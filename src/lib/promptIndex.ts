import type { ClaudeStreamMessage } from '../types/claude';

type PromptContentItem = {
  type?: string;
  text?: string;
};

export type PromptIndexByMessage = WeakMap<object, number>;

/**
 * 提取后端 prompt_tracker 会计数的用户文本。
 *
 * 注意：这里刻意不做展示层的转义/格式化，只保留用于判断 promptIndex
 * 的原始文本，避免“展示内容”和“撤回索引”混在一起。
 */
export function extractTrackedPromptText(message: ClaudeStreamMessage | unknown): {
  text: string;
  hasTextContent: boolean;
  hasToolResult: boolean;
} {
  const content = (message as ClaudeStreamMessage | undefined)?.message?.content;
  let text = '';
  let hasTextContent = false;
  let hasToolResult = false;

  if (typeof content === 'string') {
    text = content;
    hasTextContent = text.trim().length > 0;
  } else if (Array.isArray(content)) {
    const textItems = content.filter(
      (item: PromptContentItem) => item?.type === 'text',
    );
    text = textItems.map((item: PromptContentItem) => item.text || '').join('');
    hasTextContent = textItems.length > 0 && text.trim().length > 0;
    hasToolResult = content.some(
      (item: PromptContentItem) => item?.type === 'tool_result',
    );
  }

  return { text, hasTextContent, hasToolResult };
}

/**
 * 判断一条 user 消息是否是真正会参与撤回编号的用户提示词。
 * 必须和 Rust 侧 prompt extraction/truncation 的过滤意图保持一致。
 */
export function isTrackedUserPrompt(message: ClaudeStreamMessage | unknown): boolean {
  const candidate = message as ClaudeStreamMessage | undefined;
  if (candidate?.type !== 'user') return false;

  if ((candidate as LegacyAny).isSidechain === true) return false;
  if ((candidate as LegacyAny).parent_tool_use_id != null) return false;

  const { text, hasTextContent, hasToolResult } = extractTrackedPromptText(candidate);

  if (hasToolResult && !hasTextContent) return false;
  if (!hasTextContent) return false;

  const isWarmupMessage = text.includes('Warmup');
  const isSkillMessage = text.includes('<command-name>')
    || text.includes('Launching skill:')
    || text.includes('skill is running');

  return !isWarmupMessage && !isSkillMessage;
}

/**
 * 从完整消息数组中计算某个实际消息下标对应的 promptIndex。
 *
 * 回归点：如果目标消息本身不是 tracked prompt，必须返回 -1，
 * 绝不能返回“前一条 prompt 的 index”。旧逻辑就是因此把撤回目标错
 * 映射到更早的对话。
 */
export function getPromptIndexForMessageInList(
  messages: Array<ClaudeStreamMessage | unknown>,
  actualIndex: number,
): number {
  if (actualIndex < 0 || actualIndex >= messages.length) return -1;
  if (!isTrackedUserPrompt(messages[actualIndex])) return -1;

  let promptIndex = -1;
  for (let i = 0; i <= actualIndex; i++) {
    if (isTrackedUserPrompt(messages[i])) {
      promptIndex += 1;
    }
  }
  return promptIndex;
}

export function buildPromptIndexByMessage(
  messages: Array<ClaudeStreamMessage | unknown>,
): PromptIndexByMessage {
  const promptIndexByMessage: PromptIndexByMessage = new WeakMap();
  let promptIndex = 0;

  for (const message of messages) {
    if (typeof message !== 'object' || message === null) continue;
    if (!isTrackedUserPrompt(message)) continue;

    promptIndexByMessage.set(message, promptIndex);
    promptIndex += 1;
  }

  return promptIndexByMessage;
}

/**
 * displayableMessages 是 messages 的过滤视图。这里先用对象引用找回完整
 * messages 中的真实位置，再交给 getPromptIndexForMessageInList 计算。
 */
export function getPromptIndexForDisplayableMessage(
  messages: Array<ClaudeStreamMessage | unknown>,
  displayableMessages: Array<ClaudeStreamMessage | unknown>,
  displayableIndex: number,
  promptIndexByMessage?: PromptIndexByMessage,
): number {
  const displayableMessage = displayableMessages[displayableIndex];
  if (!displayableMessage) return -1;

  if (promptIndexByMessage && typeof displayableMessage === 'object') {
    return promptIndexByMessage.get(displayableMessage) ?? -1;
  }

  const actualIndex = messages.findIndex((message) => message === displayableMessage);
  return getPromptIndexForMessageInList(messages, actualIndex);
}
