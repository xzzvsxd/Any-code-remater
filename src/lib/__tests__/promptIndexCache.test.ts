import { describe, expect, test } from 'vitest';
import {
  getBranchPromptIndexForDisplayableMessage,
  getPromptIndexForDisplayableMessage,
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
});
