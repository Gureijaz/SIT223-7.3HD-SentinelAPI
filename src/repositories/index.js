'use strict';

const JsonStore = require('./jsonStore');
const config = require('../config');

const store = new JsonStore(config.dataFile);

const usersRepository = {
  findByEmail(email) {
    return store.collection('users').find((u) => u.email === email.toLowerCase()) || null;
  },

  findById(id) {
    return store.collection('users').find((u) => u.id === id) || null;
  },

  insert(user) {
    store.collection('users').push(user);
    store.flush();
    return user;
  },

  count() {
    return store.collection('users').length;
  },
};

const findingsRepository = {
  all() {
    return store.collection('findings');
  },

  findById(id) {
    return store.collection('findings').find((f) => f.id === id) || null;
  },

  insert(finding) {
    store.collection('findings').push(finding);
    store.flush();
    return finding;
  },

  update(id, patch) {
    const findings = store.collection('findings');
    const index = findings.findIndex((f) => f.id === id);
    if (index === -1) return null;

    findings[index] = { ...findings[index], ...patch };
    store.flush();
    return findings[index];
  },

  remove(id) {
    const findings = store.collection('findings');
    const index = findings.findIndex((f) => f.id === id);
    if (index === -1) return false;

    findings.splice(index, 1);
    store.flush();
    return true;
  },
};

module.exports = { store, usersRepository, findingsRepository };
