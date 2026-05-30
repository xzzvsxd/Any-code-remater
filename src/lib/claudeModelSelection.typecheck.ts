import type { ClaudeStreamMessage } from '@/types/claude';
import { formatClaudeModelLabel, resolveClaudeContinuationModel } from './claudeModelSelection';

export {};

const expectEqual = (actual: unknown, expected: unknown, label: string) => {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${String(expected)}, got ${String(actual)}`);
  }
};

const initMessages: ClaudeStreamMessage[] = [
  { type: 'system', subtype: 'init', model: 'claude-opus-4-7-20260201' },
];

expectEqual(
  resolveClaudeContinuationModel({
    requestedModel: 'sonnet',
    messages: initMessages,
    lastSubmittedModel: 'sonnet',
  }),
  'claude-opus-4-7-20260201',
  'continuation prefers runtime init model over default sonnet'
);

expectEqual(
  resolveClaudeContinuationModel({
    requestedModel: 'sonnet',
    sessionModel: 'claude-sonnet-4-5-20250514',
    messages: [],
    lastSubmittedModel: 'opus',
  }),
  'claude-sonnet-4-5-20250514',
  'continuation falls back to saved session model'
);

expectEqual(formatClaudeModelLabel('claude-opus-4-7-20260201'), 'Claude Opus 4.7', 'full model label');
expectEqual(formatClaudeModelLabel('opus1m'), 'Claude Opus 4.7 1M', 'alias model label');
expectEqual(formatClaudeModelLabel('my-custom-model'), 'my-custom-model', 'custom model label');
