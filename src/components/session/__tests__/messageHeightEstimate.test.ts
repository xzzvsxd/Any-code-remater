import { describe, expect, test } from 'vitest';
import {
  SESSION_MESSAGES_OVERSCAN,
  estimateMessageGroupHeight,
} from '../messageHeightEstimate';
import type { MessageGroup } from '@/lib/subagentGrouping';
import type { ClaudeStreamMessage } from '@/types/claude';

const normalGroup = (message: ClaudeStreamMessage): MessageGroup => ({
  type: 'normal',
  message,
  index: 0,
});

describe('message height estimation for virtualized history navigation', () => {
  test('uses nested Claude message.content text instead of the missing top-level content field', () => {
    const shortAssistant = normalGroup({
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: 'short answer' }],
      },
    });

    const longAssistant = normalGroup({
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: 'long line\n'.repeat(240) }],
      },
    });

    expect(estimateMessageGroupHeight(longAssistant)).toBeGreaterThan(
      estimateMessageGroupHeight(shortAssistant) * 2,
    );
  });

  test('keeps very long text estimates bounded to avoid huge virtual total-size jumps', () => {
    const hugeAssistant = normalGroup({
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: 'x'.repeat(250_000) }],
      },
    });

    expect(estimateMessageGroupHeight(hugeAssistant)).toBeLessThanOrEqual(1_200);
  });

  test('estimates collapsed long user prompts as cheaper than full expanded content', () => {
    const hugeUser = normalGroup({
      type: 'user',
      message: {
        role: 'user',
        content: [{ type: 'text', text: 'line\n'.repeat(500) }],
      },
    });

    expect(estimateMessageGroupHeight(hugeUser)).toBeLessThanOrEqual(260);
  });

  test('reserves realistic height for system init cards with many tools', () => {
    const systemInit = normalGroup({
      type: 'system',
      subtype: 'init',
      session_id: '29ecedbe-2430-465b-958f-99c406aa5519',
      model: 'claude-opus-4-8[1m]',
      cwd: '/home/grandthief/桌面/Juhe',
      tools: [
        'Task',
        'TaskOutput',
        'Bash',
        'Glob',
        'Grep',
        'ExitPlanMode',
        'Read',
        'Edit',
        'Write',
        'NotebookEdit',
        'WebFetch',
        'TodoWrite',
        'WebSearch',
        'TaskStop',
        'AskUserQuestion',
        'Skill',
        'EnterPlanMode',
        'EnterWorktree',
        'ToolSearch',
        'mcp__ask_user__ask_question',
        'mcp__tool_search__search',
      ],
      message: {
        role: 'system',
        content: [],
      },
    } as ClaudeStreamMessage);

    expect(estimateMessageGroupHeight(systemInit)).toBeGreaterThanOrEqual(260);
  });

  test('limits overscan so top jumps do not mount too many unmeasured long rows at once', () => {
    expect(SESSION_MESSAGES_OVERSCAN).toBeLessThanOrEqual(8);
  });
});
