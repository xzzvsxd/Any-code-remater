import { describe, expect, test, beforeEach, vi } from 'vitest';
import { isValidElement, type ReactElement } from 'react';
import { toolRegistry } from '../toolRegistry';
import { initializeToolRegistry } from '../toolRegistryInit';

vi.mock('@tauri-apps/api/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tauri-apps/api/core')>();
  return {
    ...actual,
    invoke: vi.fn(async () => null),
  };
});

describe('tool registry initialization', () => {
  beforeEach(() => {
    toolRegistry.clear();
    initializeToolRegistry();
  });

  test('registers Codex request_user_input aliases as AskUserQuestion renderer', () => {
    expect(toolRegistry.getRenderer('request_user_input')?.name).toBe('askuserquestion');
    expect(toolRegistry.getRenderer('request-user-input')?.name).toBe('askuserquestion');
    expect(toolRegistry.getRenderer('ask_user')?.name).toBe('askuserquestion');
  });

  test('registers update_plan renderer before messages render', () => {
    expect(toolRegistry.getRenderer('update_plan')?.name).toBe('update_plan');
  });

  test('normalizes singular request_user_input payloads for visual rendering', () => {
    const renderer = toolRegistry.getRenderer('request_user_input');
    expect(renderer?.name).toBe('askuserquestion');

    const element = renderer!.render({
      toolName: 'request_user_input',
      input: {
        question: {
          question: '是否继续？',
          options: [
            { id: 'continue', description: '继续执行当前任务' },
          ],
        },
      },
    });

    expect(isValidElement(element)).toBe(true);
    const props = (element as ReactElement<any>).props;
    expect(props.questions).toEqual([
      {
        question: '是否继续？',
        header: undefined,
        options: [
          { label: 'continue', description: '继续执行当前任务' },
        ],
        multiSelect: false,
      },
    ]);
  });
});
