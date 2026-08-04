import { describe, expect, test } from 'vitest';
import { resolveVirtualRowMeasuredHeight } from '../virtualRowMeasurement';

describe('resolveVirtualRowMeasuredHeight', () => {
  test('keeps a genuinely rendered row at its measured height', () => {
    expect(resolveVirtualRowMeasuredHeight({
      rawHeight: 184,
      cachedHeight: 220,
      fallbackHeight: 320,
      hasRenderedContent: true,
    })).toBe(184);
  });

  test('uses the cached or estimated height for a transient zero-layout read', () => {
    expect(resolveVirtualRowMeasuredHeight({
      rawHeight: 0,
      cachedHeight: 184,
      fallbackHeight: 320,
      hasRenderedContent: true,
    })).toBe(184);

    expect(resolveVirtualRowMeasuredHeight({
      rawHeight: 0,
      fallbackHeight: 320,
      hasRenderedContent: true,
    })).toBe(320);
  });

  test('does not turn a null-rendered technical row into a large ghost row', () => {
    expect(resolveVirtualRowMeasuredHeight({
      rawHeight: 0,
      cachedHeight: 220,
      fallbackHeight: 1_000,
      hasRenderedContent: false,
    })).toBe(1);
  });
});
