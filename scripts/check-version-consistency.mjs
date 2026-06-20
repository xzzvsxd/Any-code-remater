import fs from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();

function fail(message) {
  console.error(`check-version-consistency: ${message}`);
  process.exit(1);
}

function readText(relativePath) {
  const filePath = path.join(repoRoot, relativePath);
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch (error) {
    fail(`missing file: ${relativePath} (${error.message})`);
  }
}

function readJson(relativePath) {
  try {
    return JSON.parse(readText(relativePath));
  } catch (error) {
    fail(`invalid JSON in ${relativePath}: ${error.message}`);
  }
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const packageJson = readJson('package.json');
const expectedVersion = packageJson.version;

if (!/^\d+\.\d+\.\d+([-.][0-9A-Za-z.-]+)?$/.test(expectedVersion)) {
  fail(`package.json version is invalid: ${expectedVersion}`);
}

const checks = [];

const packageLock = readJson('package-lock.json');
checks.push(['package-lock.json version', packageLock.version]);
checks.push(['package-lock.json packages[""].version', packageLock.packages?.['']?.version]);

const tauriConfig = readJson('src-tauri/tauri.conf.json');
checks.push(['src-tauri/tauri.conf.json version', tauriConfig.version]);

const escapedVersion = escapeRegExp(expectedVersion);
const cargoToml = readText('src-tauri/Cargo.toml');
if (!new RegExp(`^version = "${escapedVersion}"$`, 'm').test(cargoToml)) {
  checks.push(['src-tauri/Cargo.toml package.version', undefined]);
}

const cargoLock = readText('src-tauri/Cargo.lock');
if (!new RegExp(`name = "any-code"\\r?\\nversion = "${escapedVersion}"`, 'm').test(cargoLock)) {
  checks.push(['src-tauri/Cargo.lock any-code version', undefined]);
}

const mismatches = checks.filter(([, actual]) => actual !== expectedVersion);
if (mismatches.length > 0) {
  console.error(`check-version-consistency: expected ${expectedVersion}`);
  for (const [label, actual] of mismatches) {
    console.error(`- ${label}: ${actual ?? 'MISSING_OR_MISMATCHED'}`);
  }
  process.exit(1);
}

console.log(`check-version-consistency: OK (${expectedVersion})`);
