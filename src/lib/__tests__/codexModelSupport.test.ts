import { describe, expect, test } from 'vitest';
import {
  DEFAULT_CODEX_MODEL_ID,
  filterSupportedCodexModels,
  sanitizeCodexModelId,
} from '../codexModelSupport';

describe('codex model support', () => {
  test('uses GPT-5.6 Sol as the default Codex model', () => {
    expect(DEFAULT_CODEX_MODEL_ID).toBe('gpt-5.6-sol');
  });

  test('keeps all GPT-5.6 preview model ids selectable', () => {
    const models = [
      { id: 'gpt-5.6-sol' },
      { id: 'gpt-5.6-terra' },
      { id: 'gpt-5.6-luna' },
      { id: 'gpt-5.5-pro' },
    ];

    expect(filterSupportedCodexModels(models).map((model) => model.id)).toEqual([
      'gpt-5.6-sol',
      'gpt-5.6-terra',
      'gpt-5.6-luna',
    ]);
  });

  test('falls back unsupported GPT-5.5 Pro to GPT-5.6 Sol', () => {
    expect(sanitizeCodexModelId('gpt-5.5-pro')).toBe('gpt-5.6-sol');
  });
});
