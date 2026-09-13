'use strict';

const { verifyToken } = require('../services/auth.service');
const { UnauthorizedError, ForbiddenError } = require('../utils/errors');

/** Rejects the request unless it carries a valid `Authorization: Bearer <jwt>` header. */
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

/** Rejects the request unless the authenticated user holds one of `roles`. */
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
