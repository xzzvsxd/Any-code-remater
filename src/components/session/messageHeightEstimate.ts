import type { MessageGroup } from "@/lib/subagentGrouping";
import type { ClaudeStreamMessage } from "@/types/claude";

export const SESSION_MESSAGES_OVERSCAN = 6;

const DEFAULT_ESTIMATE = 220;
const MAX_NORMAL_MESSAGE_ESTIMATE = 1_200;
const MAX_AGGREGATED_ESTIMATE = 1_000;
const MAX_SUBAGENT_ESTIMATE = 900;
const TEXT_SCAN_CHARS = 20_000;
const TEXT_LINE_CAP = 80;
const CHARS_PER_VISUAL_LINE = 96;
const LINE_HEIGHT = 22;

interface TextStats {
  chars: number;
  lines: number;
  hasCodeFence: boolean;
  toolUses: number;
  toolResults: number;
  thinkingBlocks: number;
  images: number;
}

const EMPTY_TEXT_STATS: TextStats = {
  chars: 0,
  lines: 0,
  hasCodeFence: false,
  toolUses: 0,
  toolResults: 0,
  thinkingBlocks: 0,
  images: 0,
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const mergeStats = (target: TextStats, source: TextStats) => {
  target.chars += source.chars;
  target.lines += source.lines;
  target.hasCodeFence = target.hasCodeFence || source.hasCodeFence;
  target.toolUses += source.toolUses;
  target.toolResults += source.toolResults;
  target.thinkingBlocks += source.thinkingBlocks;
  target.images += source.images;
};

const getStringStats = (text: string): TextStats => {
  const scanLength = Math.min(text.length, TEXT_SCAN_CHARS);
  const sample = text.slice(0, scanLength);
  let explicitLines = 1;
  for (let index = 0; index < scanLength; index += 1) {
    if (text.charCodeAt(index) === 10) {
      explicitLines += 1;
      if (explicitLines >= TEXT_LINE_CAP) {
        break;
      }
    }
  }

  const estimatedWrappedLines = Math.ceil(text.length / CHARS_PER_VISUAL_LINE);
  const lines = clamp(Math.max(explicitLines, estimatedWrappedLines), text.length > 0 ? 1 : 0, TEXT_LINE_CAP);

  return {
    ...EMPTY_TEXT_STATS,
    chars: text.length,
    lines,
    hasCodeFence: sample.includes('```') || sample.includes('~~~'),
  };
};

const estimateObjectTextStats = (value: unknown, depth = 0): TextStats => {
  const stats: TextStats = { ...EMPTY_TEXT_STATS };
  if (value == null || depth > 3) {
    return stats;
  }

  if (typeof value === 'string') {
    return getStringStats(value);
  }

  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return getStringStats(String(value));
  }

  if (Array.isArray(value)) {
    for (const item of value.slice(0, 32)) {
      mergeStats(stats, estimateObjectTextStats(item, depth + 1));
      if (stats.chars > TEXT_SCAN_CHARS) break;
    }
    return stats;
  }

  if (typeof value !== 'object') {
    return stats;
  }

  const record = value as Record<string, unknown>;
  for (const field of ['text', 'content', 'message', 'thinking']) {
    if (typeof record[field] === 'string') {
      mergeStats(stats, getStringStats(record[field] as string));
      return stats;
    }
  }

  let visited = 0;
  for (const key in record) {
    mergeStats(stats, estimateObjectTextStats(record[key], depth + 1));
    visited += 1;
    if (visited >= 24 || stats.chars > TEXT_SCAN_CHARS) break;
  }
  return stats;
};

const getMessageContentStats = (message: ClaudeStreamMessage | undefined): TextStats => {
  const stats: TextStats = { ...EMPTY_TEXT_STATS };
  if (!message) return stats;

  const content = message.message?.content ?? (message as any).content;
  if (typeof content === 'string') {
    return getStringStats(content);
  }

  if (!Array.isArray(content)) {
    return estimateObjectTextStats(content);
  }

  for (const item of content) {
    if (!item || typeof item !== 'object') {
      mergeStats(stats, estimateObjectTextStats(item));
      continue;
    }

    const part = item as Record<string, unknown>;
    switch (part.type) {
      case 'text':
        mergeStats(stats, estimateObjectTextStats(part.text));
        break;
      case 'thinking':
        stats.thinkingBlocks += 1;
        mergeStats(stats, estimateObjectTextStats(part.thinking ?? part.text ?? part.content));
        break;
      case 'tool_use':
        stats.toolUses += 1;
        mergeStats(stats, estimateObjectTextStats(part.input));
        break;
      case 'tool_result':
        stats.toolResults += 1;
        mergeStats(stats, estimateObjectTextStats(part.content ?? part.result));
        break;
      case 'image':
      case 'image_url':
        stats.images += 1;
        break;
      default:
        mergeStats(stats, estimateObjectTextStats(part));
        break;
    }
  }

  return stats;
};

const estimateAssistantHeight = (message: ClaudeStreamMessage): number => {
  const stats = getMessageContentStats(message);
  const base = 104;

  // 大内容已在 MessageContent 内走 max-height 预览，估高也按预览态计算，避免虚拟总高巨大跳变。
  const veryLargePreview = stats.chars > 120_000 || stats.lines >= TEXT_LINE_CAP;
  const textHeight = veryLargePreview
    ? 560
    : clamp(stats.lines * LINE_HEIGHT, stats.chars > 0 ? LINE_HEIGHT : 0, 880);

  const chrome =
    (stats.hasCodeFence ? 140 : 0)
    + stats.toolUses * 72
    + stats.toolResults * 56
    + stats.thinkingBlocks * 110
    + stats.images * 160;

  return clamp(base + textHeight + chrome, 120, MAX_NORMAL_MESSAGE_ESTIMATE);
};

const estimateUserHeight = (message: ClaudeStreamMessage): number => {
  const stats = getMessageContentStats(message);
  const collapsed = stats.lines > 5 || stats.chars > 1_000;
  const textHeight = collapsed ? 112 : clamp(stats.lines * 20, 24, 140);
  return clamp(78 + textHeight + stats.images * 150, 120, 260);
};

const estimateNormalMessageHeight = (message: ClaudeStreamMessage | undefined): number => {
  if (!message) return DEFAULT_ESTIMATE;

  if (message.type === 'system') {
    const stats = getMessageContentStats(message);
    return clamp(76 + stats.lines * 18, 80, 320);
  }

  if (message.type === 'user') {
    return estimateUserHeight(message);
  }

  if (message.type === 'assistant') {
    return estimateAssistantHeight(message);
  }

  if (message.type === 'summary') return 160;
  if (message.type === 'result') return 140;
  if (message.type === 'thinking') return 180;
  return DEFAULT_ESTIMATE;
};

export function estimateMessageGroupHeight(group: MessageGroup | undefined): number {
  if (!group) return DEFAULT_ESTIMATE;

  if (group.type === 'normal') {
    return estimateNormalMessageHeight(group.message);
  }

  if (group.type === 'subagent') {
    const subagentCount = group.group.subagentMessages.length;
    return clamp(420 + subagentCount * 24, 420, MAX_SUBAGENT_ESTIMATE);
  }

  if (group.type === 'aggregated') {
    const total = group.messages.reduce((sum, message) => sum + estimateNormalMessageHeight(message), 64);
    return clamp(total, 140, MAX_AGGREGATED_ESTIMATE);
  }

  return DEFAULT_ESTIMATE;
}
