import { describe, expect, test } from 'vitest';
import {
  collectRunningSessionUpdates,
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
});
