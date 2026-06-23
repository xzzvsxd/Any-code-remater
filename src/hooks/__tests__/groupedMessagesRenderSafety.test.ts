import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { updateGroupedMessagesCache } from '../useGroupedMessages';
import type { ClaudeStreamMessage } from '@/types/claude';

const groupedMessagesSource = readFileSync(
  resolve(process.cwd(), 'src/hooks/useGroupedMessages.ts'),
  'utf8',
);

const subagentGroupingSource = readFileSync(
  resolve(process.cwd(), 'src/lib/subagentGrouping.ts'),
  'utf8',
);

const rawTaggedThinking = (text: string): ClaudeStreamMessage => ({
  type: 'assistant',
  message: {
    role: 'assistant',
    content: [{ type: 'text', text: `<thinking>${text}</thinking>` }],
  },
});

const standardThinking = (text: string): ClaudeStreamMessage => ({
  type: 'assistant',
  message: {
    role: 'assistant',
    content: [{ type: 'thinking', thinking: text }],
  },
});

const assistantText = (text: string): ClaudeStreamMessage => ({
  type: 'assistant',
  message: {
    role: 'assistant',
    content: [{ type: 'text', text }],
  },
});

describe('grouped messages render safety', () => {
  test('uses append-only grouping cache for common streaming updates', () => {
    expect(groupedMessagesSource).toContain('GroupedMessagesCache');
    expect(groupedMessagesSource).toContain('canUseAppendFastPath');
    expect(groupedMessagesSource).toContain('appendNormalGroup');
    expect(groupedMessagesSource).toContain('for (let index = cache.processedLength; index < messages.length; index++)');
  });

  test('falls back to full grouping for subagent messages that can rewrite earlier groups', () => {
    expect(groupedMessagesSource).toContain('isSubagentMessage(message)');
    expect(groupedMessagesSource).toContain('return null');
  });

  test('exports technical message classifier for safe incremental aggregation', () => {
    expect(subagentGroupingSource).toContain('export function getTechnicalMessageType');
  });

  test('updates only the replaced tail group for same-length streaming deltas', () => {
    const firstPrompt: ClaudeStreamMessage = {
      type: 'user',
      message: { role: 'user', content: [{ type: 'text', text: 'hello' }] },
    };
    const firstAnswer: ClaudeStreamMessage = {
      type: 'assistant',
      message: { role: 'assistant', content: [{ type: 'text', text: 'a' }] },
    };
    const initial = updateGroupedMessagesCache(null, [firstPrompt, firstAnswer], {
      enableSubagentGrouping: true,
    });
    const stableFirstGroup = initial.groups[0];

    const replacementAnswer: ClaudeStreamMessage = {
      type: 'assistant',
      message: { role: 'assistant', content: [{ type: 'text', text: 'ab' }] },
    };
    const updated = updateGroupedMessagesCache(initial, [firstPrompt, replacementAnswer], {
      enableSubagentGrouping: true,
    });

    expect(updated).toBe(initial);
    expect(updated.groups[0]).toBe(stableFirstGroup);
    expect(updated.groups[1]).toMatchObject({
      type: 'normal',
      message: replacementAnswer,
      index: 1,
    });
  });

  test('aggregates assistant messages that only contain raw tagged thinking text', () => {
    const firstThinking = rawTaggedThinking('check layout');
    const secondThinking = rawTaggedThinking('continue reasoning');

    const grouped = updateGroupedMessagesCache(null, [firstThinking, secondThinking], {
      enableSubagentGrouping: true,
    });

    expect(grouped.groups).toHaveLength(1);
    expect(grouped.groups[0]).toMatchObject({
      type: 'aggregated',
      messages: [firstThinking, secondThinking],
      index: 0,
    });
  });

  test('attaches thinking-only rows to the following assistant response turn', () => {
    const thinking = standardThinking('先分析');
    const answer = assistantText('然后回答');

    const grouped = updateGroupedMessagesCache(null, [thinking, answer], {
      enableSubagentGrouping: true,
    });

    expect(grouped.groups).toHaveLength(1);
    expect(grouped.groups[0]).toMatchObject({
      type: 'aggregated',
      messages: [thinking, answer],
      index: 0,
    });
  });

  test('does not pile multiple thinking turns into the first assistant response', () => {
    const firstThinking = standardThinking('第一轮思考');
    const firstAnswer = assistantText('第一轮回答');
    const secondThinking = standardThinking('第二轮思考');
    const secondAnswer = assistantText('第二轮回答');

    const grouped = updateGroupedMessagesCache(
      null,
      [firstThinking, firstAnswer, secondThinking, secondAnswer],
      { enableSubagentGrouping: true },
    );

    expect(grouped.groups).toHaveLength(2);
    expect(grouped.groups[0]).toMatchObject({
      type: 'aggregated',
      messages: [firstThinking, firstAnswer],
      index: 0,
    });
    expect(grouped.groups[1]).toMatchObject({
      type: 'aggregated',
      messages: [secondThinking, secondAnswer],
      index: 2,
    });
  });

  test('does not attach pending thinking across a user boundary', () => {
    const thinking = standardThinking('孤立思考');
    const interruptingUser: ClaudeStreamMessage = {
      type: 'user',
      message: { role: 'user', content: [{ type: 'text', text: '插入问题' }] },
    };
    const answer = assistantText('后续回答');

    const grouped = updateGroupedMessagesCache(null, [thinking, interruptingUser, answer], {
      enableSubagentGrouping: true,
    });

    expect(grouped.groups).toHaveLength(3);
    expect(grouped.groups[0]).toMatchObject({
      type: 'aggregated',
      messages: [thinking],
      index: 0,
    });
    expect(grouped.groups[1]).toMatchObject({
      type: 'normal',
      message: interruptingUser,
      index: 1,
    });
    expect(grouped.groups[2]).toMatchObject({
      type: 'normal',
      message: answer,
      index: 2,
    });
  });
});
