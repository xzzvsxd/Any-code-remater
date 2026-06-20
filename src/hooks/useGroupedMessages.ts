/**
 * 消息分组 Hook
 * 
 * 将消息列表进行分组处理，识别并组织子代理消息
 */

import { useMemo, useRef } from 'react';
import type { ClaudeStreamMessage } from '@/types/claude';
import {
  getTechnicalMessageType,
  groupMessages,
  isSubagentMessage,
  type MessageGroup,
} from '@/lib/subagentGrouping';

/**
 * 消息分组配置
 */
export interface GroupedMessagesOptions {
  /** 是否启用子代理分组 */
  enableSubagentGrouping?: boolean;
}

interface GroupedMessagesCache {
  messages: ClaudeStreamMessage[];
  groups: MessageGroup[];
  enableSubagentGrouping: boolean;
  processedLength: number;
  firstMessage?: ClaudeStreamMessage;
  lastProcessedMessage?: ClaudeStreamMessage;
}

const appendNormalGroup = (
  groups: MessageGroup[],
  message: ClaudeStreamMessage,
  index: number,
  enableSubagentGrouping: boolean,
): MessageGroup[] | null => {
  if (!enableSubagentGrouping) {
    return groups.concat({
      type: 'normal' as const,
      message,
      index,
    });
  }

  // 子代理消息会影响此前 Task 工具调用的归组边界，需要回退全量 groupMessages。
  if (isSubagentMessage(message)) {
    return null;
  }

  const technicalType = getTechnicalMessageType(message);
  if (!technicalType) {
    return groups.concat({
      type: 'normal' as const,
      message,
      index,
    });
  }

  const lastGroup = groups[groups.length - 1];
  if (lastGroup?.type === 'aggregated') {
    const lastType = getTechnicalMessageType(lastGroup.messages[0]);
    if (lastType === technicalType) {
      const nextGroups = groups.slice();
      nextGroups[nextGroups.length - 1] = {
        type: 'aggregated',
        messages: lastGroup.messages.concat(message),
        index: lastGroup.index,
      };
      return nextGroups;
    }
  }

  return groups.concat({
    type: 'aggregated' as const,
    messages: [message],
    index,
  });
};

/**
 * 对消息列表进行分组处理
 * 
 * @param messages 原始消息列表
 * @param options 分组选项
 * @returns 分组后的消息列表
 * 
 * @example
 * const messageGroups = useGroupedMessages(messages, { enableSubagentGrouping: true });
 */
export function useGroupedMessages(
  messages: ClaudeStreamMessage[],
  options: GroupedMessagesOptions = {}
): MessageGroup[] {
  const { enableSubagentGrouping = true } = options;
  const cacheRef = useRef<GroupedMessagesCache | null>(null);

  return useMemo(() => {
    const cache = cacheRef.current;
    const canUseAppendFastPath =
      cache !== null &&
      cache.enableSubagentGrouping === enableSubagentGrouping &&
      messages.length >= cache.processedLength &&
      (cache.processedLength === 0 ||
        messages[cache.processedLength - 1] === cache.lastProcessedMessage) &&
      (cache.firstMessage === undefined || messages[0] === cache.firstMessage);

    if (canUseAppendFastPath) {
      let groups = cache.groups;
      let usedFastPath = true;

      for (let index = cache.processedLength; index < messages.length; index++) {
        const nextGroups = appendNormalGroup(
          groups,
          messages[index],
          index,
          enableSubagentGrouping,
        );
        if (!nextGroups) {
          usedFastPath = false;
          break;
        }
        groups = nextGroups;
      }

      if (usedFastPath) {
        cacheRef.current = {
          messages,
          groups,
          enableSubagentGrouping,
          processedLength: messages.length,
          firstMessage: messages[0],
          lastProcessedMessage: messages[messages.length - 1],
        };
        return groups;
      }
    }

    const groups = enableSubagentGrouping
      ? groupMessages(messages)
      : messages.map((message, index) => ({
          type: 'normal' as const,
          message,
          index,
        }));

    cacheRef.current = {
      messages,
      groups,
      enableSubagentGrouping,
      processedLength: messages.length,
      firstMessage: messages[0],
      lastProcessedMessage: messages[messages.length - 1],
    };
    return groups;
  }, [messages, enableSubagentGrouping]);
}
