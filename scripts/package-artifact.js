'use strict';

/**
 * Packages the verified build into a versioned, immutable archive.
 *
 * The archive name carries version + build number + short commit, so the exact
 * bytes deployed to staging are the exact bytes promoted at the Release stage.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const pkg = require('../package.json');

const RUNTIME_PATHS = ['src', 'package.json', 'package-lock.json', 'ecosystem.config.js'];

function readBuildInfo() {
  const file = path.join(process.cwd(), 'src', 'generated', 'build-info.json');

  if (!fs.existsSync(file)) {
    throw new Error('src/generated/build-info.json missing - run `npm run build` first');
  }

  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function stage(stagingDir) {
  fs.rmSync(stagingDir, { recursive: true, force: true });
  fs.mkdirSync(stagingDir, { recursive: true });

  for (const entry of RUNTIME_PATHS) {
    const source = path.join(process.cwd(), entry);
    if (!fs.existsSync(source)) continue;
    fs.cpSync(source, path.join(stagingDir, entry), { recursive: true });
  }
}

function compress(stagingDir, archivePath) {
  // Compress-Archive ships with Windows PowerShell, so the agent needs no extra
  // archiving tool installed. The trailing wildcard matters: without it the
  // staging directory itself becomes a folder inside the zip.
  const contentsGlob = path.join(stagingDir, '*');

  execFileSync(
    'powershell',
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `Compress-Archive -Path '${contentsGlob}' -DestinationPath '${archivePath}' -Force`,
    ],
    { stdio: 'inherit' },
  );
}

function main() {
  const buildInfo = readBuildInfo();
  const distDir = path.join(process.cwd(), 'dist');
  const stagingDir = path.join(distDir, 'staging');

  const artefactName = `${pkg.name}-${buildInfo.version}-build.${buildInfo.buildNumber}-${buildInfo.shortCommit}.zip`;
  const archivePath = path.join(distDir, artefactName);

  fs.mkdirSync(distDir, { recursive: true });
  stage(stagingDir);
  compress(stagingDir, archivePath);
  fs.rmSync(stagingDir, { recursive: true, force: true });

  const { size } = fs.statSync(archivePath);

  fs.writeFileSync(
    path.join(distDir, 'artefact.json'),
    JSON.stringify({ ...buildInfo, artefact: artefactName, sizeBytes: size }, null, 2),
  );

  console.log(`Artefact: dist/${artefactName} (${(size / 1024).toFixed(1)} KiB)`);
}

main();
