import { describe, expect, it } from 'vitest';
import { mergeUiOnlySessionMessages } from '@/lib/uiOnlySessionEvents';
import type { ClaudeStreamMessage } from '@/types/claude';

function message(
  type: ClaudeStreamMessage['type'],
  label: string,
  extra: Partial<ClaudeStreamMessage> = {},
): ClaudeStreamMessage {
  return {
    type,
    message: { content: [{ type: 'text', text: label }] },
    testLabel: label,
    ...extra,
  } as ClaudeStreamMessage;
}

describe('mergeUiOnlySessionMessages', () => {
  it('preserves historical JSONL order instead of resorting long history by timestamps', () => {
    const history = [
      message('user', 'prompt 1', { timestamp: '2026-01-01T00:00:10.000Z' }),
      message('assistant', 'answer 1', { timestamp: '2026-01-01T00:00:11.000Z' }),
      message('user', 'prompt 2', { timestamp: '2026-01-01T00:00:01.000Z' }),
      message('assistant', 'answer 2', { timestamp: '2026-01-01T00:00:02.000Z' }),
    ];
    const uiOnly = [
      message('system', 'AI execution complete', {
        uiEventId: 'done-1',
        receivedAt: '2026-01-01T00:00:12.000Z',
      }),
    ];

    const merged = mergeUiOnlySessionMessages(history, uiOnly);

    expect(merged.map(item => item.testLabel)).toEqual([
      'prompt 1',
      'answer 1',
      'prompt 2',
      'answer 2',
      'AI execution complete',
    ]);
  });

  it('deduplicates UI-only events without sorting the full historical array', () => {
    const history = [
      message('assistant', 'answer 1', { timestamp: '2026-01-01T00:00:05.000Z' }),
      message('assistant', 'answer 2', { timestamp: '2026-01-01T00:00:01.000Z' }),
    ];
    const duplicate = message('system', 'AI execution complete', {
      uiEventId: 'done-1',
      receivedAt: '2026-01-01T00:00:06.000Z',
    });

    const merged = mergeUiOnlySessionMessages(history, [duplicate, duplicate]);

    expect(merged.map(item => item.testLabel)).toEqual([
      'answer 1',
      'answer 2',
      'AI execution complete',
    ]);
  });
});
