'use strict';

const logger = require('../utils/logger');
const { AppError, NotFoundError } = require('../utils/errors');

function notFoundHandler(req, _res, next) {
  next(new NotFoundError(`Route ${req.method} ${req.path}`));
}

// Express identifies error handlers by their four-argument signature, so the
// unused `next` parameter has to stay.
function errorHandler(err, req, res, _next) {
  if (err instanceof AppError) {
    logger.warn({ err: { code: err.code, message: err.message }, path: req.path }, 'handled error');

    return res.status(err.statusCode).json({
      error: { code: err.code, message: err.message, details: err.details },
    });
  }

  logger.error({ err, path: req.path }, 'unhandled error');

  return res.status(500).json({
    error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' },
  });
}

module.exports = { notFoundHandler, errorHandler };
