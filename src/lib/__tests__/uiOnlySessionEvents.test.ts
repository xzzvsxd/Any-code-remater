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
  test('keeps real JSONL rows fixed when regressing timestamps surround UI-only events', () => {
    const laterPhysicalRow = assistant('physical row 0', '2026-01-01T00:00:02.000Z');
    const earlierPhysicalRow = assistant('physical row 1', '2026-01-01T00:00:01.000Z');
    const beforeHistory = terminalEvent('before history', '2026-01-01T00:00:00.000Z');
    const afterLastEligibleRow = terminalEvent('after last eligible row', '2026-01-01T00:00:01.000Z');

    const merged = mergeUiOnlySessionMessages(
      [laterPhysicalRow, earlierPhysicalRow],
      [beforeHistory, afterLastEligibleRow],
    );

    expect(merged).toEqual([
      expect.objectContaining({ result: 'before history' }),
      laterPhysicalRow,
      earlierPhysicalRow,
      expect.objectContaining({ result: 'after last eligible row' }),
    ]);
    expect(merged.filter(message => message.uiOnly !== true)).toEqual([
      laterPhysicalRow,
      earlierPhysicalRow,
    ]);
  });

  test('places equal-time events stably and missing-time events at the end', () => {
    const first = assistant('first', '2026-01-01T00:00:01.000Z');
    const second = assistant('second', '2026-01-01T00:00:01.000Z');
    const equalA = terminalEvent('equal-a', '2026-01-01T00:00:01.000Z');
    const equalB = terminalEvent('equal-b', '2026-01-01T00:00:01.000Z');
    const missingTime = {
      ...terminalEvent('missing-time', '2026-01-01T00:00:02.000Z'),
      timestamp: undefined,
      receivedAt: undefined,
    } as ClaudeStreamMessage;

    const merged = mergeUiOnlySessionMessages(
      [first, second],
      [equalA, equalB, missingTime],
    );

    expect(merged).toEqual([
      first,
      second,
      expect.objectContaining({ result: 'equal-a' }),
      expect.objectContaining({ result: 'equal-b' }),
      expect.objectContaining({ result: 'missing-time' }),
    ]);
  });

  test('deduplicates UI-only events without moving a 10000-row history backbone', () => {
    const history = Array.from({ length: 10_000 }, (_, index) => (
      index % 2 === 0
        ? user(
            `prompt-${index}`,
            new Date(Date.UTC(2026, 0, 1, 0, 0, 10_000 - index)).toISOString(),
          )
        : assistant(
            `answer-${index}`,
            new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString(),
          )
    ));
    const events = Array.from({ length: 50 }, (_, index) => terminalEvent(
      `event-${index}`,
      new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString(),
    ));

    const merged = mergeUiOnlySessionMessages(history, [...events, events[0]]);
    const mergedHistory = merged.filter(message => message.uiOnly !== true);

    expect(merged).toHaveLength(10_050);
    expect(mergedHistory).toHaveLength(history.length);
    expect(mergedHistory.every((message, index) => message === history[index])).toBe(true);
  });

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
