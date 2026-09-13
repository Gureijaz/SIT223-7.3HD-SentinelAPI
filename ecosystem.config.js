'use strict';

/**
 * PM2 process definitions for the two deployment environments.
 *
 * Staging (3001) is what the Deploy stage releases to and smoke-tests; production
 * (3000) is what the Release stage promotes to once staging is green. Both run
 * from the same checked-out artefact, so the only difference between them is
 * configuration - the classic build-once/deploy-many rule.
 *
 * Secrets are never written here: JWT_SECRET is injected by Jenkins from its
 * credential store at deploy time and inherited by the child process.
 */

const path = require('path');

const shared = {
  script: path.join(__dirname, 'src', 'server.js'),
  instances: 1,
  exec_mode: 'fork',
  autorestart: true,
  max_restarts: 10,
  min_uptime: '10s',
  max_memory_restart: '300M',
  time: true,
  merge_logs: true,
  kill_timeout: 10000,
};

module.exports = {
  apps: [
    {
      ...shared,
      name: 'sentinel-api-staging',
      out_file: path.join(__dirname, 'logs', 'staging-out.log'),
      error_file: path.join(__dirname, 'logs', 'staging-err.log'),
      env: {
        NODE_ENV: 'staging',
        PORT: 3001,
        LOG_LEVEL: 'debug',
        DATA_FILE: path.join(__dirname, 'data', 'staging.json'),
        RATE_LIMIT_MAX: 10000,
      },
    },
    {
      ...shared,
      name: 'sentinel-api-production',
      out_file: path.join(__dirname, 'logs', 'production-out.log'),
      error_file: path.join(__dirname, 'logs', 'production-err.log'),
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
        LOG_LEVEL: 'info',
        DATA_FILE: path.join(__dirname, 'data', 'production.json'),
        RATE_LIMIT_MAX: 300,
      },
    },
  ],
};
