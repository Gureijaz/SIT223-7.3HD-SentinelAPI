'use strict';

const { randomUUID } = require('crypto');

const { findingsRepository } = require('../repositories');
const { NotFoundError, ForbiddenError } = require('../utils/errors');
const { scoreFinding, summarise } = require('./risk');
const { SEVERITIES } = require('../schemas');

const SEVERITY_ORDER = Object.fromEntries(SEVERITIES.map((s, i) => [s, SEVERITIES.length - i]));

function decorate(finding, now = Date.now()) {
  return { ...finding, riskScore: scoreFinding(finding, now) };
}

function matches(finding, query) {
  if (query.severity && finding.severity !== query.severity) return false;
  if (query.status && finding.status !== query.status) return false;
  if (query.asset && finding.asset !== query.asset) return false;

  if (query.q) {
    const needle = query.q.toLowerCase();
    const haystack = [finding.title, finding.description, finding.cve, ...(finding.tags || [])]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    if (!haystack.includes(needle)) return false;
  }

  return true;
}

function compare(a, b, sort) {
  if (sort === 'severity') return SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
  if (sort === 'cvss') return (a.cvss || 0) - (b.cvss || 0);
  if (sort === 'title') return a.title.localeCompare(b.title);
  return Date.parse(a.createdAt) - Date.parse(b.createdAt);
}

function list(query) {
  const now = Date.now();
  const filtered = findingsRepository.all().filter((f) => matches(f, query));

  const sorted = [...filtered].sort((a, b) => {
    const result = compare(a, b, query.sort);
    return query.order === 'asc' ? result : -result;
  });

  const start = (query.page - 1) * query.limit;
  const items = sorted.slice(start, start + query.limit).map((f) => decorate(f, now));

  return {
    items,
    pagination: {
      page: query.page,
      limit: query.limit,
      total: filtered.length,
      pages: Math.max(1, Math.ceil(filtered.length / query.limit)),
    },
  };
}

function get(id) {
  const finding = findingsRepository.findById(id);
  if (!finding) throw new NotFoundError('Finding');
  return decorate(finding);
}

function create(payload, actor) {
  const now = new Date().toISOString();

  const finding = {
    id: randomUUID(),
    ...payload,
    reportedBy: actor.sub,
    createdAt: now,
    updatedAt: now,
  };

  findingsRepository.insert(finding);
  return decorate(finding);
}

function update(id, patch, actor) {
  const existing = findingsRepository.findById(id);
  if (!existing) throw new NotFoundError('Finding');

  // Analysts own what they reported; admins can edit anything.
  if (actor.role !== 'admin' && existing.reportedBy !== actor.sub) {
    throw new ForbiddenError('Only the reporter or an admin can modify this finding');
  }

  const updated = findingsRepository.update(id, { ...patch, updatedAt: new Date().toISOString() });
  return decorate(updated);
}

function remove(id, actor) {
  const existing = findingsRepository.findById(id);
  if (!existing) throw new NotFoundError('Finding');

  if (actor.role !== 'admin') {
    throw new ForbiddenError('Only an admin can delete findings');
  }

  findingsRepository.remove(id);
}

function stats() {
  return summarise(findingsRepository.all());
}

module.exports = { list, get, create, update, remove, stats, decorate };
