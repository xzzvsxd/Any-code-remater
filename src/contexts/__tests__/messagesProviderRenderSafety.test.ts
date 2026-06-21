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

const useToolResultsSource = readFileSync(
  resolve(process.cwd(), 'src/hooks/useToolResults.ts'),
  'utf8',
);

const taskManagementWidgetsSource = readFileSync(
  resolve(process.cwd(), 'src/components/widgets/task-management/TaskManagementWidgets.tsx'),
  'utf8',
);

describe('MessagesProvider background derivation safety', () => {
  test('can skip expensive tool-result derivation for inactive background sessions', () => {
    expect(messagesContextSource).toContain('deriveToolResults?: boolean');
    expect(messagesContextSource).toContain('EMPTY_TOOL_RESULTS');
    expect(messagesContextSource).toContain('if (!deriveToolResults)');
    expect(messagesContextSource).toContain('return EMPTY_TOOL_RESULTS');
    expect(messagesContextSource).toContain('toolResultCacheRef');
    expect(messagesContextSource).toContain('appendToolResultsFromMessage(nextResults, messages[index])');
  });

  test('tool result consumers subscribe only to tool result changes, not every message append', () => {
    expect(messagesContextSource).toContain('MessagesToolResultsContext');
    expect(messagesContextSource).toContain('useMessagesToolResults');
    expect(useToolResultsSource).toContain('useMessagesToolResults');
    expect(useToolResultsSource).not.toContain('useMessagesContext');
  });

  test('task widgets subscribe to an incremental task lookup instead of scanning every streaming message', () => {
    expect(messagesContextSource).toContain('MessagesTaskLookupContext');
    expect(messagesContextSource).toContain('useTaskSubjectLookup');
    expect(messagesContextSource).toContain('taskSubjectLookupCacheRef');
    expect(taskManagementWidgetsSource).toContain('useTaskSubjectLookup');
    expect(taskManagementWidgetsSource).not.toContain('useMessagesContext');
    expect(taskManagementWidgetsSource).not.toContain('buildTaskSubjectLookup(messages)');
  });

  test('ClaudeCodeSession only derives tool results for the active tab', () => {
    expect(claudeCodeSessionSource).toContain('deriveToolResults={props.isActive !== false}');
  });

  test('exposes an immediate append path for user-submitted optimistic messages', () => {
    expect(messagesContextSource).toContain('appendMessageImmediate');
    expect(messagesContextSource).toContain('rawSetMessagesRef.current((prev) => prev.concat(message))');
  });

  test('exposes a batched tail replacement path for same-length streaming deltas', () => {
    expect(messagesContextSource).toContain('replaceLastMessage');
    expect(messagesContextSource).toContain('createBatchedTailUpdater');
    expect(messagesContextSource).toContain('tailBatchedRef');
    expect(messagesContextSource).toContain('lastToolResultIds');
  });

  test('prompt execution uses immediate append for optimistic user-visible prompts', () => {
    expect(promptExecutionSource).toContain('appendMessageImmediate(commandMessage)');
    expect(promptExecutionSource).toContain('appendMessageImmediate(userMessage)');
  });

  test('Gemini same-length assistant deltas use the tail replacement queue instead of generic setMessages', () => {
    expect(promptExecutionSource).toContain('replaceLastMessage');
    expect(promptExecutionSource).toContain('replaceLastMessage((lastMsg) =>');
  });
});
