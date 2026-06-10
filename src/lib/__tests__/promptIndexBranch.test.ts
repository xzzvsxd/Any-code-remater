import { describe, expect, test } from 'vitest';
import { getBranchPromptIndexForMessageInList } from '../promptIndex';

const user = (text: string) => ({
  type: 'user',
  message: { role: 'user', content: [{ type: 'text', text }] },
});

const assistant = (text: string) => ({
  type: 'assistant',
  message: { role: 'assistant', content: text },
});

describe('branch prompt index mapping', () => {
  test('branches user messages before that prompt so the prompt can be rewritten', () => {
    const messages = [user('first'), assistant('first answer'), user('second')];

    expect(getBranchPromptIndexForMessageInList(messages, 2)).toBe(1);
  });

  test('branches assistant replies after their owning turn instead of before the user prompt', () => {
    const messages = [user('first'), assistant('first answer'), user('second')];

    expect(getBranchPromptIndexForMessageInList(messages, 1)).toBe(1);
  });

  test('branches the final assistant reply at prompt count so the whole last turn is retained', () => {
    const messages = [user('first'), assistant('first answer')];

    expect(getBranchPromptIndexForMessageInList(messages, 1)).toBe(1);
  });

  test('does not branch messages before the first real user prompt', () => {
    const messages = [assistant('system preface'), user('first')];

    expect(getBranchPromptIndexForMessageInList(messages, 0)).toBe(-1);
  });
});
