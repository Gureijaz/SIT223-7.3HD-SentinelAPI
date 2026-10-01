'use strict';

const { ValidationError } = require('./errors');

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
