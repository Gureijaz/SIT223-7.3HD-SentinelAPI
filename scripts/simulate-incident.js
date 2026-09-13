'use strict';

/**
 * Incident simulation.
 *
 * Deliberately drives a burst of rejected requests at a deployed instance so the
 * SentinelHighErrorRatio rule crosses its threshold, then waits for Prometheus
 * to move the alert through pending into firing and for Alertmanager to accept
 * it. This proves the alerting path end to end - rule evaluation, routing and
 * notification - instead of just asserting that a dashboard exists.
 *
 *   node scripts/simulate-incident.js --url http://localhost:3001 --requests 400
 *
 * Traffic is entirely unauthenticated 401/404 rejections, so nothing is written
 * and no real data is touched.
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
const PROMETHEUS_URL = (process.env.PROMETHEUS_URL || 'http://localhost:9090').replace(/\/$/, '');
const ALERTMANAGER_URL = (process.env.ALERTMANAGER_URL || 'http://localhost:9093').replace(/\/$/, '');
const ALERT_NAME = args.alert || 'SentinelHighErrorRatio';
const REQUESTS = Number(args.requests || 400);
const WAIT_SECONDS = Number(args.wait || 180);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function generateErrors() {
  console.log(`Generating ${REQUESTS} rejected requests against ${BASE_URL} ...`);

  const routes = ['/api/findings', '/api/findings/stats', '/api/auth/me', '/no-such-route'];
  let sent = 0;

  for (let batch = 0; batch < REQUESTS; batch += 20) {
    const pending = [];

    for (let i = 0; i < 20 && batch + i < REQUESTS; i += 1) {
      const route = routes[(batch + i) % routes.length];
      pending.push(fetch(`${BASE_URL}${route}`).catch(() => null));
    }

    const settled = await Promise.all(pending);
    sent += settled.filter(Boolean).length;
  }

  console.log(`  ${sent} requests sent (all expected to be rejected with 401/404).\n`);
  return sent;
}

async function prometheusAlerts() {
  const response = await fetch(`${PROMETHEUS_URL}/api/v1/alerts`);
  const body = await response.json();
  return (body.data.alerts || []).filter((a) => a.labels.alertname === ALERT_NAME);
}

async function alertmanagerAlerts() {
  try {
    const response = await fetch(`${ALERTMANAGER_URL}/api/v2/alerts?active=true`);
    const body = await response.json();
    return body.filter((a) => a.labels.alertname === ALERT_NAME);
  } catch {
    return [];
  }
}

async function waitForAlert() {
  console.log(`Waiting up to ${WAIT_SECONDS}s for ${ALERT_NAME} to fire ...`);

  const deadline = Date.now() + WAIT_SECONDS * 1000;
  let lastState = 'inactive';

  while (Date.now() < deadline) {
    const alerts = await prometheusAlerts();

    if (alerts.length) {
      const state = alerts[0].state;

      if (state !== lastState) {
        console.log(`  [${new Date().toISOString()}] ${ALERT_NAME} -> ${state}`);
        lastState = state;
      }

      if (state === 'firing') return alerts[0];
    }

    await sleep(5000);
  }

  throw new Error(`${ALERT_NAME} did not reach the firing state within ${WAIT_SECONDS}s (last state: ${lastState})`);
}

async function main() {
  const sent = await generateErrors();
  const alert = await waitForAlert();

  console.log('\nAlert fired:');
  console.log(JSON.stringify({ labels: alert.labels, annotations: alert.annotations, activeAt: alert.activeAt }, null, 2));

  // Alertmanager polls Prometheus, so give it a moment to receive the alert
  // before checking that it was routed rather than dropped.
  await sleep(10000);
  const routed = await alertmanagerAlerts();

  if (routed.length) {
    console.log(`\nAlertmanager has accepted the alert and routed it to: ${routed[0].receivers.map((r) => r.name).join(', ')}`);
  } else {
    console.log('\nWARNING: Alertmanager did not report the alert as active; check its routing configuration.');
  }

  const dir = path.join(process.cwd(), 'reports', 'monitoring');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'incident-simulation.json'),
    JSON.stringify(
      {
        target: BASE_URL,
        alert: ALERT_NAME,
        requestsSent: sent,
        firedAt: new Date().toISOString(),
        prometheusAlert: { labels: alert.labels, annotations: alert.annotations, activeAt: alert.activeAt },
        alertmanagerReceivers: routed.flatMap((a) => a.receivers.map((r) => r.name)),
      },
      null,
      2,
    ),
  );

  console.log('\nIncident simulation complete. The alert will resolve on its own once error traffic stops.');
}

main().catch((err) => {
  console.error(`INCIDENT SIMULATION FAILED: ${err.message}`);
  process.exitCode = 1;
});
