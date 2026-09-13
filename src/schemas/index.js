'use strict';

const { z } = require('zod');

const SEVERITIES = ['critical', 'high', 'medium', 'low', 'informational'];
const STATUSES = ['open', 'triaged', 'in_progress', 'resolved', 'accepted_risk'];
const ROLES = ['analyst', 'admin'];

const registerSchema = z.object({
  email: z.string().email(),
  password: z
    .string()
    .min(12, 'Password must be at least 12 characters')
    .regex(/[a-z]/, 'Password must contain a lowercase letter')
    .regex(/[A-Z]/, 'Password must contain an uppercase letter')
    .regex(/[0-9]/, 'Password must contain a digit'),
  name: z.string().min(1).max(120),
  role: z.enum(ROLES).optional(),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const createFindingSchema = z.object({
  title: z.string().min(3).max(200),
  description: z.string().max(5000).optional().default(''),
  severity: z.enum(SEVERITIES),
  status: z.enum(STATUSES).optional().default('open'),
  cve: z
    .string()
    .regex(/^CVE-\d{4}-\d{4,7}$/, 'cve must look like CVE-2024-12345')
    .optional(),
  asset: z.string().min(1).max(200),
  cvss: z.number().min(0).max(10).optional(),
  tags: z.array(z.string().min(1).max(40)).max(20).optional().default([]),
});

const updateFindingSchema = createFindingSchema.partial().refine(
  (value) => Object.keys(value).length > 0,
  { message: 'At least one field must be supplied' },
);

const listFindingsSchema = z.object({
  severity: z.enum(SEVERITIES).optional(),
  status: z.enum(STATUSES).optional(),
  asset: z.string().optional(),
  q: z.string().optional(),
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
  sort: z.enum(['createdAt', 'severity', 'cvss', 'title']).optional().default('createdAt'),
  order: z.enum(['asc', 'desc']).optional().default('desc'),
});

module.exports = {
  SEVERITIES,
  STATUSES,
  ROLES,
  registerSchema,
  loginSchema,
  createFindingSchema,
  updateFindingSchema,
  listFindingsSchema,
};
