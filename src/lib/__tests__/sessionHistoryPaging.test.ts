import { describe, expect, it } from 'vitest';
import {
  mergeOlderHistoryMessages,
  normalizeLoadedHistoryMessages,
} from '@/lib/sessionHistoryPaging';
import type { ClaudeStreamMessage } from '@/types/claude';

describe('normalizeLoadedHistoryMessages', () => {
  it('normalizes only the provided page and retypes slash-command output defensively', () => {
    const page = [
      {
        type: 'user',
        message: {
          content: [
            {
              type: 'text',
              text: '<local-command-stdout>done</local-command-stdout>',
            },
          ],
        },
      },
      {
        type: 'assistant',
        message: {
          content: [{ type: 'text', text: 'ok' }],
          usage: {
            input_tokens: 1,
            output_tokens: 2,
          },
        },
      },
    ] as ClaudeStreamMessage[];

    const normalized = normalizeLoadedHistoryMessages(page);

    expect(normalized).toHaveLength(2);
    expect(normalized[0]).toMatchObject({
      type: 'system',
      subtype: 'command-output',
    });
    expect(normalized[1].message?.usage).toMatchObject({
      input_tokens: 1,
      output_tokens: 2,
    });
  });

  it('filters unknown event types without requiring a full-history pass', () => {
    const warnedTypes: string[] = [];

    const normalized = normalizeLoadedHistoryMessages(
      [
        { type: 'assistant', message: { content: [{ type: 'text', text: 'visible' }] } },
        { type: 'debug_event' as LegacyAny, result: 'noise' },
      ] as ClaudeStreamMessage[],
      type => warnedTypes.push(type)
    );

    expect(normalized).toHaveLength(1);
    expect(warnedTypes).toEqual(['debug_event']);
  });
});

describe('mergeOlderHistoryMessages', () => {
  it('prepends older pages while deduplicating overlapping init rows', () => {
    const init = {
      type: 'system',
      subtype: 'init',
      session_id: 's1',
      receivedAt: '2026-01-01T00:00:00.000Z',
    } as ClaudeStreamMessage;
    const older = {
      type: 'user',
      uuid: 'older-prompt',
      message: { content: [{ type: 'text', text: 'older' }] },
    } as ClaudeStreamMessage;
    const recent = {
      type: 'assistant',
      uuid: 'recent-answer',
      message: { content: [{ type: 'text', text: 'recent' }] },
    } as ClaudeStreamMessage;

    const merged = mergeOlderHistoryMessages([init, recent], [init, older]);

    expect(merged).toEqual([init, older, recent]);
  });
});
