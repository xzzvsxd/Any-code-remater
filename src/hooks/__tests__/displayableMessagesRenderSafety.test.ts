import { describe, expect, test } from 'vitest';
import { filterDisplayableMessages } from '../useDisplayableMessages';

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
});