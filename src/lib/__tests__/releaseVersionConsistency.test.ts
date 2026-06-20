import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const repoRoot = process.cwd();

const readJson = (relativePath: string) => JSON.parse(
  readFileSync(resolve(repoRoot, relativePath), 'utf8'),
);

const readText = (relativePath: string) => readFileSync(resolve(repoRoot, relativePath), 'utf8');

describe('release version consistency checks', () => {
  test('npm validate includes a version consistency guard', () => {
    const packageJson = readJson('package.json');

    expect(packageJson.scripts['check:version-consistency']).toBe('node scripts/check-version-consistency.mjs');
    expect(packageJson.scripts['check:release-version-gates']).toBe('node scripts/check-release-version-gates.mjs');
    expect(packageJson.scripts.validate).toContain('npm run check:version-consistency');
    expect(packageJson.scripts.validate).toContain('npm run check:release-version-gates');
  });

  test('release metadata versions currently match across package, Tauri and Cargo files', () => {
    const packageJson = readJson('package.json');
    const packageLock = readJson('package-lock.json');
    const tauriConfig = readJson('src-tauri/tauri.conf.json');
    const cargoToml = readText('src-tauri/Cargo.toml');
    const cargoLock = readText('src-tauri/Cargo.lock');

    const expectedVersion = packageJson.version;

    expect(packageLock.version).toBe(expectedVersion);
    expect(packageLock.packages[''].version).toBe(expectedVersion);
    expect(tauriConfig.version).toBe(expectedVersion);
    expect(cargoToml).toMatch(new RegExp(`^version = "${expectedVersion.replace(/\./g, '\\.')}"$`, 'm'));
    expect(cargoLock).toMatch(new RegExp(`name = "any-code"\\r?\\nversion = "${expectedVersion.replace(/\./g, '\\.')}"`, 'm'));
  });

  test('release workflows reject tag/input versions that do not match source metadata', () => {
    const workflowPaths = [
      '.github/workflows/build.yml',
      '.github/workflows/release-linux.yml',
      '.github/workflows/release-macos.yml',
      '.github/workflows/release-windows.yml',
    ];

    const runtimeGateUsages = workflowPaths.reduce((count, workflowPath) => {
      const workflow = readText(workflowPath);
      return count + (workflow.match(/node scripts\/verify-release-version\.mjs/g) ?? []).length;
    }, 0);

    // build.yml has a shared verify job; linux/windows have one build+publish job;
    // macOS has both build and publish jobs, so a full release matrix needs at least 5 gates.
    expect(runtimeGateUsages).toBeGreaterThanOrEqual(5);

    const buildWorkflow = readText('.github/workflows/build.yml');
    expect(buildWorkflow).toContain('verify-release-version:');
    expect(buildWorkflow).toMatch(/build-windows:\s+name:[\s\S]*?needs:\s+\[resolve-release,\s+verify-release-version\]/);
  });
});
