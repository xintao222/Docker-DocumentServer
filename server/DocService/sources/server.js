/*
 * (c) Copyright Ascensio System SIA 2010-2019
 *
 * This program is a free software product. You can redistribute it and/or
 * modify it under the terms of the GNU Affero General Public License (AGPL)
 * version 3 as published by the Free Software Foundation. In accordance with
 * Section 7(a) of the GNU AGPL its Section 15 shall be amended to the effect
 * that Ascensio System SIA expressly excludes the warranty of non-infringement
 * of any third-party rights.
 *
 * This program is distributed WITHOUT ANY WARRANTY; without even the implied
 * warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR  PURPOSE. For
 * details, see the GNU AGPL at: http://www.gnu.org/licenses/agpl-3.0.html
 *
 * You can contact Ascensio System SIA at 20A-12 Ernesta Birznieka-Upisha
 * street, Riga, Latvia, EU, LV-1050.
 *
 * The  interactive user interfaces in modified source and object code versions
 * of the Program must display Appropriate Legal Notices, as required under
 * Section 5 of the GNU AGPL version 3.
 *
 * Pursuant to Section 7(b) of the License you must retain the original Product
 * logo when distributing the program. Pursuant to Section 7(e) we decline to
 * grant you any rights under trademark law for use of our trademarks.
 *
 * All the Product's GUI elements, including illustrations and icon sets, as
 * well as technical writing content are licensed under the terms of the
 * Creative Commons Attribution-ShareAlike 4.0 International. See the License
 * terms at http://creativecommons.org/licenses/by-sa/4.0/legalcode
 *
 */

'use strict';

const configCommon = require('config');
const config = configCommon.get('services.CoAuthoring');
//process.env.NODE_ENV = config.get('server.mode');
const logger = require('./../../Common/sources/logger');
const co = require('co');
const license = require('./../../Common/sources/license');
const fs = require('fs');

const express = require('express');
const http = require('http');
const urlModule = require('url');
const path = require('path');
const bodyParser = require("body-parser");
const mime = require('mime');
const docsCoServer = require('./DocsCoServer');
const canvasService = require('./canvasservice');
const converterService = require('./converterservice');
const fileUploaderService = require('./fileuploaderservice');
const constants = require('./../../Common/sources/constants');
const utils = require('./../../Common/sources/utils');
const commonDefines = require('./../../Common/sources/commondefines');
const configStorage = configCommon.get('storage');
const app = express();
const server = http.createServer(app);
const escapeHtml = require('escape-html');

let licenseInfo, updatePluginsTime, userPlugins, pluginsLoaded;

const updatePlugins = (eventType, filename) => {
	console.log('update Folder: %s ; %s', eventType, filename);
	if (updatePluginsTime && 1000 >= (new Date() - updatePluginsTime)) {
		return;
	}
	console.log('update Folder true: %s ; %s', eventType, filename);
	updatePluginsTime = new Date();
	pluginsLoaded = false;
};
const readLicense = function*() {
	licenseInfo = yield* license.readLicense();
};
const updateLicense = () => {
	return co(function*() {
		try {
			yield* readLicense();
			docsCoServer.setLicenseInfo(licenseInfo);
			console.log('End updateLicense');
		} catch (err) {
			logger.error('updateLicense error:\r\n%s', err.stack);
		}
	});
};

logger.warn('Express server starting...');

updateLicense();

let subPathRouter;

if(config.ENV_SUBPATH) {
	subPathRouter = express.Router()
	app.use(config.ENV_SUBPATH, subPathRouter);
} else {
	subPathRouter = app;
}

if (config.has('server.static_content')) {
	const staticContent = config.get('server.static_content');
	for (let i in staticContent) {
		subPathRouter.use(i, express.static(staticContent[i]['path'], staticContent[i]['options']));
	}
}

if (configStorage.has('fs.folderPath')) {
	const cfgBucketName = configStorage.get('bucketName');
	const cfgStorageFolderName = configStorage.get('storageFolderName');
	subPathRouter.use('/' + cfgBucketName + '/' + cfgStorageFolderName, (req, res, next) => {
		const index = req.url.lastIndexOf('/');
		if ('GET' === req.method && -1 != index) {
			const contentDisposition = req.query['disposition'] || 'attachment';
			let sendFileOptions = {
				root: configStorage.get('fs.folderPath'), dotfiles: 'deny', headers: {
					'Content-Disposition': contentDisposition
				}
			};
			const urlParsed = urlModule.parse(req.url);
			if (urlParsed && urlParsed.pathname) {
				const filename = decodeURIComponent(path.basename(urlParsed.pathname));
				sendFileOptions.headers['Content-Type'] = mime.getType(filename);
			}
			const realUrl = req.url.substring(0, index);
			res.sendFile(realUrl, sendFileOptions, (err) => {
				if (err) {
					logger.error(err);
					res.status(400).end();
				}
			});
		} else {
			res.sendStatus(404)
		}
	});
}

try {
	fs.watch(config.get('plugins.path'), updatePlugins);
} catch (e) {
	logger.warn('Failed to subscribe to plugin folder updates. When changing the list of plugins, you must restart the server. https://nodejs.org/docs/latest/api/fs.html#fs_availability');
}
fs.watchFile(configCommon.get('license').get('license_file'), updateLicense);
setInterval(updateLicense, 86400000);

// Если захочется использовать 'development' и 'production',
// то с помощью app.settings.env (https://github.com/strongloop/express/issues/936)
// Если нужна обработка ошибок, то теперь она такая https://github.com/expressjs/errorhandler
docsCoServer.install(server, () => {
	console.log('Start callbackFunction');

	server.listen(config.get('server.port'), () => {
		logger.warn("Express server listening on port %d in %s mode(ENV_SUBPATH : %s)", config.get('server.port'), app.settings.env, config.ENV_SUBPATH);
	});

	let subPathRouter;

	if(config.ENV_SUBPATH) {
		subPathRouter = express.Router()
		app.use(config.ENV_SUBPATH, subPathRouter);
	} else {
		subPathRouter = app;
	}

	subPathRouter.get('/view', (req, res) => {
		let fileUrl = req.query.url;
		const id = req.query.id;
		const attname = req.query.attname || ' ';
		const type = req.query.type || 'embedded';

		const urlObj = urlModule.parse(fileUrl);
		if(config.ENV_FILE_INNER_URI) {
			fileUrl = 'http://' + config.ENV_FILE_INNER_URI + urlObj.path;
		}
		const pathObj = path.parse(urlObj.pathname);
		const fileType = pathObj.ext.toString().replace('.','').toLowerCase();

		res.send('<!DOCTYPE html>\n' +
			'<html lang="en" style="height: 100%;">\n' +
			'<head>\n' +
			'    <meta charset="UTF-8">\n' +
			'    <title>' + escapeHtml(attname) + '</title>\n' +
			'</head>\n' +
			'<body style="height: 100%;margin: 0;">\n' +
			'<div width="100%" style="height: 100%;">\n' +
			'    <div id="placeholder"></div>\n' +
			'</div>\n' +
			'<script type="text/javascript" src="./web-apps/apps/api/documents/api.js"></script>\n' +
			'<script type="application/javascript">\n' +
			'  var config = {\n' +
			'      "document": {\n' +
			'        "fileType": "' + escapeHtml(fileType) + '",\n' +
			'        "title": "' + escapeHtml(attname) + '",\n' +
			'        "url": "' + escapeHtml(fileUrl).replace(/&amp;/g,'&') + '",\n' +
			'        "permissions": {\n' +
			'          "comment": false,\n' +
			'          "download": false,\n' +
			'          "edit": false,\n' +
			'          "fillForms": false,\n' +
			'          "print": true,\n' +
			'          "review": false\n' +
			'        },\n' +
			'      },\n' +
			'      "type": "' + escapeHtml(type) + '",\n' +
			'      "editorConfig": {\n' +
			'        "lang": "zh",\n' +
			'        "customization": {\n' +
			'          "logo": {\n' +
			'            "image": "https://passport.baidu.com/passApi/img/small_blank.gif",\n' +
			'            "imageEmbedded": "https://passport.baidu.com/passApi/img/small_blank.gif",\n' +
			'            "url": "https://www.baidu.com"\n' +
			'          },\n' +
			'          //"loaderName": " ",\n' +
			'          "autosave": false,\n' +
			'          "chat": false,\n' +
			'          "commentAuthorOnly": false,\n' +
			'          "comments": false,\n' +
			'          "compactHeader": false,\n' +
			'          "compactToolbar": false,\n' +
			'          "customer": {\n' +
			'            "address": "address",\n' +
			'            "info": "info",\n' +
			'            "logo": "https://passport.baidu.com/passApi/img/small_blank.gif",\n' +
			'            "mail": "mail",\n' +
			'            "name": "name",\n' +
			'            "www": "baidu.com"\n' +
			'          },\n' +
			'          "feedback": {\n' +
			'            "url": "https://example.com",\n' +
			'            "visible": false\n' +
			'          },\n' +
			'          "forcesave": false,\n' +
			'          "goback": {\n' +
			'            "blank": true,\n' +
			'            "text": "",\n' +
			'            "url": ""\n' +
			'          },\n' +
			'          "help": false,\n' +
			'          "hideRightMenu": true,\n' +
			'          "showReviewChanges": false,\n' +
			'          "toolbarNoTabs": false,\n' +
			'          "zoom": 100\n' +
			'        },\n' +
			'        "mode": "view",\n' +
			'        "plugins": {}\n' +
			'      }\n' +
			'\n' +
			'    }\n' +
			'  ;\n' +
			'  var docEditor = new DocsAPI.DocEditor("placeholder", config);\n' +
			'</script>\n' +
			'</body>\n');
	});

	subPathRouter.get('/index.html', (req, res) => {
		res.send('Server is functioning normally. Version: ' + commonDefines.buildVersion + '. Build: ' +
			commonDefines.buildNumber);
	});
	const rawFileParser = bodyParser.raw(
		{inflate: true, limit: config.get('server.limits_tempfile_upload'), type: function() {return true;}});

	subPathRouter.get('/coauthoring/CommandService.ashx', utils.checkClientIp, rawFileParser, docsCoServer.commandFromServer);
	subPathRouter.post('/coauthoring/CommandService.ashx', utils.checkClientIp, rawFileParser,
		docsCoServer.commandFromServer);

	subPathRouter.get('/ConvertService.ashx', utils.checkClientIp, rawFileParser, converterService.convertXml);
	subPathRouter.post('/ConvertService.ashx', utils.checkClientIp, rawFileParser, converterService.convertXml);
	subPathRouter.post('/converter', utils.checkClientIp, rawFileParser, converterService.convertJson);


	subPathRouter.get('/FileUploader.ashx', utils.checkClientIp, rawFileParser, fileUploaderService.uploadTempFile);
	subPathRouter.post('/FileUploader.ashx', utils.checkClientIp, rawFileParser, fileUploaderService.uploadTempFile);

	subPathRouter.param('docid', (req, res, next, val) => {
		if (constants.DOC_ID_REGEX.test(val)) {
			next();
		} else {
			res.sendStatus(403);
		}
	});
	subPathRouter.param('index', (req, res, next, val) => {
		if (!isNaN(parseInt(val))) {
			next();
		} else {
			res.sendStatus(403);
		}
	});
	subPathRouter.post('/uploadold/:docid/:userid/:index', fileUploaderService.uploadImageFileOld);
	subPathRouter.post('/upload/:docid/:userid/:index', rawFileParser, fileUploaderService.uploadImageFile);

	subPathRouter.post('/downloadas/:docid', rawFileParser, canvasService.downloadAs);
	subPathRouter.post('/savefile/:docid', rawFileParser, canvasService.saveFile);
	subPathRouter.get('/healthcheck', utils.checkClientIp, docsCoServer.healthCheck);

	subPathRouter.get('/baseurl', (req, res) => {
		res.send(utils.getBaseUrlByRequest(req));
	});

	subPathRouter.get('/robots.txt', (req, res) => {
		res.setHeader('Content-Type', 'plain/text');
		res.send("User-agent: *\nDisallow: /");
	});

	subPathRouter.post('/docbuilder', utils.checkClientIp, rawFileParser, (req, res) => {
		converterService.builder(req, res);
	});
	subPathRouter.get('/info/info.json', utils.checkClientIp, docsCoServer.licenseInfo);
	subPathRouter.put('/internal/cluster/inactive', utils.checkClientIp, docsCoServer.shutdown);
	subPathRouter.delete('/internal/cluster/inactive', utils.checkClientIp, docsCoServer.shutdown);

	const sendUserPlugins = (res, data) => {
		pluginsLoaded = true;
		res.setHeader('Content-Type', 'application/json');
		res.send(JSON.stringify(data));
	};
	subPathRouter.get('/plugins.json', (req, res) => {
		if (userPlugins && pluginsLoaded) {
			sendUserPlugins(res, userPlugins);
			return;
		}

		if (!config.has('server.static_content') || !config.has('plugins.uri')) {
			res.sendStatus(404);
			return;
		}

		let staticContent = config.get('server.static_content');
		let pluginsUri = config.get('plugins.uri');
		let pluginsPath = undefined;
		let pluginsAutostart = config.get('plugins.autostart');

		if (staticContent[pluginsUri]) {
			pluginsPath = staticContent[pluginsUri].path;
		}

		let baseUrl = '../../../..';
		utils.listFolders(pluginsPath, true).then((values) => {
			return co(function*() {
				const configFile = 'config.json';
				let stats = null;
				let result = [];
				for (let i = 0; i < values.length; ++i) {
					try {
						stats = yield utils.fsStat(path.join(values[i], configFile));
					} catch (err) {
						stats = null;
					}

					if (stats && stats.isFile) {
						result.push( baseUrl + pluginsUri + '/' + path.basename(values[i]) + '/' + configFile);
					}
				}

				userPlugins = {'url': '', 'pluginsData': result, 'autostart': pluginsAutostart};
				sendUserPlugins(res, userPlugins);
			});
		});
	});
});

process.on('uncaughtException', (err) => {
	logger.error((new Date).toUTCString() + ' uncaughtException:', err.message);
	logger.error(err.stack);
	logger.shutdown(() => {
		process.exit(1);
	});
});
