'use strict';

const createApp = require('./app');
const config = require('./config');
const logger = require('./utils/logger');

const app = createApp();

const server = app.listen(config.port, () => {
  logger.info(
    {
      port: config.port,
      env: config.env,
      version: config.release.version,
      build: config.release.buildNumber,
    },
    'sentinel-api listening',
  );
});

function shutdown(signal) {
  logger.info({ signal }, 'shutting down');
  server.close(() => process.exit(0));

  // Force the process down if connections refuse to drain, so PM2 restarts
  // during a deploy never hang the pipeline.
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

module.exports = server;
