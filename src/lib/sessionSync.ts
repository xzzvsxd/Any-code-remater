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

export type ClaudeSessionStateEvent = {
  session_id: string;
  status: 'started' | 'stopped';
  project_path?: string;
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

/**
 * 为单条 `claude-session-state` 事件选择可更新的 tab。
 *
 * 约束很严格：有 session_id 时只信精确匹配；没有精确匹配时，最多只允许匹配
 * “同项目、无真实 session.id、且已经处于 streaming 的唯一临时新会话 tab”。
 *
 * 不能用 project_path 去匹配任意已有 session tab。一个项目里有大量历史会话，
 * 新会话 started 事件若按路径随便命中第一条旧 session，就会把老会话误标运行中。
 */
export const selectTabForClaudeSessionStateEvent = (
  tabs: readonly MinimalTab[],
  event: ClaudeSessionStateEvent,
): MinimalTab | null => {
  const exact = tabs.find((tab) => tab.session?.id === event.session_id);
  if (exact) return exact;

  const eventPath = normalizePath(event.project_path);
  if (!eventPath) return null;

  const temporaryStreamingCandidates = tabs.filter((tab) => {
    if (tab.session?.id || tab.state !== 'streaming') return false;
    const tabPath = normalizePath(tab.projectPath || tab.session?.project_path);
    return !!tabPath && tabPath === eventPath;
  });

  return temporaryStreamingCandidates.length === 1 ? temporaryStreamingCandidates[0] : null;
};
