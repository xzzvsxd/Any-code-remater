import { describe, expect, test } from 'vitest';
import { createFallbackTranslationConfig } from '../translationConfigDefaults';

describe('translation fallback config', () => {
  test('does not enable external translation when saved config cannot be loaded', () => {
    const config = createFallbackTranslationConfig();

    expect(config.enabled).toBe(false);
    expect(config.api_key).toBe('');
  });
});
