import { describe, expect, it } from 'vitest';
import {
  hasExecutionTerminalAfter,
  isExecutionTerminalMessage,
  shouldSuppressProcessingIndicator,
} from '../executionTerminal';

describe('execution terminal state helpers', () => {
  const startedAt = Date.parse('2026-06-01T12:00:00.000Z');

  it('recognizes UI-only execution completion messages as terminal state', () => {
    expect(isExecutionTerminalMessage({
      type: 'system',
      subtype: 'execution-complete',
      uiOnly: true,
      timestamp: '2026-06-01T12:05:38.000Z',
    })).toBe(true);
  });

  it('treats a terminal message after the current run start as completed', () => {
    expect(hasExecutionTerminalAfter([
      { type: 'assistant', message: { content: [{ type: 'text', text: 'done' }] } },
      {
        type: 'system',
        subtype: 'execution-complete',
        uiOnly: true,
        timestamp: '2026-06-01T12:05:38.000Z',
      },
    ], startedAt)).toBe(true);
  });

  it('ignores terminal messages from previous runs', () => {
    expect(hasExecutionTerminalAfter([
      {
        type: 'system',
        subtype: 'execution-complete',
        uiOnly: true,
        timestamp: '2026-06-01T11:59:00.000Z',
      },
      { type: 'user', message: { content: [{ type: 'text', text: 'new prompt' }] } },
    ], startedAt)).toBe(false);
  });

  it('does not suppress a new run started seconds after the previous completion', () => {
    expect(hasExecutionTerminalAfter([
      {
        type: 'system',
        subtype: 'execution-complete',
        uiOnly: true,
        timestamp: '2026-06-01T11:59:59.000Z',
      },
      { type: 'user', message: { content: [{ type: 'text', text: 'new prompt' }] } },
    ], startedAt)).toBe(false);
  });

  it('suppresses the processing indicator when completion has already been rendered', () => {
    expect(shouldSuppressProcessingIndicator({
      isLoading: true,
      messages: [{
        type: 'system',
        subtype: 'execution-complete',
        uiOnly: true,
        timestamp: '2026-06-01T12:05:38.000Z',
      }],
      executionStartedAt: startedAt,
    })).toBe(true);
  });

  it('does not suppress a freshly-started run before its start timestamp is initialized', () => {
    expect(shouldSuppressProcessingIndicator({
      isLoading: true,
      messages: [{
        type: 'system',
        subtype: 'execution-complete',
        uiOnly: true,
        timestamp: '2026-06-01T11:59:00.000Z',
      }],
      executionStartedAt: null,
    })).toBe(false);
  });
});
