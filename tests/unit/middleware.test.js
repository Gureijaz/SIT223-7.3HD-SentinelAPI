'use strict';

const { errorHandler, notFoundHandler } = require('../../src/middleware/errorHandler');
const { requireRole } = require('../../src/middleware/auth');
const { AppError, ForbiddenError, NotFoundError, UnauthorizedError } = require('../../src/utils/errors');

function mockRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

describe('errorHandler', () => {
  it('returns the status and code of an application error', () => {
    const res = mockRes();
    const err = new AppError('Teapot', 418, 'TEAPOT', [{ field: 'x' }]);

    errorHandler(err, { path: '/brew' }, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(418);
    expect(res.json).toHaveBeenCalledWith({
      error: { code: 'TEAPOT', message: 'Teapot', details: [{ field: 'x' }] },
    });
  });

  it('hides the details of an unexpected error behind a 500', () => {
    const res = mockRes();

    errorHandler(new Error('database password is hunter2'), { path: '/boom' }, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(500);
    const body = res.json.mock.calls[0][0];
    expect(body.error.code).toBe('INTERNAL_ERROR');
    expect(JSON.stringify(body)).not.toContain('hunter2');
  });
});

describe('notFoundHandler', () => {
  it('passes a NotFoundError naming the route to next', () => {
    const next = jest.fn();

    notFoundHandler({ method: 'GET', path: '/nowhere' }, mockRes(), next);

    const err = next.mock.calls[0][0];
    expect(err).toBeInstanceOf(NotFoundError);
    expect(err.message).toBe('Route GET /nowhere not found');
  });
});

describe('requireRole', () => {
  it('rejects a request that was never authenticated', () => {
    const next = jest.fn();

    requireRole('admin')({}, mockRes(), next);

    expect(next.mock.calls[0][0]).toBeInstanceOf(UnauthorizedError);
  });

  it('rejects a user without the role', () => {
    const next = jest.fn();

    requireRole('admin')({ user: { role: 'analyst' } }, mockRes(), next);

    expect(next.mock.calls[0][0]).toBeInstanceOf(ForbiddenError);
  });

  it('lets a user with the role through', () => {
    const next = jest.fn();

    requireRole('admin', 'analyst')({ user: { role: 'analyst' } }, mockRes(), next);

    expect(next).toHaveBeenCalledWith();
  });
});
