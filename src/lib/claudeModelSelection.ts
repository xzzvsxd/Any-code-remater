import type { ClaudeStreamMessage } from '@/types/claude';
import type { ModelType } from '@/components/FloatingPromptInput/types';
import { getCachedModelNames, parseModelDisplayName } from './modelNameParser';

type ClaudeModelInput = ModelType | string | null | undefined;

interface ResolveClaudeContinuationModelOptions {
  requestedModel?: ClaudeModelInput;
  sessionModel?: ClaudeModelInput;
  messages?: ClaudeStreamMessage[];
  lastSubmittedModel?: ClaudeModelInput;
  fallbackModel?: ClaudeModelInput;
}

const DEFAULT_BUILT_IN_LABELS: Record<string, string> = {
  default: 'Claude Default',
  best: 'Claude Best',
  sonnet: 'Claude Sonnet 4.6',
  opus: 'Claude Opus 4.7',
  haiku: 'Claude Haiku 4.5',
  opusplan: 'Claude Opus Plan',
};

const normalizeModel = (model: ClaudeModelInput): string | null => {
  if (typeof model !== 'string') return null;
  const trimmed = model.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const findRuntimeModelFromMessages = (messages: ClaudeStreamMessage[] = []): string | null => {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index] as ClaudeStreamMessage & {
      model?: unknown;
      message?: {
        model?: unknown;
      };
    };
    const topLevelModel = normalizeModel(message.model as ClaudeModelInput);
    if (topLevelModel) {
      return topLevelModel;
    }

    const nestedModel = normalizeModel(message.message?.model as ClaudeModelInput);
    if (nestedModel) {
      return nestedModel;
    }
  }

  return null;
};

/**
 * Resolve the model for automatic continuation prompts (plan approval and
 * AskUserQuestion answers). These prompts are not explicit user model choices,
 * so they must inherit the running/history session model instead of falling
 * back to the UI default.
 */
export function resolveClaudeContinuationModel({
  requestedModel,
  sessionModel,
  messages = [],
  lastSubmittedModel,
  fallbackModel = 'sonnet',
}: ResolveClaudeContinuationModelOptions): ModelType {
  return (
    findRuntimeModelFromMessages(messages) ||
    normalizeModel(sessionModel) ||
    normalizeModel(lastSubmittedModel) ||
    normalizeModel(requestedModel) ||
    normalizeModel(fallbackModel) ||
    'sonnet'
  ) as ModelType;
}

export function formatClaudeModelLabel(model: ClaudeModelInput): string {
  const normalized = normalizeModel(model);
  if (!normalized) {
    return 'Model';
  }

  const lower = normalized.toLowerCase();
  if (lower === 'default' || lower === 'best' || lower === 'sonnet' || lower === 'opus' || lower === 'haiku' || lower === 'opusplan') {
    const cached = getCachedModelNames();
    return cached[lower] || DEFAULT_BUILT_IN_LABELS[lower] || normalized;
  }

  if (lower === 'sonnet1m' || lower === 'opus1m') {
    const family = lower.startsWith('opus') ? 'opus' : 'sonnet';
    const cached = getCachedModelNames();
    return `${cached[family] || DEFAULT_BUILT_IN_LABELS[family]} 1M`;
  }

  const parsed = parseModelDisplayName(normalized);
  return parsed || normalized;
}
