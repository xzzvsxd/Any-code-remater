import { describe, expect, test } from 'vitest';
import {
  getMessageGroupMeasurementCacheKey,
  getMessageGroupRenderRevision,
  getMessageGroupVirtualKey,
  getMessageGroupsRenderSignature,
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

  test('separates stable virtual identity from render-revision measurement cache identity', () => {
    const initial: MessageGroup = {
      type: 'normal',
      message: userMessage('same-message', 'short'),
      index: 1,
    };
    const expanded: MessageGroup = {
      type: 'normal',
      message: userMessage('same-message', 'short\n'.repeat(120)),
      index: 1,
    };

    expect(getMessageGroupVirtualKey(initial, 1)).toBe(
      getMessageGroupVirtualKey(expanded, 1),
    );
    expect(getMessageGroupRenderRevision(initial, 1)).not.toBe(
      getMessageGroupRenderRevision(expanded, 1),
    );
    expect(getMessageGroupMeasurementCacheKey(initial, 1)).not.toBe(
      getMessageGroupMeasurementCacheKey(expanded, 1),
    );
    expect(getMessageGroupMeasurementCacheKey(initial, 1)).toContain(
      getMessageGroupVirtualKey(initial, 1),
    );
  });

  test('render signature changes when an offscreen row keeps identity but changes height-relevant content', () => {
    const initial: MessageGroup = {
      type: 'normal',
      message: userMessage('same-message', 'short'),
      index: 1,
    };
    const expanded: MessageGroup = {
      type: 'normal',
      message: userMessage('same-message', 'short\n'.repeat(120)),
      index: 1,
    };

    expect(getMessageGroupsRenderSignature([initial])).not.toBe(
      getMessageGroupsRenderSignature([expanded]),
    );
  });

  test('render revision changes when equal-length content has different line layout', () => {
    const singleLine = 'a'.repeat(120);
    const manyLines = Array.from({ length: 41 }, () => 'ab').join('\n').slice(0, 120);
    expect(singleLine.length).toBe(manyLines.length);

    const initial: MessageGroup = {
      type: 'normal',
      message: userMessage('same-message', singleLine),
      index: 1,
    };
    const reflowed: MessageGroup = {
      type: 'normal',
      message: userMessage('same-message', manyLines),
      index: 1,
    };

    expect(getMessageGroupRenderRevision(initial, 1)).not.toBe(
      getMessageGroupRenderRevision(reflowed, 1),
    );
    expect(getMessageGroupMeasurementCacheKey(initial, 1)).not.toBe(
      getMessageGroupMeasurementCacheKey(reflowed, 1),
    );
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

  test('messages with identical timestamp and identical content still include row position to avoid virtual DOM reuse', () => {
    const first: MessageGroup = {
      type: 'normal',
      index: 2,
      message: {
        type: 'assistant',
        timestamp: '2026-06-23T00:00:03.000Z',
        message: { role: 'assistant', content: [{ type: 'text', text: 'same repeated answer' }] },
      } as ClaudeStreamMessage,
    };
    const second: MessageGroup = {
      type: 'normal',
      index: 9,
      message: {
        type: 'assistant',
        timestamp: '2026-06-23T00:00:03.000Z',
        message: { role: 'assistant', content: [{ type: 'text', text: 'same repeated answer' }] },
      } as ClaudeStreamMessage,
    };

    expect(getMessageGroupVirtualKey(first, 2)).not.toBe(
      getMessageGroupVirtualKey(second, 9),
    );
  });

  test('aggregated technical rows separate stable identity from changing render content', () => {
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

    expect(getMessageGroupVirtualKey(first, 10)).toBe(
      getMessageGroupVirtualKey(second, 10),
    );
    expect(getMessageGroupRenderRevision(first, 10)).not.toBe(
      getMessageGroupRenderRevision(second, 10),
    );
    expect(getMessageGroupMeasurementCacheKey(first, 10)).not.toBe(
      getMessageGroupMeasurementCacheKey(second, 10),
    );
  });

  test('keeps an aggregate row key stable when streaming appends another tool event', () => {
    const firstToolMessage = {
      type: 'assistant',
      uuid: 'tool-row-1',
      message: {
        role: 'assistant',
        content: [{ type: 'tool_use', id: 'tool-1', name: 'Read', input: {} }],
      },
    } as ClaudeStreamMessage;
    const nextToolMessage = {
      type: 'assistant',
      uuid: 'tool-row-2',
      message: {
        role: 'assistant',
        content: [{ type: 'tool_use', id: 'tool-2', name: 'Bash', input: {} }],
      },
    } as ClaudeStreamMessage;
    const beforeAppend: MessageGroup = {
      type: 'aggregated',
      index: 10,
      messages: [firstToolMessage],
    };
    const afterAppend: MessageGroup = {
      type: 'aggregated',
      index: 10,
      messages: [firstToolMessage, nextToolMessage],
    };

    expect(getMessageGroupVirtualKey(beforeAppend, 10)).toBe(
      getMessageGroupVirtualKey(afterAppend, 10),
    );
    expect(getMessageGroupRenderRevision(beforeAppend, 10)).not.toBe(
      getMessageGroupRenderRevision(afterAppend, 10),
    );
  });

  test('assistant rows sharing one message.id but different uuids must get distinct virtual keys', () => {
    // 复现真实 bug：Claude 流式同一回合的多条 JSONL 行（正文/thinking/多个 tool_use）
    // 共享同一个 message.id，但每行 uuid 唯一。虚拟行 key 必须按 uuid 区分，否则多条
    // 物理消息碰撞成同一行 → 重复渲染 + 行错位。
    const sharedMessageId = 'msg_0ce240c8-5eab-4164-8062-29a2c2779cb2';
    const first: MessageGroup = {
      type: 'normal',
      index: 4,
      message: {
        type: 'assistant',
        uuid: 'row-uuid-1',
        timestamp: '2026-06-25T00:00:01.000Z',
        message: { id: sharedMessageId, role: 'assistant', content: [{ type: 'text', text: '回合第一块' }] },
      } as ClaudeStreamMessage,
    };
    const second: MessageGroup = {
      type: 'normal',
      index: 5,
      message: {
        type: 'assistant',
        uuid: 'row-uuid-2',
        timestamp: '2026-06-25T00:00:01.500Z',
        message: { id: sharedMessageId, role: 'assistant', content: [{ type: 'text', text: '回合第二块' }] },
      } as ClaudeStreamMessage,
    };

    expect(getMessageGroupVirtualKey(first, 4)).not.toBe(
      getMessageGroupVirtualKey(second, 5),
    );
    // 应当采用行级唯一的 uuid，而非共享的 message.id
    expect(getMessageGroupVirtualKey(first, 4)).toContain('row-uuid-1');
    expect(getMessageGroupVirtualKey(second, 5)).toContain('row-uuid-2');
  });

  test('prefers row-level uuid over turn-level message.id for strong identity', () => {
    const group: MessageGroup = {
      type: 'normal',
      index: 2,
      message: {
        type: 'assistant',
        uuid: 'unique-row-uuid',
        message: { id: 'msg_shared_turn_id', role: 'assistant', content: [{ type: 'text', text: 'answer' }] },
      } as ClaudeStreamMessage,
    };

    const key = getMessageGroupVirtualKey(group, 2);
    expect(key).toContain('unique-row-uuid');
    expect(key).not.toContain('msg_shared_turn_id');
  });

  test('messages that only have a shared message.id (no uuid) still get position-suffixed distinct keys', () => {
    const sharedId = 'msg_only_shared';
    const first: MessageGroup = {
      type: 'normal',
      index: 3,
      message: {
        type: 'assistant',
        message: { id: sharedId, role: 'assistant', content: [{ type: 'text', text: 'a' }] },
      } as ClaudeStreamMessage,
    };
    const second: MessageGroup = {
      type: 'normal',
      index: 6,
      message: {
        type: 'assistant',
        message: { id: sharedId, role: 'assistant', content: [{ type: 'text', text: 'b' }] },
      } as ClaudeStreamMessage,
    };

    expect(getMessageGroupVirtualKey(first, 3)).not.toBe(
      getMessageGroupVirtualKey(second, 6),
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
