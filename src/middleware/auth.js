'use strict';

const { verifyToken } = require('../services/auth.service');
const { UnauthorizedError, ForbiddenError } = require('../utils/errors');

function authenticate(req, _res, next) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');

  if (scheme !== 'Bearer' || !token) {
    return next(new UnauthorizedError('Missing bearer token'));
  }

  try {
    req.user = verifyToken(token);
    return next();
  } catch (err) {
    return next(err);
  }
}

function requireRole(...roles) {
  return (req, _res, next) => {
    if (!req.user) return next(new UnauthorizedError());
    if (!roles.includes(req.user.role)) {
      return next(new ForbiddenError(`Requires role: ${roles.join(' or ')}`));
    }
    return next();
  };
}

module.exports = { authenticate, requireRole };
