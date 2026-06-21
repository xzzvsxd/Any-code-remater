import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';

const source = readFileSync('src/hooks/useContextWindowUsage.ts', 'utf8');

describe('context window usage render safety', () => {
  test('same-length streaming content updates do not rescan full history without usage signals', () => {
    expect(source).toContain('SAME_LENGTH_CONTEXT_TAIL_SCAN_COUNT');
    expect(source).toContain('messages.length === cache.lastMessageCount');
    expect(source).toContain('messages.length - SAME_LENGTH_CONTEXT_TAIL_SCAN_COUNT');
    expect(source).toContain('return cache.result');
  });
});
