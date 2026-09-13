'use strict';

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const pinoHttp = require('pino-http');

const config = require('./config');
const logger = require('./utils/logger');
const { metricsMiddleware } = require('./middleware/metrics');
const { notFoundHandler, errorHandler } = require('./middleware/errorHandler');

const authRoutes = require('./routes/auth.routes');
const findingsRoutes = require('./routes/findings.routes');
const healthRoutes = require('./routes/health.routes');

function createApp() {
  const app = express();

  app.disable('x-powered-by');
  app.use(helmet());
  app.use(cors());
  app.use(compression());
  app.use(express.json({ limit: '256kb' }));

  if (config.env !== 'test') {
    app.use(pinoHttp({ logger, autoLogging: { ignore: (req) => req.url === '/metrics' } }));
  }

  app.use(metricsMiddleware);

  // Health and metrics endpoints sit outside the rate limiter: Prometheus scrapes
  // /metrics every 15s and would otherwise trip it during a load spike.
  app.use('/', healthRoutes);

  app.use(rateLimit({
    windowMs: config.rateLimit.windowMs,
    max: config.rateLimit.max,
    standardHeaders: true,
    legacyHeaders: false,
  }));

  app.use('/api/auth', authRoutes);
  app.use('/api/findings', findingsRoutes);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

module.exports = createApp;
