'use strict';

const SEVERITY_WEIGHTS = {
  critical: 40,
  high: 25,
  medium: 12,
  low: 4,
  informational: 1,
};

const STATUS_MULTIPLIERS = {
  open: 1,
  triaged: 0.9,
  in_progress: 0.6,
  accepted_risk: 0.3,
  resolved: 0,
};

const AGE_CAP_DAYS = 90;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Scores a single finding from 0-100.
 *
 * The score blends three signals: the declared severity, the CVSS base score
 * when one is supplied, and how long the finding has been sitting unresolved.
 * Remediation progress damps the whole thing, so a resolved critical scores 0
 * while an untouched one that has aged past the cap scores the maximum.
 */
function scoreFinding(finding, now = Date.now()) {
  if (!finding || !SEVERITY_WEIGHTS[finding.severity]) {
    throw new Error(`Unknown severity: ${finding && finding.severity}`);
  }

  const severityScore = SEVERITY_WEIGHTS[finding.severity];
  const cvssScore = typeof finding.cvss === 'number' ? finding.cvss * 3 : severityScore * 0.75;

  const createdAt = Date.parse(finding.createdAt);
  const ageDays = Number.isNaN(createdAt) ? 0 : Math.max(0, (now - createdAt) / MS_PER_DAY);
  const ageScore = Math.min(ageDays, AGE_CAP_DAYS) / AGE_CAP_DAYS * 30;

  const multiplier = STATUS_MULTIPLIERS[finding.status] ?? 1;
  const raw = (severityScore + cvssScore + ageScore) * multiplier;

  return Math.round(Math.min(100, raw) * 10) / 10;
}

/** Aggregates a set of findings into the numbers the /api/findings/stats endpoint returns. */
function summarise(findings, now = Date.now()) {
  const bySeverity = Object.fromEntries(Object.keys(SEVERITY_WEIGHTS).map((k) => [k, 0]));
  const byStatus = Object.fromEntries(Object.keys(STATUS_MULTIPLIERS).map((k) => [k, 0]));

  let riskTotal = 0;

  for (const finding of findings) {
    bySeverity[finding.severity] = (bySeverity[finding.severity] || 0) + 1;
    byStatus[finding.status] = (byStatus[finding.status] || 0) + 1;
    riskTotal += scoreFinding(finding, now);
  }

  const openCount = findings.length - (byStatus.resolved || 0);

  return {
    total: findings.length,
    open: openCount,
    bySeverity,
    byStatus,
    riskTotal: Math.round(riskTotal * 10) / 10,
    riskAverage: findings.length === 0 ? 0 : Math.round((riskTotal / findings.length) * 10) / 10,
  };
}

module.exports = { scoreFinding, summarise, SEVERITY_WEIGHTS, STATUS_MULTIPLIERS };
