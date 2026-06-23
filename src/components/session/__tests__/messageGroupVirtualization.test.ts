import { describe, expect, test } from 'vitest';
import {
  getMessageGroupVirtualKey,
  safeEstimateMessageGroupHeight,
} from '../messageGroupVirtualization';
import type { MessageGroup } from '@/lib/subagentGrouping';
import type { ClaudeStreamMessage } from '@/types/claude';

const userMessage = (uuid: string, text: string): ClaudeStreamMessage => ({
  type: 'user',
  uuid,
  timestamp: '2026-06-23T00:00:00.000Z',
  message: {
    role: 'user',
    content: [{ type: 'text', text }],
  },
});

describe('message group virtualization identity and safety', () => {
  test('keeps row keys tied to message identity instead of shifting array index', () => {
    const firstIndex: MessageGroup = {
      type: 'normal',
      message: userMessage('same-message', 'hello'),
      index: 1,
    };
    const shiftedIndex: MessageGroup = {
      type: 'normal',
      message: userMessage('same-message', 'hello'),
      index: 2,
    };

    expect(getMessageGroupVirtualKey(firstIndex, 1)).toBe(
      getMessageGroupVirtualKey(shiftedIndex, 2),
    );
    expect(getMessageGroupVirtualKey(firstIndex, 1)).not.toContain('n-1');
  });

  test('uses optimistic UI event ids so submitted prompts do not collide while history catches up', () => {
    const promptA: MessageGroup = {
      type: 'normal',
      index: 3,
      message: {
        type: 'user',
        uiOnly: true,
        uiOptimisticPrompt: true,
        uiEventId: 'prompt-a',
        sentAt: '2026-06-23T00:00:01.000Z',
        message: {
          role: 'user',
          content: [{ type: 'text', text: 'same text' }],
        },
      } as ClaudeStreamMessage,
    };
    const promptB: MessageGroup = {
      ...promptA,
      index: 4,
      message: {
        ...(promptA.message as any),
        uiEventId: 'prompt-b',
        sentAt: '2026-06-23T00:00:02.000Z',
      } as ClaudeStreamMessage,
    };

    expect(getMessageGroupVirtualKey(promptA, 3)).toContain('prompt-a');
    expect(getMessageGroupVirtualKey(promptB, 4)).toContain('prompt-b');
    expect(getMessageGroupVirtualKey(promptA, 3)).not.toBe(
      getMessageGroupVirtualKey(promptB, 4),
    );
  });

  test('messages with the same timestamp still get distinct fallback keys when content differs', () => {
    const first: MessageGroup = {
      type: 'normal',
      index: 7,
      message: {
        type: 'assistant',
        timestamp: '2026-06-23T00:00:03.000Z',
        message: { role: 'assistant', content: [{ type: 'text', text: 'first answer' }] },
      } as ClaudeStreamMessage,
    };
    const second: MessageGroup = {
      type: 'normal',
      index: 8,
      message: {
        type: 'assistant',
        timestamp: '2026-06-23T00:00:03.000Z',
        message: { role: 'assistant', content: [{ type: 'text', text: 'different answer' }] },
      } as ClaudeStreamMessage,
    };

    expect(getMessageGroupVirtualKey(first, 7)).not.toBe(
      getMessageGroupVirtualKey(second, 8),
    );
  });

  test('aggregated technical rows include real message identities so cache is not reused for a different aggregate', () => {
    const first: MessageGroup = {
      type: 'aggregated',
      index: 10,
      messages: [
        { type: 'thinking', uuid: 'think-1', content: 'a' } as ClaudeStreamMessage,
        {
          type: 'assistant',
          uuid: 'tool-1',
          message: { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'Read', input: {} }] },
        } as ClaudeStreamMessage,
      ],
    };
    const second: MessageGroup = {
      ...first,
      index: 10,
      messages: [
        first.messages[0],
        {
          type: 'assistant',
          uuid: 'tool-2',
          message: { role: 'assistant', content: [{ type: 'tool_use', id: 't2', name: 'Bash', input: {} }] },
        } as ClaudeStreamMessage,
      ],
    };

    expect(getMessageGroupVirtualKey(first, 10)).not.toBe(
      getMessageGroupVirtualKey(second, 10),
    );
  });

  test('virtualizer helpers never throw on malformed group data before row error boundary can render', () => {
    const malformedSubagent = {
      type: 'subagent',
      group: undefined,
    } as unknown as MessageGroup;

    expect(() => getMessageGroupVirtualKey(malformedSubagent, 5)).not.toThrow();
    expect(() => safeEstimateMessageGroupHeight(malformedSubagent)).not.toThrow();
    expect(safeEstimateMessageGroupHeight(malformedSubagent)).toBeGreaterThan(0);
  });
});
