'use strict';

const express = require('express');

const { parse } = require('../utils/validate');
const {
  createFindingSchema,
  updateFindingSchema,
  listFindingsSchema,
} = require('../schemas');
const findingsService = require('../services/findings.service');
const { authenticate, requireRole } = require('../middleware/auth');
const { findingsCreatedTotal } = require('../middleware/metrics');

const router = express.Router();

router.use(authenticate);

router.get('/', (req, res, next) => {
  try {
    const query = parse(listFindingsSchema, req.query);
    res.status(200).json(findingsService.list(query));
  } catch (err) {
    next(err);
  }
});

router.get('/stats', (req, res, next) => {
  try {
    res.status(200).json(findingsService.stats());
  } catch (err) {
    next(err);
  }
});

router.get('/:id', (req, res, next) => {
  try {
    res.status(200).json(findingsService.get(req.params.id));
  } catch (err) {
    next(err);
  }
});

router.post('/', (req, res, next) => {
  try {
    const payload = parse(createFindingSchema, req.body);
    const finding = findingsService.create(payload, req.user);
    findingsCreatedTotal.inc({ severity: finding.severity });
    res.status(201).json(finding);
  } catch (err) {
    next(err);
  }
});

router.patch('/:id', (req, res, next) => {
  try {
    const patch = parse(updateFindingSchema, req.body);
    res.status(200).json(findingsService.update(req.params.id, patch, req.user));
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', requireRole('admin'), (req, res, next) => {
  try {
    findingsService.remove(req.params.id, req.user);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

module.exports = router;
