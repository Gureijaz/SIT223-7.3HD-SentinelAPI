# Sentinel API

A vulnerability-finding tracker REST API, built as the subject of a seven-stage
Jenkins DevOps pipeline for **SIT223/SIT753 Professional Practice in IT — 7.3HD**.

Security teams record findings against assets, triage them through a workflow, and
the API scores each finding's risk from its severity, CVSS base score and how long
it has gone unremediated. It exists to be built, tested, analysed, scanned,
deployed, released and monitored automatically — every stage of the pipeline acts
on something real in this codebase.

| | |
| --- | --- |
| **Runtime** | Node.js 20+ / Express 4 |
| **Auth** | JWT bearer tokens, bcrypt password hashing, role-based access control |
| **Validation** | zod schemas at every request boundary |
| **Storage** | Atomic file-backed document store (no database service to provision) |
| **Observability** | `prom-client` metrics, structured `pino` logs, liveness + readiness probes |
| **Tests** | Jest (unit) + supertest (integration), 73 cases, coverage gated |
| **Pipeline** | Jenkins declarative pipeline, 7 stages |

---

## The pipeline

```
Checkout → Build → Test → Code Quality → Security → Deploy → Release → Monitoring
```

| # | Stage | What it does | Tools |
| --- | --- | --- | --- |
| 1 | **Build** | Installs from the lockfile, stamps version/commit/build metadata into the tree, verifies the module graph loads, packages a versioned zip and archives it with a fingerprint | npm, `scripts/build.js`, `scripts/package-artifact.js`, Jenkins artefact storage |
| 2 | **Test** | Runs unit and integration suites as separate Jest projects, publishes JUnit XML for pass/fail gating and trends, enforces coverage thresholds | Jest, supertest, jest-junit |
| 3 | **Code Quality** | Enforces maintainability rules locally, then analyses the project on SonarCloud and fails the build on a red quality gate | ESLint 9, SonarCloud, `scripts/quality-gate.js` |
| 4 | **Security** | Scans runtime and build dependency trees separately, gates on critical/high in the shipped tree, and scans the filesystem for vulnerabilities, secrets and misconfiguration | `npm audit`, `scripts/security-gate.js`, Trivy |
| 5 | **Deploy** | Reloads the staging instance under PM2 with staging config and a Jenkins-held secret, then proves it over HTTP | PM2, `scripts/smoke-test.js` |
| 6 | **Release** | Publishes a tagged GitHub release carrying the artefact, promotes the same bytes to production, and verifies the running version matches | GitHub CLI, PM2, `scripts/verify-release.js` |
| 7 | **Monitoring** | Asserts Prometheus targets are up, alert rules loaded, Alertmanager routing configured and the new version visible — then optionally fires a real incident | Prometheus, Alertmanager, `scripts/monitoring-check.js`, `scripts/simulate-incident.js` |

The full pipeline definition is in [`Jenkinsfile`](Jenkinsfile).

---

## Running it locally

```bash
npm install
cp .env.example .env      # then set JWT_SECRET
npm start                 # http://localhost:3000
```

```bash
npm test                  # unit + integration
npm run test:coverage     # with coverage thresholds enforced
npm run lint              # ESLint, zero warnings allowed
npm run security:audit    # the Security stage gate
npm run build && npm run package
```

## API

All `/api/*` routes require `Authorization: Bearer <token>`; `/health`, `/ready`
and `/metrics` do not, so probes and Prometheus can reach them.

| Method | Route | Description |
| --- | --- | --- |
| `POST` | `/api/auth/register` | Create an account. The first account created becomes an admin. |
| `POST` | `/api/auth/login` | Exchange credentials for a JWT. |
| `GET` | `/api/auth/me` | The authenticated user. |
| `GET` | `/api/findings` | List findings. Filter by `severity`, `status`, `asset`, free-text `q`; page with `page`/`limit`; sort with `sort`/`order`. |
| `GET` | `/api/findings/stats` | Counts by severity and status, plus total and average risk. |
| `GET` | `/api/findings/:id` | A single finding with its risk score. |
| `POST` | `/api/findings` | Create a finding. |
| `PATCH` | `/api/findings/:id` | Update a finding. Reporters may edit their own; admins may edit any. |
| `DELETE` | `/api/findings/:id` | Delete a finding. Admins only. |
| `GET` | `/health` | Liveness, plus the running version, build number and commit. |
| `GET` | `/ready` | Readiness — confirms the storage layer answers. |
| `GET` | `/metrics` | Prometheus exposition. |

### Example

```bash
curl -X POST http://localhost:3000/api/auth/register \
  -H 'Content-Type: application/json' \
  -d '{"email":"analyst@example.com","password":"CorrectHorseBattery1","name":"Analyst"}'

curl -X POST http://localhost:3000/api/findings \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"title":"Unauthenticated Redis on the staging subnet","severity":"critical",
       "asset":"staging-cache-01","cve":"CVE-2022-0543","cvss":9.8}'
```

### Risk scoring

`scripts`-free business logic lives in [`src/services/risk.js`](src/services/risk.js).
A finding scores 0–100 by blending three signals:

- **severity** — a fixed weight per level (critical 40 … informational 1);
- **CVSS** — the supplied base score, times three; when absent, 75% of the severity weight stands in;
- **age** — up to 30 points, ramping linearly and capping at 90 days unresolved.

Remediation progress then damps the total: `triaged` ×0.9, `in_progress` ×0.6,
`accepted_risk` ×0.3, `resolved` ×0. So an untouched critical that has aged out
scores 100, and the same finding scores 0 once it is closed.

---

## Metrics exposed

| Metric | Type | Labels |
| --- | --- | --- |
| `sentinel_http_request_duration_seconds` | histogram | `method`, `route`, `status_code` |
| `sentinel_http_requests_total` | counter | `method`, `route`, `status_code` |
| `sentinel_http_errors_total` | counter | `method`, `route`, `status_code` |
| `sentinel_findings_created_total` | counter | `severity` |
| `sentinel_build_info` | gauge | `version`, `build_number`, `commit`, `env` |

Plus the default Node.js process metrics. Routes are labelled with the matched
Express route rather than the raw path, so ids never explode the label space.

See [`ops/README.md`](ops/README.md) for the monitoring stack.

---

## Repository layout

```
src/
  app.js                 Express wiring: security headers, metrics, routes, errors
  server.js              Listener with graceful shutdown
  config/                Environment configuration and build metadata
  middleware/            auth, metrics, error handling
  routes/                auth, findings, health/metrics
  services/              auth, findings, risk scoring
  repositories/          atomic file-backed store
  schemas/               zod request schemas
  utils/                 errors, logger, validation
tests/
  unit/                  pure logic: risk, validation, auth service, error types
  integration/           full HTTP request/response cycles through the app
scripts/                 pipeline stage helpers (build, package, gates, smoke, monitoring)
ops/                     Prometheus, Alertmanager and Grafana configuration
Jenkinsfile              the seven-stage pipeline
security-policy.json     dependency gate thresholds and justified waivers
```
