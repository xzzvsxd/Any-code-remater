import { describe, expect, test } from 'vitest';
import {
  countLinesUpTo,
  shouldRenderCodeBlockAsPlainText,
  shouldRenderMarkdownAsPlainText,
  shouldUseIncrementalTypewriter,
} from '../markdownRenderSafety';

describe('markdown render safety', () => {
  test('keeps small code blocks eligible for syntax highlighting', () => {
    expect(shouldRenderCodeBlockAsPlainText('const x = 1;\nconsole.log(x);')).toBe(false);
  });

  test('uses plain text for very large code blocks', () => {
    expect(shouldRenderCodeBlockAsPlainText('x'.repeat(80_001))).toBe(true);
  });

  test('uses plain text for very high line-count code blocks', () => {
    expect(shouldRenderCodeBlockAsPlainText(Array.from({ length: 2_001 }, () => 'x').join('\n'))).toBe(true);
  });

  test('disables incremental typewriter for large streaming markdown', () => {
    expect(shouldUseIncrementalTypewriter('short response', { isStreaming: true })).toBe(true);
    expect(shouldUseIncrementalTypewriter('x'.repeat(12_001), { isStreaming: true })).toBe(false);
  });

  test('disables incremental typewriter when streaming content contains code fences', () => {
    expect(shouldUseIncrementalTypewriter('```ts\nconst x = 1;\n```', { isStreaming: true })).toBe(false);
  });

  test('renders very large markdown as bounded plain text', () => {
    expect(shouldRenderMarkdownAsPlainText('small **markdown**')).toBe(false);
    expect(shouldRenderMarkdownAsPlainText('x'.repeat(120_001))).toBe(true);
    expect(shouldRenderMarkdownAsPlainText(Array.from({ length: 3_001 }, () => 'line').join('\n'))).toBe(true);
  });

  test('counts lines with an upper bound for collapsed huge content summaries', () => {
    expect(countLinesUpTo('a\nb\nc', 10)).toEqual({ lineCount: 3, exceeded: false });
    expect(countLinesUpTo(Array.from({ length: 20 }, () => 'x').join('\n'), 5)).toEqual({
      lineCount: 6,
      exceeded: true,
    });
  });
});
