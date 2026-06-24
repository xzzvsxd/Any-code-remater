import type { ClaudeStreamMessage } from '@/types/claude';
import { extractTaggedThinkingFromText } from './aiMessageContent';
import { getMessageContent } from './messageContentAccess';

const THINKING_DIVIDER = '\n\n---divider---\n\n';

const toText = (value: unknown): string => {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value);
  }
  return '';
};

const getThinkingTextFromBlock = (item: any): string => (
  toText(item?.thinking ?? item?.content).trim()
);

const getPendingThinkingBlocks = (message: ClaudeStreamMessage | undefined): string[] => {
  if (!message) return [];

  const content = getMessageContent(message);

  if (message.type === 'thinking') {
    const thinking = toText(content).trim();
    return thinking ? [thinking] : [];
  }

  if (message.type !== 'assistant') {
    return [];
  }

  const thinkingBlocks: string[] = [];
  let hasVisibleOrToolContent = false;

  if (typeof content === 'string') {
    const extracted = extractTaggedThinkingFromText(content);
    if (extracted.text) {
      hasVisibleOrToolContent = true;
    }
    thinkingBlocks.push(...extracted.thinkingBlocks);
  } else if (Array.isArray(content)) {
    for (const item of content) {
      if (!item || typeof item !== 'object') {
        if (toText(item).trim()) {
          hasVisibleOrToolContent = true;
        }
        continue;
      }

      if (item.type === 'thinking') {
        const thinking = getThinkingTextFromBlock(item);
        if (thinking) {
          thinkingBlocks.push(thinking);
        }
        continue;
      }

      if (item.type === 'text') {
        const extracted = extractTaggedThinkingFromText(item.text ?? item.content);
        if (extracted.text) {
          hasVisibleOrToolContent = true;
        }
        thinkingBlocks.push(...extracted.thinkingBlocks);
        continue;
      }

      hasVisibleOrToolContent = true;
    }
  }

  return !hasVisibleOrToolContent ? thinkingBlocks.filter(Boolean) : [];
};

const messageAlreadyHasThinking = (message: ClaudeStreamMessage): boolean => {
  const content = getMessageContent(message);
  if (message.type === 'thinking') {
    return toText(content).trim().length > 0;
  }
  if (typeof content === 'string') {
    return extractTaggedThinkingFromText(content).thinkingBlocks.length > 0;
  }
  if (!Array.isArray(content)) {
    return false;
  }
  return content.some((item: any) => {
    if (!item || typeof item !== 'object') return false;
    if (item.type === 'thinking') {
      return getThinkingTextFromBlock(item).length > 0;
    }
    if (item.type === 'text') {
      return extractTaggedThinkingFromText(item.text ?? item.content).thinkingBlocks.length > 0;
    }
    return false;
  });
};

/**
 * Streaming tail replacement is allowed to replace the last assistant row in-place.
 * Some engines first emit a thinking-only assistant row, then replace that same
 * tail with text/tool content. Without this merge, the thinking block exists for
 * one frame and then disappears even though it belongs to the same assistant turn.
 */
export function preserveAssistantThinkingOnTailReplace<T extends ClaudeStreamMessage>(
  previousTail: ClaudeStreamMessage | undefined,
  replacement: T,
): T {
  if (replacement.type !== 'assistant' || messageAlreadyHasThinking(replacement)) {
    return replacement;
  }

  const pendingThinkingBlocks = getPendingThinkingBlocks(previousTail);
  if (pendingThinkingBlocks.length === 0) {
    return replacement;
  }

  const thinkingContent =
    pendingThinkingBlocks.length === 1
      ? pendingThinkingBlocks[0]
      : pendingThinkingBlocks.join(THINKING_DIVIDER);
  const thinkingBlock = { type: 'thinking', thinking: thinkingContent };
  const replacementContent = getMessageContent(replacement);
  const nextContent = Array.isArray(replacementContent)
    ? [thinkingBlock, ...replacementContent]
    : typeof replacementContent === 'string' && replacementContent.trim()
      ? [thinkingBlock, { type: 'text', text: replacementContent }]
      : [thinkingBlock];

  return {
    ...replacement,
    message: {
      ...(replacement.message ?? {}),
      role: replacement.message?.role ?? 'assistant',
      content: nextContent,
    },
  };
}
