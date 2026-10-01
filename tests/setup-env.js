'use strict';

const os = require('os');
const path = require('path');
const { randomUUID } = require('crypto');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-only-secret-not-used-anywhere-else';
process.env.LOG_LEVEL = 'silent';
process.env.CORS_ORIGINS = 'https://sentinel.test';
process.env.DATA_FILE = path.join(os.tmpdir(), 'sentinel-api-tests', `${randomUUID()}.json`);
