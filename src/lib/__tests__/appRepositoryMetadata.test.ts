import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';
import {
  PROJECT_RELEASES_URL,
  UPDATE_MANIFEST_URL,
  UPSTREAM_PROJECTS,
} from '../appMetadata';

const repoRoot = process.cwd();

const readText = (relativePath: string) =>
  readFileSync(resolve(repoRoot, relativePath), 'utf8');

describe('application repository metadata', () => {
  test('uses the maintained releases page for update and project navigation', () => {
    expect(PROJECT_RELEASES_URL).toBe(
      'https://github.com/xzzvsxd/Any-code-remater/releases',
    );
    expect(UPDATE_MANIFEST_URL).toBe(
      'https://github.com/xzzvsxd/Any-code-remater/releases/latest/download/latest.json',
    );

    const tauriConfig = JSON.parse(readText('src-tauri/tauri.conf.json'));
    expect(tauriConfig.plugins.updater.endpoints).toEqual([UPDATE_MANIFEST_URL]);
  });

  test('keeps explicit credit links for both upstream authors', () => {
    expect(UPSTREAM_PROJECTS).toEqual([
      {
        name: 'anyme123/Any-code',
        url: 'https://github.com/anyme123/Any-code',
      },
      {
        name: 'zm892729231/Any-code',
        url: 'https://github.com/zm892729231/Any-code',
      },
    ]);
  });

  test('About dialog consumes centralized project and upstream metadata', () => {
    const aboutDialog = readText('src/components/dialogs/AboutDialog.tsx');

    expect(aboutDialog).toContain('handleOpenExternal(PROJECT_RELEASES_URL)');
    expect(aboutDialog).toContain('UPSTREAM_PROJECTS.map');
    expect(aboutDialog).not.toContain(
      'const PROJECT_URL = "https://github.com/zm892729231/Any-code"',
    );
  });
});
