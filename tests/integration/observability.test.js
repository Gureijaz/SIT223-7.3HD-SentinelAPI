'use strict';

const { app, request, seedUsers, auth, SAMPLE_FINDING } = require('../helpers');

describe('GET /health', () => {
  it('reports the running version and build', async () => {
    const response = await request(app).get('/health').expect(200);

    expect(response.body.status).toBe('ok');
    expect(response.body.env).toBe('test');
    expect(response.body.version).toEqual(expect.any(String));
    expect(response.body).toHaveProperty('build');
    expect(response.body).toHaveProperty('commit');
  });

  it('does not require authentication, so probes can reach it', async () => {
    await request(app).get('/health').expect(200);
  });
});

describe('GET /ready', () => {
  it('reports ready once storage answers', async () => {
    const response = await request(app).get('/ready').expect(200);
    expect(response.body.status).toBe('ready');
  });
});

describe('GET /metrics', () => {
  it('exposes Prometheus text-format metrics', async () => {
    const response = await request(app).get('/metrics').expect(200);

    expect(response.headers['content-type']).toMatch(/text\/plain/);
    expect(response.text).toContain('sentinel_http_requests_total');
    expect(response.text).toContain('sentinel_build_info');
    expect(response.text).toContain('process_cpu_user_seconds_total');
  });

  it('counts requests and errors it has served', async () => {
    await request(app).get('/api/findings').expect(401);

    const response = await request(app).get('/metrics').expect(200);

    expect(response.text).toMatch(/sentinel_http_requests_total\{[^}]*status_code="401"[^}]*\}\s+\d+/);
    expect(response.text).toMatch(/sentinel_http_errors_total\{[^}]*\}\s+\d+/);
  });

  it('counts created findings by severity', async () => {
    const { analyst } = await seedUsers();

    await request(app)
      .post('/api/findings')
      .set(auth(analyst.token))
      .send({ ...SAMPLE_FINDING, severity: 'critical' })
      .expect(201);

    const response = await request(app).get('/metrics').expect(200);

    expect(response.text).toMatch(/sentinel_findings_created_total\{[^}]*severity="critical"[^}]*\}\s+[1-9]/);
  });
});

describe('unknown routes', () => {
  it('returns a structured 404', async () => {
    const response = await request(app).get('/does-not-exist').expect(404);

    expect(response.body.error.code).toBe('NOT_FOUND');
    expect(response.body.error.message).toMatch(/Route GET \/does-not-exist/);
  });
});

describe('security headers', () => {
  it('sets helmet defaults and hides the Express fingerprint', async () => {
    const response = await request(app).get('/health').expect(200);

    expect(response.headers['x-powered-by']).toBeUndefined();
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['x-frame-options']).toBeDefined();
  });
});
