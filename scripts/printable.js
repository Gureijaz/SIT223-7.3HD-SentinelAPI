'use strict';

function printable(value) {
  return String(value).replace(/\p{Cc}/gu, ' ');
}

module.exports = { printable };
