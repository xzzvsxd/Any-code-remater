import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source = readFileSync(resolve(process.cwd(), 'src/hooks/useTypewriter.ts'), 'utf8');

describe('useTypewriter render safety invariants', () => {
  test('disabled typewriter does not mirror huge content into React state', () => {
    expect(source).toContain("setDisplayedText('');");
    expect(source).toContain('const effectiveDisplayedText = enabled ? displayedText : fullText;');
    expect(source).toContain('displayedText: effectiveDisplayedText');
  });
});
