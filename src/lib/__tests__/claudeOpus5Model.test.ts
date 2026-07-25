import { describe, expect, it } from 'vitest';

import { formatClaudeModelLabel } from '../claudeModelSelection';
import { getPricingForModel, MODEL_PRICING } from '../pricing';
import {
  CLAUDE_PRICING,
  getContextWindowSize,
  getModelPricing,
  tokenCounter,
} from '../tokenCounter';

const expectedPricing = {
  input: 5,
  output: 25,
  cacheWrite: 6.25,
  cacheRead: 0.5,
};

describe('Claude Opus 5 support', () => {
  it('formats current and legacy Opus aliases correctly', () => {
    expect(formatClaudeModelLabel('opus')).toBe('Claude Opus 5');
    expect(formatClaudeModelLabel('claude-opus-5')).toBe('Claude Opus 5');
    expect(formatClaudeModelLabel('opus1m')).toBe('Claude Opus 4.8 1M');
  });

  it.each([
    'claude-opus-5',
    'opus',
    'opus5',
    'opus-5',
    'anthropic.claude-opus-5',
    'claude-opus-5@20260724',
  ])(
    'treats %s as native 1M',
    (model) => expect(getContextWindowSize(model, 'claude')).toBe(1_000_000),
  );

  it.each([
    'claude-opus-5',
    'opus',
    'opus5',
    'opus-5',
    'anthropic.claude-opus-5',
    'claude-opus-5@20260724',
  ])('uses Opus 5 pricing for %s', (model) => {
    expect(getPricingForModel(model, 'claude')).toEqual(expectedPricing);
  });

  it('keeps token-counter pricing aligned with frontend pricing', () => {
    expect(MODEL_PRICING).toHaveProperty('claude-opus-5', expectedPricing);
    expect(CLAUDE_PRICING).toHaveProperty('claude-opus-5', {
      input: 5,
      output: 25,
      cache_write: 6.25,
      cache_read: 0.5,
    });
    expect(getModelPricing('claude-opus-5')).toMatchObject({
      input: 5,
      output: 25,
      cache_write: 6.25,
      cache_read: 0.5,
    });
    expect(tokenCounter.normalizeModel('claude-opus-5')).toBe('claude-opus-5');
    expect(tokenCounter.normalizeModel('opus')).toBe('claude-opus-5');
  });

  it('keeps explicit Opus 4.8 and opus1m on their historical model identity', () => {
    expect(formatClaudeModelLabel('claude-opus-4-8')).toBe('Claude Opus 4.8');
    expect(getContextWindowSize('opus1m', 'claude')).toBe(1_000_000);
  });
});
