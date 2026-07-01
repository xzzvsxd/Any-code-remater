import { describe, expect, test } from 'vitest';
import {
  getBranchPromptIndexForDisplayableMessage,
  getPromptNavigationIndexForDisplayableMessage,
  getPromptIndexForDisplayableMessage,
  isNavigableUserPrompt,
  isTrackedUserPrompt,
  updatePromptIndexMapsCache,
  type PromptIndexMapsCache,
} from '../promptIndex';
import type { ClaudeStreamMessage } from '@/types/claude';

const user = (text: string): ClaudeStreamMessage => ({
  type: 'user',
  message: { role: 'user', content: [{ type: 'text', text }] },
});

const assistant = (text: string): ClaudeStreamMessage => ({
  type: 'assistant',
  message: { role: 'assistant', content: [{ type: 'text', text }] },
});

describe('prompt index cache', () => {
  test('extends prompt and branch index maps on append-only streaming updates', () => {
    const firstPrompt = user('first');
    const firstAnswer = assistant('answer');
    const cache = updatePromptIndexMapsCache(null, [firstPrompt, firstAnswer]);

    const secondPrompt = user('second');
    const secondAnswer = assistant('second answer');
    const extended = updatePromptIndexMapsCache(cache, [
      firstPrompt,
      firstAnswer,
      secondPrompt,
      secondAnswer,
    ]);

    expect(extended.promptIndexByMessage).toBe(cache.promptIndexByMessage);
    expect(extended.branchPromptIndexByMessage).toBe(cache.branchPromptIndexByMessage);
    expect(getPromptIndexForDisplayableMessage([], [secondPrompt], 0, extended.promptIndexByMessage)).toBe(1);
    expect(getBranchPromptIndexForDisplayableMessage([], [secondAnswer], 0, extended.branchPromptIndexByMessage)).toBe(2);
  });

  test('rebuilds maps when the message prefix changes', () => {
    const firstPrompt = user('first');
    const cache = updatePromptIndexMapsCache(null, [firstPrompt]);
    const replacement = user('replacement');
    const rebuilt = updatePromptIndexMapsCache(cache as PromptIndexMapsCache, [replacement]);

    expect(rebuilt.promptIndexByMessage).not.toBe(cache.promptIndexByMessage);
    expect(getPromptIndexForDisplayableMessage([], [replacement], 0, rebuilt.promptIndexByMessage)).toBe(0);
    expect(getPromptIndexForDisplayableMessage([], [firstPrompt], 0, rebuilt.promptIndexByMessage)).toBe(-1);
  });

  test('reuses maps when only the streaming tail message is replaced', () => {
    const firstPrompt = user('first');
    const firstAnswer = assistant('partial');
    const cache = updatePromptIndexMapsCache(null, [firstPrompt, firstAnswer]);

    const replacementAnswer = assistant('partial plus delta');
    const updated = updatePromptIndexMapsCache(cache, [firstPrompt, replacementAnswer]);

    expect(updated).toBe(cache);
    expect(updated.promptIndexByMessage).toBe(cache.promptIndexByMessage);
    expect(updated.branchPromptIndexByMessage).toBe(cache.branchPromptIndexByMessage);
    expect(getPromptIndexForDisplayableMessage([], [replacementAnswer], 0, updated.promptIndexByMessage)).toBe(-1);
    expect(getBranchPromptIndexForDisplayableMessage([], [replacementAnswer], 0, updated.branchPromptIndexByMessage)).toBe(1);
  });

  test('does not count UI-only optimistic prompts in backend prompt indexes', () => {
    const firstPrompt = user('real prompt');
    const optimisticPrompt: ClaudeStreamMessage = {
      ...user('local only prompt'),
      uiOnly: true,
      uiOptimisticPrompt: true,
      excludeFromAiContext: true,
    };
    const answer = assistant('answer after optimistic prompt');
    const cache = updatePromptIndexMapsCache(null, [firstPrompt, optimisticPrompt, answer]);

    expect(getPromptIndexForDisplayableMessage([], [firstPrompt], 0, cache.promptIndexByMessage)).toBe(0);
    expect(getPromptIndexForDisplayableMessage([], [optimisticPrompt], 0, cache.promptIndexByMessage)).toBe(-1);
    expect(getBranchPromptIndexForDisplayableMessage([], [answer], 0, cache.branchPromptIndexByMessage)).toBe(1);
  });

  test('counts UI-only submitted prompts for navigation without changing backend prompt indexes', () => {
    const firstOptimisticPrompt: ClaudeStreamMessage = {
      ...user('已发送但还没对账的一问'),
      uiOnly: true,
      uiOptimisticPrompt: true,
      excludeFromAiContext: true,
    };
    const secondOptimisticPrompt: ClaudeStreamMessage = {
      ...user('已发送但还没对账的二问'),
      uiOnly: true,
      uiOptimisticPrompt: true,
      excludeFromAiContext: true,
    };
    const answer = assistant('assistant output');

    const cache = updatePromptIndexMapsCache(null, [
      firstOptimisticPrompt,
      answer,
      secondOptimisticPrompt,
    ]);

    expect(isTrackedUserPrompt(firstOptimisticPrompt)).toBe(false);
    expect(isNavigableUserPrompt(firstOptimisticPrompt)).toBe(true);
    expect(getPromptIndexForDisplayableMessage([], [firstOptimisticPrompt], 0, cache.promptIndexByMessage)).toBe(-1);
    expect(getPromptIndexForDisplayableMessage([], [secondOptimisticPrompt], 0, cache.promptIndexByMessage)).toBe(-1);
    expect(
      getPromptNavigationIndexForDisplayableMessage([], [firstOptimisticPrompt], 0, cache.navigationPromptIndexByMessage),
    ).toBe(0);
    expect(
      getPromptNavigationIndexForDisplayableMessage([], [secondOptimisticPrompt], 0, cache.navigationPromptIndexByMessage),
    ).toBe(1);
  });

  test('recognizes legacy top-level content and role-only user prompts', () => {
    const legacyTopLevel = {
      type: 'user',
      content: [{ type: 'text', text: '旧历史顶层 content' }],
    } as any;
    const roleOnly = {
      message: {
        role: 'user',
        content: [{ type: 'text', text: '只有 message.role 的 prompt' }],
      },
    } as any;

    const cache = updatePromptIndexMapsCache(null, [legacyTopLevel, assistant('answer'), roleOnly]);

    expect(isTrackedUserPrompt(legacyTopLevel)).toBe(true);
    expect(isTrackedUserPrompt(roleOnly)).toBe(true);
    expect(getPromptIndexForDisplayableMessage([], [legacyTopLevel], 0, cache.promptIndexByMessage)).toBe(0);
    expect(getPromptIndexForDisplayableMessage([], [roleOnly], 0, cache.promptIndexByMessage)).toBe(1);
    expect(
      getPromptNavigationIndexForDisplayableMessage([], [legacyTopLevel], 0, cache.navigationPromptIndexByMessage),
    ).toBe(0);
    expect(
      getPromptNavigationIndexForDisplayableMessage([], [roleOnly], 0, cache.navigationPromptIndexByMessage),
    ).toBe(1);
  });
});
