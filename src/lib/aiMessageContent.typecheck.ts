import type { ClaudeStreamMessage } from '@/types/claude';
import { extractTaggedThinkingFromText, getRenderableAiContent } from './aiMessageContent';

export {};

const expectEqual = (actual: unknown, expected: unknown, label: string) => {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${String(expected)}, got ${String(actual)}`);
  }
};

const openOnly = extractTaggedThinkingFromText('<thinking> 我需要检查一下渲染器主流程中,img在最后保存时是否还是RGBA模式。');
expectEqual(openOnly.text, '', 'open-only visible text');
expectEqual(openOnly.thinkingBlocks[0], '我需要检查一下渲染器主流程中,img在最后保存时是否还是RGBA模式。', 'open-only thinking');

const closed = extractTaggedThinkingFromText('结论前\n<thinking>内部推理</thinking>\n结论后');
expectEqual(closed.text, '结论前\n\n结论后', 'closed tag visible text');
expectEqual(closed.thinkingBlocks[0], '内部推理', 'closed tag thinking');

const assistantMessage: ClaudeStreamMessage = {
  type: 'assistant',
  message: {
    role: 'assistant',
    content: [
      { type: 'text', text: '<thinking> 渲染 raw thinking 标签' },
      { type: 'text', text: '最终答案' },
    ],
  },
};
const renderable = getRenderableAiContent(assistantMessage);
expectEqual(renderable.text, '最终答案', 'assistant visible text excludes thinking tag');
expectEqual(renderable.thinkingContent, '渲染 raw thinking 标签', 'assistant thinking includes raw tag');
expectEqual(renderable.hasThinking, true, 'assistant has thinking');
