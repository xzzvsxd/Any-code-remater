import { describe, expect, test } from 'vitest';

import { createCrossChannelDuplicateGuard } from '../stream/crossChannelDuplicateGuard';

describe('createCrossChannelDuplicateGuard', () => {
  test('drops only cross-channel duplicates for the same payload key', () => {
    const guard = createCrossChannelDuplicateGuard<'global' | 'session'>();

    expect(guard.shouldProcess('same-delta', 'global')).toBe(true);
    expect(guard.shouldProcess('same-delta', 'session')).toBe(false);
  });

  test('allows repeated identical payloads from the same channel', () => {
    const guard = createCrossChannelDuplicateGuard<'global' | 'session'>();

    expect(guard.shouldProcess('repeated-text-delta', 'session')).toBe(true);
    expect(guard.shouldProcess('repeated-text-delta', 'session')).toBe(true);
    expect(guard.shouldProcess('repeated-text-delta', 'session')).toBe(true);
  });

  test('bounds remembered keys so long runs do not grow memory forever', () => {
    const guard = createCrossChannelDuplicateGuard<'global' | 'session'>({ maxEntries: 2 });

    expect(guard.shouldProcess('old', 'global')).toBe(true);
    expect(guard.shouldProcess('middle', 'global')).toBe(true);
    expect(guard.shouldProcess('new', 'global')).toBe(true);

    expect(guard.shouldProcess('old', 'session')).toBe(true);
    expect(guard.size).toBeLessThanOrEqual(2);
  });
});
