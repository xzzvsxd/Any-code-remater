import { describe, expect, test } from 'vitest';

import {
  DEFAULT_CLAUDE_AUTO_COMPACT_WINDOW,
  parseClaudeAutoCompactWindow,
  resolveClaudeAutoCompactConfig,
} from '../claudeAutoCompact';

describe('Claude auto-compact configuration', () => {
  test('defaults to the Any Code 256k official window', () => {
    expect(resolveClaudeAutoCompactConfig({}, 1_000_000)).toEqual({
      enabled: true,
      configuredWindow: DEFAULT_CLAUDE_AUTO_COMPACT_WINDOW,
      effectiveWindow: DEFAULT_CLAUDE_AUTO_COMPACT_WINDOW,
      source: 'default',
      isEnvironmentOverride: false,
    });
  });

  test('preserves explicit disablement and model-caps the saved window', () => {
    expect(resolveClaudeAutoCompactConfig({
      autoCompactEnabled: false,
      autoCompactWindow: 256_000,
    }, 200_000)).toMatchObject({
      enabled: false,
      configuredWindow: 256_000,
      effectiveWindow: 200_000,
      source: 'settings',
    });
  });

  test('uses a valid environment window before the saved setting', () => {
    expect(resolveClaudeAutoCompactConfig({
      autoCompactWindow: 300_000,
      env: { CLAUDE_CODE_AUTO_COMPACT_WINDOW: '256k' },
    }, 1_000_000)).toEqual({
      enabled: true,
      configuredWindow: 256_000,
      effectiveWindow: 256_000,
      source: 'environment',
      isEnvironmentOverride: true,
    });
  });

  test('falls through an invalid environment value to the saved setting', () => {
    expect(resolveClaudeAutoCompactConfig({
      autoCompactWindow: 300_000,
      env: { CLAUDE_CODE_AUTO_COMPACT_WINDOW: '20k' },
    }, 1_000_000)).toMatchObject({
      configuredWindow: 300_000,
      source: 'settings',
      isEnvironmentOverride: false,
    });
  });

  test('represents the official automatic environment mode without inventing a threshold', () => {
    expect(resolveClaudeAutoCompactConfig({
      autoCompactWindow: 300_000,
      env: { CLAUDE_CODE_AUTO_COMPACT_WINDOW: 'auto' },
    }, 1_000_000)).toEqual({
      enabled: true,
      configuredWindow: null,
      effectiveWindow: null,
      source: 'automatic',
      isEnvironmentOverride: true,
    });
  });

  test('recognizes the official disable environment', () => {
    expect(resolveClaudeAutoCompactConfig({
      autoCompactEnabled: true,
      env: { DISABLE_AUTO_COMPACT: '1' },
    }, 1_000_000).enabled).toBe(false);
  });

  test.each([
    ['256k', 256_000],
    ['0.5m', 500_000],
    ['200000', 200_000],
    ['256', 256_000],
    [256_000, 256_000],
    [' auto ', 'auto'],
    ['99k', null],
    ['1001k', null],
    ['invalid', null],
    [Number.NaN, null],
  ])('parses %p using Claude window semantics', (value, expected) => {
    expect(parseClaudeAutoCompactWindow(value)).toBe(expected);
  });
});
