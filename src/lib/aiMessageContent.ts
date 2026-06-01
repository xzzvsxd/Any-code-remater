import type { ClaudeStreamMessage } from '@/types/claude';

const THINKING_DIVIDER = '\n\n---divider---\n\n';

export interface TaggedThinkingExtraction {
  text: string;
  thinkingBlocks: string[];
}

export interface RenderableAiContent {
  text: string;
  thinkingContent: string;
  hasThinking: boolean;
  hasToolCalls: boolean;
}

const toText = (value: unknown): string => {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value);
  }
  return '';
};

/**
 * Extract raw `<thinking>` text that some channels return as normal text.
 *
 * Supported formats:
 * - `<thinking> ...` (open-only block, common while streaming/fallback channels)
 * - `<thinking> ... </thinking>` (closed block)
 * - `visible text\n<thinking> ...` (thinking starts on its own line)
 *
 * Inline occurrences such as `foo <thinking> bar` are intentionally left as
 * visible text unless they are properly closed. This avoids swallowing ordinary
 * XML/HTML examples or code snippets too aggressively.
 */
export function extractTaggedThinkingFromText(rawText: unknown): TaggedThinkingExtraction {
  const originalText = toText(rawText);
  if (!originalText) {
    return { text: '', thinkingBlocks: [] };
  }

  const thinkingBlocks: string[] = [];

  let visibleText = originalText.replace(
    /<thinking>\s*([\s\S]*?)\s*<\/thinking>/gi,
    (_match, thinking: string) => {
      const normalized = thinking.trim();
      if (normalized) {
        thinkingBlocks.push(normalized);
      }
      return '';
    }
  );

  const openOnlyMatch = /(^|\n)([ \t]*)<thinking>\s*/i.exec(visibleText);
  if (openOnlyMatch?.index !== undefined) {
    const tagStart = openOnlyMatch.index + openOnlyMatch[1].length;
    const tagEnd = openOnlyMatch.index + openOnlyMatch[0].length;
    const before = visibleText.slice(0, tagStart).trimEnd();
    const thinking = visibleText.slice(tagEnd).trim();

    if (thinking) {
      thinkingBlocks.push(thinking);
    }
    visibleText = before;
  }

  return {
    text: visibleText.trim(),
    thinkingBlocks,
  };
}

export function getRenderableAiContent(message: ClaudeStreamMessage): RenderableAiContent {
  const content = message.message?.content;
  const textParts: string[] = [];
  const thinkingBlocks: string[] = [];
  let hasToolCalls = false;

  const addText = (value: unknown) => {
    const extracted = extractTaggedThinkingFromText(value);
    if (extracted.text) {
      textParts.push(extracted.text);
    }
    thinkingBlocks.push(...extracted.thinkingBlocks);
  };

  if (typeof content === 'string') {
    addText(content);
  } else if (Array.isArray(content)) {
    content.forEach((item: LegacyAny) => {
      if (!item || typeof item !== 'object') {
        return;
      }

      if (item.type === 'text') {
        addText(item.text ?? item.content);
      } else if (item.type === 'thinking') {
        const thinking = toText(item.thinking ?? item.content).trim();
        if (thinking) {
          thinkingBlocks.push(thinking);
        }
      } else if (item.type === 'tool_use') {
        hasToolCalls = true;
      }
    });
  }

  return {
    text: textParts.join('\n\n'),
    thinkingContent: thinkingBlocks.join(THINKING_DIVIDER),
    hasThinking: thinkingBlocks.length > 0,
    hasToolCalls,
  };
}
