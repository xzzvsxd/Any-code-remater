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

export interface GroupedMessagesCache {
  messages: ClaudeStreamMessage[];
  groups: MessageGroup[];
  enableSubagentGrouping: boolean;
  processedLength: number;
  firstMessage?: ClaudeStreamMessage;
  secondLastProcessedMessage?: ClaudeStreamMessage;
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

const buildGroupedMessagesCache = (
  messages: ClaudeStreamMessage[],
  enableSubagentGrouping: boolean,
): GroupedMessagesCache => {
  const groups = enableSubagentGrouping
    ? groupMessages(messages)
    : messages.map((message, index) => ({
        type: 'normal' as const,
        message,
        index,
      }));

  return {
    messages,
    groups,
    enableSubagentGrouping,
    processedLength: messages.length,
    firstMessage: messages[0],
    secondLastProcessedMessage: messages.length >= 2 ? messages[messages.length - 2] : undefined,
    lastProcessedMessage: messages[messages.length - 1],
  };
};

const removeTailMessageFromGroups = (
  groups: MessageGroup[],
  oldTailMessage: ClaudeStreamMessage | undefined,
  oldTailIndex: number,
): MessageGroup[] | null => {
  if (!oldTailMessage || groups.length === 0) return groups;

  const lastGroup = groups[groups.length - 1];
  if (lastGroup.type === 'normal') {
    if (lastGroup.message !== oldTailMessage || lastGroup.index !== oldTailIndex) {
      return null;
    }
    return groups.slice(0, -1);
  }

  if (lastGroup.type === 'aggregated') {
    const lastAggregatedMessage = lastGroup.messages[lastGroup.messages.length - 1];
    if (lastAggregatedMessage !== oldTailMessage) {
      return null;
    }

    if (lastGroup.messages.length === 1) {
      return groups.slice(0, -1);
    }

    const nextGroups = groups.slice();
    nextGroups[nextGroups.length - 1] = {
      type: 'aggregated',
      messages: lastGroup.messages.slice(0, -1),
      index: lastGroup.index,
    };
    return nextGroups;
  }

  // subagent 组可能重写更早的 Task 边界，不做增量删除。
  return null;
};

export function updateGroupedMessagesCache(
  cache: GroupedMessagesCache | null,
  messages: ClaudeStreamMessage[],
  options: GroupedMessagesOptions = {},
): GroupedMessagesCache {
  const { enableSubagentGrouping = true } = options;

  if (!cache || cache.enableSubagentGrouping !== enableSubagentGrouping) {
    return buildGroupedMessagesCache(messages, enableSubagentGrouping);
  }

  const canUseTailReplacementFastPath =
    messages.length === cache.processedLength &&
    messages.length > 0 &&
    (messages.length === 1 || messages[messages.length - 2] === cache.secondLastProcessedMessage) &&
    (messages.length === 1 || cache.firstMessage === undefined || messages[0] === cache.firstMessage) &&
    messages[messages.length - 1] !== cache.lastProcessedMessage;

  if (canUseTailReplacementFastPath) {
    const tailIndex = messages.length - 1;
    const groupsWithoutOldTail = removeTailMessageFromGroups(
      cache.groups,
      cache.lastProcessedMessage,
      tailIndex,
    );
    if (groupsWithoutOldTail) {
      const nextGroups = appendNormalGroup(
        groupsWithoutOldTail,
        messages[tailIndex],
        tailIndex,
        enableSubagentGrouping,
      );
      if (nextGroups) {
        cache.messages = messages;
        cache.groups = nextGroups;
        cache.processedLength = messages.length;
        cache.firstMessage = messages[0];
        cache.secondLastProcessedMessage = messages.length >= 2 ? messages[messages.length - 2] : undefined;
        cache.lastProcessedMessage = messages[messages.length - 1];
        return cache;
      }
    }
  }

  const canUseAppendFastPath =
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
      cache.messages = messages;
      cache.groups = groups;
      cache.processedLength = messages.length;
      cache.firstMessage = messages[0];
      cache.secondLastProcessedMessage = messages.length >= 2 ? messages[messages.length - 2] : undefined;
      cache.lastProcessedMessage = messages[messages.length - 1];
      return cache;
    }
  }

  return buildGroupedMessagesCache(messages, enableSubagentGrouping);
}

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
    const nextCache = updateGroupedMessagesCache(cacheRef.current, messages, {
      enableSubagentGrouping,
    });
    cacheRef.current = nextCache;
    return nextCache.groups;
  }, [messages, enableSubagentGrouping]);
}
