import { describe, expect, test } from 'vitest';
import { getPromptScrollRetryAction } from '../promptScrollRetryPolicy';

describe('getPromptScrollRetryAction', () => {
  test.each([
    {
      name: 'centers the exact anchor as soon as it exists',
      state: { anchorFound: true, rowFound: true, targetVirtualized: true, attempt: 12, maxAttempts: 12 },
      expected: 'center-anchor',
    },
    {
      name: 'uses the rendered row as a settled fallback',
      state: { anchorFound: false, rowFound: true, targetVirtualized: true, attempt: 1, maxAttempts: 12 },
      expected: 'center-row',
    },
    {
      name: 'waits without another scroll write while the target is virtualized',
      state: { anchorFound: false, rowFound: false, targetVirtualized: true, attempt: 1, maxAttempts: 12 },
      expected: 'wait',
    },
    {
      name: 'reissues scrolling only while the target remains outside the virtual window',
      state: { anchorFound: false, rowFound: false, targetVirtualized: false, attempt: 1, maxAttempts: 12 },
      expected: 'scroll',
    },
    {
      name: 'stops at the fixed attempt budget',
      state: { anchorFound: false, rowFound: false, targetVirtualized: false, attempt: 12, maxAttempts: 12 },
      expected: 'stop',
    },
  ] as const)('$name', ({ state, expected }) => {
    expect(getPromptScrollRetryAction(state)).toBe(expected);
  });
});
