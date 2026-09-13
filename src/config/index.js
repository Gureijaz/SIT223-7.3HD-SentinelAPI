'use strict';

const path = require('path');

require('dotenv').config();

const ENVIRONMENTS = ['development', 'test', 'staging', 'production'];

function requiredInProduction(name, value, fallback) {
  if (value) return value;
  if (process.env.NODE_ENV === 'production') {
    throw new Error(`Environment variable ${name} must be set in production`);
  }
  return fallback;
}

const env = process.env.NODE_ENV || 'development';

if (!ENVIRONMENTS.includes(env)) {
  throw new Error(`NODE_ENV must be one of ${ENVIRONMENTS.join(', ')}, got "${env}"`);
}

// Written by `npm run build` at the Build stage; absent during local development.
let buildInfo = {};
try {
  buildInfo = require('../generated/build-info.json');
} catch {
  buildInfo = {};
}

const config = {
  env,
  port: Number(process.env.PORT || 3000),
  logLevel: process.env.LOG_LEVEL || (env === 'test' ? 'silent' : 'info'),
  dataFile: process.env.DATA_FILE || path.join(process.cwd(), 'data', `${env}.json`),
  jwt: {
    secret: requiredInProduction('JWT_SECRET', process.env.JWT_SECRET, 'dev-only-insecure-secret'),
    expiresIn: process.env.JWT_EXPIRES_IN || '2h',
  },
  bcryptRounds: Number(process.env.BCRYPT_ROUNDS || (env === 'test' ? 4 : 10)),
  rateLimit: {
    windowMs: Number(process.env.RATE_LIMIT_WINDOW_MS || 15 * 60 * 1000),
    max: Number(process.env.RATE_LIMIT_MAX || (env === 'test' ? 100000 : 300)),
  },
  release: {
    version: process.env.APP_VERSION || buildInfo.version || require('../../package.json').version,
    buildNumber: process.env.BUILD_NUMBER || buildInfo.buildNumber || 'local',
    commit: process.env.GIT_COMMIT || buildInfo.shortCommit || 'unknown',
    builtAt: buildInfo.builtAt || null,
  },
};

module.exports = config;
