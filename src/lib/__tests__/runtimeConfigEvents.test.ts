import { describe, expect, test, vi } from 'vitest';

import {
  notifyRuntimeConfigChanged,
  subscribeRuntimeConfigChanged,
} from '../runtimeConfigEvents';

describe('runtime configuration events', () => {
  test('notifies persistent workspaces with the changed engine and settings snapshot', () => {
    const target = new EventTarget();
    const listener = vi.fn();
    const unsubscribe = subscribeRuntimeConfigChanged(listener, target);
    const settings = { env: { ANTHROPIC_MODEL: 'claude-opus-5' } };

    notifyRuntimeConfigChanged({ engine: 'claude', settings, model: 'claude-opus-5' }, target);

    expect(listener).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenCalledWith({ engine: 'claude', settings, model: 'claude-opus-5' });
    unsubscribe();
  });

  test('unsubscribes without leaking future configuration changes', () => {
    const target = new EventTarget();
    const listener = vi.fn();
    const unsubscribe = subscribeRuntimeConfigChanged(listener, target);

    unsubscribe();
    notifyRuntimeConfigChanged({ engine: 'codex' }, target);

    expect(listener).not.toHaveBeenCalled();
  });
});
