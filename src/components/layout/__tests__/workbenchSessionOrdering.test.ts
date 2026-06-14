import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Project, Session } from '@/lib/api';
import {
  orderProjectSessionsForSidebar,
  shouldRefreshProjectSessionsOnFocus,
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
      runningSessionIds: new Set(['a', 'b']),
      runningStartOrder: new Map([
        ['a', 1],
        ['b', 2],
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
      runningSessionIds: new Set(['running']),
      runningStartOrder: new Map([['running', 1]]),
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

  test('WorkbenchSidebar does not poll expanded projects while sessions are streaming', () => {
    expect(sidebarSource).toContain('shouldRefreshProjectSessionsOnFocus');
    expect(sidebarSource).toContain('orderProjectSessionsForSidebar');
    expect(sidebarSource).not.toContain('window.setInterval');
    expect(sidebarSource).not.toContain('???????');
  });
});