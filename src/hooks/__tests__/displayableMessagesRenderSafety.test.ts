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

const toolResult = (id: string) => ({
  type: 'user',
  message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: 'ok' }] },
});

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

  test('does not let future tool_use messages hide earlier tool results', () => {
    const messages = [toolResult('future-tool'), toolUse('future-tool', 'bash')];

    expect(filterDisplayableMessages(messages as any)).toEqual(messages);
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

  test('tail replacement uses tool_use state before the old tail message', () => {
    const oldTailToolUse = toolUse('future-tool', 'bash');
    const initial = updateDisplayableMessagesCache(null, [oldTailToolUse] as any);

    const replacementToolResult = toolResult('future-tool');
    const updated = updateDisplayableMessagesCache(initial, [replacementToolResult] as any);

    expect(updated).toBe(initial);
    expect(updated.displayableMessages).toEqual([replacementToolResult]);
  });
});
