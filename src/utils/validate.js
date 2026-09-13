'use strict';

const { ValidationError } = require('./errors');

/** Parses `payload` with a zod schema, converting zod issues into a ValidationError. */
function parse(schema, payload) {
  const result = schema.safeParse(payload);

  if (!result.success) {
    const details = result.error.issues.map((issue) => ({
      field: issue.path.join('.') || '(body)',
      message: issue.message,
    }));
    throw new ValidationError(details);
  }

  return result.data;
}

module.exports = { parse };
