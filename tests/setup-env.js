'use strict';

const os = require('os');
const path = require('path');
const { randomUUID } = require('crypto');

// Every test file gets its own data file so suites can never see each other's
// writes, even when Jest runs them in parallel workers.
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-only-secret-not-used-anywhere-else';
process.env.LOG_LEVEL = 'silent';
process.env.DATA_FILE = path.join(os.tmpdir(), 'sentinel-api-tests', `${randomUUID()}.json`);
