'use strict';

const pino = require('pino');
const config = require('../config');

const logger = pino({
  level: config.logLevel,
  base: {
    service: 'sentinel-api',
    env: config.env,
    version: config.release.version,
  },
  redact: {
    paths: ['req.headers.authorization', 'password', '*.password'],
    censor: '[redacted]',
  },
});

module.exports = logger;
