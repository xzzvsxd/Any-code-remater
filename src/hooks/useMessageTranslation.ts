import { useState, useCallback } from 'react';
import { translationMiddleware, type TranslationResult } from '@/lib/translationMiddleware';
import { progressiveTranslationManager, TranslationPriority, type TranslationState } from '@/lib/progressiveTranslation';
import { extractMessageContent as extractContentUtil, isClaudeResponse } from '@/lib/contentExtraction';
import { processLiveMessageNonBlocking } from '@/lib/stream/liveMessageProcessing';
import type { ClaudeStreamMessage } from '@/types/claude';

/**
 * useMessageTranslation Hook
 *
 * 管理消息翻译系统，包括：
 * - 实时消息翻译处理
 * - 渐进式历史消息翻译
 * - 8种内容提取策略
 * - 翻译状态管理
 *
 * 从 ClaudeCodeSession.tsx 提取（Phase 3）
 */

interface UseMessageTranslationConfig {
  isMountedRef: React.MutableRefObject<boolean>;
  lastTranslationResult?: TranslationResult;
  onMessagesUpdate: (updater: (prev: ClaudeStreamMessage[]) => ClaudeStreamMessage[]) => void;
  onMessageAppend?: (message: ClaudeStreamMessage) => void;
  /**
   * 真实 user 消息回显的专用入口：与发送时插入的乐观用户消息对账（替换而非重复 append）。
   * 缺省时回退到普通 append。
   */
  onUserEcho?: (message: ClaudeStreamMessage) => void;
}

interface UseMessageTranslationReturn {
  translationEnabled: boolean;
  translationStates: TranslationState;
  processMessageWithTranslation: (
    message: ClaudeStreamMessage,
    payload: string,
    currentTranslationResult?: TranslationResult
  ) => Promise<void>;
  initializeProgressiveTranslation: (messages: ClaudeStreamMessage[]) => Promise<void>;
  applyTranslationToMessage: (message: ClaudeStreamMessage, result: TranslationResult) => ClaudeStreamMessage;
}

export function useMessageTranslation(config: UseMessageTranslationConfig): UseMessageTranslationReturn {
  const { isMountedRef, onMessagesUpdate, onMessageAppend, onUserEcho } = config;

  // Translation states
  const [translationEnabled, setTranslationEnabled] = useState(false);
  const [translationStates, setTranslationStates] = useState<TranslationState>({});

  /**
   * 处理翻译完成回调
   */
  const handleTranslationComplete = useCallback((
    messageId: string,
    _originalMessage: ClaudeStreamMessage,
    result: TranslationResult,
    messageIndex: number
  ) => {
    // Update translation state
    setTranslationStates(prev => ({
      ...prev,
      [messageId]: {
        ...prev[messageId],
        status: 'translated',
        translatedContent: result.translatedText
      }
    }));

    // Update the actual message in the messages array
    onMessagesUpdate(prevMessages => {
      return prevMessages.map((msg, index) => {
        if (index === messageIndex) {
          // Apply the translation
          return applyTranslationToMessage(msg, result);
        }
        return msg;
      });
    });
  }, [onMessagesUpdate]);

  /**
   * 应用翻译结果到消息对象
   */
  const applyTranslationToMessage = useCallback((
    message: ClaudeStreamMessage,
    result: TranslationResult
  ): ClaudeStreamMessage => {
    let processedMessage = { ...message };

    // Apply translation based on the message structure
    if (typeof message.content === 'string') {
      processedMessage.content = result.translatedText;
    } else if (Array.isArray(message.content)) {
      processedMessage.content = message.content.map((item: any) => {
        if (item && (item.type === 'text' || typeof item === 'string')) {
          return typeof item === 'string'
            ? { type: 'text', text: result.translatedText }
            : { ...item, text: result.translatedText };
        }
        return item;
      });
    } else if (message.message?.content) {
      if (typeof message.message.content === 'string') {
        processedMessage.message = {
          ...message.message,
          content: [{ type: 'text', text: result.translatedText }]
        };
      } else if (Array.isArray(message.message.content)) {
        processedMessage.message = {
          ...message.message,
          content: message.message.content.map((item: any) => {
            if (item && (item.type === 'text' || typeof item === 'string')) {
              return typeof item === 'string'
                ? { type: 'text', text: result.translatedText }
                : { ...item, text: result.translatedText };
            }
            return item;
          })
        };
      }
    } else if ((message as any).result) {
      (processedMessage as any).result = result.translatedText;
    } else if ((message as any).text) {
      (processedMessage as any).text = result.translatedText;
    } else if ((message as any).error) {
      (processedMessage as any).error = result.translatedText;
    } else if ((message as any).summary) {
      (processedMessage as any).summary = result.translatedText;
    }

    processedMessage.translationMeta = {
      wasTranslated: result.wasTranslated,
      detectedLanguage: result.detectedLanguage,
      originalText: result.originalText,
    };

    return processedMessage;
  }, []);

  /**
   * 处理单个消息的翻译（支持8种内容提取策略）
   */
  const processMessageWithTranslation = useCallback(async (
    message: ClaudeStreamMessage,
    payload: string,
    _currentTranslationResult?: TranslationResult
  ) => {
    try {
      processLiveMessageNonBlocking({
        message,
        isMounted: () => isMountedRef.current,
        append: (processedMessage) => {
          if (onMessageAppend) {
            onMessageAppend(processedMessage);
          } else {
            onMessagesUpdate((prev) => [...prev, processedMessage]);
          }
        },
        appendUserEcho: onUserEcho,
        updateMessages: onMessagesUpdate,
        translateMessage: async (processedMessage) => {
          const isEnabled = await translationMiddleware.isEnabled();
          setTranslationEnabled(isEnabled);
          if (!isEnabled || !isClaudeResponse(processedMessage)) {
            return null;
          }
          const extracted = extractContentUtil(processedMessage);
          if (!extracted.hasContent) {
            return null;
          }
          return translationMiddleware.translateClaudeResponse(extracted.text);
        },
        applyTranslation: applyTranslationToMessage,
        onTranslationError: (translationError) => {
          console.error('[useMessageTranslation] Response translation failed:', translationError);
        },
      });
    } catch (err) {
      console.error('[useMessageTranslation] Failed to parse message:', err, payload);
    }
  }, [isMountedRef, onMessagesUpdate, onMessageAppend, onUserEcho, applyTranslationToMessage]);

  /**
   * 初始化渐进式翻译（后台翻译历史消息）
   */
  const initializeProgressiveTranslation = useCallback(async (messages: ClaudeStreamMessage[]): Promise<void> => {
    try {
      // Check if translation is enabled
      const isEnabled = await progressiveTranslationManager.isTranslationEnabled();
      setTranslationEnabled(isEnabled);

      if (!isEnabled) {
        return;
      }
      // Initialize translation states
      const initialStates: TranslationState = {};

      // Get the most recent messages (last 10) for priority translation
      const recentMessages = messages.slice(-10);

      messages.forEach((message, index) => {
        const messageId = `${message.timestamp || Date.now()}_${index}`;

        // Extract text content for translation
        let textContent = extractContentUtil(message).text;

        if (textContent.trim()) {
          initialStates[messageId] = {
            status: 'original',
            originalContent: textContent,
            translatedContent: undefined
          };

          // Determine priority
          const isRecent = recentMessages.includes(message);
          const priority = isRecent ? TranslationPriority.HIGH : TranslationPriority.NORMAL;

          // Add to translation queue
          progressiveTranslationManager.addTask(
            messageId,
            textContent,
            priority,
            (result) => {
              if (result && result.wasTranslated) {
                handleTranslationComplete(messageId, message, result, index);
              }
            }
          );
        }
      });

      setTranslationStates(initialStates);
      

    } catch (error) {
      console.error('[useMessageTranslation] Failed to initialize progressive translation:', error);
    }
  }, [handleTranslationComplete]);

  return {
    translationEnabled,
    translationStates,
    processMessageWithTranslation,
    initializeProgressiveTranslation,
    applyTranslationToMessage
  };
}
