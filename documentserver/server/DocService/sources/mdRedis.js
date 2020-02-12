'use strict';
var config = require('config').get('services.CoAuthoring.redis1');
var logger = require('./../../Common/sources/logger');
var redis = require(config.get('name'));

var cfgRedisHost = config.get('host');
var cfgRedisPort = config.get('port');

function createClientRedis() {
  var redisClient = redis.createClient(cfgRedisPort, cfgRedisHost, {});
  redisClient.on('error', function (err) {
    logger.error('redisClient error %s', err.toString());
  });
  return redisClient;
}

var g_redisClient = null;

function getClientRedis() {
  if (!g_redisClient) {
    g_redisClient = createClientRedis();
  }
  return g_redisClient;
}

module.exports.getClientRedis = getClientRedis;
