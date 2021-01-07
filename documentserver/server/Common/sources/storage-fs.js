/*
 * Copyright (C) Ascensio System SIA 2012-2019. All rights reserved
 *
 * https://www.onlyoffice.com/ 
 *
 * Version: 5.4.2 (build:46)
 */


'use strict';

var fs = require('fs');
const fse = require('fs-extra')
var path = require('path');
var mkdirp = require('mkdirp');
var utils = require("./utils");
var crypto = require('crypto');
const ms = require('ms');
const commonDefines = require('./../../Common/sources/commondefines');

var config = require('config');
var configStorage = config.get('storage');
var cfgBucketName = configStorage.get('bucketName');
var cfgStorageFolderName = configStorage.get('storageFolderName');
var cfgStorageExternalHost = configStorage.get('externalHost');
var configFs = configStorage.get('fs');
var cfgStorageFolderPath = configFs.get('folderPath');
var cfgStorageSecretString = configFs.get('secretString');
var cfgStorageUrlExpires = configFs.get('urlExpires');
const cfgExpSessionAbsolute = ms(config.get('services.CoAuthoring.expire.sessionabsolute'));
const cfgCoAuthoring = config.get('services.CoAuthoring');
const cfgEnvSubpath = cfgCoAuthoring.get('env.subpath');

function getFilePath(strPath) {
  return path.join(cfgStorageFolderPath, strPath);
}
function getOutputPath(strPath) {
  return strPath.replace(/\\/g, '/');
}
function removeEmptyParent(strPath, done) {
  if (cfgStorageFolderPath.length + 1 >= strPath.length) {
    done();
  } else {
    fs.readdir(strPath, function(err, list) {
      if (err) {
        done();
      } else {
        if (list.length > 0) {
          done();
        } else {
          fs.rmdir(strPath, function(err) {
            if (err) {
              done();
            } else {
              removeEmptyParent(path.dirname(strPath), function(err) {
                done(err);
              });
            }
          });
        }
      }
    });
  }
}

exports.getObject = function(strPath) {
  return utils.readFile(getFilePath(strPath));
};

exports.putObject = function(strPath, buffer, contentLength) {
  return new Promise(function(resolve, reject) {
    var fsPath = getFilePath(strPath);
    mkdirp(path.dirname(fsPath), function(err) {
      if (err) {
        reject(err);
      } else {
        if (Buffer.isBuffer(buffer)) {
          fs.writeFile(fsPath, buffer, function(err) {
            if (err) {
              reject(err);
            } else {
              resolve();
            }
          });
        } else {
          utils.promiseCreateWriteStream(fsPath).then(function(writable) {
            buffer.pipe(writable);
          }).catch(function(err) {
            reject(err);
          });
        }
      }
    });
  });
};
exports.uploadObject = function(strPath, filePath) {
  let fsPath = getFilePath(strPath);
  return fse.copy(filePath, fsPath);
};
exports.copyObject = function(sourceKey, destinationKey) {
  let fsPathSource = getFilePath(sourceKey);
  let fsPathSestination = getFilePath(destinationKey);
  return fse.copy(fsPathSource, fsPathSestination);
};
exports.listObjects = function(strPath) {
  return utils.listObjects(getFilePath(strPath)).then(function(values) {
    return values.map(function(curvalue) {
      return getOutputPath(curvalue.substring(cfgStorageFolderPath.length + 1));
    });
  });
};
exports.deleteObject = function(strPath) {
  return new Promise(function(resolve, reject) {
    const fsPath = getFilePath(strPath);
    fs.unlink(fsPath, function(err) {
      if (err) {
        reject(err);
      } else {
        removeEmptyParent(path.dirname(fsPath), function(err) {
          if (err) {
            reject(err);
          } else {
            resolve();
          }
        });
      }
    });
  });
};
exports.deleteObjects = function(strPaths) {
  return Promise.all(strPaths.map(exports.deleteObject));
};
exports.getSignedUrl = function(baseUrl, strPath, urlType, optFilename, opt_type) {
  return new Promise(function(resolve, reject) {
    var userFriendlyName = optFilename ? encodeURIComponent(optFilename.replace(/\//g, "%2f")) : path.basename(strPath);
    var uri = cfgEnvSubpath + '/' + cfgBucketName + '/' + cfgStorageFolderName + '/' + strPath + '/' + userFriendlyName;
    var url = (cfgStorageExternalHost ? cfgStorageExternalHost : baseUrl) + uri;

    var date = new Date();
    var expires = Math.ceil(date.getTime() / 1000);
    expires += (commonDefines.c_oAscUrlTypes.Session === urlType ? (cfgExpSessionAbsolute / 1000) : cfgStorageUrlExpires) || 31536000;

    var md5 = crypto.createHash('md5').update(expires + decodeURIComponent(uri) + cfgStorageSecretString).digest("base64");
    md5 = md5.replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");

    url += '?md5=' + encodeURIComponent(md5);
    url += '&expires=' + encodeURIComponent(expires);
    url += '&disposition=' + encodeURIComponent(utils.getContentDisposition(null, null, opt_type));
    resolve(utils.changeOnlyOfficeUrl(url, strPath, optFilename));
  });
};
