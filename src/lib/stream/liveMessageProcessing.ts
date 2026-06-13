import type { ClaudeStreamMessage } from '@/types/claude';
import type { TranslationResult } from '@/lib/translationMiddleware';
import { normalizeUsageData } from '@/lib/utils';

type MessageUpdater = (updater: (prev: ClaudeStreamMessage[]) => ClaudeStreamMessage[]) => void;

interface ProcessLiveMessageOptions {
  message: ClaudeStreamMessage;
  isMounted: () => boolean;
  append: (message: ClaudeStreamMessage) => void;
  updateMessages: MessageUpdater;
  translateMessage: (message: ClaudeStreamMessage) => Promise<TranslationResult | null | undefined>;
  applyTranslation: (message: ClaudeStreamMessage, result: TranslationResult) => ClaudeStreamMessage;
  now?: () => string;
  onTranslationError?: (error: unknown) => void;
}

const cloneContent = (content: any): any => {
  if (Array.isArray(content)) {
    return content.map((item) => (item && typeof item === 'object' ? { ...item } : item));
  }
  if (content && typeof content === 'object') {
    return { ...content };
  }
  return content;
};

const extractTextFromMessageContent = (content: any): string => {
  if (typeof content === 'string') {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .filter((item: any) => item?.type === 'text')
      .map((item: any) => item?.text || '')
      .join('\n');
  }
  return '';
};

const retypeSlashCommandOutput = (message: ClaudeStreamMessage): ClaudeStreamMessage => {
  if (message.type !== 'user') {
    return message;
  }

  const textContent = extractTextFromMessageContent(message.message?.content);
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
};

export function prepareStreamMessageForAppend(
  message: ClaudeStreamMessage,
  nowIso: string = new Date().toISOString(),
): ClaudeStreamMessage {
  const { __rawPayload: _rawPayload, ...messageWithoutTransientRawPayload } = message as ClaudeStreamMessage & {
    __rawPayload?: string;
  };
  let prepared: ClaudeStreamMessage = {
    ...messageWithoutTransientRawPayload,
    message: messageWithoutTransientRawPayload.message
      ? {
          ...messageWithoutTransientRawPayload.message,
          content: cloneContent(messageWithoutTransientRawPayload.message.content),
          usage: messageWithoutTransientRawPayload.message.usage ? normalizeUsageData(messageWithoutTransientRawPayload.message.usage) : messageWithoutTransientRawPayload.message.usage,
        }
      : messageWithoutTransientRawPayload.message,
    usage: messageWithoutTransientRawPayload.usage ? normalizeUsageData(messageWithoutTransientRawPayload.usage) : messageWithoutTransientRawPayload.usage,
  };

  if (prepared.type !== 'user') {
    if (!prepared.receivedAt) {
      prepared.receivedAt = nowIso;
    }
    if (!prepared.timestamp) {
      prepared.timestamp = nowIso;
    }
  }

  prepared = retypeSlashCommandOutput(prepared);
  return prepared;
}

/**
 * Live stream 主路径必须先 append 原文，再把翻译放到后台。
 * 这样翻译网络/队列/缓存抖动不会阻塞 AsyncQueue，避免 Linux/WebKit 主线程长时间饥饿。
 */
export function processLiveMessageNonBlocking(options: ProcessLiveMessageOptions): ClaudeStreamMessage | null {
  if (!options.isMounted()) {
    return null;
  }

  const prepared = prepareStreamMessageForAppend(options.message, options.now?.());
  options.append(prepared);

  void options.translateMessage(prepared)
    .then((result) => {
      if (!result?.wasTranslated || !options.isMounted()) {
        return;
      }

      options.updateMessages((prevMessages) =>
        prevMessages.map((message) => (
          message === prepared ? options.applyTranslation(message, result) : message
        )),
      );
    })
    .catch((error) => {
      options.onTranslationError?.(error);
    });

  return prepared;
}
