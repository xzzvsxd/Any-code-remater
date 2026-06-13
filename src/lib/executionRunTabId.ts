/**
 * Resolve the tab id used for backend execution-event routing.
 *
 * A UI tab/window id is stable across main-window tabs and detached session
 * windows.  Using a random per-component id breaks targeted stream delivery:
 * the backend emits high-frequency output to `session-window-{tab_id}` when such
 * a window exists, while detached windows are labeled with the UI tab id.
 */
export function resolveExecutionRunTabId(
  stableTabId: string | null | undefined,
  generateFallback: () => string,
): string {
  const normalized = stableTabId?.trim();
  return normalized ? normalized : generateFallback();
}
