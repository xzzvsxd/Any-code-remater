import type { Project, Session } from '@/lib/api';

export type RunningSessionStartOrder = ReadonlyMap<string, number>;

const normalizeWorkbenchPath = (path?: string) =>
  path ? path.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase() : '';

export const sessionBelongsToWorkbenchProject = (session: Session, project: Project): boolean =>
  session.project_id === project.id ||
  (!!session.project_path && normalizeWorkbenchPath(session.project_path) === normalizeWorkbenchPath(project.path));

interface OrderProjectSessionsForSidebarOptions {
  projectSessions: Session[];
  pinnedSessionIds: ReadonlySet<string>;
  runningSessionIds: ReadonlySet<string>;
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
  runningSessionIds,
  runningStartOrder,
}: OrderProjectSessionsForSidebarOptions): Session[] {
  if (runningSessionIds.size === 0) {
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

    if (runningSessionIds.has(session.id)) {
      running.push(session);
      return;
    }

    rest.push(session);
  });

  running.sort((a, b) => {
    const orderA = runningStartOrder.get(a.id) ?? Number.MAX_SAFE_INTEGER;
    const orderB = runningStartOrder.get(b.id) ?? Number.MAX_SAFE_INTEGER;
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
