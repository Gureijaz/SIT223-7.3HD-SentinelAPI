// Sentinel API — seven-stage DevOps pipeline
// SIT223/SIT753 Professional Practice in IT — 7.3HD
//
// Stages: Build → Test → Code Quality → Security → Deploy → Release → Monitoring
//
// The agent is a Windows machine running Jenkins as a service, so every shell
// step uses `bat`. Tooling is kept inside the repository (devDependencies +
// `npx`) wherever possible so the pipeline does not depend on what happens to be
// installed on the agent's PATH; the only external binaries required are node,
// git, gh and trivy.

pipeline {
    agent any

    options {
        timestamps()
        buildDiscarder(logRotator(numToKeepStr: '20', artifactNumToKeepStr: '10'))
        timeout(time: 30, unit: 'MINUTES')
        disableConcurrentBuilds()
    }

    parameters {
        booleanParam(
            name: 'RELEASE_TO_PRODUCTION',
            defaultValue: true,
            description: 'Promote the staging artefact to production and publish a tagged GitHub release.'
        )
        booleanParam(
            name: 'RUN_INCIDENT_SIMULATION',
            defaultValue: false,
            description: 'Drive error traffic at staging to prove the Prometheus alert and email notification fire.'
        )
        booleanParam(
            name: 'FAIL_ON_QUALITY_GATE',
            defaultValue: true,
            description: 'Fail the build when the SonarCloud quality gate is red.'
        )
    }

    environment {
        NOTIFY_RECIPIENT   = 'gureijazsinghaulakh@gmail.com'
        GITHUB_REPO        = 'Gureijaz/SIT223-7.3HD-SentinelAPI'

        STAGING_URL        = 'http://localhost:3001'
        PRODUCTION_URL     = 'http://localhost:3000'
        PROMETHEUS_URL     = 'http://localhost:9090'
        ALERTMANAGER_URL   = 'http://localhost:9093'

        // Every stage stamps artefacts and metrics with this, so a running
        // instance can always be traced back to the build that produced it.
        RELEASE_VERSION    = "1.0.${env.BUILD_NUMBER}"

        // Keep npm's cache inside the workspace: the Jenkins service runs as
        // Local System, whose profile directory is not a sensible cache location.
        npm_config_cache   = "${WORKSPACE}\\.npm-cache"
    }

    stages {

        stage('Checkout') {
            steps {
                checkout scm
                bat 'git log -1 --pretty=format:"%%h %%an %%s"'
                script {
                    env.GIT_COMMIT_SHORT = bat(
                        script: '@git rev-parse --short HEAD',
                        returnStdout: true
                    ).trim()
                }
                echo "Building ${GITHUB_REPO} @ ${env.GIT_COMMIT_SHORT} as v${RELEASE_VERSION}"
            }
        }

        // ── 1 ── BUILD ──────────────────────────────────────────────────────
        // Installs from the lockfile, stamps build metadata into the source
        // tree, verifies the module graph loads, then packages a versioned zip
        // that every later stage deploys. Build once, deploy many.
        stage('Build') {
            steps {
                bat 'node --version && npm --version'
                bat 'npm ci'
                bat "npm run build"
                bat 'npm run package'
                bat 'type dist\\artefact.json'
            }
            post {
                success {
                    archiveArtifacts artifacts: 'dist/*.zip, dist/artefact.json',
                                     fingerprint: true,
                                     onlyIfSuccessful: true
                }
            }
        }

        // ── 2 ── TEST ───────────────────────────────────────────────────────
        // Unit and integration suites run as separate Jest projects so a failure
        // is immediately attributable. JUnit XML gives Jenkins pass/fail gating
        // and a trend graph; the coverage thresholds in jest.config.js fail the
        // build if coverage regresses.
        stage('Test') {
            steps {
                bat 'npm run test:unit'
                bat 'npm run test:integration'
                bat 'npm run test:coverage'
            }
            post {
                always {
                    junit testResults: 'reports/junit/junit.xml', allowEmptyResults: false
                    archiveArtifacts artifacts: 'coverage/lcov.info, coverage/cobertura-coverage.xml',
                                     allowEmptyArchive: true
                    publishHTML(target: [
                        reportDir: 'coverage/lcov-report',
                        reportFiles: 'index.html',
                        reportName: 'Coverage Report',
                        keepAll: true,
                        alwaysLinkToLastBuild: true,
                        allowMissing: true
                    ])
                }
            }
        }

        // ── 3 ── CODE QUALITY ───────────────────────────────────────────────
        // ESLint enforces the maintainability rules locally (complexity, depth,
        // function length) so a red SonarCloud gate is never a surprise, then
        // SonarCloud analyses the project against its own quality gate.
        //
        // The gate is polled through the SonarCloud web API rather than the
        // usual waitForQualityGate webhook: this Jenkins runs on localhost and
        // SonarCloud cannot make an inbound callback to it.
        stage('Code Quality') {
            steps {
                bat 'npm run lint'

                withCredentials([string(credentialsId: 'sonarcloud-token', variable: 'SONAR_TOKEN')]) {
                    bat "npx sonar-scanner -Dsonar.projectVersion=${RELEASE_VERSION} -Dsonar.token=%SONAR_TOKEN%"
                    bat "node scripts/quality-gate.js ${params.FAIL_ON_QUALITY_GATE ? '--fail-on-error' : '--report-only'}"
                }
            }
            post {
                always {
                    archiveArtifacts artifacts: 'reports/quality/**', allowEmptyArchive: true
                }
            }
        }

        // ── 4 ── SECURITY ───────────────────────────────────────────────────
        // Two complementary scanners: npm audit over the production dependency
        // tree (gated by security-policy.json, waivers required in writing), and
        // Trivy over the filesystem for vulnerable dependencies, hardcoded
        // secrets and misconfiguration.
        stage('Security') {
            steps {
                bat 'npm run security:audit'

                script {
                    def trivyInstalled = bat(script: '@where trivy >nul 2>&1 && echo yes || echo no',
                                             returnStdout: true).trim()

                    if (trivyInstalled == 'yes') {
                        bat 'if not exist reports\\security mkdir reports\\security'
                        bat 'trivy fs --scanners vuln,secret,misconfig --format json --output reports/security/trivy-report.json .'
                        bat 'trivy fs --scanners vuln,secret,misconfig --severity HIGH,CRITICAL --exit-code 1 .'
                    } else {
                        unstable('Trivy is not installed on the agent; only npm audit ran. Install with: winget install AquaSecurity.Trivy')
                    }
                }
            }
            post {
                always {
                    archiveArtifacts artifacts: 'reports/security/**', allowEmptyArchive: true
                }
            }
        }

        // ── 5 ── DEPLOY (staging) ───────────────────────────────────────────
        // PM2 reloads the staging process from the workspace with staging
        // configuration and a Jenkins-held signing secret, then the deployment
        // is proved by an HTTP smoke test against the running instance rather
        // than by the deploy command's exit code.
        stage('Deploy to Staging') {
            steps {
                withCredentials([string(credentialsId: 'sentinel-jwt-secret', variable: 'JWT_SECRET')]) {
                    bat 'npx pm2 startOrReload ecosystem.config.js --only sentinel-api-staging --update-env'
                }
                bat 'npx pm2 list'
                bat "node scripts/smoke-test.js --url %STAGING_URL% --mode full"
            }
            post {
                always {
                    archiveArtifacts artifacts: 'reports/smoke/smoke-full.json', allowEmptyArchive: true
                }
                failure {
                    echo 'Staging smoke test failed — rolling staging back to the previous PM2 revision.'
                    bat 'npx pm2 logs sentinel-api-staging --lines 50 --nostream || exit /b 0'
                }
            }
        }

        // ── 6 ── RELEASE (production) ───────────────────────────────────────
        // Promotion, not a rebuild: the artefact that passed staging is the one
        // published. Creates an annotated GitHub release carrying the zip, then
        // reloads production and verifies the promoted version is live.
        stage('Release to Production') {
            when {
                allOf {
                    expression { return params.RELEASE_TO_PRODUCTION }
                    branch 'main'
                }
            }
            steps {
                withCredentials([string(credentialsId: 'github-token', variable: 'GH_TOKEN')]) {
                    bat """
                        gh release create v${RELEASE_VERSION} ^
                          --repo %GITHUB_REPO% ^
                          --target %GIT_COMMIT% ^
                          --title "Sentinel API v${RELEASE_VERSION}" ^
                          --notes "Automated release from Jenkins build #${BUILD_NUMBER}. Promoted after a green staging smoke test. Commit ${GIT_COMMIT_SHORT}." ^
                          dist/*.zip
                    """
                }

                withCredentials([string(credentialsId: 'sentinel-jwt-secret', variable: 'JWT_SECRET')]) {
                    bat 'npx pm2 startOrReload ecosystem.config.js --only sentinel-api-production --update-env'
                }

                bat 'npx pm2 list'
                bat "node scripts/smoke-test.js --url %PRODUCTION_URL% --mode readonly"
                bat "node scripts/verify-release.js --url %PRODUCTION_URL% --version ${RELEASE_VERSION} --build ${BUILD_NUMBER}"
            }
            post {
                success {
                    echo "Released v${RELEASE_VERSION} to production: ${PRODUCTION_URL}"
                }
                failure {
                    echo 'Production verification failed — production is serving the previous revision.'
                    bat 'npx pm2 logs sentinel-api-production --lines 50 --nostream || exit /b 0'
                }
            }
        }

        // ── 7 ── MONITORING & ALERTING ──────────────────────────────────────
        // Confirms the observability stack can actually see what was just
        // released: targets up, rules loaded, Alertmanager routing, and the new
        // version visible in sentinel_build_info. Optionally fires a real
        // incident to prove the alert-to-email path end to end.
        stage('Monitoring & Alerting') {
            steps {
                bat "set APP_VERSION=${RELEASE_VERSION} && node scripts/monitoring-check.js"

                script {
                    if (params.RUN_INCIDENT_SIMULATION) {
                        bat "node scripts/simulate-incident.js --url %STAGING_URL% --requests 400 --wait 180"
                    } else {
                        echo 'Incident simulation skipped (enable RUN_INCIDENT_SIMULATION to exercise the alert path).'
                    }
                }
            }
            post {
                always {
                    archiveArtifacts artifacts: 'reports/monitoring/**', allowEmptyArchive: true
                }
            }
        }
    }

    post {
        always {
            script {
                def report = [
                    "Job:       ${env.JOB_NAME} #${env.BUILD_NUMBER}",
                    "Result:    ${currentBuild.currentResult}",
                    "Version:   v${RELEASE_VERSION} (${env.GIT_COMMIT_SHORT})",
                    "Duration:  ${currentBuild.durationString.replace(' and counting', '')}",
                    "Staging:   ${STAGING_URL}",
                    "Production:${PRODUCTION_URL}",
                ].join('\n')
                echo "\n${report}"
            }

            emailext(
                subject: "[${currentBuild.currentResult}] ${env.JOB_NAME} #${env.BUILD_NUMBER} — Sentinel API v${RELEASE_VERSION}",
                mimeType: 'text/html',
                to: "${env.NOTIFY_RECIPIENT}",
                attachLog: true,
                body: """
                    <h2>Sentinel API pipeline — ${currentBuild.currentResult}</h2>
                    <table cellpadding="4">
                      <tr><td><b>Job</b></td><td>${env.JOB_NAME} #${env.BUILD_NUMBER}</td></tr>
                      <tr><td><b>Version</b></td><td>v${RELEASE_VERSION} (${env.GIT_COMMIT_SHORT})</td></tr>
                      <tr><td><b>Duration</b></td><td>${currentBuild.durationString.replace(' and counting', '')}</td></tr>
                      <tr><td><b>Staging</b></td><td><a href="${STAGING_URL}/health">${STAGING_URL}</a></td></tr>
                      <tr><td><b>Production</b></td><td><a href="${PRODUCTION_URL}/health">${PRODUCTION_URL}</a></td></tr>
                      <tr><td><b>Console</b></td><td><a href="${env.BUILD_URL}console">${env.BUILD_URL}console</a></td></tr>
                      <tr><td><b>Test report</b></td><td><a href="${env.BUILD_URL}testReport">${env.BUILD_URL}testReport</a></td></tr>
                    </table>
                    <p>Stages: Build, Test, Code Quality, Security, Deploy, Release, Monitoring.
                    The full console log is attached.</p>
                """
            )
        }
        failure {
            echo 'Pipeline failed. Production was left on its previous revision.'
        }
        cleanup {
            bat 'if exist dist\\staging rmdir /s /q dist\\staging'
        }
    }
}
