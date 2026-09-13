'use strict';

/**
 * Security stage gate — dependency vulnerability scanning.
 *
 * Runs `npm audit` twice, because the two trees carry very different risk:
 *
 *   runtime  (--omit=dev)  ships inside the artefact and is exposed to users.
 *                          Critical and high advisories here BLOCK the pipeline.
 *   build    (full tree)   only ever executes on the CI agent. Advisories here
 *                          are reported and tracked, but do not block, because
 *                          nothing in that tree reaches a deployed environment.
 *
 * An advisory can be waived by adding it to security-policy.json with a written
 * justification and a review date, so every accepted risk is visible in version
 * control and expires rather than quietly becoming permanent.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const SEVERITIES = ['critical', 'high', 'moderate', 'low', 'info'];

const DEFAULT_POLICY = {
  runtime: { failOn: ['critical', 'high'] },
  build: { failOn: [] },
  waivers: [],
};

function loadPolicy() {
  const file = path.join(process.cwd(), 'security-policy.json');
  if (!fs.existsSync(file)) return DEFAULT_POLICY;

  return { ...DEFAULT_POLICY, ...JSON.parse(fs.readFileSync(file, 'utf8')) };
}

function runAudit(omitDev) {
  // The whole invocation is passed as one shell string: npm is a .cmd shim on
  // Windows, which cannot be spawned without a shell, and passing a separate
  // argument array alongside `shell: true` is deprecated (DEP0190).
  const command = `npm audit --json${omitDev ? ' --omit=dev' : ''}`;

  // npm audit exits non-zero whenever it finds anything, so its exit code is
  // ignored and the decision is made from the parsed report.
  const result = spawnSync(command, {
    encoding: 'utf8',
    shell: true,
    maxBuffer: 64 * 1024 * 1024,
  });

  const stdout = result.stdout || '';
  if (!stdout.trim()) {
    throw new Error(`\`${command}\` produced no output: ${result.stderr || 'unknown error'}`);
  }

  return JSON.parse(stdout);
}

function waiverFor(vulnerability, advisory, waivers) {
  return (
    waivers.find((waiver) => {
      if (waiver.package && waiver.package !== vulnerability.name) return false;
      if (waiver.advisory && !String(advisory.url || '').includes(waiver.advisory)) return false;
      return Boolean(waiver.package || waiver.advisory);
    }) || null
  );
}

function collect(report, waivers) {
  const findings = Object.values(report.vulnerabilities || {}).map((vulnerability) => {
    const advisory = (vulnerability.via || []).find((via) => typeof via === 'object') || {};
    const waiver = waiverFor(vulnerability, advisory, waivers);

    return {
      package: vulnerability.name,
      severity: vulnerability.severity,
      title: advisory.title || `Vulnerable transitive dependency of ${vulnerability.name}`,
      advisory: advisory.url || '',
      range: vulnerability.range,
      direct: Boolean(vulnerability.isDirect),
      fixAvailable: Boolean(vulnerability.fixAvailable),
      waived: Boolean(waiver),
      waiverReason: waiver ? waiver.justification : null,
      waiverReview: waiver ? waiver.reviewBy : null,
    };
  });

  const counts = Object.fromEntries(SEVERITIES.map((severity) => [severity, 0]));
  for (const finding of findings) {
    if (finding.waived) continue;
    counts[finding.severity] = (counts[finding.severity] || 0) + 1;
  }

  return { findings, counts };
}

function printTree(label, result, failOn) {
  console.log(`\n${label}`);
  console.log(`  gate: ${failOn.length ? `fails on ${failOn.join('/')}` : 'report only'}`);
  console.log(`  ${SEVERITIES.map((s) => `${s}=${result.counts[s] || 0}`).join('  ')}`);

  for (const finding of result.findings) {
    const flag = finding.waived ? 'WAIVED' : finding.severity.toUpperCase().padEnd(8);
    console.log(`    ${flag}  ${finding.package}@${finding.range} — ${finding.title}`);
    if (finding.advisory) console.log(`              ${finding.advisory}`);
    if (finding.waived) console.log(`              waiver: ${finding.waiverReason} (review by ${finding.waiverReview})`);
  }

  if (result.findings.length === 0) console.log('    no advisories reported');
}

function markdown(runtime, build, policy) {
  const table = (result) => [
    '| Package | Severity | Advisory | Fix available | Waived |',
    '| --- | --- | --- | --- | --- |',
    ...result.findings.map(
      (f) =>
        `| \`${f.package}\` | ${f.severity} | [${f.title}](${f.advisory || '#'}) | ${f.fixAvailable ? 'yes' : 'no'} | ${f.waived ? `yes — ${f.waiverReason}` : 'no'} |`,
    ),
  ];

  return [
    '# Dependency security scan',
    '',
    `Generated: ${new Date().toISOString()}`,
    '',
    '## Runtime dependencies (shipped in the artefact)',
    '',
    `Blocking severities: ${policy.runtime.failOn.join(', ') || 'none'}`,
    '',
    ...(runtime.findings.length ? table(runtime) : ['No advisories against the runtime dependency tree.']),
    '',
    '## Build-time dependencies (CI agent only)',
    '',
    'Reported for visibility. These packages never reach a deployed environment,',
    'so they are tracked rather than gated.',
    '',
    ...(build.findings.length ? table(build) : ['No advisories against the build dependency tree.']),
    '',
  ].join('\n');
}

function main() {
  const policy = loadPolicy();
  const waivers = policy.waivers || [];

  const runtime = collect(runAudit(true), waivers);
  const build = collect(runAudit(false), waivers);

  printTree('Runtime dependency tree (npm audit --omit=dev)', runtime, policy.runtime.failOn);
  printTree('Build dependency tree (npm audit)', build, policy.build.failOn);

  const dir = path.join(process.cwd(), 'reports', 'security');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'npm-audit-summary.json'),
    JSON.stringify({ generatedAt: new Date().toISOString(), policy, runtime, build }, null, 2),
  );
  fs.writeFileSync(path.join(dir, 'npm-audit-summary.md'), markdown(runtime, build, policy));

  const blocking = [
    ...policy.runtime.failOn.map((s) => runtime.counts[s] || 0),
    ...policy.build.failOn.map((s) => build.counts[s] || 0),
  ].reduce((total, count) => total + count, 0);

  if (blocking > 0) {
    console.error(`\nSECURITY GATE FAILED: ${blocking} unwaived blocking advisory/advisories.`);
    console.error('Remediate by upgrading the dependency, removing it, or recording a justified waiver in security-policy.json.');
    process.exitCode = 1;
    return;
  }

  console.log('\nSECURITY GATE PASSED: no unwaived blocking advisories in the runtime dependency tree.');
}

main();
