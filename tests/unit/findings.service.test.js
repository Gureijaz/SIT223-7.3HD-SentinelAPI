'use strict';

const findingsService = require('../../src/services/findings.service');
const { store, findingsRepository, usersRepository } = require('../../src/repositories');
const { ForbiddenError, NotFoundError } = require('../../src/utils/errors');
const { summarise } = require('../../src/services/risk');

const OWNER = { sub: 'owner-1', role: 'analyst' };
const OTHER = { sub: 'other-2', role: 'analyst' };
const ADMIN = { sub: 'admin-3', role: 'admin' };

const PAYLOAD = {
  title: 'Exposed admin panel',
  description: '',
  severity: 'high',
  status: 'open',
  asset: 'web-01',
  tags: [],
};

beforeEach(() => store.reset());

describe('findings service', () => {
  it('rejects a lookup for a finding that does not exist', () => {
    expect(() => findingsService.get('nope')).toThrow(NotFoundError);
  });

  it('rejects an update to a finding that does not exist', () => {
    expect(() => findingsService.update('nope', { status: 'resolved' }, ADMIN)).toThrow(NotFoundError);
  });

  it('stops an analyst editing a finding that belongs to someone else', () => {
    const created = findingsService.create(PAYLOAD, OWNER);

    expect(() => findingsService.update(created.id, { status: 'resolved' }, OTHER)).toThrow(ForbiddenError);
  });

  it('stops an analyst deleting a finding', () => {
    const created = findingsService.create(PAYLOAD, OWNER);

    expect(() => findingsService.remove(created.id, OWNER)).toThrow(ForbiddenError);
  });

  it('rejects a delete for a finding that does not exist', () => {
    expect(() => findingsService.remove('nope', ADMIN)).toThrow(NotFoundError);
  });

  it('lets an admin delete a finding', () => {
    const created = findingsService.create(PAYLOAD, OWNER);

    findingsService.remove(created.id, ADMIN);

    expect(findingsRepository.findById(created.id)).toBeNull();
  });

  it('summarises the register through the stats call', () => {
    findingsService.create(PAYLOAD, OWNER);

    expect(findingsService.stats().total).toBe(1);
  });
});

describe('repositories', () => {
  it('returns null when updating a finding that is not there', () => {
    expect(findingsRepository.update('nope', { status: 'open' })).toBeNull();
  });

  it('returns false when removing a finding that is not there', () => {
    expect(findingsRepository.remove('nope')).toBe(false);
  });

  it('returns null for an unknown user id', () => {
    expect(usersRepository.findById('nope')).toBeNull();
  });
});

describe('risk summary with unrecognised values', () => {
  it('counts a status it has never seen and scores it without damping', () => {
    const finding = {
      severity: 'low',
      status: 'mystery',
      createdAt: new Date().toISOString(),
    };

    const result = summarise([finding]);

    expect(result.byStatus.mystery).toBe(1);
    expect(result.riskTotal).toBeGreaterThan(0);
  });
});
