'use strict';

const path = require('path');

const KEYS = [
  'NODE_ENV', 'PORT', 'LOG_LEVEL', 'DATA_FILE', 'JWT_SECRET', 'JWT_EXPIRES_IN', 'CORS_ORIGINS',
  'BCRYPT_ROUNDS', 'RATE_LIMIT_WINDOW_MS', 'RATE_LIMIT_MAX', 'APP_VERSION', 'BUILD_NUMBER', 'GIT_COMMIT',
];
const BUILD_INFO_PATH = '../../src/generated/build-info.json';

const saved = {};

beforeEach(() => {
  for (const key of KEYS) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
  jest.resetModules();
});

function loadConfig(env, buildInfo) {
  Object.assign(process.env, env);
  let config;

  jest.isolateModules(() => {
    if (buildInfo === undefined) {
      jest.doMock(BUILD_INFO_PATH, () => {
        throw new Error('missing');
      }, { virtual: true });
    } else {
      jest.doMock(BUILD_INFO_PATH, () => buildInfo, { virtual: true });
    }
    config = require('../../src/config');
  });

  return config;
}

describe('defaults', () => {
  it('falls back to development settings', () => {
    const config = loadConfig({});

    expect(config.env).toBe('development');
    expect(config.port).toBe(3000);
    expect(config.logLevel).toBe('info');
    expect(config.bcryptRounds).toBe(10);
    expect(config.rateLimit.max).toBe(300);
    expect(config.jwt.expiresIn).toBe('2h');
    expect(config.corsOrigins).toEqual([]);
    expect(config.dataFile).toBe(path.join(process.cwd(), 'data', 'development.json'));
  });

  it('reports a local build when no build info exists', () => {
    const { release } = loadConfig({});

    expect(release.buildNumber).toBe('local');
    expect(release.commit).toBe('unknown');
    expect(release.builtAt).toBeNull();
    expect(release.version).toEqual(expect.any(String));
  });

  it('uses quiet, fast settings under test', () => {
    const config = loadConfig({ NODE_ENV: 'test' });

    expect(config.logLevel).toBe('silent');
    expect(config.bcryptRounds).toBe(4);
    expect(config.rateLimit.max).toBe(100000);
  });
});

describe('overrides', () => {
  it('reads every setting from the environment', () => {
    const config = loadConfig({
      NODE_ENV: 'staging',
      PORT: '8080',
      LOG_LEVEL: 'debug',
      DATA_FILE: 'custom.json',
      JWT_SECRET: 'staging-secret',
      JWT_EXPIRES_IN: '30m',
      BCRYPT_ROUNDS: '12',
      RATE_LIMIT_WINDOW_MS: '1000',
      RATE_LIMIT_MAX: '5',
    });

    expect(config.env).toBe('staging');
    expect(config.port).toBe(8080);
    expect(config.logLevel).toBe('debug');
    expect(config.dataFile).toBe('custom.json');
    expect(config.jwt).toEqual({ secret: 'staging-secret', expiresIn: '30m' });
    expect(config.bcryptRounds).toBe(12);
    expect(config.rateLimit).toEqual({ windowMs: 1000, max: 5 });
  });

  it('splits and trims the CORS origin list', () => {
    const config = loadConfig({ CORS_ORIGINS: ' https://a.test , ,https://b.test ' });

    expect(config.corsOrigins).toEqual(['https://a.test', 'https://b.test']);
  });
});

describe('validation', () => {
  it('rejects an unknown environment', () => {
    expect(() => loadConfig({ NODE_ENV: 'qa' })).toThrow(/NODE_ENV must be one of/);
  });

  it('refuses to start in production without a signing secret', () => {
    expect(() => loadConfig({ NODE_ENV: 'production' })).toThrow(/JWT_SECRET must be set in production/);
  });

  it('starts in production when the secret is set', () => {
    const config = loadConfig({ NODE_ENV: 'production', JWT_SECRET: 'real-secret' });

    expect(config.jwt.secret).toBe('real-secret');
  });
});

describe('build info', () => {
  const info = { version: '9.9.9', buildNumber: '42', shortCommit: 'abc12345', builtAt: '2026-01-01T00:00:00Z' };

  it('reports the stamped build', () => {
    const { release } = loadConfig({}, info);

    expect(release).toEqual({ version: '9.9.9', buildNumber: '42', commit: 'abc12345', builtAt: info.builtAt });
  });

  it('prefers the stamped build over stale environment variables', () => {
    const { release } = loadConfig({ APP_VERSION: '1.2.3', BUILD_NUMBER: '7', GIT_COMMIT: 'feedbeef' }, info);

    expect(release.version).toBe('9.9.9');
    expect(release.buildNumber).toBe('42');
    expect(release.commit).toBe('abc12345');
  });

  it('falls back to environment variables when nothing was stamped', () => {
    const { release } = loadConfig({ APP_VERSION: '1.2.3', BUILD_NUMBER: '7', GIT_COMMIT: 'feedbeef' });

    expect(release.version).toBe('1.2.3');
    expect(release.buildNumber).toBe('7');
    expect(release.commit).toBe('feedbeef');
  });
});
