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
var config = require('config');
var configCoAuthoring = config.get('services.CoAuthoring');
var co = require('co');
var logger = require('./../../Common/sources/logger');
var pubsubService = require('./pubsubRabbitMQ');
var commonDefines = require('./../../Common/sources/commondefines');
var constants = require('./../../Common/sources/constants');
var utils = require('./../../Common/sources/utils');

var cfgRedisPrefix = configCoAuthoring.get('redis.prefix');
var redisKeyShutdown = cfgRedisPrefix + constants.REDIS_KEY_SHUTDOWN;

var WAIT_TIMEOUT = 30000;
var LOOP_TIMEOUT = 1000;
var EXEC_TIMEOUT = WAIT_TIMEOUT + utils.CONVERTION_TIMEOUT;

exports.shutdown = function(editorData, status) {
  return co(function*() {
    var res = true;
    try {
      logger.debug('shutdown start:' + EXEC_TIMEOUT);

      //redisKeyShutdown не простой счетчик, чтобы его не уменьшала сборка, которая началась перед запуском Shutdown
      //сбрасываем redisKeyShutdown на всякий случай, если предыдущий запуск не дошел до конца
      yield editorData.cleanupShutdown(redisKeyShutdown);

      var pubsub = new pubsubService();
      yield pubsub.initPromise();
      //inner ping to update presence
      logger.debug('shutdown pubsub shutdown message');
      pubsub.publish(JSON.stringify({type: commonDefines.c_oPublishType.shutdown, status: status}));
      //wait while pubsub deliver and start conversion
      logger.debug('shutdown start wait pubsub deliver');
      var startTime = new Date().getTime();
      var isStartWait = true;
      while (true) {
        var curTime = new Date().getTime() - startTime;
        if (isStartWait && curTime >= WAIT_TIMEOUT) {
          isStartWait = false;
          logger.debug('shutdown stop wait pubsub deliver');
        } else if (curTime >= EXEC_TIMEOUT) {
          res = false;
          logger.debug('shutdown timeout');
          break;
        }
        var remainingFiles = yield editorData.getShutdownCount(redisKeyShutdown);
        logger.debug('shutdown remaining files:%d', remainingFiles);
        if (!isStartWait && remainingFiles <= 0) {
          break;
        }
        yield utils.sleep(LOOP_TIMEOUT);
      }
      //todo надо проверять очереди, потому что могут быть долгие конвертации запущенные до Shutdown
      //clean up
      yield editorData.cleanupShutdown(redisKeyShutdown);
      yield pubsub.close();

      logger.debug('shutdown end');
    } catch (e) {
      res = false;
      logger.error('shutdown error:\r\n%s', e.stack);
    }
    return res;
  });
};
