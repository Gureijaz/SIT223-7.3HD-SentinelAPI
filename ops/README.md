# Monitoring stack

Prometheus and Alertmanager run as standalone Windows executables — no container
runtime, no service install. The Monitoring stage of the pipeline talks to both
over HTTP and fails if either is blind to the release that was just promoted.

```
sentinel-api :3001 (staging)     ─┐
sentinel-api :3000 (production)  ─┼─► Prometheus :9090 ─► Alertmanager :9093 ─► email
                                  │        │
                                  │        └─► Grafana :3030 (optional dashboard)
                                  └─ /metrics scraped every 15s
```

## Contents

| Path | What it is |
| --- | --- |
| `prometheus/prometheus.yml` | Scrape config — both environments under one `sentinel-api` job, labelled `env` |
| `prometheus/alert.rules.yml` | Four alert rules across availability, traffic and business signals |
| `alertmanager/alertmanager.yml` | Email routing, severity-based sub-route, inhibition rule |
| `grafana/sentinel-api-dashboard.json` | Importable dashboard (optional) |
| `monitoring.ps1` | start / stop / status / restart helper |
| `bin/` | Downloaded Prometheus and Alertmanager binaries (gitignored) |

## First-time setup

The binaries are not committed. Download them into `ops/bin/`:

```powershell
$bin = "ops\bin"
New-Item -ItemType Directory -Force $bin | Out-Null
curl.exe -sSL -o "$bin\prometheus.zip"   https://github.com/prometheus/prometheus/releases/download/v3.14.0/prometheus-3.14.0.windows-amd64.zip
curl.exe -sSL -o "$bin\alertmanager.zip" https://github.com/prometheus/alertmanager/releases/download/v0.34.0/alertmanager-0.34.0.windows-amd64.zip
Expand-Archive "$bin\prometheus.zip"   -DestinationPath $bin -Force
Expand-Archive "$bin\alertmanager.zip" -DestinationPath $bin -Force
Remove-Item "$bin\*.zip"
```

Then create the SMTP password file — **this is the one step that cannot be
automated**, because it holds a credential:

```powershell
# Google Account → Security → 2-Step Verification → App passwords
Set-Content -Path ops\alertmanager\smtp-password.txt -Value 'your-16-char-app-password' -NoNewline
```

The file is gitignored. Alertmanager reads it at send time, so a missing or wrong
password still lets alerts fire and route — only the email delivery fails.

## Running

```powershell
powershell -ExecutionPolicy Bypass -File ops\monitoring.ps1 -Action start
powershell -ExecutionPolicy Bypass -File ops\monitoring.ps1 -Action status
powershell -ExecutionPolicy Bypass -File ops\monitoring.ps1 -Action stop
```

| Service | URL |
| --- | --- |
| Prometheus | <http://localhost:9090> — targets at `/targets`, alerts at `/alerts` |
| Alertmanager | <http://localhost:9093> |

## Verifying and exercising it

```bash
node scripts/monitoring-check.js      # the Monitoring stage's assertions
node scripts/simulate-incident.js --url http://localhost:3001 --requests 400
```

`monitoring-check.js` asserts that Prometheus is healthy, both scrape targets are
UP, the `sentinel` rule group is loaded with nothing already firing, Alertmanager
has a receiver, metrics are flowing, and `sentinel_build_info` reports the version
that was just released.

`simulate-incident.js` drives a burst of rejected (401/404) requests at staging so
`SentinelHighErrorRatio` crosses 25%, then waits for Prometheus to move the alert
through `pending` into `firing` and confirms Alertmanager routed it. Nothing is
written and no real data is touched; the alert resolves itself once traffic stops.

## Alert rules

| Alert | Fires when | For | Severity |
| --- | --- | --- | --- |
| `SentinelInstanceDown` | `up == 0` for an instance | 1m | critical |
| `SentinelHighErrorRatio` | over 25% of requests returning 4xx/5xx over 2m | 1m | critical |
| `SentinelHighLatencyP95` | p95 request duration above 1s | 5m | warning |
| `SentinelCriticalFindingBurst` | 5+ critical findings logged in 10 minutes | 0m | warning |

Each carries a summary, a description that explains the likely cause, and — for
the availability and traffic alerts — a runbook command. `SentinelInstanceDown`
inhibits `SentinelHighErrorRatio` for the same environment, so a dead instance
pages once rather than twice.

## Grafana (optional)

Grafana is not required by the pipeline. To use the dashboard anyway: install
Grafana, add a Prometheus data source at `http://localhost:9090` with the UID
`prometheus`, then import `grafana/sentinel-api-dashboard.json`. It shows
availability, deployed version, error ratio, latency percentiles, request rate by
status code, findings created by severity, and process memory — filtered by an
`env` variable so staging and production sit side by side.
