import assert from 'node:assert/strict';

import { groupMessages } from '../src/lib/subagentGrouping.js';

const taskMessage = {
  type: 'assistant',
  message: {
    content: [
      {
        type: 'tool_use',
        name: 'Task',
        id: 'task-a',
        input: { subagent_type: 'reviewer' },
      },
      {
        type: 'tool_use',
        name: 'Task',
        id: 'task-b',
        input: { subagent_type: 'tester' },
      },
    ],
  },
};

const messages = [
  { type: 'user', message: { content: 'start' } },
  taskMessage,
  { type: 'assistant', parent_tool_use_id: 'task-a', message: { content: 'a1' } },
  { type: 'assistant', parent_tool_use_id: 'task-b', message: { content: 'b1' } },
  { type: 'assistant', parent_tool_use_id: 'task-a', message: { content: 'a2' } },
  { type: 'assistant', message: { content: 'done' } },
] as any[];

const groups = groupMessages(messages);
const subagentGroups = groups.filter(group => group.type === 'subagent');

assert.equal(subagentGroups.length, 2);
assert.equal(subagentGroups[0]?.group.taskToolUseId, 'task-a');
assert.equal(subagentGroups[0]?.group.subagentMessages.length, 2);
assert.equal(subagentGroups[0]?.group.endIndex, 4);
assert.equal(subagentGroups[1]?.group.taskToolUseId, 'task-b');
assert.equal(subagentGroups[1]?.group.subagentMessages.length, 1);
assert.equal(subagentGroups[1]?.group.endIndex, 3);

console.log('subagent grouping verification passed');
