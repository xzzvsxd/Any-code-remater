import { describe, expect, test } from 'vitest';
import {
  collectRunningSessionUpdates,
  selectTabForClaudeSessionStateEvent,
  shouldQueryRunningSessions,
} from '@/lib/sessionSync';

describe('session running-state sync', () => {
  test('initial sync queries backend even when restored tabs are idle', () => {
    const tabs = [
      {
        id: 'tab-1',
        state: 'idle',
        session: { id: 'session-1', project_path: '/work/project' },
        projectPath: '/work/project',
      },
    ];

    expect(shouldQueryRunningSessions(tabs, 'initial')).toBe(true);
  });

  test('periodic sync still skips backend when no tab can be reconciled', () => {
    const tabs = [
      {
        id: 'tab-1',
        state: 'idle',
        projectPath: '/work/project',
      },
    ];

    expect(shouldQueryRunningSessions(tabs, 'periodic')).toBe(false);
  });

  test('marks an idle restored tab streaming when backend reports the session is alive', () => {
    const tabs = [
      {
        id: 'tab-1',
        state: 'idle',
        session: { id: 'session-alive', project_path: '/work/project' },
        projectPath: '/work/project',
      },
    ];
    const runningSessions = [
      {
        process_type: { ClaudeSession: { session_id: 'session-alive' } },
        project_path: '/work/project',
      },
    ];

    expect(collectRunningSessionUpdates(tabs, runningSessions)).toEqual([
      { tabId: 'tab-1', isStreaming: true, sessionId: 'session-alive' },
    ]);
  });

  test('keeps clearing stale streaming tabs when backend has no matching run', () => {
    const tabs = [
      {
        id: 'tab-1',
        state: 'streaming',
        session: { id: 'session-dead', project_path: '/work/project' },
        projectPath: '/work/project',
      },
    ];

    expect(collectRunningSessionUpdates(tabs, [])).toEqual([
      { tabId: 'tab-1', isStreaming: false, sessionId: null },
    ]);
  });

  test('does not path-match a started event to an old persisted session in the same project', () => {
    const tabs = [
      {
        id: 'old-tab',
        state: 'idle',
        session: { id: 'old-session', project_path: '/work/project' },
        projectPath: '/work/project',
      },
      {
        id: 'new-tab',
        state: 'idle',
        projectPath: '/work/project',
      },
    ];

    expect(selectTabForClaudeSessionStateEvent(tabs, {
      session_id: 'new-session',
      status: 'started',
      project_path: '/work/project',
    })).toBeNull();
  });

  test('does not clear another real running session on same-project stopped fallback', () => {
    const tabs = [
      {
        id: 'old-tab',
        state: 'streaming',
        session: { id: 'old-session', project_path: '/work/project' },
        projectPath: '/work/project',
      },
    ];

    expect(selectTabForClaudeSessionStateEvent(tabs, {
      session_id: 'different-session',
      status: 'stopped',
      project_path: '/work/project',
    })).toBeNull();
  });

  test('allows stopped fallback only for a unique no-session temporary streaming tab', () => {
    const tabs = [
      {
        id: 'new-tab',
        state: 'streaming',
        projectPath: '/work/project',
      },
      {
        id: 'old-tab',
        state: 'idle',
        session: { id: 'old-session', project_path: '/work/project' },
        projectPath: '/work/project',
      },
    ];

    expect(selectTabForClaudeSessionStateEvent(tabs, {
      session_id: 'new-session',
      status: 'stopped',
      project_path: '/work/project',
    })?.id).toBe('new-tab');
  });
});
