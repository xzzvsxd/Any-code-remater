import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { extractTaggedThinkingFromText, getRenderableAiContentParts } from '../aiMessageContent';

const source = readFileSync('src/lib/aiMessageContent.ts', 'utf8');

describe('AI message content render safety', () => {
  test('keeps normal text extraction behavior', () => {
    expect(extractTaggedThinkingFromText('hello')).toEqual({ text: 'hello', thinkingBlocks: [] });
    expect(extractTaggedThinkingFromText('visible\n<thinking>secret</thinking>')).toEqual({
      text: 'visible',
      thinkingBlocks: ['secret'],
    });
  });

  test('short-circuits no-thinking text before regex replacement', () => {
    expect(source).toContain('/<thinking>/i.test(originalText)');
    expect(source.indexOf('/<thinking>/i.test(originalText)')).toBeLessThan(source.indexOf('originalText.replace'));
  });

  test('preserves official content block order instead of lifting all thinking away from text', () => {
    const parts = getRenderableAiContentParts({
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: '先分析' },
          { type: 'text', text: '第一段正文' },
          { type: 'thinking', thinking: '再验证' },
          { type: 'text', text: '第二段正文' },
        ],
      },
    });

    expect(parts.map((part) => part.type)).toEqual(['thinking', 'text', 'thinking', 'text']);
    expect(parts.map((part) => part.content)).toEqual(['先分析', '第一段正文', '再验证', '第二段正文']);
  });

  test('splits raw tagged thinking text in-place so replayed history keeps the original turn order', () => {
    const parts = getRenderableAiContentParts({
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [
          { type: 'text', text: '开头\n<thinking>中间思考</thinking>\n结尾' },
        ],
      },
    });

    expect(parts.map((part) => part.type)).toEqual(['text', 'thinking', 'text']);
    expect(parts.map((part) => part.content)).toEqual(['开头', '中间思考', '结尾']);
  });
});
