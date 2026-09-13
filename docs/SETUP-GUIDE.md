# Setting up the pipeline

Everything needed to take this repository from a fresh clone to a green
seven-stage Jenkins build. Steps marked **(manual)** involve a credential or a
browser and cannot be scripted.

Target environment: Windows 11, Jenkins running as a Windows service as
`Local System`, Node.js installed machine-wide.

---

## 0. Prerequisites

| Tool | Check | Install |
| --- | --- | --- |
| Node.js 20+ | `node --version` | `winget install OpenJS.NodeJS.LTS --scope machine` |
| Git | `git --version` | `winget install Git.Git --scope machine` |
| GitHub CLI | `gh --version` | `winget install GitHub.cli` |
| Trivy | `trivy --version` | `winget install AquaSecurity.Trivy` |
| Jenkins | <http://localhost:8080> | `winget install Jenkins.Jenkins` |

> **Why `--scope machine` matters.** The Jenkins service runs as `Local System`,
> which does not inherit your user PATH. A per-user winget install lands in
> `%LOCALAPPDATA%\Microsoft\WinGet\Packages\...` and the pipeline fails with
> `'npm' is not recognized` even though it works fine in your own terminal.
> After installing machine-wide, run `Restart-Service Jenkins`.

Required Jenkins plugins — **Manage Jenkins → Plugins → Available**:

- Pipeline, Git, Credentials Binding *(included in "Install suggested plugins")*
- **Email Extension Plugin**
- **JUnit**
- **HTML Publisher**
- **Timestamper**

---

## 1. Clone and verify locally

```powershell
git clone https://github.com/Gureijaz/SIT223-7.3HD-SentinelAPI.git
cd SIT223-7.3HD-SentinelAPI
npm ci
npm test
npm run lint
```

73 tests across two suites should pass and ESLint should be silent. If this works,
the Build, Test and Code Quality stages will work.

---

## 2. SonarCloud project **(manual)**

1. Sign in at <https://sonarcloud.io> with GitHub.
2. **+ → Analyze new project** → pick `SIT223-7.3HD-SentinelAPI` → **Set Up**.
3. Choose **With Jenkins** (or "Other CI"); the important part is the token.
4. **My Account → Security → Generate Token**. Copy it — you only see it once.
5. Check the project key and organization match
   [`sonar-project.properties`](../sonar-project.properties):

   ```
   sonar.projectKey=Gureijaz_SIT223-7.3HD-SentinelAPI
   sonar.organization=gureijaz
   ```

   SonarCloud shows both on the project's **Information** page. Edit the file if
   they differ, then commit and push.
6. In **Administration → Analysis Method**, turn *Automatic Analysis* **off** —
   otherwise SonarCloud rejects the CI-based analysis the pipeline submits.

> The pipeline does **not** use `waitForQualityGate`. That step waits for
> SonarCloud to call a webhook back into Jenkins, which cannot work when Jenkins
> is on `localhost`. `scripts/quality-gate.js` polls the SonarCloud API instead.

---

## 3. Jenkins credentials **(manual)**

Three secret-text credentials, created at
**Manage Jenkins → Credentials → System → Global credentials → Add Credentials**
(*Kind: Secret text* for all three):

| ID | Secret |
| --- | --- |
| `sonarcloud-token` | The SonarCloud token from step 2 |
| `github-token` | GitHub PAT with `repo` scope — <https://github.com/settings/tokens> |
| `sentinel-jwt-secret` | Any long random string. Generate one with:<br>`node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"` |

The IDs must match exactly — the Jenkinsfile binds them by name.

### Email notifications

**Manage Jenkins → System → Extended E-mail Notification**:

- SMTP server `smtp.gmail.com`, port `587`, **Use TLS** ticked
- Credentials: your Gmail address + a **Google app password**
  (Google Account → Security → 2-Step Verification → App passwords)
- Default recipient: your email

Also fill in the plain **E-mail Notification** section below it and tick
**Use SMTP Authentication** under its *Advanced* settings — the two sections have
separate credentials, and the test button only exercises the second one.

---

## 4. Create the pipeline job

Either run the helper (it prompts for your own tokens and posts them to the local
Jenkins; nothing is written to disk):

```powershell
powershell -ExecutionPolicy Bypass -File jenkins\setup-jenkins.ps1 -JenkinsUser <your-jenkins-username>
```

…or do it by hand: **New Item → Pipeline**, name it `sentinel-api-pipeline`, then

- **Build Triggers** → *Poll SCM* → `H/5 * * * *`
- **Pipeline** → *Pipeline script from SCM* → Git
  → `https://github.com/Gureijaz/SIT223-7.3HD-SentinelAPI.git`
  → branch `*/main` → Script Path `Jenkinsfile`

---

## 5. Monitoring stack

```powershell
# download the binaries once — see ops/README.md for the full command
powershell -ExecutionPolicy Bypass -File ops\monitoring.ps1 -Action start
```

**(manual)** Create the Alertmanager SMTP password file — this holds a credential,
so it is deliberately not committed and not scripted:

```powershell
Set-Content -Path ops\alertmanager\smtp-password.txt -Value 'your-16-char-app-password' -NoNewline
```

Confirm with `ops\monitoring.ps1 -Action status`: Prometheus and Alertmanager UP,
and both app instances UP once the pipeline has deployed them.

---

## 6. Run it

Open `http://localhost:8080/job/sentinel-api-pipeline/` → **Build with Parameters**.

| Parameter | For the first run | For the demo video |
| --- | --- | --- |
| `RELEASE_TO_PRODUCTION` | ✔ | ✔ |
| `RUN_INCIDENT_SIMULATION` | ✘ | ✔ — this is what proves the alert path |
| `FAIL_ON_QUALITY_GATE` | ✔ | ✔ |

A full run with the incident simulation takes roughly 8–12 minutes; without it,
about 4.

### What success looks like

| Stage | Evidence |
| --- | --- |
| Build | `dist/sentinel-api-1.0.N-build.N-<commit>.zip` archived and fingerprinted |
| Test | Test Result trend graph; 73 tests; coverage report linked on the build page |
| Code Quality | `QUALITY GATE PASSED` in the log, dashboard link to SonarCloud |
| Security | `SECURITY GATE PASSED`, Trivy finds no HIGH/CRITICAL |
| Deploy | `12/12 checks passed` against <http://localhost:3001> |
| Release | GitHub release `v1.0.N` created; `RELEASE VERIFIED` against <http://localhost:3000> |
| Monitoring | `7/7 monitoring checks passed`; with the simulation on, `SentinelHighErrorRatio -> firing` and an email |

---

## Troubleshooting

**`'npm' is not recognized`** — Node is on the user PATH but not the machine PATH.
See the `--scope machine` note in step 0, then `Restart-Service Jenkins`.

**`npm ci` fails with `EPERM` or a lock error** — the Jenkins service and your own
shell are sharing an npm cache. The Jenkinsfile already redirects it with
`npm_config_cache` inside the workspace; make sure you have not overridden
`npm_config_cache` globally.

**Quality gate step reports `.scannerwork/report-task.txt not found`** — the
scanner did not run. Usually the SonarCloud token is missing or the project key in
`sonar-project.properties` does not match the project.

**`gh release create` fails with 403** — the `github-token` credential is missing
the `repo` scope, or has expired.

**Deploy stage passes but the smoke test times out** — PM2 started the process but
it exited. `npx pm2 logs sentinel-api-staging --lines 100`. The usual cause is a
port already in use.

**Monitoring stage fails with `no sentinel-api targets are configured`** —
Prometheus is not running, or is running against a different config file. Restart
it with `ops\monitoring.ps1 -Action restart`.

**Incident simulation never fires** — the alert needs the error *ratio* over 25%
across a 2-minute window. If staging has just served a large volume of successful
smoke-test traffic, raise `--requests`, or wait for the rate window to move on.
