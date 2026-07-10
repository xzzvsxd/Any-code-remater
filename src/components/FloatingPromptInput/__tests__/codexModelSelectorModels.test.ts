import { describe, expect, test } from 'vitest';
import { DEFAULT_CODEX_MODEL_ID } from '@/lib/codexModelSupport';
import { getCodexModels } from '../CodexModelSelector';

describe('CodexModelSelector default model list', () => {
  test('lists GPT-5.6 Sol/Terra/Luna at the top with Sol as default', () => {
    const models = getCodexModels();

    expect(models.slice(0, 3).map((model) => model.id)).toEqual([
      'gpt-5.6-sol',
      'gpt-5.6-terra',
      'gpt-5.6-luna',
    ]);
    expect(models[0]).toMatchObject({
      id: DEFAULT_CODEX_MODEL_ID,
      isDefault: true,
    });
  });
});
