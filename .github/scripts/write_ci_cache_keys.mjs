#!/usr/bin/env node
/* global console, process */
import { createHash } from 'node:crypto';
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

function sha256(value) {
  return createHash('sha256').update(value).digest('hex').slice(0, 24);
}

function readText(path) {
  return readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
}

function stableJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function packageManifestDepsKey() {
  const manifest = JSON.parse(readText('package.json'));
  return stableJson({
    dependencies: manifest.dependencies ?? {},
    devDependencies: manifest.devDependencies ?? {},
    optionalDependencies: manifest.optionalDependencies ?? {},
    peerDependencies: manifest.peerDependencies ?? {},
    overrides: manifest.overrides ?? {},
    resolutions: manifest.resolutions ?? {},
    packageManager: manifest.packageManager ?? '',
    engines: manifest.engines ?? {},
  });
}

function normalizedPackageLock() {
  const lock = JSON.parse(readText('package-lock.json'));

  // The app version changes on every release. It does not change installed deps,
  // so do not let version-only release bumps miss the node_modules/Bun cache.
  if (Object.prototype.hasOwnProperty.call(lock, 'version')) {
    lock.version = '<app-version>';
  }
  if (lock.packages?.['']) {
    lock.packages[''].version = '<app-version>';
  }

  return stableJson(lock);
}

function normalizedCargoInputs() {
  const cargoToml = readText('src-tauri/Cargo.toml').replace(
    /(^version\s*=\s*)"[^"]+"/m,
    '$1"<app-version>"',
  );

  const cargoLock = readText('src-tauri/Cargo.lock').replace(
    /(\[\[package\]\]\nname = "any-code"\n)version = "[^"]+"/,
    '$1version = "<app-version>"',
  );

  return `${cargoToml}\n--- Cargo.lock ---\n${cargoLock}`;
}

function writeOutput(name, value) {
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`);
  }
  console.log(`${name}=${value}`);
}

mkdirSync('.ci-cache', { recursive: true });
const nodeDepsKey = sha256(`${packageManifestDepsKey()}\n${normalizedPackageLock()}`);
const rustDepsKey = sha256(normalizedCargoInputs());

writeFileSync(join('.ci-cache', 'node-deps.key'), `${nodeDepsKey}\n`, 'utf8');
writeFileSync(join('.ci-cache', 'rust-deps.key'), `${rustDepsKey}\n`, 'utf8');

writeOutput('node_deps_key', nodeDepsKey);
writeOutput('rust_deps_key', rustDepsKey);
