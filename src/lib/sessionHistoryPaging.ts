import { normalizeUsageData } from '@/lib/utils';
import type { ClaudeStreamMessage } from '@/types/claude';

const VALID_HISTORY_TYPES = new Set([
  'user',
  'assistant',
  'system',
  'result',
  'summary',
  'thinking',
  'tool_use',
]);

function extractTextContent(message: ClaudeStreamMessage): string {
  const content = message.message?.content;

  if (typeof content === 'string') {
    return content;
  }

  if (!Array.isArray(content)) {
    return '';
  }

  return content
    .filter((item: LegacyAny) => item?.type === 'text')
    .map((item: LegacyAny) => item?.text || '')
    .join('\n');
}

function normalizeUsageFields(message: ClaudeStreamMessage): ClaudeStreamMessage {
  const next: ClaudeStreamMessage = { ...message };

  if (next.message?.usage) {
    next.message = {
      ...next.message,
      usage: normalizeUsageData(next.message.usage),
    };
  }

  if (next.usage) {
    next.usage = normalizeUsageData(next.usage);
  }

  if ((next as LegacyAny).codexMetadata?.usage) {
    next.codexMetadata = {
      ...(next as LegacyAny).codexMetadata,
      usage: normalizeUsageData((next as LegacyAny).codexMetadata.usage),
    };
  }

  return next;
}

function retypeCommandMessage(message: ClaudeStreamMessage): ClaudeStreamMessage {
  if (message.type !== 'user') {
    return message;
  }

  const textContent = extractTextContent(message);
  const isCommandOutput = textContent.includes('<local-command-stdout>');
  const isCommandMeta = textContent.includes('<command-name>') || textContent.includes('<command-message>');
  const isCommandError = textContent.includes('Unknown slash command:');

  if (!isCommandOutput && !isCommandMeta && !isCommandError) {
    return message;
  }

  return {
    ...message,
    type: 'system',
    subtype: isCommandOutput ? 'command-output' : isCommandError ? 'command-error' : 'command-meta',
  };
}

/**
 * Normalizes one backend history page for display. This function deliberately
 * processes only the page it receives; callers should not pass the full JSONL
 * history just to render the first screen.
 */
export function normalizeLoadedHistoryMessages(
  history: ClaudeStreamMessage[],
  onFilteredType?: (type: string) => void
): ClaudeStreamMessage[] {
  return history
    .filter(entry => {
      const type = entry.type;
      if (type && !VALID_HISTORY_TYPES.has(type)) {
        onFilteredType?.(type);
        return false;
      }
      return true;
    })
    .map(entry => ({
      ...entry,
      type: entry.type || 'assistant',
    }))
    .map(normalizeUsageFields)
    .map(retypeCommandMessage);
}

export function getHistoryMessageDedupKey(message: ClaudeStreamMessage): string {
  const stableId =
    message.uuid ??
    message.id ??
    (message.message as LegacyAny)?.id ??
    message.leafUuid ??
    message.requestId ??
    message.session_id;

  if (typeof stableId === 'string' && stableId.trim() !== '') {
    return `${message.type}:${stableId}`;
  }

  try {
    return JSON.stringify(message);
  } catch {
    const timestamp = message.receivedAt ?? message.sentAt ?? message.timestamp ?? '';
    return `${message.type}:${timestamp}:${String(message.result ?? message.summary ?? '')}`;
  }
}

/**
 * Prepends an older history page without duplicating overlap rows such as
 * system:init or a page-boundary line.
 */
export function mergeOlderHistoryMessages(
  currentMessages: ClaudeStreamMessage[],
  olderMessages: ClaudeStreamMessage[]
): ClaudeStreamMessage[] {
  if (olderMessages.length === 0) {
    return currentMessages;
  }

  const currentKeys = new Set(currentMessages.map(getHistoryMessageDedupKey));
  const uniqueOlderMessages = olderMessages.filter(message => {
    const key = getHistoryMessageDedupKey(message);
    if (currentKeys.has(key)) {
      return false;
    }
    currentKeys.add(key);
    return true;
  });

  const leadingInit =
    currentMessages[0]?.type === 'system' && currentMessages[0]?.subtype === 'init'
      ? currentMessages[0]
      : null;

  if (leadingInit) {
    return [leadingInit, ...uniqueOlderMessages, ...currentMessages.slice(1)];
  }

  return [...uniqueOlderMessages, ...currentMessages];
}
