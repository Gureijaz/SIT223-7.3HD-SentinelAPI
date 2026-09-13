'use strict';

const { scoreFinding, summarise } = require('../../src/services/risk');

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse('2026-01-01T00:00:00.000Z');

function finding(overrides = {}) {
  return {
    severity: 'high',
    status: 'open',
    createdAt: new Date(NOW).toISOString(),
    ...overrides,
  };
}

describe('scoreFinding', () => {
  it('scores a brand new high finding from severity alone', () => {
    // 25 (severity) + 18.75 (cvss fallback = 25 * 0.75) + 0 (age) = 43.75
    expect(scoreFinding(finding(), NOW)).toBe(43.8);
  });

  it('uses a supplied CVSS score in place of the severity fallback', () => {
    // 25 + 9.8 * 3 = 54.4
    expect(scoreFinding(finding({ cvss: 9.8 }), NOW)).toBe(54.4);
  });

  it('ranks critical above high above low for identical inputs', () => {
    const critical = scoreFinding(finding({ severity: 'critical' }), NOW);
    const high = scoreFinding(finding({ severity: 'high' }), NOW);
    const low = scoreFinding(finding({ severity: 'low' }), NOW);

    expect(critical).toBeGreaterThan(high);
    expect(high).toBeGreaterThan(low);
  });

  it('increases the score as an open finding ages', () => {
    const fresh = scoreFinding(finding(), NOW);
    const aged = scoreFinding(finding({ createdAt: new Date(NOW - 30 * DAY).toISOString() }), NOW);

    expect(aged).toBeGreaterThan(fresh);
  });

  it('caps the age contribution at 90 days', () => {
    const ninety = scoreFinding(finding({ createdAt: new Date(NOW - 90 * DAY).toISOString() }), NOW);
    const year = scoreFinding(finding({ createdAt: new Date(NOW - 365 * DAY).toISOString() }), NOW);

    expect(year).toBe(ninety);
  });

  it('scores a resolved finding at zero regardless of severity', () => {
    expect(scoreFinding(finding({ severity: 'critical', status: 'resolved' }), NOW)).toBe(0);
  });

  it('damps the score as remediation progresses', () => {
    const open = scoreFinding(finding({ status: 'open' }), NOW);
    const triaged = scoreFinding(finding({ status: 'triaged' }), NOW);
    const inProgress = scoreFinding(finding({ status: 'in_progress' }), NOW);

    expect(open).toBeGreaterThan(triaged);
    expect(triaged).toBeGreaterThan(inProgress);
  });

  it('never exceeds 100', () => {
    const worst = finding({
      severity: 'critical',
      cvss: 10,
      createdAt: new Date(NOW - 500 * DAY).toISOString(),
    });

    expect(scoreFinding(worst, NOW)).toBe(100);
  });

  it('tolerates an unparseable createdAt by contributing no age score', () => {
    expect(scoreFinding(finding({ createdAt: 'not-a-date' }), NOW)).toBe(43.8);
  });

  it('throws on an unknown severity', () => {
    expect(() => scoreFinding(finding({ severity: 'catastrophic' }), NOW)).toThrow(/Unknown severity/);
    expect(() => scoreFinding(null, NOW)).toThrow(/Unknown severity/);
  });
});

describe('summarise', () => {
  it('returns zeroed totals for an empty set', () => {
    const result = summarise([], NOW);

    expect(result.total).toBe(0);
    expect(result.open).toBe(0);
    expect(result.riskTotal).toBe(0);
    expect(result.riskAverage).toBe(0);
    expect(result.bySeverity.critical).toBe(0);
  });

  it('counts findings by severity and status', () => {
    const result = summarise(
      [
        finding({ severity: 'critical', status: 'open' }),
        finding({ severity: 'critical', status: 'resolved' }),
        finding({ severity: 'low', status: 'triaged' }),
      ],
      NOW,
    );

    expect(result.total).toBe(3);
    expect(result.open).toBe(2);
    expect(result.bySeverity.critical).toBe(2);
    expect(result.bySeverity.low).toBe(1);
    expect(result.byStatus.resolved).toBe(1);
  });

  it('averages the risk score across the set', () => {
    const result = summarise([finding(), finding()], NOW);

    expect(result.riskTotal).toBe(87.6);
    expect(result.riskAverage).toBe(43.8);
  });
});
