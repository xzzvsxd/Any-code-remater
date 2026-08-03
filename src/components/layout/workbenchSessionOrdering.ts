import type { DraftSession, Project, Session } from '@/lib/api';

export type RunningSessionStartOrder = ReadonlyMap<string, number>;
export type WorkbenchRunningSessionKey = `session:${string}` | `tab:${string}`;
export type WorkbenchOpenTabSession = Session & {
  /**
   * 侧栏合成项对应的真实 tab id。
   *
   * 注意：未落盘新会话的 `Session.id` 仍可能是历史草稿/旧会话形态的字符串，
   * 不能拿它直接和落盘会话 id 放在同一个命名空间里判断 running。
   */
  __workbenchOpenTabId?: string;
  /** true 表示这是“尚未拿到真实 session.id”的临时 tab 行。 */
  __workbenchTemporaryOpenTab?: boolean;
};

export interface WorkbenchOpenTabCandidate {
  id: string;
  title: string;
  type: 'session' | 'new';
  projectPath?: string;
  session?: Session;
  engine?: 'claude' | 'codex' | 'gemini';
  state: 'idle' | 'streaming' | 'error';
  createdAt: number;
}

export const normalizeWorkbenchPath = (path?: string) =>
  path ? path.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase() : '';

export const sessionBelongsToWorkbenchProject = (session: Session, project: Project): boolean =>
  session.project_id === project.id ||
  (!!session.project_path && normalizeWorkbenchPath(session.project_path) === normalizeWorkbenchPath(project.path));

export const workbenchProjectsMatch = (
  project: Pick<Project, 'id' | 'path'>,
  candidate?: Pick<Project, 'id' | 'path'> | null,
): boolean => {
  if (!candidate) return false;
  return project.id === candidate.id
    || normalizeWorkbenchPath(project.path) === normalizeWorkbenchPath(candidate.path);
};

interface ResolveWorkbenchProjectSessionsOptions {
  project: Pick<Project, 'id' | 'path'>;
  selectedProject?: Pick<Project, 'id' | 'path'> | null;
  selectedProjectSessions: Session[];
  cachedProjectSessions?: Session[];
}

/**
 * The selected project's `sessions` array drives the main session list and is
 * therefore authoritative. `sessionsByProject` is only a background-project
 * cache and may finish an older request after the selected list has refreshed.
 */
export function resolveWorkbenchProjectSessions({
  project,
  selectedProject,
  selectedProjectSessions,
  cachedProjectSessions,
}: ResolveWorkbenchProjectSessionsOptions): Session[] {
  if (workbenchProjectsMatch(project, selectedProject)) {
    return selectedProjectSessions;
  }

  return cachedProjectSessions ?? [];
}

export const workbenchSessionKey = (sessionId: string): WorkbenchRunningSessionKey => `session:${sessionId}`;
export const workbenchTabKey = (tabId: string): WorkbenchRunningSessionKey => `tab:${tabId}`;
export const workbenchTemporaryOpenTabSessionId = (tabId: string) => `__workbench_tab__:${tabId}`;

export function withWorkbenchOpenTabMetadata(
  session: Session,
  openTabId: string,
  temporaryOpenTab: boolean,
): WorkbenchOpenTabSession {
  return {
    ...session,
    __workbenchOpenTabId: openTabId,
    __workbenchTemporaryOpenTab: temporaryOpenTab,
  };
}

/**
 * Projects are the sidebar's ownership boundary, so an unscoped empty tab has
 * nowhere to render. Once a path is selected, expose it immediately instead of
 * waiting for the first runtime event or session id.
 */
export function createWorkbenchOpenTabSession(
  tab: WorkbenchOpenTabCandidate,
): WorkbenchOpenTabSession | null {
  if (tab.session?.id) {
    return withWorkbenchOpenTabMetadata(
      tab.session.first_message ? tab.session : { ...tab.session, first_message: tab.title },
      tab.id,
      false,
    );
  }

  if (!tab.projectPath) return null;

  return withWorkbenchOpenTabMetadata(
    {
      id: workbenchTemporaryOpenTabSessionId(tab.id),
      project_id: '',
      project_path: tab.projectPath,
      created_at: Math.floor((tab.createdAt || Date.now()) / 1000),
      first_message: tab.title,
      engine: tab.engine || 'claude',
    },
    tab.id,
    true,
  );
}

export function filterWorkbenchOpenTabsShadowedByDrafts<T extends { id: string }>(
  openTabs: readonly WorkbenchOpenTabSession[],
  drafts: readonly T[],
): WorkbenchOpenTabSession[] {
  if (openTabs.length === 0 || drafts.length === 0) return [...openTabs];
  const draftCarrierIds = new Set(drafts.map((draft) => draft.id));
  return openTabs.filter((session) => (
    !isTemporaryWorkbenchOpenTabSession(session)
    || !draftCarrierIds.has(getWorkbenchOpenTabId(session)!)
  ));
}

export function getWorkbenchOpenTabId(session: Session): string | undefined {
  const value = (session as WorkbenchOpenTabSession).__workbenchOpenTabId;
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

export function isTemporaryWorkbenchOpenTabSession(session: Session): boolean {
  return (session as WorkbenchOpenTabSession).__workbenchTemporaryOpenTab === true && !!getWorkbenchOpenTabId(session);
}

/**
 * 侧栏 running 命中 key。
 *
 * 必须把“真实 session.id”和“临时 tab.id”分到不同命名空间：
 * - `session:<uuid>` 只能命中已落盘/已拿到 session.id 的真实会话；
 * - `tab:<tab-id>` 只能命中侧栏合成的临时未落盘 tab 行。
 *
 * 这样即使某个旧草稿/旧会话的 id 恰好等于新建 tab.id，也不会被误标为运行中。
 */
export function getWorkbenchSessionRunningKey(session: Session): WorkbenchRunningSessionKey {
  if (isTemporaryWorkbenchOpenTabSession(session)) {
    return workbenchTabKey(getWorkbenchOpenTabId(session)!);
  }

  return workbenchSessionKey(session.id);
}

export function isWorkbenchSessionRunning(
  session: Session,
  runningSessionKeys: ReadonlySet<string>,
): boolean {
  return runningSessionKeys.has(getWorkbenchSessionRunningKey(session));
}

interface ReconcileWorkbenchOpenTabSessionsOptions {
  diskSessions: Session[];
  openTabSessions: readonly Session[];
  activeSessionId?: string | null;
  runningSessionKeys: ReadonlySet<string>;
}

interface ReconciledWorkbenchOpenTabSessions {
  pinnedOpenTabSessions: Session[];
  remainingDiskSessions: Session[];
}

/**
 * Keep the in-memory representation for sessions that are new, active, or
 * running. A just-created JSONL can already appear in a disk scan with an empty
 * title/old activity timestamp; letting that stale copy shadow the open tab
 * sends the new session below the sidebar's render limit.
 *
 * Idle background tabs continue to use their disk row, so restored tab sets do
 * not flood the pinned section.
 */
export function reconcileWorkbenchOpenTabSessions({
  diskSessions,
  openTabSessions,
  activeSessionId,
  runningSessionKeys,
}: ReconcileWorkbenchOpenTabSessionsOptions): ReconciledWorkbenchOpenTabSessions {
  const diskIds = new Set(diskSessions.map((session) => session.id));
  const pinnedIds = new Set<string>();
  const pinnedOpenTabSessions: Session[] = [];

  openTabSessions.forEach((session) => {
    const shouldPin = !diskIds.has(session.id)
      || session.id === activeSessionId
      || isWorkbenchSessionRunning(session, runningSessionKeys);
    if (!shouldPin || pinnedIds.has(session.id)) return;

    pinnedIds.add(session.id);
    pinnedOpenTabSessions.push(session);
  });

  return {
    pinnedOpenTabSessions,
    remainingDiskSessions: pinnedIds.size === 0
      ? diskSessions
      : diskSessions.filter((session) => !pinnedIds.has(session.id)),
  };
}

/**
 * 草稿的 id 是创建它的新建 tab id。首条消息发送后，该 tab 会进入 streaming，随后被“升级”为真实 session。
 * 后端 draft-sessions.json 可能因为跨组件/跨窗口 save-delete 竞态暂时仍保留旧草稿。
 * 只要 carrier tab 已经开始发送或已有真实 session.id，这个 draft 就不再是可恢复草稿，
 * 侧栏必须过滤掉，否则点击红色“草稿”会命中同一个 tab.id 并跳回正在运行的真实会话，造成幽灵草稿项。
 */
export function filterPromotedDraftSessionsForSidebar<T extends { id: string }>(
  drafts: readonly T[],
  promotedDraftCarrierIds: ReadonlySet<string>,
): T[] {
  if (promotedDraftCarrierIds.size === 0 || drafts.length === 0) {
    return [...drafts];
  }

  return drafts.filter((draft) => !promotedDraftCarrierIds.has(draft.id));
}

interface OrderProjectSessionsForSidebarOptions {
  projectSessions: Session[];
  pinnedSessionIds: ReadonlySet<string>;
  runningSessionKeys: ReadonlySet<string>;
  runningStartOrder: RunningSessionStartOrder;
}

/**
 * 侧栏最近会话顺序策略：
 * - 草稿/未落盘 tab 仍置顶，保证刚创建或待恢复的项不会被 slice 截掉。
 * - 运行中会话只在进入 running 时获得一个稳定 start order；后续 assistant token
 *   写入导致 last_message_timestamp 变化时，不再跟着磁盘活跃时间反复换位。
 * - 非运行项保留输入顺序，由上层的磁盘/用户排序决定。
 */
export function orderProjectSessionsForSidebar({
  projectSessions,
  pinnedSessionIds,
  runningSessionKeys,
  runningStartOrder,
}: OrderProjectSessionsForSidebarOptions): Session[] {
  if (runningSessionKeys.size === 0) {
    return projectSessions;
  }

  const originalIndex = new Map(projectSessions.map((session, index) => [session.id, index]));
  const pinned: Session[] = [];
  const running: Session[] = [];
  const rest: Session[] = [];

  projectSessions.forEach((session) => {
    if (pinnedSessionIds.has(session.id)) {
      pinned.push(session);
      return;
    }

    if (isWorkbenchSessionRunning(session, runningSessionKeys)) {
      running.push(session);
      return;
    }

    rest.push(session);
  });

  running.sort((a, b) => {
    const orderA = runningStartOrder.get(getWorkbenchSessionRunningKey(a)) ?? Number.MAX_SAFE_INTEGER;
    const orderB = runningStartOrder.get(getWorkbenchSessionRunningKey(b)) ?? Number.MAX_SAFE_INTEGER;
    if (orderA !== orderB) {
      return orderA - orderB;
    }

    return (originalIndex.get(a.id) ?? 0) - (originalIndex.get(b.id) ?? 0);
  });

  return [...pinned, ...running, ...rest];
}

export function shouldRefreshProjectSessionsOnFocus(project: Project, runningSessions: Session[]): boolean {
  return !runningSessions.some((session) => sessionBelongsToWorkbenchProject(session, project));
}

export interface WorkbenchProjectSessionIndex {
  openTabSessionsByProjectId: Map<string, Session[]>;
  draftSessionsByProjectId: Map<string, DraftSession[]>;
  runningCountByProjectId: Map<string, number>;
}

interface BuildWorkbenchProjectSessionIndexOptions {
  projects: readonly Project[];
  openTabSessions: readonly Session[];
  draftSessions: readonly DraftSession[];
  runningSessionKeys: ReadonlySet<string>;
}

const pushMapValue = <T>(map: Map<string, T[]>, key: string, value: T) => {
  const existing = map.get(key);
  if (existing) {
    existing.push(value);
  } else {
    map.set(key, [value]);
  }
};

const incrementMapValue = (map: Map<string, number>, key: string) => {
  map.set(key, (map.get(key) ?? 0) + 1);
};

/**
 * 预先把“已打开 tab 会话 / 草稿 / 运行计数”归档到项目 id。
 *
 * 旧实现是在每个 project renderItem 里反复：
 * - openTabSessions.filter(...)
 * - draftSessions.filter(...)
 * - openTabSessions.filter(...running...)
 *
 * 大工作区下复杂度接近 O(projects × (openTabs + drafts))，Linux/WebKitGTK 在 streaming
 * 状态变化或展开多个项目时会出现明显主线程卡顿。这里改成一次线性建索引，单个项目行只做
 * Map.get(project.id)。
 */
export function buildWorkbenchProjectSessionIndex({
  projects,
  openTabSessions,
  draftSessions,
  runningSessionKeys,
}: BuildWorkbenchProjectSessionIndexOptions): WorkbenchProjectSessionIndex {
  const projectIds = new Set(projects.map((project) => project.id));
  const projectIdByPath = new Map(
    projects.map((project) => [normalizeWorkbenchPath(project.path), project.id]),
  );

  const resolveProjectId = (projectId?: string, projectPath?: string): string | undefined => {
    if (projectId && projectIds.has(projectId)) {
      return projectId;
    }

    const normalizedPath = normalizeWorkbenchPath(projectPath);
    return normalizedPath ? projectIdByPath.get(normalizedPath) : undefined;
  };

  const openTabSessionsByProjectId = new Map<string, Session[]>();
  const draftSessionsByProjectId = new Map<string, DraftSession[]>();
  const runningCountByProjectId = new Map<string, number>();

  openTabSessions.forEach((session) => {
    const projectId = resolveProjectId(session.project_id, session.project_path);
    if (!projectId) return;

    pushMapValue(openTabSessionsByProjectId, projectId, session);
    if (isWorkbenchSessionRunning(session, runningSessionKeys)) {
      incrementMapValue(runningCountByProjectId, projectId);
    }
  });

  draftSessions.forEach((draft) => {
    const projectId = resolveProjectId(draft.project_id, draft.project_path);
    if (!projectId) return;

    pushMapValue(draftSessionsByProjectId, projectId, draft);
  });

  return {
    openTabSessionsByProjectId,
    draftSessionsByProjectId,
    runningCountByProjectId,
  };
}
