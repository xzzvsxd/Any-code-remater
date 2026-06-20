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
  if (message.type !== 'system') return false;

  // 获取消息内容
  const content = message.message?.content;
  let text = '';

  if (typeof content === 'string') {
    text = content;
  } else if (Array.isArray(content)) {
    text = content
      .filter((item: any) => item.type === 'text')
      .map((item: any) => item.text || '')
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
  if (message.type !== 'user') return false;

  const content = message.message?.content;
  let text = '';

  if (typeof content === 'string') {
    text = content;
  } else if (Array.isArray(content)) {
    text = content
      .filter((item: any) => item.type === 'text')
      .map((item: any) => item.text || '')
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

function shouldSkipToolResultForToolUse(toolUse: any): boolean {
  const toolName = typeof toolUse?.name === 'string' ? toolUse.name : '';
  const normalizedToolName = toolName.toLowerCase();
  return TOOLS_WITH_DEDICATED_WIDGETS.has(normalizedToolName) || toolName.startsWith('mcp__');
}

function rememberSkippableToolUses(message: ClaudeStreamMessage, skippableToolUseIds: Set<string>): void {
  if (message.type !== 'assistant') return;
  const content = message.message?.content;
  if (!Array.isArray(content)) return;

  for (const item of content) {
    if (item?.type !== 'tool_use' || !item.id) continue;
    if (shouldSkipToolResultForToolUse(item)) {
      skippableToolUseIds.add(item.id);
    }
  }
}

function buildWarmupHiddenIndices(messages: ClaudeStreamMessage[], hideWarmupMessages: boolean): Set<number> {
  const warmupIndices = new Set<number>();
  if (!hideWarmupMessages) return warmupIndices;

  messages.forEach((msg, idx) => {
    if (isWarmupMessage(msg)) {
      warmupIndices.add(idx);
      // 找到紧跟其后的 assistant 回复（Warmup 的响应）
      if (idx + 1 < messages.length && messages[idx + 1].type === 'assistant') {
        warmupIndices.add(idx + 1);
      }
    }
  });

  return warmupIndices;
}

function hasVisibleUserContent(message: ClaudeStreamMessage, skippableToolUseIds: Set<string>): boolean {
  const msg = message.message;
  if (!msg) return true;

  // 检查是否有空内容
  if (!msg.content || (Array.isArray(msg.content) && msg.content.length === 0)) {
    return false;
  }

  if (!Array.isArray(msg.content)) {
    return true;
  }

  for (const content of msg.content) {
    // 如果有文本内容，保留消息
    if (content.type === 'text') {
      return true;
    }

    // 工具结果只在「此前已看到」对应 tool_use 且该工具已有专用 Widget 时跳过。
    // 旧实现对每个 tool_result 从当前位置回扫全部历史；长会话/大量工具输出会把过滤变成
    // O(n * gap) 主线程长任务。这里随线性扫描维护已见 tool_use 索引，语义仍等价于“只看前文”。
    if (content.type === 'tool_result') {
      const toolUseId = content.tool_use_id;
      if (!toolUseId || !skippableToolUseIds.has(toolUseId)) {
        return true;
      }
    }
  }

  return false;
}

export function filterDisplayableMessages(
  messages: ClaudeStreamMessage[],
  options: DisplayableMessagesOptions = {},
): ClaudeStreamMessage[] {
  // 默认隐藏 Warmup（undefined 时为 true），只有明确设置为 false 时才显示
  const hideWarmupMessages = options.hideWarmupMessages !== false;
  // 默认隐藏启动警告（undefined 时为 true）
  const hideStartupWarnings = options.hideStartupWarnings !== false;
  const warmupIndices = buildWarmupHiddenIndices(messages, hideWarmupMessages);
  const skippableToolUseIds = new Set<string>();
  const displayableMessages: ClaudeStreamMessage[] = [];

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
    if (shouldDisplay && message.type === 'user' && message.message) {
      // 跳过元消息标记的用户消息
      if (message.isMeta) {
        shouldDisplay = false;
      } else if (!hasVisibleUserContent(message, skippableToolUseIds)) {
        shouldDisplay = false;
      }
    }

    if (shouldDisplay) {
      displayableMessages.push(message);
    }

    // 必须在当前消息判定之后记录 tool_use：旧逻辑只回看 index - 1 之前的消息，
    // 不能让同条消息或未来消息影响当前 tool_result 的可见性。
    rememberSkippableToolUses(message, skippableToolUseIds);
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
  return useMemo(() => {
    return filterDisplayableMessages(messages, options);
  }, [messages, options.hideWarmupMessages, options.hideStartupWarnings]);
}
