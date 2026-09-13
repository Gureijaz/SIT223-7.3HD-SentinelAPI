'use strict';

/**
 * Post-deployment smoke test.
 *
 * Runs against a *deployed* instance over HTTP, so it proves the release is
 * actually serving traffic - something the in-process Jest suites cannot show.
 *
 *   node scripts/smoke-test.js --url http://localhost:3001 --mode full
 *
 * `full`     exercises the write path (used against staging).
 * `readonly` touches only probes and rejection paths (used against production).
 */

const fs = require('fs');
const path = require('path');

const args = Object.fromEntries(
  process.argv.slice(2).reduce((pairs, arg, i, all) => {
    if (arg.startsWith('--')) pairs.push([arg.slice(2), all[i + 1]]);
    return pairs;
  }, []),
);

const BASE_URL = (args.url || process.env.SMOKE_URL || 'http://localhost:3001').replace(/\/$/, '');
const MODE = args.mode || process.env.SMOKE_MODE || 'full';
const TIMEOUT_MS = Number(args.timeout || 10000);

const results = [];

async function http(method, route, options = {}) {
  const { body, token, expect: expectedStatus } = options;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(`${BASE_URL}${route}`, {
      method,
      signal: controller.signal,
      headers: {
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    const text = await response.text();
    const contentType = response.headers.get('content-type') || '';
    const payload = text && contentType.includes('json') ? JSON.parse(text) : text;

    if (expectedStatus && response.status !== expectedStatus) {
      throw new Error(`expected HTTP ${expectedStatus}, got ${response.status}: ${text.slice(0, 200)}`);
    }

    return { status: response.status, body: payload };
  } finally {
    clearTimeout(timer);
  }
}

async function check(name, fn) {
  const startedAt = Date.now();

  try {
    const detail = await fn();
    results.push({ name, ok: true, ms: Date.now() - startedAt, detail: detail || null });
    console.log(`  PASS  ${name}${detail ? ` - ${detail}` : ''}`);
  } catch (err) {
    results.push({ name, ok: false, ms: Date.now() - startedAt, error: err.message });
    console.error(`  FAIL  ${name} - ${err.message}`);
  }
}

/** Polls /health until the instance answers, so the test does not race PM2's restart. */
async function waitForReady(attempts = 30, delayMs = 1000) {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const { status } = await http('GET', '/health');
      if (status === 200) return attempt;
    } catch {
      // Instance is not up yet; fall through to the retry delay.
    }
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }

  throw new Error(`instance at ${BASE_URL} did not become healthy within ${attempts} attempts`);
}

async function probeChecks() {
  await check('GET /health returns ok with build metadata', async () => {
    const { body } = await http('GET', '/health', { expect: 200 });
    if (body.status !== 'ok') throw new Error(`status was ${body.status}`);
    return `version=${body.version} build=${body.build} commit=${body.commit} env=${body.env}`;
  });

  await check('GET /ready reports the storage layer is available', async () => {
    const { body } = await http('GET', '/ready', { expect: 200 });
    if (body.status !== 'ready') throw new Error(`status was ${body.status}`);
  });

  await check('GET /metrics exposes Prometheus metrics', async () => {
    const { body } = await http('GET', '/metrics', { expect: 200 });
    if (!String(body).includes('sentinel_http_requests_total')) {
      throw new Error('sentinel_http_requests_total missing from the exposition');
    }
    return `${String(body).split('\n').length} exposition lines`;
  });

  await check('protected routes reject anonymous callers', async () => {
    await http('GET', '/api/findings', { expect: 401 });
  });

  await check('unknown routes return a structured 404', async () => {
    const { body } = await http('GET', '/definitely-not-a-route', { expect: 404 });
    if (!body.error || body.error.code !== 'NOT_FOUND') throw new Error('error envelope missing');
  });
}

async function writePathChecks() {
  const stamp = Date.now();
  const credentials = {
    email: `smoke.${stamp}@sentinel.test`,
    password: 'SmokeTestPassw0rd',
    name: 'Smoke Test',
  };

  let token;
  let findingId;

  await check('POST /api/auth/register creates an account', async () => {
    const { body } = await http('POST', '/api/auth/register', { body: credentials, expect: 201 });
    token = body.token;
    return `role=${body.user.role}`;
  });

  await check('POST /api/auth/login returns a token', async () => {
    const { body } = await http('POST', '/api/auth/login', {
      body: { email: credentials.email, password: credentials.password },
      expect: 200,
    });
    token = body.token;
  });

  await check('POST /api/findings creates a finding and scores it', async () => {
    const { body } = await http('POST', '/api/findings', {
      token,
      expect: 201,
      body: {
        title: `Smoke test finding ${stamp}`,
        severity: 'medium',
        asset: 'smoke-test',
        description: 'Created by the deployment smoke test; safe to delete.',
      },
    });
    findingId = body.id;
    return `riskScore=${body.riskScore}`;
  });

  await check('GET /api/findings lists the new finding', async () => {
    const { body } = await http('GET', `/api/findings?q=${stamp}`, { token, expect: 200 });
    if (!body.items.some((f) => f.id === findingId)) throw new Error('finding not present in the list');
  });

  await check('PATCH /api/findings/:id updates status', async () => {
    const { body } = await http('PATCH', `/api/findings/${findingId}`, {
      token,
      expect: 200,
      body: { status: 'resolved' },
    });
    if (body.status !== 'resolved') throw new Error('status not applied');
  });

  await check('GET /api/findings/stats aggregates the register', async () => {
    const { body } = await http('GET', '/api/findings/stats', { token, expect: 200 });
    if (typeof body.total !== 'number') throw new Error('stats payload malformed');
    return `total=${body.total} open=${body.open}`;
  });

  await check('validation rejects a malformed finding', async () => {
    await http('POST', '/api/findings', { token, expect: 400, body: { title: 'x', severity: 'nope' } });
  });
}

async function main() {
  console.log(`Smoke testing ${BASE_URL} (mode: ${MODE})\n`);

  const attempts = await waitForReady();
  console.log(`  Instance answered after ${attempts} attempt(s)\n`);

  await probeChecks();
  if (MODE === 'full') await writePathChecks();

  const failed = results.filter((r) => !r.ok);
  const dir = path.join(process.cwd(), 'reports', 'smoke');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, `smoke-${MODE}.json`),
    JSON.stringify({ baseUrl: BASE_URL, mode: MODE, ranAt: new Date().toISOString(), results }, null, 2),
  );

  console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);

  if (failed.length) {
    console.error(`SMOKE TEST FAILED: ${failed.map((f) => f.name).join(', ')}`);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(`SMOKE TEST ERROR: ${err.message}`);
  process.exitCode = 1;
});
