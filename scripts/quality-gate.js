'use strict';

/**
 * Code Quality stage gate.
 *
 * The usual Jenkins recipe for this is `waitForQualityGate`, which depends on
 * SonarCloud making an inbound webhook call back to Jenkins. This Jenkins
 * controller runs on localhost and is not reachable from the internet, so the
 * gate is polled from the other direction instead: read the analysis id the
 * scanner just wrote, poll the compute-engine task until it finishes, then read
 * the quality gate result and fail the build when it is red.
 *
 *   node scripts/quality-gate.js --fail-on-error
 *   node scripts/quality-gate.js --report-only
 *
 * Reads SONAR_TOKEN from the environment; Jenkins injects it from its credential
 * store and it is never written to disk or to a report.
 */

const fs = require('fs');
const path = require('path');

const FAIL_ON_ERROR = !process.argv.includes('--report-only');
const POLL_TIMEOUT_MS = Number(process.env.SONAR_POLL_TIMEOUT_MS || 300000);
const POLL_INTERVAL_MS = 5000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function readTaskReport() {
  const file = path.join(process.cwd(), '.scannerwork', 'report-task.txt');

  if (!fs.existsSync(file)) {
    throw new Error('.scannerwork/report-task.txt not found — did sonar-scanner run?');
  }

  return Object.fromEntries(
    fs
      .readFileSync(file, 'utf8')
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => {
        const index = line.indexOf('=');
        return [line.slice(0, index), line.slice(index + 1)];
      }),
  );
}

async function api(url) {
  const headers = process.env.SONAR_TOKEN
    ? { Authorization: `Bearer ${process.env.SONAR_TOKEN}` }
    : {};

  const response = await fetch(url, { headers });
  const text = await response.text();

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} from ${url.split('?')[0]}: ${text.slice(0, 200)}`);
  }

  return JSON.parse(text);
}

async function waitForAnalysis(ceTaskUrl) {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  let lastStatus = '';

  while (Date.now() < deadline) {
    const { task } = await api(ceTaskUrl);

    if (task.status !== lastStatus) {
      console.log(`  Analysis task: ${task.status}`);
      lastStatus = task.status;
    }

    if (task.status === 'SUCCESS') return task.analysisId;
    if (task.status === 'FAILED' || task.status === 'CANCELED') {
      throw new Error(`SonarCloud analysis ${task.status}: ${task.errorMessage || 'no detail supplied'}`);
    }

    await sleep(POLL_INTERVAL_MS);
  }

  throw new Error(`SonarCloud analysis did not finish within ${POLL_TIMEOUT_MS / 1000}s`);
}

function formatCondition(condition) {
  const actual = condition.actualValue === undefined ? 'n/a' : condition.actualValue;
  return `${condition.metricKey} ${condition.comparator} ${condition.errorThreshold} (actual: ${actual}) -> ${condition.status}`;
}

async function main() {
  const report = readTaskReport();
  const serverUrl = report.serverUrl.replace(/\/$/, '');

  console.log(`Project:   ${report.projectKey}`);
  console.log(`Dashboard: ${report.dashboardUrl}\n`);

  const analysisId = await waitForAnalysis(report.ceTaskUrl);
  const { projectStatus } = await api(`${serverUrl}/api/qualitygates/project_status?analysisId=${analysisId}`);

  console.log(`\nQuality gate: ${projectStatus.status}`);
  for (const condition of projectStatus.conditions || []) {
    const marker = condition.status === 'OK' ? 'PASS' : 'FAIL';
    console.log(`  ${marker}  ${formatCondition(condition)}`);
  }

  const dir = path.join(process.cwd(), 'reports', 'quality');
  fs.mkdirSync(dir, { recursive: true });

  fs.writeFileSync(
    path.join(dir, 'quality-gate.json'),
    JSON.stringify(
      {
        projectKey: report.projectKey,
        dashboardUrl: report.dashboardUrl,
        analysisId,
        status: projectStatus.status,
        conditions: projectStatus.conditions,
        checkedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  );

  const lines = [
    '# SonarCloud quality gate',
    '',
    `Project: \`${report.projectKey}\``,
    `Dashboard: ${report.dashboardUrl}`,
    `Status: **${projectStatus.status}**`,
    '',
    '| Metric | Comparator | Threshold | Actual | Result |',
    '| --- | --- | --- | --- | --- |',
    ...(projectStatus.conditions || []).map(
      (c) => `| ${c.metricKey} | ${c.comparator} | ${c.errorThreshold} | ${c.actualValue ?? 'n/a'} | ${c.status} |`,
    ),
  ];
  fs.writeFileSync(path.join(dir, 'quality-gate.md'), lines.join('\n'));

  if (projectStatus.status !== 'OK') {
    const message = `QUALITY GATE ${projectStatus.status}: see ${report.dashboardUrl}`;

    if (FAIL_ON_ERROR) {
      console.error(`\n${message}`);
      process.exitCode = 1;
      return;
    }

    console.warn(`\n${message} (reporting only, build not failed)`);
    return;
  }

  console.log('\nQUALITY GATE PASSED.');
}

main().catch((err) => {
  console.error(`QUALITY GATE CHECK FAILED: ${err.message}`);
  process.exitCode = FAIL_ON_ERROR ? 1 : 0;
});
