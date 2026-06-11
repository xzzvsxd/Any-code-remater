type NullableSessionId = string | null | undefined;

export interface ClaudeExecutionModeInput {
  effectiveSessionId?: NullableSessionId;
  extractedSessionId?: NullableSessionId;
  claudeSessionId?: NullableSessionId;
  /**
   * Kept as an explicit input because callers still track first-prompt state.
   * A known session id is authoritative: it must resume even if this boolean is
   * stale (for example queued callbacks created before system:init arrived).
   */
  isFirstPrompt: boolean;
}

export type ClaudeExecutionMode =
  | { mode: 'execute'; sessionId: null }
  | { mode: 'resume'; sessionId: string };

const normalizeSessionId = (sessionId: NullableSessionId): string | null => {
  const trimmed = sessionId?.trim();
  return trimmed ? trimmed : null;
};

export function resolveClaudeExecutionMode(input: ClaudeExecutionModeInput): ClaudeExecutionMode {
  const sessionId = normalizeSessionId(input.effectiveSessionId)
    || normalizeSessionId(input.extractedSessionId)
    || normalizeSessionId(input.claudeSessionId);

  if (sessionId) {
    return { mode: 'resume', sessionId };
  }

  return { mode: 'execute', sessionId: null };
}

export interface ClaudeGlobalMessageLike {
  type?: string;
  subtype?: string;
  session_id?: string;
  cwd?: string;
}

export interface ClaudeGlobalRoutingInput {
  currentTabId: string;
  eventTabId: string | null;
  hasAttachedSessionListeners: boolean;
  currentSessionId: string | null;
  message: ClaudeGlobalMessageLike;
}

export function shouldAcceptClaudeGlobalMessage(input: ClaudeGlobalRoutingInput): boolean {
  // The backend tags one-shot Claude events with the run tab id. This is the
  // authoritative isolation boundary. Do not also reject by cwd: on Linux, cwd
  // can be symlink-resolved differently from the path selected in the UI, which
  // drops the system:init line and prevents the tab from binding the session id.
  if (input.eventTabId !== input.currentTabId) {
    return false;
  }

  if (!input.hasAttachedSessionListeners) {
    return true;
  }

  const messageSessionId = normalizeSessionId(input.message.session_id);
  return input.message.type === 'system'
    && input.message.subtype === 'init'
    && Boolean(messageSessionId)
    && messageSessionId !== normalizeSessionId(input.currentSessionId);
}
