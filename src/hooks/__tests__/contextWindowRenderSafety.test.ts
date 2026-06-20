import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';

const source = readFileSync('src/hooks/useContextWindowUsage.ts', 'utf8');

describe('context window render safety', () => {
  test('reuses cached context usage when appended messages cannot change usage or model signals', () => {
    expect(source).toContain('findLatestContextUsageSignalInRange(messages, cache.lastMessageCount');
    expect(source).toContain('return cache.result');
  });

  test('does not allocate a filtered copy of the entire message list before the cache fast path', () => {
    const cacheFastPathIndex = source.indexOf('findLatestContextUsageSignalInRange(messages, cache.lastMessageCount');
    const filterIndex = source.indexOf('messages.filter');

    expect(cacheFastPathIndex).toBeGreaterThan(-1);
    expect(filterIndex === -1 || filterIndex > cacheFastPathIndex).toBe(true);
  });
});