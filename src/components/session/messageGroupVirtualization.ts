import type { MessageGroup } from "@/lib/subagentGrouping";
import type { ClaudeStreamMessage } from "@/types/claude";
import { estimateMessageGroupHeight } from "./messageHeightEstimate";

const FALLBACK_ESTIMATE = 220;
const MAX_KEY_PART_LENGTH = 96;

const stableHash = (value: string): string => {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
};

const stableHashParts = (parts: Iterable<string>): string => {
  let hash = 2166136261;
  for (const part of parts) {
    for (let index = 0; index < part.length; index += 1) {
      hash ^= part.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    hash ^= 10; // 分隔符，避免 ['ab','c'] 与 ['a','bc'] 碰撞到同一字符流
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
};

const keyPart = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length <= MAX_KEY_PART_LENGTH) {
    return trimmed.replace(/\s+/g, ' ');
  }
  return `${trimmed.slice(0, 48)}#${stableHash(trimmed)}`;
};

const contentLengthHint = (value: unknown, depth = 0): number => {
  if (value == null || depth > 3) return 0;
  if (typeof value === 'string') return value.length;
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value).length;
  }
  if (Array.isArray(value)) {
    let total = 0;
    for (const item of value.slice(0, 32)) {
      total += contentLengthHint(item, depth + 1);
    }
    return total + value.length;
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    let total = Object.keys(record).length;
    for (const field of ['text', 'content', 'message', 'thinking', 'result', 'name', 'type']) {
      total += contentLengthHint(record[field], depth + 1);
    }
    return total;
  }
  return 0;
};

const contentPreview = (value: unknown, depth = 0): string => {
  if (value == null || depth > 2) return '';
  if (typeof value === 'string') return value.slice(0, 160);
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value);
  }
  if (Array.isArray(value)) {
    return value.slice(0, 6).map((item) => contentPreview(item, depth + 1)).join('|');
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const parts: string[] = [];
    for (const field of ['type', 'text', 'content', 'message', 'thinking', 'result', 'name']) {
      const preview = contentPreview(record[field], depth + 1);
      if (preview) parts.push(`${field}:${preview}`);
    }
    return parts.join('|');
  }
  return '';
};

const getContentSignature = (message: ClaudeStreamMessage | undefined): string => {
  if (!message) return 'missing';
  const raw = message as any;
  const content = raw.message?.content ?? raw.content;
  return `${contentLengthHint(content)}:${stableHash(contentPreview(content))}`;
};

export const getMessageVirtualIdentity = (
  message: ClaudeStreamMessage | undefined,
  fallbackIndex: number,
): string => {
  if (!message) return `missing:${fallbackIndex}`;

  const raw = message as any;
  const nested = raw.message as Record<string, unknown> | undefined;
  const content = nested?.content ?? raw.content;
  const firstToolUseId = Array.isArray(content)
    ? content.find((item: any) => item?.type === 'tool_use' && typeof item.id === 'string')?.id
    : undefined;
  const firstToolResultId = Array.isArray(content)
    ? content.find((item: any) => item?.type === 'tool_result' && typeof item.tool_use_id === 'string')?.tool_use_id
    : undefined;

  // 强 identity 候选分两类：
  // - 行级唯一标识（uuid/leafUuid/uiEventId/工具调用 id）：每条 JSONL 行各不相同，
  //   作为虚拟行 key 跨 index 平移时仍稳定，不加位置后缀。
  // - 回合级/会话级标识（message.id/id/session_id/parent_tool_use_id）：同一 assistant 回合的
  //   多条行（正文块、thinking、多个 tool_use）**共享同一个 message.id**，整会话共享同一 session_id。
  //   直接用它们做 key 会让多条物理消息碰撞成同一行 → 虚拟列表重复渲染 + 行错位（本 bug 根因）。
  //   因此这类候选必须追加 `:pos:${fallbackIndex}` 位置后缀，保证行级唯一。
  const uniqueIdentityCandidates = [
    raw.uiEventId,
    raw.uuid,
    raw.leafUuid,
    raw.leaf_uuid,
    firstToolUseId ? `tool:${firstToolUseId}` : undefined,
    firstToolResultId ? `tool-result:${firstToolResultId}` : undefined,
  ];

  for (const candidate of uniqueIdentityCandidates) {
    const part = keyPart(candidate);
    if (part) {
      return `${message.type}:${part}`;
    }
  }

  // 回合级/会话级标识：可能跨行重复，附加位置后缀避免虚拟行 key 碰撞。
  const sharedIdentityCandidates = [
    nested?.id,
    raw.id,
    raw.session_id,
    raw.sessionId,
    raw.parent_tool_use_id,
    raw.parentToolUseId,
  ];

  for (const candidate of sharedIdentityCandidates) {
    const part = keyPart(candidate);
    if (part) {
      return `${message.type}:shared:${part}:pos:${fallbackIndex}`;
    }
  }

  for (const timestampCandidate of [raw.timestamp, raw.receivedAt, raw.sentAt]) {
    const part = keyPart(timestampCandidate);
    if (part) {
      return `${message.type}:time:${part}:sig:${getContentSignature(message)}:pos:${fallbackIndex}`;
    }
  }

  const lengthHint = contentLengthHint(content);
  return `${message.type}:idx:${fallbackIndex}:len:${lengthHint}`;
};

const getAggregatedKey = (group: Extract<MessageGroup, { type: 'aggregated' }>, fallbackIndex: number): string => {
  const messages = Array.isArray(group.messages) ? group.messages : [];
  const firstMessage = messages[0];
  if (!firstMessage) {
    return `agg:empty:${fallbackIndex}`;
  }

  // 聚合行的 React identity 必须固定在首条技术消息上。流式期间后续 tool/thinking
  // 事件会持续追加到同一行；若把消息数量或整组指纹放进 key，每次追加都会卸载整行，
  // ToolCallsGroup 的用户展开状态也会随之重置。内容变化由 render revision / measurement
  // key 单独追踪，虚拟列表仍会正确重新渲染和测高。
  return `agg:${getMessageVirtualIdentity(firstMessage, group.index ?? fallbackIndex)}`;
};

export const getMessageGroupVirtualKey = (
  group: MessageGroup | undefined,
  fallbackIndex: number,
): string => {
  try {
    if (!group) return `idx:${fallbackIndex}`;

    if (group.type === 'normal') {
      return `normal:${getMessageVirtualIdentity(group.message, group.index)}`;
    }

    if (group.type === 'subagent') {
      const subagentGroup = (group as any).group;
      const id =
        keyPart(subagentGroup?.id) ??
        keyPart(subagentGroup?.taskToolUseId) ??
        keyPart(getMessageVirtualIdentity(subagentGroup?.taskMessage, subagentGroup?.startIndex ?? fallbackIndex));
      return `sub:${id ?? `invalid:${fallbackIndex}`}`;
    }

    if (group.type === 'aggregated') {
      return getAggregatedKey(group, fallbackIndex);
    }

    return `unknown:${fallbackIndex}`;
  } catch {
    return `invalid:${fallbackIndex}`;
  }
};

export const getMessageGroupRenderRevision = (
  group: MessageGroup | undefined,
  fallbackIndex: number,
): string => {
  try {
    if (!group) return `missing:${fallbackIndex}`;

    if (group.type === 'normal') {
      return `normal:${getMessageVirtualIdentity(group.message, group.index)}:sig:${getContentSignature(group.message)}`;
    }

    if (group.type === 'subagent') {
      const subagentGroup = (group as any).group;
      const subagentMessages = Array.isArray(subagentGroup?.subagentMessages)
        ? subagentGroup.subagentMessages
        : [];
      const subagentSignature = stableHashParts(
        subagentMessages.map((message: ClaudeStreamMessage) => getContentSignature(message)),
      );
      return `sub:${subagentMessages.length}:sig:${subagentSignature}:${getMessageVirtualIdentity(subagentGroup?.taskMessage, subagentGroup?.startIndex ?? fallbackIndex)}`;
    }

    if (group.type === 'aggregated') {
      const messages = Array.isArray(group.messages) ? group.messages : [];
      const aggregateSignature = stableHashParts(
        messages.map((message) => `${getMessageVirtualIdentity(message, fallbackIndex)}:${getContentSignature(message)}`),
      );
      return `agg:${messages.length}:sig:${aggregateSignature}:${getMessageGroupVirtualKey(group, fallbackIndex)}`;
    }

    return `unknown:${fallbackIndex}`;
  } catch {
    return `invalid:${fallbackIndex}`;
  }
};

/**
 * 高度测量缓存 key 必须比虚拟行 identity 更细。
 *
 * react-virtual 的 getItemKey 需要稳定，避免历史回填/聚合重排时按 index 串行；
 * 但行内容、Thinking 折叠、工具结果到达后，同一个稳定 identity 的真实高度会变。
 * 因此外部 measuredHeightsRef 不能只按 virtual key 复用旧高度，否则会出现：
 * - 旧高度过小：后续行 translateY(start) 提前，消息互相重叠；
 * - 旧高度过大：getTotalSize 被撑大，底部/中间留下大片空白。
 */
export const getMessageGroupMeasurementCacheKey = (
  group: MessageGroup | undefined,
  fallbackIndex: number,
): string => {
  const virtualKey = getMessageGroupVirtualKey(group, fallbackIndex);
  const revision = getMessageGroupRenderRevision(group, fallbackIndex);
  return `${virtualKey}::rev:${stableHash(revision)}`;
};

/**
 * 当前消息列表的“高度相关渲染签名”。
 *
 * 用于发现离屏行内容变更：这些行没有 DOM/ResizeObserver，TanStack 内部 itemSizeCache
 * 不会自动失效；签名变化时需要清内部 size cache，再靠 revision-keyed 外部缓存保留未变行高度。
 */
export const getMessageGroupsRenderSignature = (
  groups: readonly MessageGroup[],
): string => {
  return `${groups.length}:${stableHashParts(
    groups.map((group, index) => getMessageGroupMeasurementCacheKey(group, index)),
  )}`;
};

export const safeEstimateMessageGroupHeight = (group: MessageGroup | undefined): number => {
  try {
    const estimate = estimateMessageGroupHeight(group);
    return Number.isFinite(estimate) && estimate > 0 ? estimate : FALLBACK_ESTIMATE;
  } catch {
    return FALLBACK_ESTIMATE;
  }
};
