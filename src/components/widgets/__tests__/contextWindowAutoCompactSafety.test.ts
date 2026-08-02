import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';

const source = readFileSync(
  resolve(process.cwd(), 'src/components/widgets/ContextWindowIndicator.tsx'),
  'utf8',
);
const controlBar = readFileSync(
  resolve(process.cwd(), 'src/components/FloatingPromptInput/ControlBar.tsx'),
  'utf8',
);
const promptInput = readFileSync(
  resolve(process.cwd(), 'src/components/FloatingPromptInput/index.tsx'),
  'utf8',
);

describe('context indicator auto-compact source', () => {
  test('does not guess a 22.5 percent buffer', () => {
    expect(source).not.toContain('AUTO_COMPACT_BUFFER_RATIO');
    expect(source).not.toContain('MIN_AUTO_COMPACT_BUFFER');
    expect(source).not.toContain('getAutoCompactBuffer');
  });

  test('receives the official settings through stable prompt controls', () => {
    expect(source).toContain('autoCompactSettings');
    expect(source).toContain('resolveClaudeAutoCompactConfig');
    expect(controlBar).toContain('autoCompactSettings');
    expect(promptInput).toContain('CLAUDE_AUTO_COMPACT_SETTINGS_CHANGED_EVENT');
    expect(promptInput).toContain('detail?.settings');
  });

  test('describes an official window instead of an exact private threshold', () => {
    expect(source).toContain('Auto-compact Window');
    expect(source).not.toContain('Auto-compact Buffer');
  });
});
