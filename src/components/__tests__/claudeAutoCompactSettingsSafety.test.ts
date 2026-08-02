import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';

const readSource = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('Claude official auto-compact settings wiring', () => {
  test('general settings edits the official enable and window fields', () => {
    const source = readSource('src/components/settings/GeneralSettings.tsx');

    expect(source).toContain('autoCompactEnabled');
    expect(source).toContain('autoCompactWindow');
    expect(source).toContain('MIN_CLAUDE_AUTO_COMPACT_WINDOW');
    expect(source).toContain('MAX_CLAUDE_AUTO_COMPACT_WINDOW');
    expect(source).toContain('CLAUDE_CODE_AUTO_COMPACT_WINDOW');
  });

  test('successful settings saves notify mounted sessions with the saved snapshot', () => {
    const source = readSource('src/components/Settings.tsx');
    const saveIndex = source.indexOf('await api.saveClaudeSettings(updatedSettings)');
    const eventIndex = source.lastIndexOf('CLAUDE_AUTO_COMPACT_SETTINGS_CHANGED_EVENT');

    expect(saveIndex).toBeGreaterThan(-1);
    expect(eventIndex).toBeGreaterThan(saveIndex);
    expect(source).toContain('detail: { settings: updatedSettings }');
  });
});
