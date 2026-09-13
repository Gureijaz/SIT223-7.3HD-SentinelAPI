'use strict';

const { app, request, seedUsers, auth, SAMPLE_FINDING } = require('../helpers');

let admin;
let analyst;

beforeEach(async () => {
  ({ admin, analyst } = await seedUsers());
});

async function createFinding(token, overrides = {}) {
  const response = await request(app)
    .post('/api/findings')
    .set(auth(token))
    .send({ ...SAMPLE_FINDING, ...overrides })
    .expect(201);

  return response.body;
}

describe('POST /api/findings', () => {
  it('creates a finding, attributes it to the reporter and returns a risk score', async () => {
    const finding = await createFinding(analyst.token);

    expect(finding.id).toEqual(expect.any(String));
    expect(finding.reportedBy).toBe(analyst.user.id);
    expect(finding.status).toBe('open');
    expect(finding.riskScore).toBeGreaterThan(0);
    expect(finding.createdAt).toEqual(expect.any(String));
  });

  it('rejects a body that fails validation', async () => {
    const response = await request(app)
      .post('/api/findings')
      .set(auth(analyst.token))
      .send({ title: 'x', severity: 'nope' })
      .expect(400);

    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('requires authentication', async () => {
    await request(app).post('/api/findings').send(SAMPLE_FINDING).expect(401);
  });
});

describe('GET /api/findings', () => {
  beforeEach(async () => {
    await createFinding(analyst.token, { title: 'Redis exposed', severity: 'critical', asset: 'cache-01' });
    await createFinding(analyst.token, { title: 'Verbose stack traces', severity: 'low', asset: 'web-01', cve: undefined });
    await createFinding(admin.token, { title: 'Missing HSTS header', severity: 'medium', asset: 'web-01', cve: undefined });
  });

  it('lists every finding with pagination metadata', async () => {
    const response = await request(app).get('/api/findings').set(auth(analyst.token)).expect(200);

    expect(response.body.items).toHaveLength(3);
    expect(response.body.pagination).toMatchObject({ page: 1, limit: 20, total: 3, pages: 1 });
  });

  it('filters by severity', async () => {
    const response = await request(app)
      .get('/api/findings?severity=critical')
      .set(auth(analyst.token))
      .expect(200);

    expect(response.body.items).toHaveLength(1);
    expect(response.body.items[0].severity).toBe('critical');
  });

  it('filters by asset', async () => {
    const response = await request(app)
      .get('/api/findings?asset=web-01')
      .set(auth(analyst.token))
      .expect(200);

    expect(response.body.items).toHaveLength(2);
  });

  it('free-text searches across title, description, cve and tags', async () => {
    const response = await request(app)
      .get('/api/findings?q=hsts')
      .set(auth(analyst.token))
      .expect(200);

    expect(response.body.items).toHaveLength(1);
    expect(response.body.items[0].title).toBe('Missing HSTS header');
  });

  it('sorts by severity descending', async () => {
    const response = await request(app)
      .get('/api/findings?sort=severity&order=desc')
      .set(auth(analyst.token))
      .expect(200);

    expect(response.body.items.map((f) => f.severity)).toEqual(['critical', 'medium', 'low']);
  });

  it('paginates', async () => {
    const response = await request(app)
      .get('/api/findings?limit=2&page=2')
      .set(auth(analyst.token))
      .expect(200);

    expect(response.body.items).toHaveLength(1);
    expect(response.body.pagination.pages).toBe(2);
  });

  it('rejects an out-of-range limit', async () => {
    await request(app).get('/api/findings?limit=5000').set(auth(analyst.token)).expect(400);
  });
});

describe('GET /api/findings/stats', () => {
  it('aggregates counts and risk across the register', async () => {
    await createFinding(analyst.token, { severity: 'critical' });
    await createFinding(analyst.token, { severity: 'low', cve: undefined });

    const response = await request(app)
      .get('/api/findings/stats')
      .set(auth(admin.token))
      .expect(200);

    expect(response.body.total).toBe(2);
    expect(response.body.open).toBe(2);
    expect(response.body.bySeverity.critical).toBe(1);
    expect(response.body.riskAverage).toBeGreaterThan(0);
  });
});

describe('GET /api/findings/:id', () => {
  it('returns a single finding', async () => {
    const created = await createFinding(analyst.token);

    const response = await request(app)
      .get(`/api/findings/${created.id}`)
      .set(auth(analyst.token))
      .expect(200);

    expect(response.body.id).toBe(created.id);
  });

  it('returns 404 for an unknown id', async () => {
    const response = await request(app)
      .get('/api/findings/00000000-0000-0000-0000-000000000000')
      .set(auth(analyst.token))
      .expect(404);

    expect(response.body.error.code).toBe('NOT_FOUND');
  });
});

describe('PATCH /api/findings/:id', () => {
  it('lets the reporter update their own finding', async () => {
    const created = await createFinding(analyst.token);

    const response = await request(app)
      .patch(`/api/findings/${created.id}`)
      .set(auth(analyst.token))
      .send({ status: 'in_progress' })
      .expect(200);

    expect(response.body.status).toBe('in_progress');
    expect(response.body.riskScore).toBeLessThan(created.riskScore);
  });

  it('lets an admin update anyone\u2019s finding', async () => {
    const created = await createFinding(analyst.token);

    await request(app)
      .patch(`/api/findings/${created.id}`)
      .set(auth(admin.token))
      .send({ status: 'resolved' })
      .expect(200);
  });

  it('stops an analyst editing a finding they did not report', async () => {
    const created = await createFinding(admin.token);

    const response = await request(app)
      .patch(`/api/findings/${created.id}`)
      .set(auth(analyst.token))
      .send({ status: 'resolved' })
      .expect(403);

    expect(response.body.error.code).toBe('FORBIDDEN');
  });

  it('rejects an empty patch body', async () => {
    const created = await createFinding(analyst.token);

    await request(app)
      .patch(`/api/findings/${created.id}`)
      .set(auth(analyst.token))
      .send({})
      .expect(400);
  });
});

describe('DELETE /api/findings/:id', () => {
  it('lets an admin delete a finding', async () => {
    const created = await createFinding(analyst.token);

    await request(app).delete(`/api/findings/${created.id}`).set(auth(admin.token)).expect(204);
    await request(app).get(`/api/findings/${created.id}`).set(auth(admin.token)).expect(404);
  });

  it('refuses an analyst', async () => {
    const created = await createFinding(analyst.token);

    const response = await request(app)
      .delete(`/api/findings/${created.id}`)
      .set(auth(analyst.token))
      .expect(403);

    expect(response.body.error.message).toMatch(/Requires role/);
  });

  it('returns 404 when deleting something that is not there', async () => {
    await request(app)
      .delete('/api/findings/00000000-0000-0000-0000-000000000000')
      .set(auth(admin.token))
      .expect(404);
  });
});
