'use strict';

const { app, request, store, seedUsers, auth, SAMPLE_FINDING } = require('../helpers');
const { registry } = require('../../src/middleware/metrics');

describe('failure handling', () => {
  afterEach(() => jest.restoreAllMocks());

  it('reports not ready when storage cannot be read', async () => {
    jest.spyOn(store, 'load').mockImplementation(() => {
      throw new Error('disk gone');
    });

    const response = await request(app).get('/ready').expect(503);

    expect(response.body).toEqual({ status: 'not_ready', reason: 'disk gone' });
  });

  it('returns a 500 envelope when metrics cannot be collected', async () => {
    jest.spyOn(registry, 'metrics').mockRejectedValue(new Error('registry broke'));

    const response = await request(app).get('/metrics').expect(500);

    expect(response.body.error.code).toBe('INTERNAL_ERROR');
    expect(JSON.stringify(response.body)).not.toContain('registry broke');
  });

  it('returns 404 for a valid token whose user no longer exists', async () => {
    const { admin } = await seedUsers();
    store.reset();

    const response = await request(app).get('/api/auth/me').set(auth(admin.token)).expect(404);

    expect(response.body.error.message).toBe('User not found');
  });
});

describe('findings queries', () => {
  let analyst;

  beforeEach(async () => {
    ({ analyst } = await seedUsers());

    const rows = [
      { title: 'Bravo exposure', severity: 'low', cvss: 2.5, asset: 'a1', status: 'open', tags: ['alpha'] },
      { title: 'Alpha exposure', severity: 'high', cvss: 8.1, asset: 'a2', status: 'triaged', tags: ['beta'] },
      { title: 'Charlie exposure', severity: 'medium', cvss: 5.5, asset: 'a1', status: 'open', tags: [] },
    ];

    for (const row of rows) {
      await request(app)
        .post('/api/findings')
        .set(auth(analyst.token))
        .send({ ...SAMPLE_FINDING, cve: undefined, ...row })
        .expect(201);
    }
  });

  async function titles(query) {
    const response = await request(app).get(`/api/findings?${query}`).set(auth(analyst.token)).expect(200);
    return response.body.items.map((f) => f.title);
  }

  it('sorts by title ascending', async () => {
    expect(await titles('sort=title&order=asc')).toEqual(['Alpha exposure', 'Bravo exposure', 'Charlie exposure']);
  });

  it('sorts by CVSS descending', async () => {
    expect(await titles('sort=cvss&order=desc')).toEqual(['Alpha exposure', 'Charlie exposure', 'Bravo exposure']);
  });

  it('sorts by creation time ascending', async () => {
    expect(await titles('sort=createdAt&order=asc')).toEqual(['Bravo exposure', 'Alpha exposure', 'Charlie exposure']);
  });

  it('filters by status', async () => {
    expect(await titles('status=triaged')).toEqual(['Alpha exposure']);
  });

  it('matches the search text against tags', async () => {
    expect(await titles('q=beta')).toEqual(['Alpha exposure']);
  });

  it('returns nothing when the search text matches no finding', async () => {
    expect(await titles('q=zzz-no-match')).toEqual([]);
  });

  it('returns 404 when patching a finding that does not exist', async () => {
    const response = await request(app)
      .patch('/api/findings/00000000-0000-0000-0000-000000000000')
      .set(auth(analyst.token))
      .send({ status: 'resolved' })
      .expect(404);

    expect(response.body.error.code).toBe('NOT_FOUND');
  });
});
