import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const messagesContextSource = readFileSync(
  resolve(process.cwd(), 'src/contexts/MessagesContext.tsx'),
  'utf8',
);

const claudeCodeSessionSource = readFileSync(
  resolve(process.cwd(), 'src/components/ClaudeCodeSession.tsx'),
  'utf8',
);

describe('MessagesProvider background derivation safety', () => {
  test('can skip expensive tool-result derivation for inactive background sessions', () => {
    expect(messagesContextSource).toContain('deriveToolResults?: boolean');
    expect(messagesContextSource).toContain('EMPTY_TOOL_RESULTS');
    expect(messagesContextSource).toMatch(
      /deriveToolResults\s*\?\s*buildToolResultMap\(messages\)\s*:\s*EMPTY_TOOL_RESULTS/,
    );
  });

  test('ClaudeCodeSession only derives tool results for the active tab', () => {
    expect(claudeCodeSessionSource).toContain('deriveToolResults={props.isActive !== false}');
  });
});
