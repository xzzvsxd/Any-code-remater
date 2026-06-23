import { describe, expect, test } from 'vitest';
import {
  filterDisplayableMessages,
  updateDisplayableMessagesCache,
} from '../useDisplayableMessages';

const toolUse = (id: string, name: string) => ({
  type: 'assistant',
  message: { role: 'assistant', content: [{ type: 'tool_use', id, name }] },
});

const assistantText = (text: string) => ({
  type: 'assistant',
  message: { role: 'assistant', content: [{ type: 'text', text }] },
});

const legacyTopLevelAssistantText = (text: string) => ({
  type: 'assistant',
  content: [{ type: 'text', text }],
});

const legacyTopLevelUserText = (text: string) => ({
  type: 'user',
  content: [{ type: 'text', text }],
});

const legacyTopLevelAssistantToolUse = (id: string) => ({
  type: 'assistant',
  content: [{ type: 'tool_use', id, name: 'Read', input: { file_path: 'src/main.ts' } }],
});

const emptyAssistant = {
  type: 'assistant',
  message: { role: 'assistant', content: [] },
};

const assistantThinking = {
  type: 'assistant',
  message: { role: 'assistant', content: [{ type: 'thinking', thinking: 'checking' }] },
};

const emptyTopLevelThinking = {
  type: 'thinking',
  content: '',
};

const topLevelThinking = {
  type: 'thinking',
  content: 'checking',
};

const emptyUserWithoutMessage = {
  type: 'user',
};

const userImageOnly = {
  type: 'user',
  message: {
    role: 'user',
    content: [
      {
        type: 'image',
        source: { type: 'base64', data: 'abc', media_type: 'image/png' },
      },
    ],
  },
};

const unsupportedMessageType = {
  type: 'debug-event',
  content: 'not rendered by StreamMessageV2',
};

const toolResult = (id: string) => ({
  type: 'user',
  message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: 'ok' }] },
});

const toolResultOnly = (id: string) => ({
  type: 'user',
  _toolResultOnly: true,
  message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: 'ok' }] },
});

const topLevelToolUse = (id: string) => ({
  type: 'tool_use',
  id,
  name: 'bash',
  content: 'running',
});

const queueOperation = {
  type: 'queue-operation',
  content: 'queued',
};

const successResult = {
  type: 'result',
  result: 'ok',
};

const errorResult = {
  type: 'result',
  is_error: true,
  result: 'failed',
};

const emptySummary = {
  type: 'summary',
  summary: '',
};

const systemInit = {
  type: 'system',
  subtype: 'init',
  message: { content: [{ type: 'text', text: 'System Initialized' }] },
};

describe('displayable message filtering render safety', () => {
  test('hides widget-backed tool results using a forward-only tool_use index', () => {
    const messages = [toolUse('bash-1', 'bash'), assistantText('gap'), toolResult('bash-1')];

    expect(filterDisplayableMessages(messages as any)).toEqual([messages[0], messages[1]]);
  });

  test('hides tool-result-only user rows even when matching tool_use appears later', () => {
    const messages = [toolResult('future-tool'), toolUse('future-tool', 'bash')];

    expect(filterDisplayableMessages(messages as any)).toEqual([messages[1]]);
  });

  test('filters messages that render null before they enter virtualized rows', () => {
    const visible = assistantText('visible response');
    const legacyUser = legacyTopLevelUserText('legacy prompt');
    const legacyAssistant = legacyTopLevelAssistantText('legacy response');
    const legacyTool = legacyTopLevelAssistantToolUse('legacy-tool');
    const messages = [
      topLevelToolUse('standalone-tool'),
      queueOperation,
      toolResultOnly('standalone-tool'),
      emptyAssistant,
      successResult,
      emptySummary,
      emptyTopLevelThinking,
      emptyUserWithoutMessage,
      unsupportedMessageType,
      visible,
      assistantThinking,
      topLevelThinking,
      userImageOnly,
      errorResult,
      legacyUser,
      legacyAssistant,
      legacyTool,
    ];

    expect(filterDisplayableMessages(messages as any)).toEqual([
      visible,
      assistantThinking,
      topLevelThinking,
      userImageOnly,
      errorResult,
      legacyUser,
      legacyAssistant,
      legacyTool,
    ]);
  });

  test('source does not do per-tool-result backward scans through message history', async () => {
    const source = await import('node:fs').then(fs => fs.readFileSync('src/hooks/useDisplayableMessages.ts', 'utf8'));

    expect(source).not.toMatch(/for \(let i = index - 1; i >= 0; i--\)/);
    expect(source).toContain('filterDisplayableMessages');
  });

  test('hook keeps an append-only suffix cache for streaming updates', async () => {
    const source = await import('node:fs').then(fs => fs.readFileSync('src/hooks/useDisplayableMessages.ts', 'utf8'));

    expect(source).toContain('DisplayableMessagesCache');
    expect(source).toContain('canUseAppendFastPath');
    expect(source).toContain('for (let index = cache.processedLength; index < messages.length; index++)');
  });

  test('cache updates only the replaced tail message for same-length streaming deltas', () => {
    const firstAssistant = assistantText('hello');
    const initial = updateDisplayableMessagesCache(null, [systemInit, firstAssistant] as any);
    const stableSystemDisplay = initial.displayableMessages[0];

    const replacementAssistant = assistantText('hello world');
    const updated = updateDisplayableMessagesCache(initial, [systemInit, replacementAssistant] as any);

    expect(updated).toBe(initial);
    expect(updated.displayableMessages[0]).toBe(stableSystemDisplay);
    expect(updated.displayableMessages[1]).toBe(replacementAssistant);
  });

  test('tail replacement removes tool-result-only rows that would render blank', () => {
    const oldTailToolUse = toolUse('future-tool', 'bash');
    const initial = updateDisplayableMessagesCache(null, [oldTailToolUse] as any);

    const replacementToolResult = toolResult('future-tool');
    const updated = updateDisplayableMessagesCache(initial, [replacementToolResult] as any);

    expect(updated).toBe(initial);
    expect(updated.displayableMessages).toEqual([]);
  });
});
