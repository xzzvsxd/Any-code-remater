import { describe, expect, test } from 'vitest';
import { initialState } from '@/components/FloatingPromptInput/reducer';
import { DEFAULT_CODEX_MODEL_ID } from '../codexModelSupport';
import { getContextWindowSize } from '../tokenCounter';
import { getPricingForModel } from '../pricing';

describe('GPT-5.6 Codex defaults', () => {
  test('new prompt input sessions default to GPT-5.6 Sol', () => {
    expect(initialState.executionEngineConfig.codexModel).toBe(DEFAULT_CODEX_MODEL_ID);
  });

  test.each([
    ['gpt-5.6-sol'],
    ['gpt-5.6-terra'],
    ['gpt-5.6-luna'],
  ])('maps %s to the Codex 1.05M context fallback', (model) => {
    expect(getContextWindowSize(model, 'codex')).toBe(1_050_000);
  });

  test('uses official GPT-5.6 Sol/Terra/Luna token pricing', () => {
    expect(getPricingForModel('gpt-5.6-sol', 'codex')).toMatchObject({
      input: 5.00,
      output: 30.00,
      cacheWrite: 6.25,
      cacheRead: 0.50,
    });
    expect(getPricingForModel('gpt-5.6-terra', 'codex')).toMatchObject({
      input: 2.50,
      output: 15.00,
      cacheWrite: 3.125,
      cacheRead: 0.25,
    });
    expect(getPricingForModel('gpt-5.6-luna', 'codex')).toMatchObject({
      input: 1.00,
      output: 6.00,
      cacheWrite: 1.25,
      cacheRead: 0.10,
    });
  });
});
