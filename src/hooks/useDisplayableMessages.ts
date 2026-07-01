/**
 * 可显示消息过滤 Hook
 *
 * 从 ClaudeCodeSession 提取（原 343-403 行）
 * 负责过滤出应该在 UI 中显示的消息
 */

import { useMemo, useRef } from 'react';
import type { ClaudeStreamMessage } from '@/types/claude';
import { getRenderableAiContent } from '@/lib/aiMessageContent';
import { getMessageContent, getMessageContentArray } from '@/lib/messageContentAccess';

/**
 * 过滤选项
 */
export interface DisplayableMessagesOptions {
  /** 是否隐藏 Warmup 消息及其回复 */
  hideWarmupMessages?: boolean;
  /** 是否隐藏启动期间的系统警告消息 */
  hideStartupWarnings?: boolean;
}

/**
 * 检查消息是否为启动期间的系统警告消息
 * 这些消息通常在 Gemini 等引擎初始化 MCP 客户端时产生
 */
function isStartupWarningMessage(message: ClaudeStreamMessage): boolean {
  // 只检查 system 类型的消息
  if (getMessageRenderType(message) !== 'system') return false;

  // 获取消息内容
  const content = getMessageContent(message);
  let text = '';

  if (typeof content === 'string') {
    text = content;
  } else if (Array.isArray(content)) {
    text = content
      .filter((item: any) => item.type === 'text' || item.type === 'input_text')
      .map((item: any) => item.text ?? item.content ?? '')
      .join('');
  }

  // 检查是否包含启动期间的特征字符串
  const startupPatterns = [
    '[STARTUP]',
    'Recording metric',
    'initialize_mcp_clients',
    'Initializing MCP',
    'MCP client',
  ];

  return startupPatterns.some(pattern => text.includes(pattern));
}

/**
 * 检查消息是否为 Warmup 消息
 *
 * 真正的 Warmup 消息是系统生成的简短消息，通常以 "Warmup" 开头
 * 需要排除用户粘贴的包含 "Warmup" 关键字的长文本（如日志内容）
 */
function isWarmupMessage(message: ClaudeStreamMessage): boolean {
  if (getMessageRenderType(message) !== 'user') return false;

  const content = getMessageContent(message);
  let text = '';

  if (typeof content === 'string') {
    text = content;
  } else if (Array.isArray(content)) {
    text = content
      .filter((item: any) => item.type === 'text' || item.type === 'input_text')
      .map((item: any) => item.text ?? item.content ?? '')
      .join('');
  }

  // 修复：更精确的 Warmup 消息检测
  // 真正的 Warmup 消息特征：
  // 1. 消息以 "Warmup" 开头（系统生成的 Warmup 提示）
  // 2. 消息内容较短（通常不超过 200 字符）
  // 排除用户粘贴的包含 "Warmup" 的长日志文本
  const trimmedText = text.trim();

  // 如果消息太长（超过 200 字符），不认为是 Warmup 消息
  // 因为真正的 Warmup 消息是简短的系统提示
  if (trimmedText.length > 200) {
    return false;
  }

  // 检查是否以 "Warmup" 开头（不区分大小写）
  return trimmedText.toLowerCase().startsWith('warmup');
}

const TOOLS_WITH_DEDICATED_WIDGETS = new Set([
  'task',
  'edit',
  'multiedit',
  'todowrite',
  'ls',
  'read',
  'glob',
  'bash',
  'write',
  'grep',
]);

const STREAM_MESSAGE_RENDERED_TYPES = new Set([
  'user',
  'assistant',
  'system',
  'result',
  'summary',
  'thinking',
]);

function getMessageRenderType(message: ClaudeStreamMessage): string | undefined {
  return (message as any).type ?? (message as any).message?.role;
}

function shouldSkipToolResultForToolUse(toolUse: any): boolean {
  const toolName = typeof toolUse?.name === 'string' ? toolUse.name : '';
  const normalizedToolName = toolName.toLowerCase();
  return TOOLS_WITH_DEDICATED_WIDGETS.has(normalizedToolName) || toolName.startsWith('mcp__');
}

function messageHasExtractableContent(message: ClaudeStreamMessage): boolean {
  const content = getMessageContent(message);
  if (typeof content === 'string') {
    return content.trim().length > 0;
  }
  if (Array.isArray(content)) {
    return content.some((item: any) => {
      if (typeof item === 'string') return item.trim().length > 0;
      if (!item || typeof item !== 'object') return false;
      return (
        (typeof item.text === 'string' && item.text.trim().length > 0) ||
        (typeof item.content === 'string' && item.content.trim().length > 0) ||
        (typeof item.message === 'string' && item.message.trim().length > 0)
      );
    });
  }
  if (content && typeof content === 'object') {
    const record = content as Record<string, unknown>;
    return (
      (typeof record.text === 'string' && record.text.trim().length > 0) ||
      (typeof record.content === 'string' && record.content.trim().length > 0) ||
      (typeof record.message === 'string' && record.message.trim().length > 0)
    );
  }
  return content != null;
}

function shouldRenderMessageAsNull(message: ClaudeStreamMessage): boolean {
  const messageType = getMessageRenderType(message);

  if (
    messageType === 'tool_use' ||
    messageType === 'queue-operation' ||
    (message as any)._toolResultOnly === true
  ) {
    return true;
  }

  if (!messageType || !STREAM_MESSAGE_RENDERED_TYPES.has(messageType)) {
    return true;
  }

  if (messageType === 'assistant') {
    const renderable = getRenderableAiContent(message);
    return !renderable.text && !renderable.hasThinking && !renderable.hasToolCalls;
  }

  if (messageType === 'thinking') {
    const content = (message as any).content;
    return typeof content !== 'string' || content.trim().length === 0;
  }

  if (messageType === 'result') {
    const isError = Boolean((message as any).is_error) || Boolean(message.subtype?.toLowerCase().includes('error'));
    return !isError;
  }

  if (messageType === 'summary') {
    const summary = (message as any).summary;
    return typeof summary !== 'string' || summary.trim().length === 0;
  }

  if (messageType === 'system' && message.subtype !== 'init') {
    const hasStatusContent = typeof (message as any).result === 'string' && (message as any).result.trim().length > 0;
    return !hasStatusContent && !messageHasExtractableContent(message);
  }

  return false;
}

function rememberSkippableToolUses(message: ClaudeStreamMessage, skippableToolUseIds: Set<string>): void {
  if (getMessageRenderType(message) !== 'assistant') return;
  const content = getMessageContentArray(message);
  if (!content) return;

  for (const item of content) {
    if (item?.type !== 'tool_use' || !item.id) continue;
    if (shouldSkipToolResultForToolUse(item)) {
      skippableToolUseIds.add(item.id);
    }
  }
}

function cloneSet<T>(source: Set<T>): Set<T> {
  return new Set(source);
}

function buildWarmupHiddenIndices(messages: ClaudeStreamMessage[], hideWarmupMessages: boolean): Set<number> {
  const warmupIndices = new Set<number>();
  if (!hideWarmupMessages) return warmupIndices;

  messages.forEach((msg, idx) => {
    if (isWarmupMessage(msg)) {
      warmupIndices.add(idx);
      // 找到紧跟其后的 assistant 回复（Warmup 的响应）
      if (idx + 1 < messages.length && getMessageRenderType(messages[idx + 1]) === 'assistant') {
        warmupIndices.add(idx + 1);
      }
    }
  });

  return warmupIndices;
}

interface DisplayableFilterState {
  displayableMessages: ClaudeStreamMessage[];
  skippableToolUseIds: Set<string>;
}

export interface DisplayableMessagesCache extends DisplayableFilterState {
  messages: ClaudeStreamMessage[];
  processedLength: number;
  firstMessage?: ClaudeStreamMessage;
  secondLastProcessedMessage?: ClaudeStreamMessage;
  lastProcessedMessage?: ClaudeStreamMessage;
  hideWarmupMessages: boolean;
  hideStartupWarnings: boolean;
  visibleByIndex: boolean[];
  skippableToolUseIdsBeforeLast: Set<string>;
}

function hasVisibleUserContent(message: ClaudeStreamMessage, skippableToolUseIds: Set<string>): boolean {
  void skippableToolUseIds;
  const rawContent = getMessageContent(message);

  // 检查是否有空内容
  if (!rawContent || (Array.isArray(rawContent) && rawContent.length === 0)) {
    return false;
  }

  if (!Array.isArray(rawContent)) {
    return typeof rawContent === 'string' && rawContent.trim().length > 0;
  }

  for (const content of rawContent) {
    // 如果有文本内容，保留消息
    if (content.type === 'text' || content.type === 'input_text') {
      const text = typeof content.text === 'string' ? content.text : content.content;
      if (typeof text === 'string' && text.trim().length > 0) {
        return true;
      }
      continue;
    }

    if (content.type === 'image' && (content.source || content.data)) {
      return true;
    }

    // 工具结果由 MessagesProvider 提取进 ToolCallsGroup 渲染；UserMessage 本身不渲染
    // tool_result-only 内容。让它进入虚拟列表只会留下一个有估算高度的空行。
    if (content.type === 'tool_result') {
      continue;
    }
  }

  return false;
}

function shouldDisplayMessageAtIndex(
  messages: ClaudeStreamMessage[],
  index: number,
  hideWarmupMessages: boolean,
  hideStartupWarnings: boolean,
  warmupIndices: Set<number> | null,
  skippableToolUseIds: Set<string>,
): boolean {
  const message = messages[index];
  const messageType = getMessageRenderType(message);
  let shouldDisplay = true;

  // 这些消息在 StreamMessageV2 / 子消息组件中会直接 return null。
  // 如果让它们进入虚拟列表，行本身仍会保留估算高度，表现为对话中“莫名空白”。
  // 因此必须在 displayable 阶段过滤掉，而不是等渲染阶段再返回 null。
  if (shouldRenderMessageAsNull(message)) {
    shouldDisplay = false;
  }

  // 规则 0：隐藏 Warmup 消息及其回复
  if (hideWarmupMessages && warmupIndices?.has(index)) {
    shouldDisplay = false;
  }

  // 规则 0.5：隐藏启动期间的系统警告消息
  if (shouldDisplay && hideStartupWarnings && isStartupWarningMessage(message)) {
    shouldDisplay = false;
  }

  // 规则 1：跳过没有实际内容的元消息
  if (shouldDisplay && message.isMeta && !message.leafUuid && !message.summary) {
    shouldDisplay = false;
  }

  // 规则 2 & 3：处理用户消息
  if (shouldDisplay && messageType === 'user') {
    // 跳过元消息标记的用户消息
    if (message.isMeta) {
      shouldDisplay = false;
    } else if (!hasVisibleUserContent(message, skippableToolUseIds)) {
      shouldDisplay = false;
    }
  }

  return shouldDisplay;
}

function filterDisplayableMessagesWithState(
  messages: ClaudeStreamMessage[],
  options: DisplayableMessagesOptions = {},
): DisplayableFilterState & {
  visibleByIndex: boolean[];
  skippableToolUseIdsBeforeLast: Set<string>;
} {
  // 默认隐藏 Warmup（undefined 时为 true），只有明确设置为 false 时才显示
  const hideWarmupMessages = options.hideWarmupMessages !== false;
  // 默认隐藏启动警告（undefined 时为 true）
  const hideStartupWarnings = options.hideStartupWarnings !== false;
  const warmupIndices = buildWarmupHiddenIndices(messages, hideWarmupMessages);
  const skippableToolUseIds = new Set<string>();
  let skippableToolUseIdsBeforeLast = new Set<string>();
  const displayableMessages: ClaudeStreamMessage[] = [];
  const visibleByIndex: boolean[] = [];

  messages.forEach((message, index) => {
    if (index === messages.length - 1) {
      skippableToolUseIdsBeforeLast = cloneSet(skippableToolUseIds);
    }

    const shouldDisplay = shouldDisplayMessageAtIndex(
      messages,
      index,
      hideWarmupMessages,
      hideStartupWarnings,
      warmupIndices,
      skippableToolUseIds,
    );

    if (shouldDisplay) {
      displayableMessages.push(message);
    }
    visibleByIndex[index] = shouldDisplay;

    // 必须在当前消息判定之后记录 tool_use：旧逻辑只回看 index - 1 之前的消息，
    // 不能让同条消息或未来消息影响当前 tool_result 的可见性。
    rememberSkippableToolUses(message, skippableToolUseIds);
  });

  return {
    displayableMessages,
    skippableToolUseIds,
    visibleByIndex,
    skippableToolUseIdsBeforeLast,
  };
}

export function filterDisplayableMessages(
  messages: ClaudeStreamMessage[],
  options: DisplayableMessagesOptions = {},
): ClaudeStreamMessage[] {
  return filterDisplayableMessagesWithState(messages, options).displayableMessages;
}

function canReuseDisplayableCacheOptions(
  cache: DisplayableMessagesCache,
  hideWarmupMessages: boolean,
  hideStartupWarnings: boolean,
): boolean {
  return (
    cache.hideWarmupMessages === hideWarmupMessages &&
    cache.hideStartupWarnings === hideStartupWarnings
  );
}

function shouldFallbackForWarmupBoundary(
  messages: ClaudeStreamMessage[],
  index: number,
  hideWarmupMessages: boolean,
): boolean {
  if (!hideWarmupMessages) return false;
  return (
    isWarmupMessage(messages[index]) ||
    (index > 0 && isWarmupMessage(messages[index - 1]) && messages[index].type === 'assistant')
  );
}

function writeDisplayableCache(
  cache: DisplayableMessagesCache,
  messages: ClaudeStreamMessage[],
  state: DisplayableFilterState & {
    visibleByIndex: boolean[];
    skippableToolUseIdsBeforeLast: Set<string>;
  },
  hideWarmupMessages: boolean,
  hideStartupWarnings: boolean,
): DisplayableMessagesCache {
  cache.messages = messages;
  cache.displayableMessages = state.displayableMessages;
  cache.skippableToolUseIds = state.skippableToolUseIds;
  cache.visibleByIndex = state.visibleByIndex;
  cache.skippableToolUseIdsBeforeLast = state.skippableToolUseIdsBeforeLast;
  cache.processedLength = messages.length;
  cache.firstMessage = messages[0];
  cache.secondLastProcessedMessage = messages.length >= 2 ? messages[messages.length - 2] : undefined;
  cache.lastProcessedMessage = messages[messages.length - 1];
  cache.hideWarmupMessages = hideWarmupMessages;
  cache.hideStartupWarnings = hideStartupWarnings;
  return cache;
}

function buildDisplayableMessagesCache(
  messages: ClaudeStreamMessage[],
  options: DisplayableMessagesOptions,
): DisplayableMessagesCache {
  const hideWarmupMessages = options.hideWarmupMessages !== false;
  const hideStartupWarnings = options.hideStartupWarnings !== false;
  const nextState = filterDisplayableMessagesWithState(messages, options);

  return {
    messages,
    displayableMessages: nextState.displayableMessages,
    skippableToolUseIds: nextState.skippableToolUseIds,
    visibleByIndex: nextState.visibleByIndex,
    skippableToolUseIdsBeforeLast: nextState.skippableToolUseIdsBeforeLast,
    processedLength: messages.length,
    firstMessage: messages[0],
    secondLastProcessedMessage: messages.length >= 2 ? messages[messages.length - 2] : undefined,
    lastProcessedMessage: messages[messages.length - 1],
    hideWarmupMessages,
    hideStartupWarnings,
  };
}

export function updateDisplayableMessagesCache(
  cache: DisplayableMessagesCache | null,
  messages: ClaudeStreamMessage[],
  options: DisplayableMessagesOptions = {},
): DisplayableMessagesCache {
  const hideWarmupMessages = options.hideWarmupMessages !== false;
  const hideStartupWarnings = options.hideStartupWarnings !== false;

  if (!cache || !canReuseDisplayableCacheOptions(cache, hideWarmupMessages, hideStartupWarnings)) {
    return buildDisplayableMessagesCache(messages, options);
  }

  const canUseTailReplacementFastPath =
    messages.length === cache.processedLength &&
    messages.length > 0 &&
    (messages.length === 1 || messages[messages.length - 2] === cache.secondLastProcessedMessage) &&
    (messages.length === 1 || cache.firstMessage === undefined || messages[0] === cache.firstMessage) &&
    messages[messages.length - 1] !== cache.lastProcessedMessage;

  if (canUseTailReplacementFastPath) {
    const lastIndex = messages.length - 1;
    if (!shouldFallbackForWarmupBoundary(messages, lastIndex, hideWarmupMessages)) {
      const skippableToolUseIds = cloneSet(cache.skippableToolUseIdsBeforeLast);
      const shouldDisplay = shouldDisplayMessageAtIndex(
        messages,
        lastIndex,
        hideWarmupMessages,
        hideStartupWarnings,
        null,
        skippableToolUseIds,
      );
      rememberSkippableToolUses(messages[lastIndex], skippableToolUseIds);

      const visibleByIndex = cache.visibleByIndex.slice(0, messages.length);
      const displayableMessages = visibleByIndex[lastIndex]
        ? cache.displayableMessages.slice(0, -1)
        : cache.displayableMessages;
      visibleByIndex[lastIndex] = shouldDisplay;

      return writeDisplayableCache(
        cache,
        messages,
        {
          displayableMessages: shouldDisplay
            ? displayableMessages.concat(messages[lastIndex])
            : displayableMessages,
          skippableToolUseIds,
          visibleByIndex,
          skippableToolUseIdsBeforeLast: cloneSet(cache.skippableToolUseIdsBeforeLast),
        },
        hideWarmupMessages,
        hideStartupWarnings,
      );
    }
  }

  const canUseAppendFastPath =
    messages.length >= cache.processedLength &&
    (cache.processedLength === 0 ||
      messages[cache.processedLength - 1] === cache.lastProcessedMessage) &&
    (cache.firstMessage === undefined || messages[0] === cache.firstMessage);

  if (canUseAppendFastPath) {
    let displayableMessages = cache.displayableMessages;
    const appendedDisplayableMessages: ClaudeStreamMessage[] = [];
    const skippableToolUseIds = cloneSet(cache.skippableToolUseIds);
    const visibleByIndex = cache.visibleByIndex.slice(0, cache.processedLength);
    let skippableToolUseIdsBeforeLast = cloneSet(cache.skippableToolUseIdsBeforeLast);
    let usedFastPath = true;

    for (let index = cache.processedLength; index < messages.length; index++) {
      // Warmup 会影响“下一条 assistant 回复”的显示状态；这类跨边界规则走全量路径更安全。
      if (shouldFallbackForWarmupBoundary(messages, index, hideWarmupMessages)) {
        usedFastPath = false;
        break;
      }

      if (index === messages.length - 1) {
        skippableToolUseIdsBeforeLast = cloneSet(skippableToolUseIds);
      }

      const shouldDisplay = shouldDisplayMessageAtIndex(
        messages,
        index,
        hideWarmupMessages,
        hideStartupWarnings,
        null,
        skippableToolUseIds,
      );
      visibleByIndex[index] = shouldDisplay;
      if (shouldDisplay) {
        appendedDisplayableMessages.push(messages[index]);
      }
      rememberSkippableToolUses(messages[index], skippableToolUseIds);
    }

    if (usedFastPath) {
      if (appendedDisplayableMessages.length > 0) {
        displayableMessages = displayableMessages.concat(appendedDisplayableMessages);
      }
      return writeDisplayableCache(
        cache,
        messages,
        {
          displayableMessages,
          skippableToolUseIds,
          visibleByIndex,
          skippableToolUseIdsBeforeLast,
        },
        hideWarmupMessages,
        hideStartupWarnings,
      );
    }
  }

  return buildDisplayableMessagesCache(messages, options);
}

/**
 * 过滤出可显示的消息
 *
 * 过滤规则：
 * 1. 跳过没有实际内容的元消息（isMeta && !leafUuid && !summary）
 * 2. 跳过只包含工具结果的用户消息（工具结果已在 assistant 消息中显示）
 * 3. 跳过空内容的用户消息
 * 4. （可选）跳过 Warmup 消息及其回复
 *
 * @param messages - 原始消息列表
 * @param options - 过滤选项
 * @returns 过滤后的可显示消息列表
 *
 * @example
 * const displayableMessages = useDisplayableMessages(messages, { hideWarmupMessages: true });
 * // 用于渲染 UI
 */
export function useDisplayableMessages(
  messages: ClaudeStreamMessage[],
  options: DisplayableMessagesOptions = {}
): ClaudeStreamMessage[] {
  const cacheRef = useRef<DisplayableMessagesCache | null>(null);

  return useMemo(() => {
    const nextCache = updateDisplayableMessagesCache(cacheRef.current, messages, options);
    cacheRef.current = nextCache;
    return nextCache.displayableMessages;
  }, [messages, options.hideWarmupMessages, options.hideStartupWarnings]);
}
