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

export type RenderableAiContentPart =
  | { type: 'text'; content: string }
  | { type: 'thinking'; content: string }
  | { type: 'tools'; content: '' };

const toText = (value: unknown): string => {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value);
  }
  return '';
};

const pushTextPart = (parts: RenderableAiContentPart[], value: string) => {
  const text = value.trim();
  if (text) {
    parts.push({ type: 'text', content: text });
  }
};

const pushThinkingPart = (parts: RenderableAiContentPart[], value: string) => {
  const thinking = value.trim();
  if (thinking) {
    parts.push({ type: 'thinking', content: thinking });
  }
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
  if (!/<thinking>/i.test(originalText)) {
    return { text: originalText.trim(), thinkingBlocks: [] };
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

export function splitTaggedThinkingContent(rawText: unknown): RenderableAiContentPart[] {
  const originalText = toText(rawText);
  if (!originalText) {
    return [];
  }
  if (!/<thinking>/i.test(originalText)) {
    const text = originalText.trim();
    return text ? [{ type: 'text', content: text }] : [];
  }

  const parts: RenderableAiContentPart[] = [];
  const closedTagPattern = /<thinking>\s*([\s\S]*?)\s*<\/thinking>/gi;
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = closedTagPattern.exec(originalText)) !== null) {
    pushTextPart(parts, originalText.slice(cursor, match.index));
    pushThinkingPart(parts, match[1]);
    cursor = match.index + match[0].length;
  }

  const tail = originalText.slice(cursor);
  const openOnlyMatch = /(^|\n)([ \t]*)<thinking>\s*/i.exec(tail);
  if (openOnlyMatch?.index !== undefined) {
    const tagStart = openOnlyMatch.index + openOnlyMatch[1].length;
    const tagEnd = openOnlyMatch.index + openOnlyMatch[0].length;
    pushTextPart(parts, tail.slice(0, tagStart));
    pushThinkingPart(parts, tail.slice(tagEnd));
  } else {
    pushTextPart(parts, tail);
  }

  return parts;
}

export function getRenderableAiContentParts(message: ClaudeStreamMessage): RenderableAiContentPart[] {
  const content = message.message?.content;
  const parts: RenderableAiContentPart[] = [];
  let emittedToolMarker = false;

  const addText = (value: unknown) => {
    parts.push(...splitTaggedThinkingContent(value));
  };

  const addToolMarker = () => {
    if (!emittedToolMarker) {
      parts.push({ type: 'tools', content: '' });
      emittedToolMarker = true;
    }
  };

  if (typeof content === 'string') {
    addText(content);
  } else if (Array.isArray(content)) {
    content.forEach((item: any) => {
      if (!item || typeof item !== 'object') {
        addText(item);
        return;
      }

      if (item.type === 'text') {
        addText(item.text ?? item.content);
      } else if (item.type === 'thinking') {
        pushThinkingPart(parts, toText(item.thinking ?? item.content));
      } else if (item.type === 'tool_use') {
        addToolMarker();
      }
    });
  }

  return parts;
}

export function summarizeRenderableAiContentParts(parts: RenderableAiContentPart[]): RenderableAiContent {
  const textParts = parts
    .filter((part): part is Extract<RenderableAiContentPart, { type: 'text' }> => part.type === 'text')
    .map((part) => part.content);
  const thinkingBlocks = parts
    .filter((part): part is Extract<RenderableAiContentPart, { type: 'thinking' }> => part.type === 'thinking')
    .map((part) => part.content);
  const hasToolCalls = parts.some((part) => part.type === 'tools');

  return {
    text: textParts.join('\n\n'),
    thinkingContent: thinkingBlocks.join(THINKING_DIVIDER),
    hasThinking: thinkingBlocks.length > 0,
    hasToolCalls,
  };
}

export function getRenderableAiContent(message: ClaudeStreamMessage): RenderableAiContent {
  return summarizeRenderableAiContentParts(getRenderableAiContentParts(message));
}
