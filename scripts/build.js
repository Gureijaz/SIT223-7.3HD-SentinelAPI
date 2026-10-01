'use strict';

const fs = require('fs');
const path = require('path');

const pkg = require('../package.json');

function gitCommit() {
  if (process.env.GIT_COMMIT) return process.env.GIT_COMMIT;

  try {
    const gitDir = path.join(process.cwd(), '.git');
    const head = fs.readFileSync(path.join(gitDir, 'HEAD'), 'utf8').trim();
    if (!head.startsWith('ref: ')) return head;

    const ref = head.slice(5);
    const loose = path.join(gitDir, ref);
    if (fs.existsSync(loose)) return fs.readFileSync(loose, 'utf8').trim();

    const packed = fs.readFileSync(path.join(gitDir, 'packed-refs'), 'utf8');
    const line = packed.split(/\r?\n/).find((l) => l.endsWith(` ${ref}`));
    return line ? line.split(' ')[0] : 'unknown';
  } catch {
    return 'unknown';
  }
}

function main() {
  const buildNumber = process.env.BUILD_NUMBER || 'local';
  const commit = gitCommit();

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
