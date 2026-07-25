export type PromptScrollRetryAction =
  | 'center-anchor'
  | 'center-row'
  | 'wait'
  | 'scroll'
  | 'stop';

export interface PromptScrollRetryState {
  anchorFound: boolean;
  rowFound: boolean;
  targetVirtualized: boolean;
  attempt: number;
  maxAttempts: number;
}

/**
 * Chooses the next prompt-location action without performing DOM or scroll work.
 * Exact DOM evidence wins; otherwise another scroll write is justified only
 * while the target row is still outside the virtual window.
 */
export function getPromptScrollRetryAction(
  state: PromptScrollRetryState,
): PromptScrollRetryAction {
  if (state.anchorFound) return 'center-anchor';
  if (state.rowFound) return 'center-row';
  if (state.attempt >= state.maxAttempts) return 'stop';
  return state.targetVirtualized ? 'wait' : 'scroll';
}
