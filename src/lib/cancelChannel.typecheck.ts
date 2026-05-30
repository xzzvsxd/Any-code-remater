import { resolveInitialCancelSessionId } from './cancelChannel';

export {};

const expectEqual = (actual: string | null, expected: string | null) => {
  if (actual !== expected) {
    throw new Error(`Expected ${expected}, got ${actual}`);
  }
};

const claudeExisting = resolveInitialCancelSessionId({
  engine: 'claude',
  effectiveSession: { id: 'claude-session-id', engine: 'claude' },
  claudeSessionId: null,
  extractedSessionInfo: null,
});
expectEqual(claudeExisting, 'claude-session-id');

const codexThreadId = resolveInitialCancelSessionId({
  engine: 'codex',
  effectiveSession: { id: 'rollout-2026-05-30', engine: 'codex' },
  claudeSessionId: null,
  extractedSessionInfo: null,
});
expectEqual(codexThreadId, null);

const codexRuntimeId = resolveInitialCancelSessionId({
  engine: 'codex',
  effectiveSession: { id: 'rollout-2026-05-30', engine: 'codex' },
  claudeSessionId: 'codex-runtime-id',
  extractedSessionInfo: null,
});
expectEqual(codexRuntimeId, 'codex-runtime-id');

const geminiHistoryId = resolveInitialCancelSessionId({
  engine: 'gemini',
  effectiveSession: { id: 'real-gemini-history-id', engine: 'gemini' },
  claudeSessionId: null,
  extractedSessionInfo: null,
});
expectEqual(geminiHistoryId, null);
