'use strict';

const {
  AppError,
  ValidationError,
  UnauthorizedError,
  ForbiddenError,
  NotFoundError,
  ConflictError,
} = require('../../src/utils/errors');

describe('error types', () => {
  it.each([
    [new ValidationError([]), 400, 'VALIDATION_ERROR'],
    [new UnauthorizedError(), 401, 'UNAUTHORIZED'],
    [new ForbiddenError(), 403, 'FORBIDDEN'],
    [new NotFoundError(), 404, 'NOT_FOUND'],
    [new ConflictError(), 409, 'CONFLICT'],
  ])('%s carries the right status code and error code', (err, statusCode, code) => {
    expect(err).toBeInstanceOf(AppError);
    expect(err).toBeInstanceOf(Error);
    expect(err.statusCode).toBe(statusCode);
    expect(err.code).toBe(code);
    expect(err.expected).toBe(true);
    expect(err.stack).toBeTruthy();
  });

  it('names the missing resource in a NotFoundError message', () => {
    expect(new NotFoundError('Finding').message).toBe('Finding not found');
  });

  it('keeps a custom message when one is supplied', () => {
    expect(new ForbiddenError('Admins only').message).toBe('Admins only');
  });
});
