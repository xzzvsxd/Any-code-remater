import { describe, expect, test } from 'vitest';
import { preserveAssistantThinkingOnTailReplace } from '../assistantThinkingPreservation';
import type { ClaudeStreamMessage } from '@/types/claude';

const assistantThinking = (thinking: string): ClaudeStreamMessage => ({
  type: 'assistant',
  timestamp: '2026-06-24T00:00:00.000Z',
  message: {
    role: 'assistant',
    content: [{ type: 'thinking', thinking }],
  },
});

const topLevelThinking = (thinking: string): ClaudeStreamMessage => ({
  type: 'thinking',
  timestamp: '2026-06-24T00:00:00.000Z',
  content: thinking,
} as ClaudeStreamMessage);

const assistantText = (text: string): ClaudeStreamMessage => ({
  type: 'assistant',
  timestamp: '2026-06-24T00:00:00.000Z',
  message: {
    role: 'assistant',
    content: [{ type: 'text', text }],
  },
});

describe('assistant thinking preservation during streaming tail replacement', () => {
  test('prepends pending assistant thinking when a text delta replaces the same tail row', () => {
    const previous = assistantThinking('先分析');
    const replacement = assistantText('然后回答');

    const preserved = preserveAssistantThinkingOnTailReplace(previous, replacement);

    expect(preserved.message?.content).toEqual([
      { type: 'thinking', thinking: '先分析' },
      { type: 'text', text: '然后回答' },
    ]);
  });

  test('preserves standalone top-level thinking when the next assistant row replaces it', () => {
    const previous = topLevelThinking('独立思考');
    const replacement = assistantText('正文');

    const preserved = preserveAssistantThinkingOnTailReplace(previous, replacement);

    expect(preserved.message?.content).toEqual([
      { type: 'thinking', thinking: '独立思考' },
      { type: 'text', text: '正文' },
    ]);
  });

  test('does not duplicate thinking that already exists in the replacement message', () => {
    const previous = assistantThinking('旧思考');
    const replacement = assistantThinking('新思考');

    expect(preserveAssistantThinkingOnTailReplace(previous, replacement)).toBe(replacement);
  });
});
