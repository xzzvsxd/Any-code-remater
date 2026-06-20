import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const promptExecutionSource = readFileSync(
  resolve(process.cwd(), 'src/hooks/usePromptExecution.ts'),
  'utf8',
);

describe('prompt execution duplicate guard safety', () => {
  test('uses source-aware duplicate guards so repeated identical deltas from one channel are not dropped', () => {
    expect(promptExecutionSource).toContain('createCrossChannelDuplicateGuard');
    expect(promptExecutionSource).toContain("source: 'global' | 'session'");
    expect(promptExecutionSource).not.toContain('processedCodexMessages = new Set<string>()');
    expect(promptExecutionSource).not.toContain('processedGeminiMessages = new Set<string>()');
    expect(promptExecutionSource).not.toContain('processedClaudeMessages = new Set<string>()');
  });
});
