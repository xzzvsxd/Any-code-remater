import type { ClaudeStreamMessage } from '@/types/claude';

/**
 * Read message content from both current Claude Code SDK shape and older
 * top-level history rows.
 *
 * Current/official shape:
 *   { message: { role, content: [...] } }
 *
 * Legacy/partially converted rows seen in older histories:
 *   { type: 'assistant', content: [...] }
 *   { type: 'user', content: '...' }
 *
 * Keeping this in one helper prevents display filters and renderers from
 * accidentally preserving only top-level `thinking` while hiding user/text/tool
 * rows that were stored in the older shape.
 */
export function getMessageContent(message: ClaudeStreamMessage | undefined | null): unknown {
  if (!message) return undefined;
  return message.message?.content ?? (message as any).content;
}

export function getMessageContentArray(message: ClaudeStreamMessage | undefined | null): any[] | null {
  const content = getMessageContent(message);
  return Array.isArray(content) ? content : null;
}
