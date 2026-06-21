import type { Project, Session } from '@/lib/api';

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

export const normalizeWorkbenchPath = (path?: string) =>
  path ? path.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase() : '';

export const sessionBelongsToWorkbenchProject = (session: Session, project: Project): boolean =>
  session.project_id === project.id ||
  (!!session.project_path && normalizeWorkbenchPath(session.project_path) === normalizeWorkbenchPath(project.path));

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
