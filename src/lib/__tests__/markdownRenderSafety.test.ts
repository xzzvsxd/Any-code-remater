import { describe, expect, test } from 'vitest';
import { shouldRenderCodeBlockAsPlainText } from '../markdownRenderSafety';

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
});
