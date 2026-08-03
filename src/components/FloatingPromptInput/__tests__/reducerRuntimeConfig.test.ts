import { describe, expect, test } from 'vitest';

import { initialState, inputReducer } from '../reducer';

describe('FloatingPromptInput runtime configuration updates', () => {
  test('patches a provider-selected model without resetting the active engine configuration', () => {
    const state = {
      ...initialState,
      executionEngineConfig: {
        ...initialState.executionEngineConfig,
        engine: 'codex' as const,
        codexMode: 'danger-full-access' as const,
        codexModel: 'gpt-5.4',
      },
    };

    const next = inputReducer(state, {
      type: 'PATCH_EXECUTION_ENGINE_CONFIG',
      payload: { codexModel: 'gpt-5.5-codex' },
    });

    expect(next.executionEngineConfig).toEqual({
      ...state.executionEngineConfig,
      codexModel: 'gpt-5.5-codex',
    });
  });
});
