import type { Session } from '@/lib/api';

export type ExecutionEngine = 'claude' | 'codex' | 'gemini';

interface ResolveInitialCancelSessionIdInput {
  engine: ExecutionEngine;
  effectiveSession?: Pick<Session, 'id' | 'engine'> | null;
  claudeSessionId?: string | null;
  extractedSessionInfo?: { sessionId?: string | null; engine?: ExecutionEngine } | null;
}

const cleanId = (value?: string | null) => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
};

/**
 * Returns a session id that is already safe to pass to the backend cancel API.
 *
 * Claude's cancel API is keyed by the real Claude session id, so resumed
 * Claude sessions can be cancel-ready immediately. Codex/Gemini cancel APIs are
 * keyed by per-run backend channel ids (for example `codex-...` /
 * `gemini-...`), not by persisted history/thread ids, so those engines must
 * wait for their backend init event unless such a backend id is already cached.
 */
export function resolveInitialCancelSessionId({
  engine,
  effectiveSession,
  claudeSessionId,
  extractedSessionInfo,
}: ResolveInitialCancelSessionIdInput): string | null {
  const runtimeId = cleanId(claudeSessionId);

  if (engine === 'claude') {
    return (
      runtimeId ||
      cleanId(effectiveSession?.id) ||
      cleanId(extractedSessionInfo?.sessionId) ||
      null
    );
  }

  if (runtimeId?.startsWith(`${engine}-`)) {
    return runtimeId;
  }

  const extractedId = cleanId(extractedSessionInfo?.sessionId);
  if (extractedId?.startsWith(`${engine}-`)) {
    return extractedId;
  }

  return null;
}
