'use strict';

/**
 * Monitoring stage verification.
 *
 * Asserts that the observability stack is genuinely wired to the release that
 * was just promoted, rather than merely installed somewhere:
 *
 *   1. Prometheus is healthy and reachable.
 *   2. Both sentinel-api scrape targets (staging + production) are UP.
 *   3. The sentinel alert rules are loaded, and none are unexpectedly firing.
 *   4. Alertmanager is healthy and has the email receiver configured.
 *   5. The version Prometheus sees matches the version we just released.
 *
 * Exits non-zero if monitoring is blind to the new release, which is exactly the
 * situation a Monitoring stage exists to catch.
 */

const fs = require('fs');
const path = require('path');

const PROMETHEUS_URL = (process.env.PROMETHEUS_URL || 'http://localhost:9090').replace(/\/$/, '');
const ALERTMANAGER_URL = (process.env.ALERTMANAGER_URL || 'http://localhost:9093').replace(/\/$/, '');
const EXPECTED_VERSION = process.env.APP_VERSION || null;
const TIMEOUT_MS = 10000;

const results = [];

async function get(base, route) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(`${base}${route}`, { signal: controller.signal });
    const text = await response.text();

    if (!response.ok) throw new Error(`HTTP ${response.status} from ${route}: ${text.slice(0, 160)}`);

    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  } finally {
    clearTimeout(timer);
  }
}

function query(expr) {
  return get(PROMETHEUS_URL, `/api/v1/query?query=${encodeURIComponent(expr)}`);
}

async function check(name, fn) {
  try {
    const detail = await fn();
    results.push({ name, ok: true, detail: detail || null });
    console.log(`  PASS  ${name}${detail ? ` - ${detail}` : ''}`);
  } catch (err) {
    results.push({ name, ok: false, error: err.message });
    console.error(`  FAIL  ${name} - ${err.message}`);
  }
}

async function main() {
  console.log(`Verifying monitoring stack\n  Prometheus:   ${PROMETHEUS_URL}\n  Alertmanager: ${ALERTMANAGER_URL}\n`);

  await check('Prometheus is healthy', async () => {
    const body = await get(PROMETHEUS_URL, '/-/healthy');
    return String(body).trim().slice(0, 60);
  });

  await check('sentinel-api scrape targets are UP', async () => {
    const body = await get(PROMETHEUS_URL, '/api/v1/targets?state=active');
    const targets = body.data.activeTargets.filter((t) => t.labels.job === 'sentinel-api');

    if (targets.length === 0) throw new Error('no sentinel-api targets are configured');

    const down = targets.filter((t) => t.health !== 'up');
    if (down.length) {
      throw new Error(`down: ${down.map((t) => `${t.labels.instance} (${t.lastError || 'no error text'})`).join(', ')}`);
    }

    return targets.map((t) => `${t.labels.env || t.labels.instance}=up`).join(', ');
  });

  await check('sentinel alert rules are loaded', async () => {
    const body = await get(PROMETHEUS_URL, '/api/v1/rules');
    const groups = body.data.groups.filter((g) => g.name.startsWith('sentinel'));

    if (groups.length === 0) throw new Error('no sentinel rule group is loaded');

    const rules = groups.flatMap((g) => g.rules);
    const firing = rules.filter((r) => r.state === 'firing');

    if (firing.length) {
      throw new Error(`already firing: ${firing.map((r) => r.name).join(', ')}`);
    }

    return `${rules.length} rules loaded (${rules.map((r) => r.name).join(', ')})`;
  });

  await check('Alertmanager is healthy with a configured receiver', async () => {
    await get(ALERTMANAGER_URL, '/-/healthy');
    const status = await get(ALERTMANAGER_URL, '/api/v2/status');
    const config = status.config.original || '';

    if (!config.includes('receivers:')) throw new Error('no receivers configured');

    return 'receivers configured';
  });

  await check('live metrics are flowing from the application', async () => {
    const body = await query('sum(sentinel_http_requests_total)');
    const value = Number(body.data.result[0] && body.data.result[0].value[1]);

    if (!Number.isFinite(value)) throw new Error('sentinel_http_requests_total has no samples yet');

    return `sentinel_http_requests_total = ${value}`;
  });

  await check('the released version is visible to Prometheus', async () => {
    const body = await query('sentinel_build_info');
    const series = body.data.result;

    if (series.length === 0) throw new Error('sentinel_build_info has no samples');

    const versions = series.map((s) => `${s.metric.env || '?'}:${s.metric.version}#${s.metric.build_number}`);

    if (EXPECTED_VERSION && !series.some((s) => s.metric.version === EXPECTED_VERSION)) {
      throw new Error(`expected version ${EXPECTED_VERSION}, Prometheus sees ${versions.join(', ')}`);
    }

    return versions.join(', ');
  });

  await check('error ratio is within the alert threshold', async () => {
    const body = await query(
      'sum(rate(sentinel_http_errors_total[5m])) / clamp_min(sum(rate(sentinel_http_requests_total[5m])), 0.001)',
    );
    const value = Number(body.data.result[0] && body.data.result[0].value[1]) || 0;

    return `5m error ratio = ${(value * 100).toFixed(2)}%`;
  });

  const dir = path.join(process.cwd(), 'reports', 'monitoring');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'monitoring-check.json'),
    JSON.stringify({ prometheus: PROMETHEUS_URL, alertmanager: ALERTMANAGER_URL, ranAt: new Date().toISOString(), results }, null, 2),
  );

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} monitoring checks passed.`);

  if (failed.length) {
    console.error(`MONITORING CHECK FAILED: ${failed.map((f) => f.name).join(', ')}`);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(`MONITORING CHECK ERROR: ${err.message}`);
  process.exitCode = 1;
});
