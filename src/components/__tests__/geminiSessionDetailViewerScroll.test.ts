import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';

const source = readFileSync(
  resolve(process.cwd(), 'src/components/GeminiSessionDetailViewer.tsx'),
  'utf8',
);

describe('GeminiSessionDetailViewer scroll behavior', () => {
  test('uses clamped bottom targets instead of overshooting to scrollHeight', () => {
    expect(source).toContain('getBottomScrollTop');
    expect(source).not.toMatch(/scrollTop\s*=\s*el\.scrollHeight/);
  });
});
