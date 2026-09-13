'use strict';

const client = require('prom-client');
const config = require('../config');

const registry = new client.Registry();

registry.setDefaultLabels({
  app: 'sentinel-api',
  env: config.env,
  version: config.release.version,
});

client.collectDefaultMetrics({ register: registry });

const httpRequestDuration = new client.Histogram({
  name: 'sentinel_http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  labelNames: ['method', 'route', 'status_code'],
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
  registers: [registry],
});

const httpRequestsTotal = new client.Counter({
  name: 'sentinel_http_requests_total',
  help: 'Total number of HTTP requests handled',
  labelNames: ['method', 'route', 'status_code'],
  registers: [registry],
});

const httpErrorsTotal = new client.Counter({
  name: 'sentinel_http_errors_total',
  help: 'Total number of HTTP responses with a 4xx or 5xx status',
  labelNames: ['method', 'route', 'status_code'],
  registers: [registry],
});

const findingsCreatedTotal = new client.Counter({
  name: 'sentinel_findings_created_total',
  help: 'Total number of findings created, labelled by severity',
  labelNames: ['severity'],
  registers: [registry],
});

const buildInfo = new client.Gauge({
  name: 'sentinel_build_info',
  help: 'Build metadata for the running instance; the value is always 1',
  labelNames: ['version', 'build_number', 'commit', 'env'],
  registers: [registry],
});

buildInfo.set(
  {
    version: config.release.version,
    build_number: String(config.release.buildNumber),
    commit: String(config.release.commit),
    env: config.env,
  },
  1,
);

/** Records duration, count and error metrics for every request that passes through. */
function metricsMiddleware(req, res, next) {
  const stop = httpRequestDuration.startTimer();

  res.on('finish', () => {
    // Use the matched Express route so high-cardinality path params (ids) do not
    // explode the label space in Prometheus.
    const route = req.route ? `${req.baseUrl}${req.route.path}` : req.path;
    const labels = { method: req.method, route, status_code: res.statusCode };

    stop(labels);
    httpRequestsTotal.inc(labels);

    if (res.statusCode >= 400) httpErrorsTotal.inc(labels);
  });

  next();
}

module.exports = {
  registry,
  metricsMiddleware,
  httpRequestsTotal,
  httpErrorsTotal,
  findingsCreatedTotal,
};
