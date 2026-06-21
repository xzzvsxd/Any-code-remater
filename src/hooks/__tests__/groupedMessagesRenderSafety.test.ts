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
});
