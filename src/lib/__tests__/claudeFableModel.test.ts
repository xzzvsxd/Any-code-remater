import { describe, expect, it } from 'vitest';

import { formatClaudeModelLabel } from '../claudeModelSelection';
import { getPricingForModel } from '../pricing';
import { getContextWindowSize, getModelPricing } from '../tokenCounter';
import { THINKING_MODES } from '../../components/FloatingPromptInput/constants';

describe('Claude Fable model support', () => {
  it('labels the Claude Code fable alias as Claude Fable 5', () => {
    expect(formatClaudeModelLabel('fable')).toBe('Claude Fable 5');
  });

  it('treats the fable alias as a 1M context Claude model', () => {
    expect(getContextWindowSize('fable', 'claude')).toBe(1_000_000);
  });

  it('uses current Fable 5 pricing for the fable alias', () => {
    expect(getPricingForModel('fable', 'claude')).toEqual({
      input: 10,
      output: 50,
      cacheWrite: 12.5,
      cacheRead: 1,
    });
  });

  it('uses the shared current rate for Opus 5 aliases and explicit Opus 4.8 IDs', () => {
    const expectedPricing = {
      input: 5,
      output: 25,
      cacheWrite: 6.25,
      cacheRead: 0.5,
    };

    expect(getPricingForModel('opus', 'claude')).toEqual(expectedPricing);
    expect(getPricingForModel('claude-opus-5', 'claude')).toEqual(expectedPricing);
    expect(getPricingForModel('claude-opus-4-8-20260601', 'claude')).toEqual(expectedPricing);
  });

  it('keeps token-counter Opus 5 pricing in sync with frontend pricing', () => {
    expect(getModelPricing('opus')).toMatchObject({
      input: 5,
      output: 25,
      cache_write: 6.25,
      cache_read: 0.5,
    });
  });

  it('exposes the latest xhigh effort level for Fable-capable Claude Code versions', () => {
    expect(THINKING_MODES.map((mode) => mode.effort).filter(Boolean)).toContain('xhigh');
  });
});
