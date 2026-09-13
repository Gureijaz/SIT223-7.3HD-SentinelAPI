'use strict';

const { parse } = require('../../src/utils/validate');
const { ValidationError } = require('../../src/utils/errors');
const { createFindingSchema, registerSchema, listFindingsSchema } = require('../../src/schemas');

describe('parse', () => {
  it('returns the parsed value with defaults applied', () => {
    const result = parse(createFindingSchema, {
      title: 'Outdated OpenSSL on the edge proxy',
      severity: 'high',
      asset: 'edge-proxy-01',
    });

    expect(result.status).toBe('open');
    expect(result.tags).toEqual([]);
    expect(result.description).toBe('');
  });

  it('coerces query string numbers into integers', () => {
    const result = parse(listFindingsSchema, { page: '3', limit: '50' });

    expect(result.page).toBe(3);
    expect(result.limit).toBe(50);
    expect(result.sort).toBe('createdAt');
  });

  it('throws a ValidationError listing every offending field', () => {
    expect.assertions(3);

    try {
      parse(createFindingSchema, { title: 'no', severity: 'urgent' });
    } catch (err) {
      expect(err).toBeInstanceOf(ValidationError);
      expect(err.statusCode).toBe(400);
      expect(err.details.map((d) => d.field).sort()).toEqual(['asset', 'severity', 'title']);
    }
  });

  it('rejects a malformed CVE identifier', () => {
    expect(() => parse(createFindingSchema, {
      title: 'Log4Shell in the reporting service',
      severity: 'critical',
      asset: 'reporting',
      cve: '2021-44228',
    })).toThrow(ValidationError);
  });

  it('enforces the password policy on registration', () => {
    expect(() => parse(registerSchema, {
      email: 'analyst@example.com',
      password: 'short',
      name: 'Analyst',
    })).toThrow(ValidationError);

    expect(() => parse(registerSchema, {
      email: 'not-an-email',
      password: 'CorrectHorseBattery1',
      name: 'Analyst',
    })).toThrow(ValidationError);
  });

  it('accepts a password that satisfies every rule', () => {
    const result = parse(registerSchema, {
      email: 'Analyst@Example.com',
      password: 'CorrectHorseBattery1',
      name: 'Analyst',
    });

    expect(result.email).toBe('Analyst@Example.com');
    expect(result.role).toBeUndefined();
  });
});
