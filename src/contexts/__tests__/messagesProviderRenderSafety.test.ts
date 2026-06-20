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

const promptExecutionSource = readFileSync(
  resolve(process.cwd(), 'src/hooks/usePromptExecution.ts'),
  'utf8',
);

describe('MessagesProvider background derivation safety', () => {
  test('can skip expensive tool-result derivation for inactive background sessions', () => {
    expect(messagesContextSource).toContain('deriveToolResults?: boolean');
    expect(messagesContextSource).toContain('EMPTY_TOOL_RESULTS');
    expect(messagesContextSource).toContain('if (!deriveToolResults)');
    expect(messagesContextSource).toContain('return EMPTY_TOOL_RESULTS');
    expect(messagesContextSource).toContain('toolResultCacheRef');
    expect(messagesContextSource).toContain('appendToolResultsFromMessage(cache.results, messages[index])');
  });

  test('ClaudeCodeSession only derives tool results for the active tab', () => {
    expect(claudeCodeSessionSource).toContain('deriveToolResults={props.isActive !== false}');
  });

  test('exposes an immediate append path for user-submitted optimistic messages', () => {
    expect(messagesContextSource).toContain('appendMessageImmediate');
    expect(messagesContextSource).toContain('rawSetMessagesRef.current((prev) => prev.concat(message))');
  });

  test('prompt execution uses immediate append for optimistic user-visible prompts', () => {
    expect(promptExecutionSource).toContain('appendMessageImmediate(commandMessage)');
    expect(promptExecutionSource).toContain('appendMessageImmediate(userMessage)');
  });
});
