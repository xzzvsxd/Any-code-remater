import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Project, Session } from '@/lib/api';
import {
  filterPromotedDraftSessionsForSidebar,
  getWorkbenchSessionRunningKey,
  isWorkbenchSessionRunning,
  orderProjectSessionsForSidebar,
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

  test('WorkbenchSidebar does not poll expanded projects while sessions are streaming', () => {
    expect(sidebarSource).toContain('shouldRefreshProjectSessionsOnFocus');
    expect(sidebarSource).toContain('orderProjectSessionsForSidebar');
    expect(sidebarSource).toContain('isWorkbenchSessionRunning');
    expect(sidebarSource).not.toContain('runningSessionIds.has(session.id)');
    expect(sidebarSource).not.toContain('window.setInterval');
    expect(sidebarSource).not.toContain('???????');
  });
});
