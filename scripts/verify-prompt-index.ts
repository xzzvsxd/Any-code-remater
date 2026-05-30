import assert from 'node:assert/strict';
import {
  getPromptIndexForDisplayableMessage,
  isTrackedUserPrompt,
} from '../src/lib/promptIndex.js';

const user = (content: unknown, extra: Record<string, unknown> = {}) => ({
  type: 'user',
  message: { content },
  ...extra,
});

const messages = [
  user('first prompt'),
  { type: 'assistant', message: { content: 'ok' } },
  user('sidechain status that may still be displayable', { isSidechain: true }),
  user([{ type: 'tool_result', content: 'tool output only' }]),
  user('Warmup: preparing short auto prompt'),
  user('second prompt'),
  user([
    { type: 'text', text: 'third prompt' },
    { type: 'tool_result', content: 'attached result' },
  ]),
];

assert.equal(isTrackedUserPrompt(messages[0]), true);
assert.equal(isTrackedUserPrompt(messages[2]), false);
assert.equal(isTrackedUserPrompt(messages[3]), false);
assert.equal(isTrackedUserPrompt(messages[4]), false);

// Regression: excluded user-like messages must not inherit the previous prompt
// index, otherwise clicking their bubble rewinds to an earlier prompt.
assert.equal(getPromptIndexForDisplayableMessage(messages, messages, 0), 0);
assert.equal(getPromptIndexForDisplayableMessage(messages, messages, 2), -1);
assert.equal(getPromptIndexForDisplayableMessage(messages, messages, 3), -1);
assert.equal(getPromptIndexForDisplayableMessage(messages, messages, 4), -1);
assert.equal(getPromptIndexForDisplayableMessage(messages, messages, 5), 1);
assert.equal(getPromptIndexForDisplayableMessage(messages, messages, 6), 2);

console.log('prompt index verification passed');
