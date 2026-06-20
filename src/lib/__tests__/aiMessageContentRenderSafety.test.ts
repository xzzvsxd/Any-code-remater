import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { extractTaggedThinkingFromText } from '../aiMessageContent';

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
});