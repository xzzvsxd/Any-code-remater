import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';

const navigatorSource = readFileSync(
  resolve(process.cwd(), 'src/components/PromptNavigator.tsx'),
  'utf8',
);
const sessionSource = readFileSync(
  resolve(process.cwd(), 'src/components/ClaudeCodeSession.tsx'),
  'utf8',
);

describe('Prompt Navigator overlay geometry', () => {
  test('slides an opaque fixed-width drawer without resizing the message viewport', () => {
    expect(navigatorSource).toContain('absolute inset-y-0 right-0 z-50 w-80');
    expect(navigatorSource).toContain('w-80 bg-background');
    expect(navigatorSource).toContain('transition-transform duration-300');
    expect(navigatorSource).toContain('translate-x-full pointer-events-none');
    expect(navigatorSource).not.toContain('transition-[transform,opacity]');
    expect(navigatorSource).not.toMatch(/translate-x-(?:0|full) opacity-/);
    expect(navigatorSource).not.toContain('transition-all duration-300');
    expect(navigatorSource).not.toContain('isOpen ? "w-80');
    expect(sessionSource).toContain('"relative flex h-full bg-background"');
  });
});
