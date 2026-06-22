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

  test('uses stricter plain-text fallback for large streaming markdown before it can freeze WebKit', () => {
    const mediumMarkdown = 'x'.repeat(24_001);

    expect(shouldRenderMarkdownAsPlainText(mediumMarkdown)).toBe(false);
    expect(shouldRenderMarkdownAsPlainText(mediumMarkdown, { isStreaming: true })).toBe(true);
  });

  test('uses plain text while streaming fenced code to avoid reparsing Prism on every delta', () => {
    const fencedCode = '```ts\nconst value = 1;\n```';

    expect(shouldRenderMarkdownAsPlainText(fencedCode)).toBe(false);
    expect(shouldRenderMarkdownAsPlainText(fencedCode, { isStreaming: true })).toBe(true);
  });

  test('uses plain text for completed markdown with large fenced code blocks', () => {
    const largeFence = `小结\n\n\`\`\`json\n${'{"event":"x"}\n'.repeat(1_001)}\`\`\``;

    expect(largeFence.length).toBeLessThan(120_000);
    expect(shouldRenderMarkdownAsPlainText(largeFence)).toBe(true);
  });

  test('uses plain text for completed markdown with many fenced code blocks', () => {
    const manyFences = Array.from(
      { length: 7 },
      (_, index) => `段落 ${index}\n\n\`\`\`ts\nconst value${index} = ${index};\n\`\`\``,
    ).join('\n\n');

    expect(shouldRenderMarkdownAsPlainText(manyFences)).toBe(true);
  });

  test('uses plain text for every streaming delta to keep renderer work bounded', () => {
    expect(shouldRenderMarkdownAsPlainText('tiny **streaming** markdown', { isStreaming: true })).toBe(true);
    expect(shouldRenderMarkdownAsPlainText('- item\n- item 2', { isStreaming: true })).toBe(true);
  });

  test('counts lines with an upper bound for collapsed huge content summaries', () => {
    expect(countLinesUpTo('a\nb\nc', 10)).toEqual({ lineCount: 3, exceeded: false });
    expect(countLinesUpTo(Array.from({ length: 20 }, () => 'x').join('\n'), 5)).toEqual({
      lineCount: 6,
      exceeded: true,
    });
  });
});
