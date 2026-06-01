import { describe, expect, it } from 'vitest';
import { shouldInitializeResumedSession } from '@/lib/sessionInitialization';

describe('shouldInitializeResumedSession', () => {
  it('does not initialize inactive restored tabs', () => {
    expect(shouldInitializeResumedSession({
      isActive: false,
      sessionId: 'session-1',
      loadedSessionId: null,
      wasCreatedAsNewSession: false,
      extractedSessionId: null,
    })).toBe(false);
  });

  it('initializes the active restored tab once', () => {
    expect(shouldInitializeResumedSession({
      isActive: true,
      sessionId: 'session-1',
      loadedSessionId: null,
      wasCreatedAsNewSession: false,
      extractedSessionId: null,
    })).toBe(true);

    expect(shouldInitializeResumedSession({
      isActive: true,
      sessionId: 'session-1',
      loadedSessionId: 'session-1',
      wasCreatedAsNewSession: false,
      extractedSessionId: null,
    })).toBe(false);
  });

  it('does not reload a session created by the same new-session component instance', () => {
    expect(shouldInitializeResumedSession({
      isActive: true,
      sessionId: 'session-1',
      loadedSessionId: null,
      wasCreatedAsNewSession: true,
      extractedSessionId: 'session-1',
    })).toBe(false);
  });

  it('allows a genuinely different session to initialize after a new-session instance changes identity', () => {
    expect(shouldInitializeResumedSession({
      isActive: true,
      sessionId: 'session-2',
      loadedSessionId: null,
      wasCreatedAsNewSession: true,
      extractedSessionId: 'session-1',
    })).toBe(true);
  });
});
