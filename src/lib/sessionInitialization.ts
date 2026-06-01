interface ShouldInitializeResumedSessionArgs {
  isActive: boolean;
  sessionId?: string | null;
  loadedSessionId?: string | null;
  wasCreatedAsNewSession: boolean;
  extractedSessionId?: string | null;
}

/**
 * Decide whether a ClaudeCodeSession instance should perform the expensive
 * resume initialization (history page load + active process check).
 *
 * Hidden restored tabs are still mounted to preserve React state, so this
 * guard keeps startup from loading every tab's history at once.
 */
export function shouldInitializeResumedSession({
  isActive,
  sessionId,
  loadedSessionId,
  wasCreatedAsNewSession,
  extractedSessionId,
}: ShouldInitializeResumedSessionArgs): boolean {
  if (!isActive) return false;
  if (!sessionId) return false;
  if (loadedSessionId === sessionId) return false;

  if (!wasCreatedAsNewSession) return true;

  // A tab that started as a new session owns its streamed messages already.
  // Reloading the just-created session would overwrite in-flight UI state.
  if (!extractedSessionId) return false;
  if (extractedSessionId === sessionId) return false;

  // Defensive fallback: if the component is ever pointed at a different
  // existing session, allow a normal resume load for that different identity.
  return true;
}
