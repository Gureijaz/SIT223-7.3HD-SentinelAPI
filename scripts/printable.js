'use strict';

/* strip control characters so logged values cannot forge log lines */
function printable(value) {
  return String(value).replace(/\p{Cc}/gu, ' ');
}

module.exports = { printable };
