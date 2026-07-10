export const DEFAULT_CODEX_MODEL_ID = 'gpt-5.6-sol';

const UNSUPPORTED_CODEX_MODEL_FALLBACKS: Record<string, string> = {
  'gpt-5.5-pro': DEFAULT_CODEX_MODEL_ID,
  'gpt-5.4-pro': 'gpt-5.4',
};

export function getCodexModelFallback(modelId: string | null | undefined): string | undefined {
  if (!modelId) return undefined;
  return UNSUPPORTED_CODEX_MODEL_FALLBACKS[modelId];
}

export function isCodexModelSupported(modelId: string | null | undefined): boolean {
  if (!modelId) return false;
  return !UNSUPPORTED_CODEX_MODEL_FALLBACKS[modelId];
}

export function sanitizeCodexModelId(modelId: string | null | undefined): string | undefined {
  if (!modelId) return undefined;
  return getCodexModelFallback(modelId) ?? modelId;
}

export function filterSupportedCodexModels<T extends { id: string }>(models: T[]): T[] {
  return models.filter((model) => isCodexModelSupported(model.id));
}
