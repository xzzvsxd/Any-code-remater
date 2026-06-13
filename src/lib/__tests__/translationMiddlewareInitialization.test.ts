import { describe, expect, test, vi } from 'vitest';
import type { TranslationConfig } from '../api';

const mocks = vi.hoisted(() => ({
  getTranslationConfig: vi.fn(),
}));

vi.mock('../api', () => ({
  api: {
    getTranslationConfig: mocks.getTranslationConfig,
  },
}));

const config: TranslationConfig = {
  enabled: true,
  api_base_url: 'http://localhost',
  api_key: '',
  model: 'test-model',
  timeout_seconds: 1,
  cache_ttl_seconds: 1,
};

describe('TranslationMiddleware initialization', () => {
  test('coalesces concurrent initialization into one config load', async () => {
    const pendingResolvers: Array<(value: TranslationConfig) => void> = [];
    mocks.getTranslationConfig.mockImplementation(
      () => new Promise<TranslationConfig>((resolve) => pendingResolvers.push(resolve)),
    );

    const { TranslationMiddleware } = await import('../translationMiddleware');
    mocks.getTranslationConfig.mockClear();
    pendingResolvers.length = 0;

    const middleware = new TranslationMiddleware({
      autoInitialize: false,
      startBackgroundTasks: false,
    } as any);

    const first = middleware.isEnabled();
    const second = middleware.isEnabled();

    expect(mocks.getTranslationConfig).toHaveBeenCalledTimes(1);
    pendingResolvers.forEach((resolve) => resolve(config));

    await expect(first).resolves.toBe(true);
    await expect(second).resolves.toBe(true);
  });
});
