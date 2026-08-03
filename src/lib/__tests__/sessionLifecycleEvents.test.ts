import { describe, expect, test, vi } from 'vitest';

import {
  notifyWorkbenchSessionPromoted,
  subscribeWorkbenchSessionPromoted,
} from '../sessionLifecycleEvents';

describe('workbench session lifecycle events', () => {
  test('publishes the real session identity when a draft tab is promoted', () => {
    const target = new EventTarget();
    const listener = vi.fn();
    const unsubscribe = subscribeWorkbenchSessionPromoted(listener, target);
    const session = {
      sessionId: 'session-real',
      projectId: 'project-1',
      projectPath: '/repo/app',
      engine: 'claude' as const,
    };

    notifyWorkbenchSessionPromoted(session, target);

    expect(listener).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenCalledWith(session);
    unsubscribe();
  });
});
