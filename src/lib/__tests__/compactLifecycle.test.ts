import { describe, expect, test } from 'vitest';
import {
  getCompactSavings,
  normalizeCompactLifecycleMessage,
  normalizeLegacyCompactOutput,
} from '../compactLifecycle';

describe('Claude native compact lifecycle normalization', () => {
  test('normalizes the scheduled, preparing, and running lifecycle events', () => {
    expect(normalizeCompactLifecycleMessage({
      type: 'system',
      subtype: 'status',
      status: 'compacting',
    })).toMatchObject({ phase: 'scheduled' });

    expect(normalizeCompactLifecycleMessage({
      type: 'compact_progress',
      event: { type: 'hooks_start', hookType: 'pre_compact' },
    })).toMatchObject({ phase: 'preparing' });

    expect(normalizeCompactLifecycleMessage({
      type: 'compact_progress',
      event: { type: 'compact_start' },
    })).toMatchObject({ phase: 'running' });
  });

  test('keeps native failure details', () => {
    expect(normalizeCompactLifecycleMessage({
      type: 'system',
      subtype: 'status',
      metadata: {
        compactResult: 'failed',
        compactError: 'summary generation timed out',
      },
    })).toEqual({
      phase: 'failed',
      trigger: 'unknown',
      error: 'summary generation timed out',
    });
  });

  test('keeps persisted boundary metrics for completed timeline rows', () => {
    const event = normalizeCompactLifecycleMessage({
      type: 'system',
      subtype: 'compact_boundary',
      compactMetadata: {
        trigger: 'auto',
        preTokens: 165_132,
        postTokens: 42_000,
        durationMs: 1_840,
      },
    });

    expect(event).toEqual({
      phase: 'completed',
      trigger: 'auto',
      beforeTokens: 165_132,
      afterTokens: 42_000,
      durationMs: 1_840,
    });
    expect(getCompactSavings(event!)).toEqual({
      releasedTokens: 123_132,
      releasedPercentage: 75,
    });
  });

  test('ignores unrelated status messages', () => {
    expect(normalizeCompactLifecycleMessage({
      type: 'system',
      subtype: 'status',
      status: 'ready',
    })).toBeNull();
  });

  test('supports the old slash-command success text as a compatibility fallback', () => {
    expect(normalizeLegacyCompactOutput(
      'Compacted. Press ctrl+r to see full summary.',
    )).toEqual({ phase: 'completed', trigger: 'manual' });
    expect(normalizeLegacyCompactOutput('ordinary command output')).toBeNull();
  });
});
