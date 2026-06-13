type MinimalTab = {
  id: string;
  state?: string;
  session?: {
    id?: string;
    project_path?: string;
  };
  projectPath?: string;
};

type RunningClaudeSession = {
  process_type?: unknown;
  project_path?: string;
};

export type SessionSyncReason = 'initial' | 'periodic';

export type RunningSessionTabUpdate = {
  tabId: string;
  isStreaming: boolean;
  sessionId: string | null;
};

const normalizePath = (p?: string) =>
  p?.replace(/\\/g, '/').toLowerCase().replace(/\/+$/, '') || '';

const getClaudeSessionId = (session: RunningClaudeSession): string | null => {
  const processType = session.process_type as any;
  const sessionId = processType?.ClaudeSession?.session_id;
  return typeof sessionId === 'string' && sessionId.trim() ? sessionId : null;
};

export const shouldQueryRunningSessions = (
  tabs: readonly MinimalTab[],
  reason: SessionSyncReason,
): boolean => {
  if (reason === 'initial') {
    // 重启恢复时，tab 可能已经被持久化为 idle；仍必须查一次后端，
    // 否则永远发现不了仍存活的 Claude CLI 进程。
    return tabs.some((tab) => !!tab.session?.id || tab.state === 'streaming');
  }

  // 周期轮询保留低开销策略：只有当前 UI 认为有运行中 tab 时才对账，
  // 用于清理已结束但事件丢失的残留 streaming 状态。
  return tabs.some((tab) => tab.state === 'streaming');
};

export const collectRunningSessionUpdates = (
  tabs: readonly MinimalTab[],
  activeSessions: readonly RunningClaudeSession[],
): RunningSessionTabUpdate[] => {
  const runningSessionIds = new Set<string>();
  const runningProjectPaths = new Set<string>();

  for (const session of activeSessions) {
    const sessionId = getClaudeSessionId(session);
    if (sessionId) {
      runningSessionIds.add(sessionId);
    }

    const projectPath = session.project_path;
    if (projectPath) {
      runningProjectPaths.add(normalizePath(projectPath));
    }
  }

  const updates: RunningSessionTabUpdate[] = [];

  for (const tab of tabs) {
    if (tab.session?.id) {
      const isRunning = runningSessionIds.has(tab.session.id);
      if (isRunning && tab.state !== 'streaming') {
        updates.push({ tabId: tab.id, isStreaming: true, sessionId: tab.session.id });
      } else if (!isRunning && tab.state === 'streaming') {
        updates.push({ tabId: tab.id, isStreaming: false, sessionId: null });
      }
      continue;
    }

    if (tab.state === 'streaming') {
      const tabPath = normalizePath(tab.session?.project_path || tab.projectPath);
      if (tabPath && !runningProjectPaths.has(tabPath)) {
        updates.push({ tabId: tab.id, isStreaming: false, sessionId: null });
      }
    }
  }

  return updates;
};
