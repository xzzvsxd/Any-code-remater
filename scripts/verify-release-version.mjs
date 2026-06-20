import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

function fail(message) {
  console.error(`verify-release-version: ${message}`);
  process.exit(1);
}

const rawRequestedVersion = process.argv[2]?.trim();

if (!rawRequestedVersion) {
  fail('missing release version argument');
}

const requestedVersion = rawRequestedVersion.replace(/^v/, '');

if (!/^\d+\.\d+\.\d+([-.][0-9A-Za-z.-]+)?$/.test(requestedVersion)) {
  fail(`invalid release version: ${rawRequestedVersion}`);
}

const consistency = spawnSync(
  process.execPath,
  ['scripts/check-version-consistency.mjs'],
  { stdio: 'inherit' },
);

if (consistency.status !== 0) {
  process.exit(consistency.status ?? 1);
}

let packageVersion;
try {
  packageVersion = JSON.parse(readFileSync('package.json', 'utf8')).version;
} catch (error) {
  fail(`unable to read package.json version: ${error.message}`);
}

if (packageVersion !== requestedVersion) {
  fail(`requested release version ${requestedVersion} does not match package.json version ${packageVersion}`);
}

console.log(`verify-release-version: OK (${requestedVersion})`);
