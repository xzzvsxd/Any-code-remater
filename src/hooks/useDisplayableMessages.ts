/**
 * 可显示消息过滤 Hook
 *
 * 从 ClaudeCodeSession 提取（原 343-403 行）
 * 负责过滤出应该在 UI 中显示的消息
 */

import { useMemo } from 'react';
import type { ClaudeStreamMessage } from '@/types/claude';

/**
 * 过滤选项
 */
interface DisplayableMessagesOptions {
  /** 是否隐藏 Warmup 消息及其回复 */
  hideWarmupMessages?: boolean;
  /** 是否隐藏启动期间的系统警告消息 */
  hideStartupWarnings?: boolean;
}

const TOOLS_WITH_INLINE_WIDGETS = new Set([
  'task',
  'edit',
  'multiedit',
  'todowrite',
  'ls',
  'read',
  'glob',
  'bash',
  'write',
  'grep'
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
    .filter((item: LegacyAny) => item.type === 'text')
    .map((item: LegacyAny) => item.text || '')
    .join('');
}

function collectSkippableToolUseIds(
  message: ClaudeStreamMessage,
  skippableToolUseIds: Set<unknown>
): void {
  if (message.type !== 'assistant') return;

  const content = message.message?.content;
  if (!Array.isArray(content)) return;

  for (const item of content as LegacyAny[]) {
    if (!item || item.type !== 'tool_use' || item.id == null || item.id === '') continue;

    const rawToolName = typeof item.name === 'string' ? item.name : undefined;
    const toolName = rawToolName?.toLowerCase();
    const hasInlineWidget = Boolean(toolName && TOOLS_WITH_INLINE_WIDGETS.has(toolName));
    const isMcpTool = rawToolName?.startsWith('mcp__') === true;

    if (hasInlineWidget || isMcpTool) {
      skippableToolUseIds.add(item.id);
    }
  }
}

function hasVisibleUserContent(
  message: ClaudeStreamMessage,
  skippableToolUseIds: Set<unknown>
): boolean {
  if (message.type !== 'user' || !message.message) {
    return true;
  }

  // 跳过元消息标记的用户消息
  if (message.isMeta) return false;

  const msg = message.message;

  // 检查是否有空内容
  if (!msg.content || (Array.isArray(msg.content) && msg.content.length === 0)) {
    return false;
  }

  if (!Array.isArray(msg.content)) {
    return true;
  }

  for (const content of msg.content as LegacyAny[]) {
    // 如果有文本内容，保留消息（与旧逻辑一致：text block 本身即代表可见内容）
    if (content.type === 'text') {
      return true;
    }

    if (content.type !== 'tool_result') {
      continue;
    }

    // 工具结果如果已有专用 widget 在 assistant 消息中展示，则不重复显示。
    // skippableToolUseIds 只包含当前消息之前出现过的 tool_use，保持旧逻辑的“向前查找”语义。
    const willBeSkipped = content.tool_use_id
      ? skippableToolUseIds.has(content.tool_use_id)
      : false;

    if (!willBeSkipped) {
      return true;
    }
  }

  return false;
}

/**
 * 检查消息是否为启动期间的系统警告消息
 * 这些消息通常在 Gemini 等引擎初始化 MCP 客户端时产生
 */
function isStartupWarningMessage(message: ClaudeStreamMessage): boolean {
  // 只检查 system 类型的消息
  if (message.type !== 'system') return false;

  const text = extractTextContent(message);

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
  if (message.type !== 'user') return false;

  const text = extractTextContent(message);

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

export function getDisplayableMessages(
  messages: ClaudeStreamMessage[],
  options: DisplayableMessagesOptions = {}
): ClaudeStreamMessage[] {
  // 默认隐藏 Warmup（undefined 时为 true），只有明确设置为 false 时才显示
  const hideWarmupMessages = options.hideWarmupMessages !== false;
  // 默认隐藏启动警告（undefined 时为 true）
  const hideStartupWarnings = options.hideStartupWarnings !== false;

  // 如果需要隐藏 Warmup，先找到所有 Warmup 消息的索引
  const warmupIndices = new Set<number>();

  if (hideWarmupMessages) {
    messages.forEach((msg, idx) => {
      if (isWarmupMessage(msg)) {
        warmupIndices.add(idx);
        // 找到紧跟其后的 assistant 回复（Warmup 的响应）
        if (idx + 1 < messages.length && messages[idx + 1].type === 'assistant') {
          warmupIndices.add(idx + 1);
        }
      }
    });
  }

  const displayableMessages: ClaudeStreamMessage[] = [];
  const skippableToolUseIds = new Set<unknown>();

  messages.forEach((message, index) => {
    let shouldDisplay = true;

    // 规则 0：隐藏 Warmup 消息及其回复
    if (hideWarmupMessages && warmupIndices.has(index)) {
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
    if (shouldDisplay && !hasVisibleUserContent(message, skippableToolUseIds)) {
      shouldDisplay = false;
    }

    if (shouldDisplay) {
      displayableMessages.push(message);
    }

    // 必须在当前消息判断之后收集 tool_use，等价于旧逻辑“只向前查找”。
    // 即便当前消息本身被过滤，也保留其 tool_use 对后续 tool_result 的影响。
    collectSkippableToolUseIds(message, skippableToolUseIds);
  });

  return displayableMessages;
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
  const hideWarmupMessages = options.hideWarmupMessages !== false;
  const hideStartupWarnings = options.hideStartupWarnings !== false;

  return useMemo(
    () => getDisplayableMessages(messages, { hideWarmupMessages, hideStartupWarnings }),
    [messages, hideWarmupMessages, hideStartupWarnings]
  );
}
