'use strict';

const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { randomUUID } = require('crypto');

const config = require('../config');
const { usersRepository } = require('../repositories');
const { ConflictError, UnauthorizedError } = require('../utils/errors');

function toPublicUser(user) {
  const { passwordHash, ...rest } = user;
  void passwordHash;
  return rest;
}

function issueToken(user) {
  return jwt.sign(
    { sub: user.id, email: user.email, role: user.role },
    config.jwt.secret,
    { expiresIn: config.jwt.expiresIn },
  );
}

async function register({ email, password, name, role }) {
  const normalisedEmail = email.toLowerCase();

  if (usersRepository.findByEmail(normalisedEmail)) {
    throw new ConflictError('An account with that email already exists');
  }

  // The first account to register bootstraps the instance as an admin; every
  // later account defaults to analyst unless an admin explicitly asks otherwise.
  const isBootstrap = usersRepository.count() === 0;

  const user = {
    id: randomUUID(),
    email: normalisedEmail,
    name,
    role: role || (isBootstrap ? 'admin' : 'analyst'),
    passwordHash: await bcrypt.hash(password, config.bcryptRounds),
    createdAt: new Date().toISOString(),
  };

  usersRepository.insert(user);

  return { user: toPublicUser(user), token: issueToken(user) };
}

async function login({ email, password }) {
  const user = usersRepository.findByEmail(email);

  // Compare against a dummy hash when the account is missing so that a failed
  // lookup and a wrong password take the same amount of time.
  const hash = user ? user.passwordHash : '$2a$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvali';
  const matches = await bcrypt.compare(password, hash);

  if (!user || !matches) {
    throw new UnauthorizedError('Invalid email or password');
  }

  return { user: toPublicUser(user), token: issueToken(user) };
}

function verifyToken(token) {
  try {
    return jwt.verify(token, config.jwt.secret);
  } catch {
    throw new UnauthorizedError('Invalid or expired token');
  }
}

module.exports = { register, login, verifyToken, issueToken, toPublicUser };
