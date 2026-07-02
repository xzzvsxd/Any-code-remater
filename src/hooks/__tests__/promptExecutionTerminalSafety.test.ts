import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const promptExecutionSource = readFileSync(
  resolve(process.cwd(), 'src/hooks/usePromptExecution.ts'),
  'utf8',
);

describe('prompt execution terminal event safety', () => {
  test('guards completion and error handlers so duplicate terminal events cannot advance the queued prompt twice', () => {
    expect(promptExecutionSource).toContain('createTerminalEventGate');
    expect(promptExecutionSource).toContain('const terminalEventGate = createTerminalEventGate()');

    const terminalGuardUsages = promptExecutionSource.match(/terminalEventGate\.tryStart\(/g) ?? [];
    expect(terminalGuardUsages.length).toBeGreaterThanOrEqual(6);
  });

  test('self-heals Claude completion from result stream messages, not only claude-complete events', () => {
    expect(promptExecutionSource).toContain('isClaudeResultMessage');
    expect(promptExecutionSource).toContain('isPotentialClaudeGlobalControlLine');
    expect(promptExecutionSource).toMatch(/isClaudeResultMessage\(message\)[\s\S]{0,160}processComplete\(\)/);
  });
});
