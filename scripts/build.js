'use strict';

/**
 * Build stage helper.
 *
 * Stamps the build with version/commit/build-number metadata, then proves the
 * application actually loads with that metadata in place. Failing here stops the
 * pipeline before anything is packaged or deployed.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const pkg = require('../package.json');

function gitCommit() {
  if (process.env.GIT_COMMIT) return process.env.GIT_COMMIT;

  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
}

function main() {
  const buildNumber = process.env.BUILD_NUMBER || 'local';
  const commit = gitCommit();

  // Jenkins sets RELEASE_VERSION to 1.0.<BUILD_NUMBER>, so the version the
  // running instance reports on /health is the version that was released.
  const version = process.env.RELEASE_VERSION || process.env.APP_VERSION || pkg.version;

  const buildInfo = {
    name: pkg.name,
    version,
    buildNumber,
    commit,
    shortCommit: commit.slice(0, 8),
    builtAt: new Date().toISOString(),
    node: process.version,
    jobName: process.env.JOB_NAME || 'local',
  };

  const outDir = path.join(process.cwd(), 'src', 'generated');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'build-info.json'), JSON.stringify(buildInfo, null, 2));

  // Smoke-check the build: if the app cannot be constructed, there is no point
  // producing an artefact from it.
  process.env.NODE_ENV = process.env.NODE_ENV || 'development';
  const createApp = require('../src/app');
  const app = createApp();

  if (typeof app.listen !== 'function') {
    throw new Error('Build verification failed: createApp() did not return an Express app');
  }

  console.log('Build metadata:');
  console.log(JSON.stringify(buildInfo, null, 2));
  console.log('\nBuild verification passed: application module graph loads cleanly.');
}

main();
