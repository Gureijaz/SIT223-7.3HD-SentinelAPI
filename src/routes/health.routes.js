'use strict';

const express = require('express');

const config = require('../config');
const { registry } = require('../middleware/metrics');

const router = express.Router();
const startedAt = Date.now();

/** Liveness probe: cheap, never touches storage, used by the deploy smoke test. */
router.get('/health', (_req, res) => {
  res.status(200).json({
    status: 'ok',
    env: config.env,
    version: config.release.version,
    build: config.release.buildNumber,
    commit: config.release.commit,
    uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
  });
});

/** Readiness probe: verifies the storage layer actually answers before taking traffic. */
router.get('/ready', (_req, res) => {
  try {
    require('../repositories').store.load();
    res.status(200).json({ status: 'ready' });
  } catch (err) {
    res.status(503).json({ status: 'not_ready', reason: err.message });
  }
});

router.get('/metrics', async (_req, res, next) => {
  try {
    res.set('Content-Type', registry.contentType);
    res.status(200).send(await registry.metrics());
  } catch (err) {
    next(err);
  }
});

module.exports = router;
