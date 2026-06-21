export type PersistedWorkbenchTab = Record<string, any> & {
  id?: unknown;
  title?: unknown;
  type?: unknown;
  session?: unknown;
  state?: unknown;
  errorMessage?: unknown;
  hasUnsavedChanges?: unknown;
  hasChanges?: unknown;
};

/**
 * 归一化从 localStorage 恢复的 tab。
 *
 * `streaming` 是运行时瞬态，不是可持久化事实。应用崩溃/刷新/系统休眠后，
 * localStorage 里保留下来的 streaming 往往已经是脏状态，会让工作区把旧会话误标为运行中。
 * 恢复时统一降为 idle；真正仍在跑的进程由 useSessionSync 的 initial backend 对账重新点亮。
 */
export function normalizePersistedWorkbenchTab<T extends PersistedWorkbenchTab>(tab: T) {
  const restoredState = tab.state === 'error' ? 'error' : 'idle';

  return {
    ...tab,
    type: tab.type || (tab.session ? 'session' : 'new'),
    state: restoredState,
    errorMessage: restoredState === 'error' ? tab.errorMessage : undefined,
    hasUnsavedChanges: tab.hasUnsavedChanges ?? tab.hasChanges ?? false,
  };
}
