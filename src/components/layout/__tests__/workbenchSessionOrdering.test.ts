import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { DraftSession, Project, Session } from '@/lib/api';
import {
  buildWorkbenchProjectSessionIndex,
  createWorkbenchOpenTabSession,
  filterWorkbenchOpenTabsShadowedByDrafts,
  filterPromotedDraftSessionsForSidebar,
  getWorkbenchSessionRunningKey,
  isWorkbenchSessionRunning,
  orderProjectSessionsForSidebar,
  reconcileWorkbenchOpenTabSessions,
  resolveWorkbenchProjectSessions,
  shouldRefreshProjectSessionsOnFocus,
  withWorkbenchOpenTabMetadata,
  workbenchSessionKey,
  workbenchTabKey,
  workbenchTemporaryOpenTabSessionId,
} from '../workbenchSessionOrdering';

const sidebarSource = readFileSync(
  resolve(process.cwd(), 'src/components/layout/WorkbenchSidebar.tsx'),
  'utf8',
);

const project: Project = {
  id: 'p1',
  path: '/repo/app',
  sessions: [],
  created_at: 1,
};

const session = (id: string, last: string, extra: Partial<Session> = {}): Session => ({
  id,
  project_id: 'p1',
  project_path: '/repo/app',
  created_at: 1,
  last_message_timestamp: last,
  first_message: id,
  ...extra,
});

describe('workbench sidebar session ordering', () => {
  test('keeps running sessions in start order when assistant activity timestamps keep changing', () => {
    const olderStartedFirst = session('a', '2026-06-15T02:00:00.000Z');
    const startedSecond = session('b', '2026-06-15T02:10:00.000Z');
    const idle = session('c', '2026-06-15T02:20:00.000Z');

    // Disk refreshes may arrive sorted by newest assistant write first: b before a.
    const inputAfterAssistantRefresh = [idle, startedSecond, olderStartedFirst];

    const ordered = orderProjectSessionsForSidebar({
      projectSessions: inputAfterAssistantRefresh,
      pinnedSessionIds: new Set(),
      runningSessionKeys: new Set([workbenchSessionKey('a'), workbenchSessionKey('b')]),
      runningStartOrder: new Map([
        [workbenchSessionKey('a'), 1],
        [workbenchSessionKey('b'), 2],
      ]),
    });

    expect(ordered.map((s) => s.id)).toEqual(['a', 'b', 'c']);
  });

  test('keeps drafts and not-yet-persisted tab sessions ahead of stable running sessions', () => {
    const draft = session('draft', '2026-06-15T02:30:00.000Z');
    const running = session('running', '2026-06-15T02:00:00.000Z');
    const idle = session('idle', '2026-06-15T02:10:00.000Z');

    const ordered = orderProjectSessionsForSidebar({
      projectSessions: [idle, running, draft],
      pinnedSessionIds: new Set(['draft']),
      runningSessionKeys: new Set([workbenchSessionKey('running')]),
      runningStartOrder: new Map([[workbenchSessionKey('running'), 1]]),
    });

    expect(ordered.map((s) => s.id)).toEqual(['draft', 'running', 'idle']);
  });

  test('skips focus refresh for projects that already have running tabs', () => {
    const runningTab = session('running', '2026-06-15T02:00:00.000Z', {
      project_id: '',
      project_path: '/repo/app/',
    });

    expect(shouldRefreshProjectSessionsOnFocus(project, [runningTab])).toBe(false);
    expect(shouldRefreshProjectSessionsOnFocus(
      { ...project, id: 'other', path: '/repo/other' },
      [runningTab],
    )).toBe(true);
  });

  test('filters draft carriers as soon as their tab is consumed by a send', () => {
    expect(filterPromotedDraftSessionsForSidebar(
      [{ id: 'tab-consumed' }, { id: 'draft-still-idle' }],
      new Set(['tab-consumed']),
    ).map((d) => d.id)).toEqual(['draft-still-idle']);
  });

  test('isolates temporary running tab ids from persisted session ids', () => {
    const oldPersistedSession = session('tab-ghost-carrier', '2026-06-15T02:00:00.000Z');
    const temporaryRunningTab = withWorkbenchOpenTabMetadata(
      session(workbenchTemporaryOpenTabSessionId('tab-ghost-carrier'), '2026-06-15T02:30:00.000Z', {
        project_id: '',
        project_path: '/repo/app',
      }),
      'tab-ghost-carrier',
      true,
    );
    const runningKeys = new Set([workbenchTabKey('tab-ghost-carrier')]);

    expect(getWorkbenchSessionRunningKey(temporaryRunningTab)).toBe(workbenchTabKey('tab-ghost-carrier'));
    expect(getWorkbenchSessionRunningKey(oldPersistedSession)).toBe(workbenchSessionKey('tab-ghost-carrier'));
    expect(isWorkbenchSessionRunning(temporaryRunningTab, runningKeys)).toBe(true);
    expect(isWorkbenchSessionRunning(oldPersistedSession, runningKeys)).toBe(false);
  });

  test('keeps a promoted new session in its original running start slot', () => {
    const olderRunning = session('older-real', '2026-06-15T02:00:00.000Z');
    const promotedNewSession = session('new-real', '2026-06-15T02:30:00.000Z');
    const idle = session('idle', '2026-06-15T02:20:00.000Z');

    const ordered = orderProjectSessionsForSidebar({
      projectSessions: [idle, promotedNewSession, olderRunning],
      pinnedSessionIds: new Set(),
      runningSessionKeys: new Set([workbenchSessionKey('older-real'), workbenchSessionKey('new-real')]),
      runningStartOrder: new Map([
        [workbenchSessionKey('new-real'), 1],
        [workbenchSessionKey('older-real'), 2],
      ]),
    });

    expect(ordered.map((s) => s.id)).toEqual(['new-real', 'older-real', 'idle']);
  });

  test('pre-indexes open tabs and drafts by project to avoid per-project scans', () => {
    const otherProject: Project = {
      id: 'p2',
      path: '/repo/other',
      sessions: [],
      created_at: 2,
    };
    const openByPath = session('open-by-path', '2026-06-15T02:30:00.000Z', {
      project_id: '',
      project_path: '/repo/app/',
    });
    const openById = session('open-by-id', '2026-06-15T02:30:00.000Z', {
      project_id: 'p2',
      project_path: '/wrong/path',
    });
    const drafts: DraftSession[] = [
      {
        id: 'draft-by-path',
        project_id: '',
        project_path: '/repo/app',
        content: 'draft',
        created_at: 1,
        updated_at: 1,
        engine: 'claude',
      },
      {
        id: 'draft-by-id',
        project_id: 'p2',
        project_path: '/wrong/path',
        content: 'draft',
        created_at: 1,
        updated_at: 1,
        engine: 'codex',
      },
    ];

    const index = buildWorkbenchProjectSessionIndex({
      projects: [project, otherProject],
      openTabSessions: [openByPath, openById],
      draftSessions: drafts,
      runningSessionKeys: new Set([workbenchSessionKey('open-by-path')]),
    });

    expect(index.openTabSessionsByProjectId.get('p1')?.map((s) => s.id)).toEqual(['open-by-path']);
    expect(index.openTabSessionsByProjectId.get('p2')?.map((s) => s.id)).toEqual(['open-by-id']);
    expect(index.draftSessionsByProjectId.get('p1')?.map((d) => d.id)).toEqual(['draft-by-path']);
    expect(index.draftSessionsByProjectId.get('p2')?.map((d) => d.id)).toEqual(['draft-by-id']);
    expect(index.runningCountByProjectId.get('p1')).toBe(1);
    expect(index.runningCountByProjectId.get('p2') ?? 0).toBe(0);
  });

  test('shows a fresh idle tab as soon as its project path is selected', () => {
    const openSession = createWorkbenchOpenTabSession({
      id: 'tab-fresh',
      title: 'New conversation',
      type: 'new',
      projectPath: '/repo/app',
      state: 'idle',
      createdAt: 1_720_000_000_000,
      engine: 'claude',
    });

    expect(openSession).toMatchObject({
      id: workbenchTemporaryOpenTabSessionId('tab-fresh'),
      project_path: '/repo/app',
      first_message: 'New conversation',
      __workbenchOpenTabId: 'tab-fresh',
      __workbenchTemporaryOpenTab: true,
    });
  });

  test('does not invent a sidebar session before a fresh tab has a project', () => {
    expect(createWorkbenchOpenTabSession({
      id: 'tab-unscoped',
      title: 'New conversation',
      type: 'new',
      state: 'idle',
      createdAt: 1_720_000_000_000,
    })).toBeNull();
  });

  test('lets a saved draft row replace its idle temporary tab row', () => {
    const temporary = createWorkbenchOpenTabSession({
      id: 'tab-with-draft',
      title: 'New conversation',
      type: 'new',
      projectPath: '/repo/app',
      state: 'idle',
      createdAt: 1_720_000_000_000,
    });
    const persisted = withWorkbenchOpenTabMetadata(
      session('persisted', '2026-06-15T02:30:00.000Z'),
      'tab-persisted',
      false,
    );

    expect(filterWorkbenchOpenTabsShadowedByDrafts(
      [temporary!, persisted],
      [{ id: 'tab-with-draft' }],
    ).map((item) => item.id)).toEqual(['persisted']);
  });

  test('uses the live selected-project sessions instead of an older sidebar cache', () => {
    const staleCached = [session('old-cache', '2026-06-15T02:00:00.000Z')];
    const liveSelected = [session('fresh-session', '2026-06-15T02:30:00.000Z')];

    expect(resolveWorkbenchProjectSessions({
      project,
      selectedProject: project,
      selectedProjectSessions: liveSelected,
      cachedProjectSessions: staleCached,
    }).map((item) => item.id)).toEqual(['fresh-session']);
  });

  test('matches the selected project by normalized path when its hydrated id changed', () => {
    const liveSelected = [session('fresh-session', '2026-06-15T02:30:00.000Z')];

    expect(resolveWorkbenchProjectSessions({
      project,
      selectedProject: { ...project, id: 'virtual:/repo/app', path: '/REPO/app/' },
      selectedProjectSessions: liveSelected,
      cachedProjectSessions: [session('old-cache', '2026-06-15T02:00:00.000Z')],
    })).toBe(liveSelected);
  });

  test('keeps an active promoted session pinned while replacing its stale disk copy', () => {
    const staleDiskCopy = session('fresh-session', '2026-06-15T01:00:00.000Z', {
      first_message: '',
    });
    const activeOpenCopy = withWorkbenchOpenTabMetadata(
      session('fresh-session', '2026-06-15T02:30:00.000Z', {
        first_message: 'Brand new conversation',
      }),
      'tab-fresh',
      false,
    );
    const idleBackgroundCopy = withWorkbenchOpenTabMetadata(
      session('old-session', '2026-06-15T02:00:00.000Z'),
      'tab-old',
      false,
    );
    const diskOnly = session('disk-only', '2026-06-15T02:10:00.000Z');

    const reconciled = reconcileWorkbenchOpenTabSessions({
      diskSessions: [staleDiskCopy, idleBackgroundCopy, diskOnly],
      openTabSessions: [idleBackgroundCopy, activeOpenCopy],
      activeSessionId: 'fresh-session',
      runningSessionKeys: new Set(),
    });

    expect(reconciled.pinnedOpenTabSessions.map((item) => item.id)).toEqual(['fresh-session']);
    expect(reconciled.remainingDiskSessions.map((item) => item.id)).toEqual(['old-session', 'disk-only']);
  });

  test('WorkbenchSidebar does not poll expanded projects while sessions are streaming', () => {
    expect(sidebarSource).toContain('shouldRefreshProjectSessionsOnFocus');
    expect(sidebarSource).toContain('orderProjectSessionsForSidebar');
    expect(sidebarSource).toContain('isWorkbenchSessionRunning');
    expect(sidebarSource).toContain('buildWorkbenchProjectSessionIndex');
    expect(sidebarSource).not.toContain('openTabSessions.filter(\r\n          (s) => tabSessionBelongsTo');
    expect(sidebarSource).not.toContain('openTabSessions.filter(\n          (s) => tabSessionBelongsTo');
    expect(sidebarSource).not.toContain('runningSessionIds.has(session.id)');
    expect(sidebarSource).not.toContain('window.setInterval');
    expect(sidebarSource).not.toContain('???????');
  });
});
