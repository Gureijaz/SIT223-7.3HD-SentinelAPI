'use strict';

const request = require('supertest');

const createApp = require('../../src/app');
const { store } = require('../../src/repositories');

const app = createApp();

const ADMIN = {
  email: 'admin@sentinel.test',
  password: 'CorrectHorseBattery1',
  name: 'Admin User',
};

const ANALYST = {
  email: 'analyst@sentinel.test',
  password: 'AnotherStrongPass9',
  name: 'Analyst User',
};

const SAMPLE_FINDING = {
  title: 'Unauthenticated Redis exposed on the staging subnet',
  description: 'Redis 6.2 is listening on 0.0.0.0:6379 with no requirepass set.',
  severity: 'critical',
  asset: 'staging-cache-01',
  cve: 'CVE-2022-0543',
  cvss: 9.8,
  tags: ['redis', 'exposure'],
};

/** Registers a user and returns the bearer token plus the public user record. */
async function registerUser(credentials) {
  const response = await request(app).post('/api/auth/register').send(credentials).expect(201);
  return { token: response.body.token, user: response.body.user };
}

/** Resets storage, then seeds an admin (registered first) and an analyst. */
async function seedUsers() {
  store.reset();
  const admin = await registerUser(ADMIN);
  const analyst = await registerUser(ANALYST);
  return { admin, analyst };
}

function auth(token) {
  return { Authorization: `Bearer ${token}` };
}

module.exports = { app, request, store, registerUser, seedUsers, auth, ADMIN, ANALYST, SAMPLE_FINDING };
