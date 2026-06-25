import type { ClaudeStreamMessage } from '@/types/claude';

/**
 * 用户消息对账（reconcile）：把后端 stream-json 回显的真实 user 消息与前端先行插入的
 * “乐观用户消息”(uiOptimisticPrompt) 合并为同一条，而不是各自 append。
 *
 * 背景：发送时前端立即插入一条 `uiOptimisticPrompt:true` 的 user 消息（即时反馈），
 * 随后后端会在流里回显同一条 user 消息。若两条都进列表：
 *   - 文本相同 → 用户消息重复显示；
 *   - 若改用纯文本预判去重，松紧难调，偶发把没落盘的 prompt 当“历史已有”吞掉。
 * 这里在回显到达时，于尾部窗口内按“归一化文本”定位对应的乐观消息并就地替换，
 * 一步同时消除重复与吞，且不改变数组长度/顺序（promptIndex 计数不受影响）。
 */

// 仅在尾部这么多条内寻找待对账的乐观消息：乐观消息总是紧贴发送时刻插入，
// 回显到达时它必在尾部附近。限定窗口避免误吸收历史里更早的同文本消息。
const RECONCILE_TAIL_WINDOW = 8;

/** 归一化提示词文本用于匹配：trim + 合并连续空白。与 uiOnlySessionEvents 的归一化语义一致。 */
const normalizePromptText = (value: string): string => value.trim().replace(/\s+/g, ' ');

/** 提取 user 消息的首段文本内容（兼容 string 与 text 数组两种 content 形态）。 */
const getUserMessageText = (message: ClaudeStreamMessage): string => {
  const content = message.message?.content;
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';

  return content
    .filter((item: any) => item?.type === 'text' && typeof item.text === 'string')
    .map((item: any) => item.text)
    .join('\n');
};

const isOptimisticUserMessage = (message: ClaudeStreamMessage): boolean => (
  (message as any).uiOptimisticPrompt === true && message.type === 'user'
);

/**
 * 把回显的真实 user 消息合并进消息列表。
 *
 * - 命中：在尾部窗口内找到归一化文本相同的乐观 user 消息 → 原地替换为回显消息，
 *   并统一时钟（回显的 timestamp 同时写入 sentAt，与 assistant 的 receivedAt 同源），
 *   清除 uiOptimisticPrompt/uiOnly 标记（它现在是已落盘的真实消息）。数组长度与顺序不变。
 * - 未命中：追加到末尾（与原 append 行为一致）。
 *
 * 纯函数：返回新数组（命中时浅拷贝并替换单项；未命中时 concat），不修改入参。
 */
export function reconcileEchoedUserMessage(
  prev: ClaudeStreamMessage[],
  echoed: ClaudeStreamMessage,
): ClaudeStreamMessage[] {
  const echoedText = normalizePromptText(getUserMessageText(echoed));

  // 回显无可比文本（极少见，如纯 tool_result 的 user 消息）：不做对账，直接追加。
  if (echoedText.length > 0) {
    const start = Math.max(0, prev.length - RECONCILE_TAIL_WINDOW);
    for (let i = prev.length - 1; i >= start; i -= 1) {
      const candidate = prev[i];
      if (!isOptimisticUserMessage(candidate)) continue;
      if (normalizePromptText(getUserMessageText(candidate)) !== echoedText) continue;

      // 命中：用回显消息替换乐观消息，统一时钟、清除乐观标记。
      const sentAt = candidate.sentAt
        || (echoed as any).sentAt
        || echoed.timestamp
        || (candidate as any).timestamp;

      const reconciled: ClaudeStreamMessage = {
        ...echoed,
        // 保留乐观消息的发送时刻作为 sentAt，使 user/assistant 落在同一时钟，避免历史重排时堆叠。
        ...(sentAt ? { sentAt } : {}),
        uiOptimisticPrompt: false,
        uiOnly: false,
        // 保留乐观消息的翻译信息（回显不带 translationMeta），避免替换后丢失译文展示。
        translationMeta: echoed.translationMeta ?? candidate.translationMeta,
      };

      const next = prev.slice();
      next[i] = reconciled;
      return next;
    }
  }

  return prev.concat(echoed);
}
