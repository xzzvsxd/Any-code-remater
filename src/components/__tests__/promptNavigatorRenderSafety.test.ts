import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';

const source = readFileSync('src/components/PromptNavigator.tsx', 'utf8');

describe('prompt navigator render safety', () => {
  test('does not scan all messages while the navigator is closed', () => {
    expect(source).toContain('EMPTY_PROMPT_ITEMS');
    expect(source).toContain('if (!isOpen) return EMPTY_PROMPT_ITEMS');
    expect(source).toContain('}, [isOpen, messages])');
  });
});
