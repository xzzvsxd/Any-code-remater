import { describe, expect, test, vi } from 'vitest';

import { resolveExecutionRunTabId } from '../executionRunTabId';

describe('resolveExecutionRunTabId', () => {
  test('uses the stable UI tab id when a session tab/window provides one', () => {
    const generateFallback = vi.fn(() => 'generated-run-id');

    expect(resolveExecutionRunTabId('tab-123', generateFallback)).toBe('tab-123');
    expect(generateFallback).not.toHaveBeenCalled();
  });

  test('generates a fallback id only when no stable UI tab id exists', () => {
    const generateFallback = vi.fn(() => 'generated-run-id');

    expect(resolveExecutionRunTabId('   ', generateFallback)).toBe('generated-run-id');
    expect(generateFallback).toHaveBeenCalledTimes(1);
  });
});
