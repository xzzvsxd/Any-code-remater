import { getConversationContext } from './sessionHelpers';
import type { ClaudeStreamMessage } from '@/types/claude';

export {};

const expect = (condition: boolean, label: string) => {
  if (!condition) {
    throw new Error(label);
  }
};

const longConclusion = `关键结论出来了，方案的前提变了:\n\n${'模型自带的史实知识非常扎实、准确。'.repeat(120)}尾部不可丢失`;
const messages: ClaudeStreamMessage[] = [
  {
    type: 'assistant',
    message: {
      role: 'assistant',
      content: [{ type: 'text', text: longConclusion }],
    },
  },
];

const context = getConversationContext(messages);
expect(context.length === 1, 'should keep one assistant context item');
expect(context[0].includes('尾部不可丢失'), 'assistant context must preserve tail content');
expect(!context[0].includes('[content truncated to fit context limit]'), 'context must not include truncation marker');
expect(!context[0].endsWith('...'), 'context must not add ellipsis truncation');

const upstreamErrorContext = getConversationContext([
  {
    type: 'user',
    message: {
      role: 'user',
      content: [{ type: 'text', text: '下一轮正常问题' }],
    },
  },
  {
    type: 'system',
    subtype: 'execution-error',
    result: 'Upstream failed with diagnostics that must stay UI-only',
    uiOnly: true,
    excludeFromAiContext: true,
  },
  {
    type: 'result',
    result: 'UI-only result fallback should not pollute context',
    excludeFromAiContext: true,
  },
] as ClaudeStreamMessage[], { includeExecutionResults: true });

expect(upstreamErrorContext.some(line => line.includes('下一轮正常问题')), 'normal user context should remain available');
expect(!upstreamErrorContext.some(line => line.includes('Upstream failed')), 'upstream errors must not enter AI context');
expect(!upstreamErrorContext.some(line => line.includes('UI-only result fallback')), 'excludeFromAiContext must override execution result inclusion');
