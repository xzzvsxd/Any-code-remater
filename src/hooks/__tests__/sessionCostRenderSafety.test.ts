import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';

const source = readFileSync('src/hooks/useSessionCostCalculation.ts', 'utf8');

describe('session cost render safety', () => {
  test('reuses cached stats when appended streaming messages do not carry usage', () => {
    expect(source).toContain('findLatestUsageMessageInRange(messages, cache.lastMessageCount)');
    expect(source).toContain('latestUsageMessage');
    expect(source).toContain('return cache.stats');
  });

  test('cache is not limited to codex because Claude streaming also emits many non-usage messages', () => {
    expect(source).not.toContain("if (engine === 'codex') {\n      const cache = codexCacheRef.current;");
  });
});