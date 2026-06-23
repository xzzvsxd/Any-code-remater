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

const ROLE_BY_MESSAGE_TYPE: Record<string, string | undefined> = {
  assistant: 'assistant',
  user: 'user',
  system: 'system',
};

/**
 * Normalize older/partially converted history rows to the official
 * `{ message: { role, content } }` shape while preserving the top-level
 * `content` field for backward compatibility.
 *
 * This fixes the class of bugs where the latest streamed rows render correctly
 * but older history rows lose user prompts / assistant text / tool results in
 * code paths that still expect `message.content` (prompt navigation, export,
 * tool result lookup, slash-command rendering, context extraction, etc.).
 */
export function normalizeMessageContentShape<T extends ClaudeStreamMessage>(message: T): T {
  if (!message) return message;

  const topLevelContent = (message as any).content;
  if (topLevelContent === undefined || message.message?.content !== undefined) {
    return message;
  }

  const role = message.message?.role ?? ROLE_BY_MESSAGE_TYPE[(message as any).type];
  if (!role) {
    return message;
  }

  return {
    ...message,
    message: {
      ...(message.message ?? {}),
      role,
      content: topLevelContent,
    },
  };
}

export function normalizeMessagesContentShape<T extends ClaudeStreamMessage>(messages: T[]): T[] {
  let changed = false;
  const normalized = messages.map((message) => {
    const nextMessage = normalizeMessageContentShape(message);
    if (nextMessage !== message) {
      changed = true;
    }
    return nextMessage;
  });
  return changed ? normalized : messages;
}
