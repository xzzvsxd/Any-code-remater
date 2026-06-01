import { describe, expect, it } from 'vitest';
import type { ClaudeStreamMessage } from '@/types/claude';
import { isStreamMessageRenderEqual } from '../StreamMessageV2';

describe('isStreamMessageRenderEqual', () => {
  it('re-renders when a system message changes subtype', () => {
    const previous = {
      type: 'system',
      subtype: 'execution-complete',
      timestamp: '2026-06-01T12:00:00.000Z',
    } as ClaudeStreamMessage;
    const next = {
      type: 'system',
      subtype: 'init',
      timestamp: '2026-06-01T12:00:00.000Z',
      session_id: 'claude-session-1',
      model: 'claude-opus-4-7',
    } as ClaudeStreamMessage;

    expect(isStreamMessageRenderEqual(previous, next)).toBe(false);
  });

  it('re-renders when system init details arrive or change', () => {
    const previous = {
      type: 'system',
      subtype: 'init',
      timestamp: '2026-06-01T12:00:00.000Z',
      session_id: 'pending',
    } as ClaudeStreamMessage;
    const next = {
      type: 'system',
      subtype: 'init',
      timestamp: '2026-06-01T12:00:00.000Z',
      session_id: 'claude-session-1',
      model: 'claude-opus-4-7',
      cwd: 'D:\\demo',
      tools: ['Read', 'Edit'],
    } as ClaudeStreamMessage;

    expect(isStreamMessageRenderEqual(previous, next)).toBe(false);
  });

  it('re-renders when streamed tool input changes', () => {
    const previous = {
      type: 'assistant',
      message: {
        content: [
          {
            type: 'tool_use',
            id: 'tool-1',
            name: 'Bash',
            input: { command: 'npm test' },
          },
        ],
      },
    } as ClaudeStreamMessage;
    const next = {
      type: 'assistant',
      message: {
        content: [
          {
            type: 'tool_use',
            id: 'tool-1',
            name: 'Bash',
            input: { command: 'npm run build' },
          },
        ],
      },
    } as ClaudeStreamMessage;

    expect(isStreamMessageRenderEqual(previous, next)).toBe(false);
  });
});
