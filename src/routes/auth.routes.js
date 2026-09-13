'use strict';

const express = require('express');

const { parse } = require('../utils/validate');
const { registerSchema, loginSchema } = require('../schemas');
const authService = require('../services/auth.service');
const { authenticate } = require('../middleware/auth');
const { usersRepository } = require('../repositories');
const { toPublicUser } = require('../services/auth.service');
const { NotFoundError } = require('../utils/errors');

const router = express.Router();

router.post('/register', async (req, res, next) => {
  try {
    const payload = parse(registerSchema, req.body);
    const result = await authService.register(payload);
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

router.post('/login', async (req, res, next) => {
  try {
    const payload = parse(loginSchema, req.body);
    const result = await authService.login(payload);
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
});

router.get('/me', authenticate, (req, res, next) => {
  try {
    const user = usersRepository.findById(req.user.sub);
    if (!user) throw new NotFoundError('User');
    res.status(200).json({ user: toPublicUser(user) });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
