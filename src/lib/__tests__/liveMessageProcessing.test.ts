import { describe, expect, test } from 'vitest';
import {
  prepareStreamMessageForAppend,
  processLiveMessageNonBlocking,
} from '../stream/liveMessageProcessing';
import type { ClaudeStreamMessage } from '@/types/claude';

describe('live message processing', () => {
  test('prepares stream messages without mutating the original message', () => {
    const original: ClaudeStreamMessage = {
      type: 'assistant',
      message: {
        content: [{ type: 'text', text: 'hello' }],
        usage: {
          input_tokens: 1,
          output_tokens: 2,
          cache_creation_tokens: 3,
          cache_read_tokens: 4,
        },
      },
    };

    const prepared = prepareStreamMessageForAppend(original, '2026-06-13T00:00:00.000Z');

    expect(prepared).not.toBe(original);
    expect(prepared.receivedAt).toBe('2026-06-13T00:00:00.000Z');
    expect(prepared.timestamp).toBe('2026-06-13T00:00:00.000Z');
    expect(original.receivedAt).toBeUndefined();
    expect(original.timestamp).toBeUndefined();
  });

  test('retypes slash command output before appending', () => {
    const prepared = prepareStreamMessageForAppend({
      type: 'user',
      message: {
        content: [{ type: 'text', text: '<local-command-stdout>done</local-command-stdout>' }],
      },
    }, '2026-06-13T00:00:00.000Z');

    expect(prepared.type).toBe('system');
    expect(prepared.subtype).toBe('command-output');
  });

  test('drops transient raw payload markers before appending to renderer state', () => {
    const original = {
      type: 'assistant',
      message: { content: [{ type: 'text', text: 'hello' }] },
      __rawPayload: '{"huge":"raw jsonl payload"}',
    } as ClaudeStreamMessage & { __rawPayload: string };

    const prepared = prepareStreamMessageForAppend(original, '2026-06-13T00:00:00.000Z');

    expect((prepared as any).__rawPayload).toBeUndefined();
  });

  test('appends immediately before waiting for live translation', () => {
    const appended: ClaudeStreamMessage[] = [];
    let translateStarted = false;
    let updateCalls = 0;

    processLiveMessageNonBlocking({
      message: {
        type: 'assistant',
        message: { content: [{ type: 'text', text: 'hello' }] },
      },
      isMounted: () => true,
      append: (message) => appended.push(message),
      updateMessages: () => {
        updateCalls += 1;
      },
      translateMessage: () => {
        translateStarted = true;
        return new Promise(() => undefined);
      },
      applyTranslation: (message) => message,
      now: () => '2026-06-13T00:00:00.000Z',
    });

    expect(appended).toHaveLength(1);
    expect(translateStarted).toBe(true);
    expect(updateCalls).toBe(0);
  });
});
