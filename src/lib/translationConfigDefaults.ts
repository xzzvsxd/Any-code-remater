import type { TranslationConfig } from './api';

export function createFallbackTranslationConfig(): TranslationConfig {
  return {
    enabled: false,
    api_base_url: "https://api.siliconflow.cn/v1",
    api_key: "",
    model: "tencent/Hunyuan-MT-7B",
    timeout_seconds: 30,
    cache_ttl_seconds: 3600,
  };
}
