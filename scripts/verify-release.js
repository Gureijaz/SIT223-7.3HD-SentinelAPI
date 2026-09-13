'use strict';

/**
 * Release verification.
 *
 * A deploy command exiting zero only proves a process was asked to start. This
 * asks the production instance what it is actually running and fails the
 * Release stage unless the version and build number match what Jenkins just
 * promoted — the check that catches a reload that silently kept serving the
 * previous revision.
 *
 *   node scripts/verify-release.js --url http://localhost:3000 --version 1.0.42 --build 42
 */

const args = Object.fromEntries(
  process.argv.slice(2).reduce((pairs, arg, i, all) => {
    if (arg.startsWith('--')) pairs.push([arg.slice(2), all[i + 1]]);
    return pairs;
  }, []),
);

const BASE_URL = (args.url || 'http://localhost:3000').replace(/\/$/, '');
const EXPECTED_VERSION = args.version;
const EXPECTED_BUILD = args.build;
const ATTEMPTS = Number(args.attempts || 20);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function health() {
  const response = await fetch(`${BASE_URL}/health`);
  if (!response.ok) throw new Error(`HTTP ${response.status} from /health`);
  return response.json();
}

async function main() {
  console.log(`Verifying the release live at ${BASE_URL}`);
  console.log(`  expecting version=${EXPECTED_VERSION} build=${EXPECTED_BUILD}\n`);

  let last = null;

  for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
    try {
      last = await health();

      const versionOk = !EXPECTED_VERSION || last.version === EXPECTED_VERSION;
      const buildOk = !EXPECTED_BUILD || String(last.build) === String(EXPECTED_BUILD);

      if (versionOk && buildOk) {
        console.log(`Production is serving version ${last.version}, build ${last.build}, commit ${last.commit}.`);
        console.log(`Uptime since reload: ${last.uptimeSeconds}s`);
        console.log('\nRELEASE VERIFIED.');
        return;
      }

      console.log(`  attempt ${attempt}: serving version=${last.version} build=${last.build} — waiting for the reload to complete`);
    } catch (err) {
      console.log(`  attempt ${attempt}: ${err.message}`);
    }

    await sleep(2000);
  }

  console.error(
    `\nRELEASE VERIFICATION FAILED: after ${ATTEMPTS} attempts production reports ` +
      `${last ? `version=${last.version} build=${last.build}` : 'no healthy response'}, ` +
      `expected version=${EXPECTED_VERSION} build=${EXPECTED_BUILD}.`,
  );
  process.exitCode = 1;
}

main().catch((err) => {
  console.error(`RELEASE VERIFICATION ERROR: ${err.message}`);
  process.exitCode = 1;
});
