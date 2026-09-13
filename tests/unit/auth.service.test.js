'use strict';

const authService = require('../../src/services/auth.service');
const { store, usersRepository } = require('../../src/repositories');
const { ConflictError, UnauthorizedError } = require('../../src/utils/errors');

const CREDENTIALS = {
  email: 'first.analyst@example.com',
  password: 'CorrectHorseBattery1',
  name: 'First Analyst',
};

beforeEach(() => store.reset());

describe('register', () => {
  it('hashes the password and never returns it', async () => {
    const { user, token } = await authService.register(CREDENTIALS);

    expect(user.passwordHash).toBeUndefined();
    expect(user.email).toBe('first.analyst@example.com');
    expect(typeof token).toBe('string');

    const stored = usersRepository.findByEmail(CREDENTIALS.email);
    expect(stored.passwordHash).not.toBe(CREDENTIALS.password);
    expect(stored.passwordHash).toMatch(/^\$2[aby]\$/);
  });

  it('promotes the very first account to admin', async () => {
    const { user } = await authService.register(CREDENTIALS);
    expect(user.role).toBe('admin');
  });

  it('defaults every later account to analyst', async () => {
    await authService.register(CREDENTIALS);
    const { user } = await authService.register({ ...CREDENTIALS, email: 'second@example.com' });

    expect(user.role).toBe('analyst');
  });

  it('honours an explicitly requested role', async () => {
    const { user } = await authService.register({ ...CREDENTIALS, role: 'analyst' });
    expect(user.role).toBe('analyst');
  });

  it('lowercases the email so addresses cannot be duplicated by case', async () => {
    await authService.register({ ...CREDENTIALS, email: 'Mixed.Case@Example.com' });

    await expect(
      authService.register({ ...CREDENTIALS, email: 'mixed.case@example.com' }),
    ).rejects.toThrow(ConflictError);
  });
});

describe('login', () => {
  beforeEach(() => authService.register(CREDENTIALS));

  it('returns a verifiable token for correct credentials', async () => {
    const { token, user } = await authService.login({
      email: CREDENTIALS.email,
      password: CREDENTIALS.password,
    });

    const claims = authService.verifyToken(token);
    expect(claims.sub).toBe(user.id);
    expect(claims.role).toBe('admin');
  });

  it('rejects a wrong password', async () => {
    await expect(
      authService.login({ email: CREDENTIALS.email, password: 'WrongPassword123' }),
    ).rejects.toThrow(UnauthorizedError);
  });

  it('rejects an unknown account with the same error as a wrong password', async () => {
    await expect(
      authService.login({ email: 'nobody@example.com', password: CREDENTIALS.password }),
    ).rejects.toThrow('Invalid email or password');
  });
});

describe('verifyToken', () => {
  it('rejects a tampered token', () => {
    expect(() => authService.verifyToken('not.a.jwt')).toThrow(UnauthorizedError);
  });
});
