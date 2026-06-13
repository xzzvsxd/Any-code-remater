import { describe, expect, test } from 'vitest';
import {
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
