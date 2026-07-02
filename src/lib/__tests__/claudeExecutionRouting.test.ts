import { describe, expect, test } from 'vitest';
import {
  isClaudeResultMessage,
  isPotentialClaudeGlobalControlLine,
  resolveClaudeExecutionMode,
  shouldAcceptClaudeGlobalMessage,
  shouldAttachClaudeSessionListeners,
} from '../claudeExecutionRouting';

describe('Claude execution routing', () => {
  test('resumes with an extracted session id even before effectiveSession is rebuilt', () => {
    expect(resolveClaudeExecutionMode({
      effectiveSessionId: null,
      extractedSessionId: 'claude-session-from-init',
      claudeSessionId: null,
      isFirstPrompt: true,
    })).toEqual({
      mode: 'resume',
      sessionId: 'claude-session-from-init',
    });
  });

  test('resumes with the live Claude session id for stale queued prompt callbacks', () => {
    expect(resolveClaudeExecutionMode({
      effectiveSessionId: null,
      extractedSessionId: null,
      claudeSessionId: 'claude-session-from-state',
      isFirstPrompt: true,
    })).toEqual({
      mode: 'resume',
      sessionId: 'claude-session-from-state',
    });
  });

  test('starts a new session only when no session id is known', () => {
    expect(resolveClaudeExecutionMode({
      effectiveSessionId: null,
      extractedSessionId: null,
      claudeSessionId: null,
      isFirstPrompt: false,
    })).toEqual({
      mode: 'execute',
      sessionId: null,
    });
  });

  test('accepts current-tab init messages even when Linux cwd is symlink-resolved differently', () => {
    expect(shouldAcceptClaudeGlobalMessage({
      currentTabId: 'tab-1',
      eventTabId: 'tab-1',
      hasAttachedSessionListeners: false,
      currentSessionId: null,
      message: {
        type: 'system',
        subtype: 'init',
        session_id: 'claude-session',
        cwd: '/mnt/work/project-real',
      },
    })).toBe(true);
  });

  test('accepts current-tab init when Claude reports a new session id after resume', () => {
    expect(shouldAcceptClaudeGlobalMessage({
      currentTabId: 'tab-1',
      eventTabId: 'tab-1',
      hasAttachedSessionListeners: false,
      currentSessionId: 'old-session',
      message: {
        type: 'system',
        subtype: 'init',
        session_id: 'new-session',
        cwd: '/home/me/work/project',
      },
    })).toBe(true);
  });

  test('rejects messages for a different tab before any cwd check', () => {
    expect(shouldAcceptClaudeGlobalMessage({
      currentTabId: 'tab-1',
      eventTabId: 'tab-2',
      hasAttachedSessionListeners: false,
      currentSessionId: null,
      message: {
        type: 'system',
        subtype: 'init',
        session_id: 'other-session',
        cwd: '/home/me/work/project',
      },
    })).toBe(false);
  });

  test('accepts current-tab result control messages after session listeners are attached', () => {
    expect(shouldAcceptClaudeGlobalMessage({
      currentTabId: 'tab-1',
      eventTabId: 'tab-1',
      hasAttachedSessionListeners: true,
      currentSessionId: 'claude-session',
      message: {
        type: 'result',
        session_id: 'claude-session',
      },
    })).toBe(true);
  });

  test('detects Claude result lines as global control lines for completion self-healing', () => {
    expect(isClaudeResultMessage({ type: 'result' })).toBe(true);
    expect(isClaudeResultMessage({ type: 'assistant' })).toBe(false);
    expect(isPotentialClaudeGlobalControlLine('{"type":"result","subtype":"success"}')).toBe(true);
    expect(isPotentialClaudeGlobalControlLine('{"type":"system","subtype":"init"}')).toBe(true);
    expect(isPotentialClaudeGlobalControlLine('{"type":"assistant","message":{}}')).toBe(false);
  });

  test('attaches session listeners for an existing resumed session even when the init sid matches currentSessionId', () => {
    expect(shouldAttachClaudeSessionListeners({
      currentSessionId: 'existing-session',
      incomingSessionId: 'existing-session',
      hasAttachedSessionListeners: false,
    })).toBe(true);
  });

  test('does not reattach session listeners for the same session after they are already attached', () => {
    expect(shouldAttachClaudeSessionListeners({
      currentSessionId: 'existing-session',
      incomingSessionId: 'existing-session',
      hasAttachedSessionListeners: true,
    })).toBe(false);
  });

  test('reattaches session listeners when Claude init reports a different session id', () => {
    expect(shouldAttachClaudeSessionListeners({
      currentSessionId: 'old-session',
      incomingSessionId: 'new-session',
      hasAttachedSessionListeners: true,
    })).toBe(true);
  });
});
