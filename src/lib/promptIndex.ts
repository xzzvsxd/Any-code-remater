import type { ClaudeStreamMessage } from '../types/claude';

type PromptContentItem = {
  type?: string;
  text?: string;
};

export type PromptIndexByMessage = WeakMap<object, number>;
export type BranchPromptIndexByMessage = WeakMap<object, number>;

export interface PromptIndexMaps {
  promptIndexByMessage: PromptIndexByMessage;
  branchPromptIndexByMessage: BranchPromptIndexByMessage;
}

export interface PromptIndexMapsCache extends PromptIndexMaps {
  messages: Array<ClaudeStreamMessage | unknown>;
  processedLength: number;
  firstMessage?: ClaudeStreamMessage | unknown;
  secondLastProcessedMessage?: ClaudeStreamMessage | unknown;
  lastProcessedMessage?: ClaudeStreamMessage | unknown;
  nextPromptIndex: number;
  hasSeenTrackedPrompt: boolean;
  nextPromptIndexBeforeLast: number;
  hasSeenTrackedPromptBeforeLast: boolean;
}

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

  // 前端本地 optimistic prompt 只用于 UI 兜底显示，后端 JSONL / prompt_tracker
  // 尚未包含它时不能参与 promptIndex 计数；否则撤回/分支索引会比后端多 1，导致错位。
  if ((candidate as any).uiOnly === true || (candidate as any).excludeFromAiContext === true) return false;
  if ((candidate as any).isSidechain === true) return false;
  if ((candidate as any).parent_tool_use_id != null) return false;

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

function addMessageToPromptIndexMaps(
  message: ClaudeStreamMessage | unknown,
  maps: PromptIndexMaps,
  state: {
    nextPromptIndex: number;
    hasSeenTrackedPrompt: boolean;
  },
): void {
  if (typeof message !== 'object' || message === null) return;

  if (isTrackedUserPrompt(message)) {
    // 撤回：只有真实 user prompt 才有 promptIndex。
    maps.promptIndexByMessage.set(message, state.nextPromptIndex);
    // 分支点在 user prompt 上：回到该 prompt 之前，允许重写这一问。
    maps.branchPromptIndexByMessage.set(message, state.nextPromptIndex);
    state.nextPromptIndex += 1;
    state.hasSeenTrackedPrompt = true;
    return;
  }

  if (state.hasSeenTrackedPrompt) {
    // 点在 assistant / 中断 / 其他非 prompt 节点上：保留到最近一轮之后。
    maps.branchPromptIndexByMessage.set(message, state.nextPromptIndex);
  }
}

export function buildPromptIndexMaps(
  messages: Array<ClaudeStreamMessage | unknown>,
): PromptIndexMapsCache {
  const maps: PromptIndexMaps = {
    promptIndexByMessage: new WeakMap(),
    branchPromptIndexByMessage: new WeakMap(),
  };
  const state = {
    nextPromptIndex: 0,
    hasSeenTrackedPrompt: false,
  };
  let nextPromptIndexBeforeLast = state.nextPromptIndex;
  let hasSeenTrackedPromptBeforeLast = state.hasSeenTrackedPrompt;

  for (let index = 0; index < messages.length; index++) {
    if (index === messages.length - 1) {
      nextPromptIndexBeforeLast = state.nextPromptIndex;
      hasSeenTrackedPromptBeforeLast = state.hasSeenTrackedPrompt;
    }
    const message = messages[index];
    addMessageToPromptIndexMaps(message, maps, state);
  }

  return {
    ...maps,
    messages,
    processedLength: messages.length,
    firstMessage: messages[0],
    secondLastProcessedMessage: messages.length >= 2 ? messages[messages.length - 2] : undefined,
    lastProcessedMessage: messages[messages.length - 1],
    nextPromptIndex: state.nextPromptIndex,
    hasSeenTrackedPrompt: state.hasSeenTrackedPrompt,
    nextPromptIndexBeforeLast,
    hasSeenTrackedPromptBeforeLast,
  };
}

export function updatePromptIndexMapsCache(
  cache: PromptIndexMapsCache | null,
  messages: Array<ClaudeStreamMessage | unknown>,
): PromptIndexMapsCache {
  const canUseTailReplacementFastPath =
    cache !== null &&
    messages.length === cache.processedLength &&
    messages.length > 1 &&
    messages[messages.length - 2] === cache.secondLastProcessedMessage &&
    (cache.firstMessage === undefined || messages[0] === cache.firstMessage) &&
    messages[messages.length - 1] !== cache.lastProcessedMessage;

  if (canUseTailReplacementFastPath) {
    const state = {
      nextPromptIndex: cache.nextPromptIndexBeforeLast,
      hasSeenTrackedPrompt: cache.hasSeenTrackedPromptBeforeLast,
    };
    const maps: PromptIndexMaps = {
      promptIndexByMessage: cache.promptIndexByMessage,
      branchPromptIndexByMessage: cache.branchPromptIndexByMessage,
    };

    addMessageToPromptIndexMaps(messages[messages.length - 1], maps, state);

    cache.messages = messages;
    cache.processedLength = messages.length;
    cache.firstMessage = messages[0];
    cache.secondLastProcessedMessage = messages.length >= 2 ? messages[messages.length - 2] : undefined;
    cache.lastProcessedMessage = messages[messages.length - 1];
    cache.nextPromptIndex = state.nextPromptIndex;
    cache.hasSeenTrackedPrompt = state.hasSeenTrackedPrompt;
    return cache;
  }

  const canExtendAppendOnly =
    cache !== null &&
    messages.length >= cache.processedLength &&
    (cache.processedLength === 0 ||
      messages[cache.processedLength - 1] === cache.lastProcessedMessage) &&
    (cache.firstMessage === undefined || messages[0] === cache.firstMessage);

  if (!canExtendAppendOnly) {
    return buildPromptIndexMaps(messages);
  }

  const state = {
    nextPromptIndex: cache.nextPromptIndex,
    hasSeenTrackedPrompt: cache.hasSeenTrackedPrompt,
  };
  const maps: PromptIndexMaps = {
    promptIndexByMessage: cache.promptIndexByMessage,
    branchPromptIndexByMessage: cache.branchPromptIndexByMessage,
  };

  for (let index = cache.processedLength; index < messages.length; index++) {
    if (index === messages.length - 1) {
      cache.nextPromptIndexBeforeLast = state.nextPromptIndex;
      cache.hasSeenTrackedPromptBeforeLast = state.hasSeenTrackedPrompt;
    }
    addMessageToPromptIndexMaps(messages[index], maps, state);
  }

  cache.messages = messages;
  cache.processedLength = messages.length;
  cache.firstMessage = messages[0];
  cache.secondLastProcessedMessage = messages.length >= 2 ? messages[messages.length - 2] : undefined;
  cache.lastProcessedMessage = messages[messages.length - 1];
  cache.nextPromptIndex = state.nextPromptIndex;
  cache.hasSeenTrackedPrompt = state.hasSeenTrackedPrompt;
  return cache;
}

export function buildPromptIndexByMessage(
  messages: Array<ClaudeStreamMessage | unknown>,
): PromptIndexByMessage {
  return buildPromptIndexMaps(messages).promptIndexByMessage;
}

export function buildBranchPromptIndexByMessage(
  messages: Array<ClaudeStreamMessage | unknown>,
): BranchPromptIndexByMessage {
  return buildPromptIndexMaps(messages).branchPromptIndexByMessage;
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

/**
 * 计算「从某条消息分支」时应使用的 promptIndex。
 *
 * 与 revert 的 getPromptIndexForMessageInList 不同：分支允许从 **任意** 消息发起
 * （用户消息、助手最终回复、中断消息），而不仅是 tracked user prompt。
 *
 * 规则：
 * - 点在 user prompt 上：返回该 promptIndex，语义为「回到该提示词之前」，用户可重写这一问。
 * - 点在 assistant / 中断等非 user 节点上：返回所属 user prompt 的下一位，语义为
 *   「保留到这一轮回复之后」。后端 branch_at_prompt 使用“保留第 N 个 prompt 之前的历史”，
 *   因此用 previousPromptIndex + 1 才会包含当前助手回复，而不是错误地回到本轮开始前。
 *
 * 找不到（该消息之前没有任何真实用户提示词）时返回 -1，调用方据此隐藏分支按钮。
 */
export function getBranchPromptIndexForMessageInList(
  messages: Array<ClaudeStreamMessage | unknown>,
  actualIndex: number,
): number {
  if (actualIndex < 0 || actualIndex >= messages.length) return -1;

  if (isTrackedUserPrompt(messages[actualIndex])) {
    return getPromptIndexForMessageInList(messages, actualIndex);
  }

  // 向前回溯（含自身）找最近的 tracked user prompt
  for (let i = actualIndex; i >= 0; i--) {
    if (isTrackedUserPrompt(messages[i])) {
      return getPromptIndexForMessageInList(messages, i) + 1;
    }
  }
  return -1;
}

/**
 * displayableMessages 视图版本：先用对象引用找回完整 messages 中的真实位置，
 * 再计算分支 promptIndex。供消息组件直接按渲染顺序取用。
 */
export function getBranchPromptIndexForDisplayableMessage(
  messages: Array<ClaudeStreamMessage | unknown>,
  displayableMessages: Array<ClaudeStreamMessage | unknown>,
  displayableIndex: number,
  branchIndexByMessage?: BranchPromptIndexByMessage,
): number {
  const displayableMessage = displayableMessages[displayableIndex];
  if (!displayableMessage) return -1;

  if (branchIndexByMessage && typeof displayableMessage === 'object') {
    return branchIndexByMessage.get(displayableMessage) ?? -1;
  }

  const actualIndex = messages.findIndex((message) => message === displayableMessage);
  return getBranchPromptIndexForMessageInList(messages, actualIndex);
}
