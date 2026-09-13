'use strict';

const { app, request, store, seedUsers, auth, ADMIN, ANALYST } = require('../helpers');

beforeEach(() => store.reset());

describe('POST /api/auth/register', () => {
  it('creates an account and returns 201 with a token', async () => {
    const response = await request(app).post('/api/auth/register').send(ADMIN).expect(201);

    expect(response.body.user.email).toBe(ADMIN.email);
    expect(response.body.user.id).toEqual(expect.any(String));
    expect(response.body.user).not.toHaveProperty('passwordHash');
    expect(response.body.token).toEqual(expect.any(String));
  });

  it('returns 400 with per-field details for an invalid body', async () => {
    const response = await request(app)
      .post('/api/auth/register')
      .send({ email: 'nope', password: 'weak', name: '' })
      .expect(400);

    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(response.body.error.details.length).toBeGreaterThanOrEqual(3);
  });

  it('returns 409 when the email is already registered', async () => {
    await request(app).post('/api/auth/register').send(ADMIN).expect(201);

    const response = await request(app).post('/api/auth/register').send(ADMIN).expect(409);
    expect(response.body.error.code).toBe('CONFLICT');
  });
});

describe('POST /api/auth/login', () => {
  beforeEach(async () => {
    await request(app).post('/api/auth/register').send(ADMIN).expect(201);
  });

  it('returns a token for valid credentials', async () => {
    const response = await request(app)
      .post('/api/auth/login')
      .send({ email: ADMIN.email, password: ADMIN.password })
      .expect(200);

    expect(response.body.token).toEqual(expect.any(String));
  });

  it('returns 401 for a wrong password', async () => {
    const response = await request(app)
      .post('/api/auth/login')
      .send({ email: ADMIN.email, password: 'NotThePassword1' })
      .expect(401);

    expect(response.body.error.code).toBe('UNAUTHORIZED');
  });
});

describe('GET /api/auth/me', () => {
  it('returns the authenticated user', async () => {
    const { admin } = await seedUsers();

    const response = await request(app).get('/api/auth/me').set(auth(admin.token)).expect(200);

    expect(response.body.user.email).toBe(ADMIN.email);
    expect(response.body.user.role).toBe('admin');
  });

  it('returns the analyst role for the second account', async () => {
    const { analyst } = await seedUsers();

    const response = await request(app).get('/api/auth/me').set(auth(analyst.token)).expect(200);

    expect(response.body.user.email).toBe(ANALYST.email);
    expect(response.body.user.role).toBe('analyst');
  });

  it('returns 401 without a token', async () => {
    const response = await request(app).get('/api/auth/me').expect(401);
    expect(response.body.error.message).toBe('Missing bearer token');
  });

  it('returns 401 for a token that is not a JWT', async () => {
    await request(app).get('/api/auth/me').set(auth('garbage')).expect(401);
  });

  it('returns 401 when the Authorization scheme is not Bearer', async () => {
    await request(app).get('/api/auth/me').set({ Authorization: 'Basic abc123' }).expect(401);
  });
});
