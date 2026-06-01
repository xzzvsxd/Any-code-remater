import { describe, expect, it } from 'vitest';
import { getDisplayableMessages } from '@/hooks/useDisplayableMessages';
import type { ClaudeStreamMessage } from '@/types/claude';

function makeMessage(
  type: ClaudeStreamMessage['type'],
  content: LegacyAny,
  extra: Partial<ClaudeStreamMessage> = {}
): ClaudeStreamMessage {
  return {
    type,
    message: { content },
    ...extra,
  } as ClaudeStreamMessage;
}

describe('getDisplayableMessages', () => {
  it('hides tool_result-only user messages already rendered by inline widgets', () => {
    const messages = [
      makeMessage('assistant', [{ type: 'tool_use', id: 'tool-1', name: 'Bash' }]),
      makeMessage('user', [{ type: 'tool_result', tool_use_id: 'tool-1', content: 'done' }]),
    ];

    expect(getDisplayableMessages(messages)).toEqual([messages[0]]);
  });

  it('hides MCP tool results and keeps unknown tool results visible', () => {
    const messages = [
      makeMessage('assistant', [
        { type: 'tool_use', id: 'mcp-1', name: 'mcp__demo__call' },
        { type: 'tool_use', id: 'custom-1', name: 'custom_tool' },
      ]),
      makeMessage('user', [{ type: 'tool_result', tool_use_id: 'mcp-1', content: 'mcp result' }]),
      makeMessage('user', [{ type: 'tool_result', tool_use_id: 'custom-1', content: 'custom result' }]),
    ];

    expect(getDisplayableMessages(messages)).toEqual([messages[0], messages[2]]);
  });

  it('preserves old forward-only matching semantics for out-of-order tool results', () => {
    const outOfOrderResult = makeMessage('user', [
      { type: 'tool_result', tool_use_id: 'later-tool', content: 'visible fallback' },
    ]);
    const laterToolUse = makeMessage('assistant', [
      { type: 'tool_use', id: 'later-tool', name: 'bash' },
    ]);

    expect(getDisplayableMessages([outOfOrderResult, laterToolUse])).toEqual([
      outOfOrderResult,
      laterToolUse,
    ]);
  });

  it('keeps text-bearing user messages even when they also contain skippable tool results', () => {
    const messages = [
      makeMessage('assistant', [{ type: 'tool_use', id: 'tool-1', name: 'read' }]),
      makeMessage('user', [
        { type: 'tool_result', tool_use_id: 'tool-1', content: 'hidden duplicate' },
        { type: 'text', text: 'user-visible note' },
      ]),
    ];

    expect(getDisplayableMessages(messages)).toEqual(messages);
  });

  it('hides warmup pairs and startup system warnings by default', () => {
    const warmup = makeMessage('user', [{ type: 'text', text: 'Warmup current project' }]);
    const warmupReply = makeMessage('assistant', [{ type: 'text', text: 'ready' }]);
    const startupWarning = makeMessage('system', [
      { type: 'text', text: '[STARTUP] Initializing MCP client' },
    ]);
    const realPrompt = makeMessage('user', [{ type: 'text', text: 'real prompt' }]);

    expect(getDisplayableMessages([warmup, warmupReply, startupWarning, realPrompt])).toEqual([
      realPrompt,
    ]);
  });
});
