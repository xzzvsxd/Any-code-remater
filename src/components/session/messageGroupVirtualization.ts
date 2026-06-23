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

const getContentSignature = (message: ClaudeStreamMessage): string => {
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

  const strongIdentityCandidates = [
    raw.uiEventId,
    nested?.id,
    raw.id,
    raw.uuid,
    raw.leafUuid,
    raw.leaf_uuid,
    raw.session_id,
    raw.sessionId,
    raw.parent_tool_use_id,
    raw.parentToolUseId,
    firstToolUseId ? `tool:${firstToolUseId}` : undefined,
    firstToolResultId ? `tool-result:${firstToolResultId}` : undefined,
  ];

  for (const candidate of strongIdentityCandidates) {
    const part = keyPart(candidate);
    if (part) {
      return `${message.type}:${part}`;
    }
  }

  for (const timestampCandidate of [raw.timestamp, raw.receivedAt, raw.sentAt]) {
    const part = keyPart(timestampCandidate);
    if (part) {
      return `${message.type}:time:${part}:sig:${getContentSignature(message)}`;
    }
  }

  const lengthHint = contentLengthHint(content);
  return `${message.type}:idx:${fallbackIndex}:len:${lengthHint}`;
};

const getAggregatedKey = (group: Extract<MessageGroup, { type: 'aggregated' }>, fallbackIndex: number): string => {
  const messages = Array.isArray(group.messages) ? group.messages : [];
  const identities = messages
    .map((message, index) => getMessageVirtualIdentity(message, group.index + index))
    .join('|');

  if (!identities) {
    return `agg:empty:${fallbackIndex}`;
  }

  return `agg:${messages.length}:${stableHash(identities)}:${keyPart(identities) ?? fallbackIndex}`;
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
      const content = group.message?.message?.content ?? (group.message as any)?.content;
      return `normal:${getMessageVirtualIdentity(group.message, group.index)}:len:${contentLengthHint(content)}`;
    }

    if (group.type === 'subagent') {
      const subagentGroup = (group as any).group;
      return `sub:${subagentGroup?.subagentMessages?.length ?? 0}:${getMessageVirtualIdentity(subagentGroup?.taskMessage, subagentGroup?.startIndex ?? fallbackIndex)}`;
    }

    if (group.type === 'aggregated') {
      const messages = Array.isArray(group.messages) ? group.messages : [];
      const totalLength = messages.reduce((sum, message) => {
        const content = message?.message?.content ?? (message as any)?.content;
        return sum + contentLengthHint(content);
      }, 0);
      return `agg:${messages.length}:len:${totalLength}:${getMessageGroupVirtualKey(group, fallbackIndex)}`;
    }

    return `unknown:${fallbackIndex}`;
  } catch {
    return `invalid:${fallbackIndex}`;
  }
};

export const safeEstimateMessageGroupHeight = (group: MessageGroup | undefined): number => {
  try {
    const estimate = estimateMessageGroupHeight(group);
    return Number.isFinite(estimate) && estimate > 0 ? estimate : FALLBACK_ESTIMATE;
  } catch {
    return FALLBACK_ESTIMATE;
  }
};
