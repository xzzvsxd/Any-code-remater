import { describe, expect, test } from 'vitest';
import type { ClaudeStreamMessage } from '@/types/claude';
import {
  mergePendingLocalSubmittedPrompts,
  mergeUiOnlySessionMessages,
} from '@/lib/uiOnlySessionEvents';

const user = (text: string, sentAt: string, extra: Partial<ClaudeStreamMessage> = {}): ClaudeStreamMessage => ({
  type: 'user',
  message: { content: [{ type: 'text', text }] },
  sentAt,
  ...extra,
});

const assistant = (text: string, receivedAt: string): ClaudeStreamMessage => ({
  type: 'assistant',
  message: { content: [{ type: 'text', text }] },
  receivedAt,
  timestamp: receivedAt,
});

const terminalEvent = (text: string, timestamp: string): ClaudeStreamMessage => ({
  type: 'system',
  subtype: 'execution-error',
  result: text,
  timestamp,
  receivedAt: timestamp,
  uiOnly: true,
  excludeFromAiContext: true,
});

describe('ui-only session event merging', () => {
  test('keeps a locally submitted prompt when a late history load is missing it', () => {
    const history = [
      assistant('previous answer', '2026-06-23T01:00:00.000Z'),
    ];
    const pendingPrompt = user('why did this fail?', '2026-06-23T01:01:00.000Z', {
      uiOnly: true,
      uiOptimisticPrompt: true,
      excludeFromAiContext: true,
      uiEventId: 'prompt-1',
    });
    const error = terminalEvent('403 from upstream', '2026-06-23T01:01:10.000Z');
    const loadedWithoutPrompt = mergeUiOnlySessionMessages(history, [error]);

    const merged = mergePendingLocalSubmittedPrompts(loadedWithoutPrompt, [
      ...history,
      pendingPrompt,
      error,
    ]);

    expect(merged).toHaveLength(3);
    expect(merged[0]).toBe(history[0]);
    expect(merged[1]).toMatchObject({
      type: 'user',
      uiOptimisticPrompt: true,
      message: { content: [{ type: 'text', text: 'why did this fail?' }] },
    });
    expect(merged[2]).toMatchObject({
      subtype: 'execution-error',
      result: '403 from upstream',
    });
  });

  test('does not drop a repeated prompt just because older history has the same text', () => {
    const olderSamePrompt = user('same question', '2026-06-23T01:00:00.000Z');
    const olderAnswer = assistant('old answer', '2026-06-23T01:00:10.000Z');
    const pendingPrompt = user('same question', '2026-06-23T01:02:00.000Z', {
      uiOnly: true,
      uiOptimisticPrompt: true,
      excludeFromAiContext: true,
      uiEventId: 'prompt-repeat',
    });

    const merged = mergePendingLocalSubmittedPrompts(
      [olderSamePrompt, olderAnswer],
      [olderSamePrompt, olderAnswer, pendingPrompt],
    );

    const userPrompts = merged.filter((message) => message.type === 'user');
    expect(userPrompts).toHaveLength(2);
    expect(userPrompts[1]).toMatchObject({
      uiOptimisticPrompt: true,
      sentAt: '2026-06-23T01:02:00.000Z',
    });
  });

  test('does not keep the local optimistic prompt after history catches up with the real prompt', () => {
    const pendingPrompt = user('already in history', '2026-06-23T01:01:00.000Z', {
      uiOnly: true,
      uiOptimisticPrompt: true,
      excludeFromAiContext: true,
      uiEventId: 'prompt-caught-up',
    });
    const realPrompt = user('already in history', '2026-06-23T01:01:01.000Z');
    const realAnswer = assistant('answer after prompt', '2026-06-23T01:01:10.000Z');

    const merged = mergePendingLocalSubmittedPrompts(
      [realPrompt, realAnswer],
      [pendingPrompt],
    );

    expect(merged).toEqual([realPrompt, realAnswer]);
  });
});
