import type { ClaudeStreamMessage } from '../types/claude';

export type UiOnlySessionEngine = 'claude' | 'codex' | 'gemini';

export interface UiOnlyStorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
}

export interface UiOnlySessionMessageParams {
  sessionId?: string | null;
  projectPath?: string | null;
  engine?: UiOnlySessionEngine | null;
  storage?: UiOnlyStorageLike | null;
}

export interface PersistUiOnlySessionMessageParams extends UiOnlySessionMessageParams {
  message: ClaudeStreamMessage;
}

const STORAGE_PREFIX = 'any-code-ui-session-events:v1';
const MAX_EVENTS_PER_SESSION = 50;

const isSupportedEngine = (engine: unknown): engine is UiOnlySessionEngine => (
  engine === 'claude' || engine === 'codex' || engine === 'gemini'
);

const getStorage = (storage?: UiOnlyStorageLike | null): UiOnlyStorageLike | null => {
  if (storage) return storage;

  const candidate = (globalThis as { localStorage?: UiOnlyStorageLike }).localStorage;
  return candidate ?? null;
};

const stableHash = (value: string): string => {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
};

// 用户消息无 timestamp/receivedAt，仅靠 type+subtype 会让多条用户消息 identity 碰撞被误去重。
// 取首段文本参与身份计算，保证不同用户消息身份唯一。
const getIdentityFirstText = (message: ClaudeStreamMessage): string => {
  const content = message.message?.content;
  if (!Array.isArray(content)) return '';
  const textPart = content.find((c: any) => c?.type === 'text');
  const text = textPart && typeof (textPart as any).text === 'string' ? (textPart as any).text : '';
  return text.slice(0, 120);
};

const getFullFirstText = (message: ClaudeStreamMessage): string => {
  const content = message.message?.content;
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  const textPart = content.find((c: any) => c?.type === 'text');
  const text = textPart && typeof (textPart as any).text === 'string'
    ? (textPart as any).text
    : textPart && typeof (textPart as any).content === 'string'
      ? (textPart as any).content
      : '';
  return text;
};

const normalizePromptText = (value: string): string => value.trim().replace(/\s+/g, ' ');

const getMessageIdentity = (message: ClaudeStreamMessage): string => {
  const explicitId = (message as any).uiEventId || (message as any).id;
  if (typeof explicitId === 'string' && explicitId.trim()) {
    return `id:${explicitId}`;
  }

  return [
    message.type || '',
    message.subtype || '',
    message.engine || '',
    message.timestamp || '',
    message.receivedAt || '',
    (message as any).sentAt || '',
    getIdentityFirstText(message),
    typeof message.result === 'string' ? message.result : JSON.stringify(message.result ?? ''),
  ].join('\u001f');
};

const getMessageTime = (message: ClaudeStreamMessage): number => {
  // 用户消息只写 sentAt（见 usePromptExecution 创建逻辑），助手/系统消息用 receivedAt/timestamp。
  // 回退链必须覆盖 sentAt，否则用户消息取不到时间戳 → NaN → 排序错位堆叠到顶部。
  const raw = message.receivedAt || message.timestamp || (message as any).sentAt;
  if (typeof raw !== 'string') return Number.NaN;
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
};

const isUiOnly = (message: ClaudeStreamMessage): boolean => (message as any).uiOnly === true;

const isLocalSubmittedPrompt = (message: ClaudeStreamMessage): boolean => (
  (message as any).uiOptimisticPrompt === true
  && (message.type === 'user' || (message.type === 'system' && message.subtype === 'command-meta'))
  && normalizePromptText(getFullFirstText(message)).length > 0
);

const getSubmittedPromptIdentity = (message: ClaudeStreamMessage): string | null => {
  if (message.type !== 'user' && !(message.type === 'system' && message.subtype === 'command-meta')) {
    return null;
  }

  const text = normalizePromptText(getFullFirstText(message));
  if (!text) return null;

  return [
    message.type,
    message.subtype || '',
    message.engine || '',
    text,
  ].join('\u001f');
};

const maxNonUiOnlyMessageTime = (messages: ClaudeStreamMessage[]): number => (
  messages.reduce((max, message) => {
    if (isUiOnly(message)) return max;
    const time = getMessageTime(message);
    return Number.isFinite(time) && time > max ? time : max;
  }, Number.NEGATIVE_INFINITY)
);

const loadedHistoryAlreadyContainsPrompt = (
  loadedMessages: ClaudeStreamMessage[],
  candidate: ClaudeStreamMessage,
): boolean => {
  const candidateIdentity = getSubmittedPromptIdentity(candidate);
  if (!candidateIdentity) return true;

  const candidateTime = getMessageTime(candidate);
  const loadedRealCutoff = maxNonUiOnlyMessageTime(loadedMessages);

  // 如果当前历史的真实消息时间线还停在本地提交之前，说明这是“历史加载晚到”
  // 的旧快照；即使旧历史里有相同文本，也不能用纯文本去重，否则用户连续发
  // 两次相同 prompt 时第二条会被吞。
  if (
    Number.isFinite(candidateTime)
    && Number.isFinite(loadedRealCutoff)
    && candidateTime > loadedRealCutoff + 250
  ) {
    return false;
  }

  return loadedMessages.some((message) => {
    if (isUiOnly(message)) return false;
    return getSubmittedPromptIdentity(message) === candidateIdentity;
  });
};

export function getUiOnlySessionEventsStorageKey(params: UiOnlySessionMessageParams): string | null {
  const engine = isSupportedEngine(params.engine) ? params.engine : 'claude';
  const sessionId = params.sessionId?.trim();
  if (sessionId) {
    return `${STORAGE_PREFIX}:${engine}:session:${encodeURIComponent(sessionId)}`;
  }

  const projectPath = params.projectPath?.trim();
  if (projectPath) {
    return `${STORAGE_PREFIX}:${engine}:project:${stableHash(projectPath)}`;
  }

  return null;
}

export function normalizeUiOnlySessionMessage(message: ClaudeStreamMessage): ClaudeStreamMessage {
  return {
    ...message,
    type: message.type || 'system',
    uiOnly: true,
    excludeFromAiContext: true,
  } as ClaudeStreamMessage;
}

export function loadUiOnlySessionMessages(params: UiOnlySessionMessageParams): ClaudeStreamMessage[] {
  const storage = getStorage(params.storage);
  const key = getUiOnlySessionEventsStorageKey(params);
  if (!storage || !key) return [];

  try {
    const raw = storage.getItem(key);
    if (!raw) return [];

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    return parsed
      .filter((entry): entry is ClaudeStreamMessage => entry && typeof entry === 'object')
      .map(normalizeUiOnlySessionMessage);
  } catch (err) {
    console.warn('[uiOnlySessionEvents] Failed to load UI-only session messages:', err);
    storage.removeItem?.(key);
    return [];
  }
}

export function persistUiOnlySessionMessage(params: PersistUiOnlySessionMessageParams): boolean {
  const storage = getStorage(params.storage);
  const key = getUiOnlySessionEventsStorageKey(params);
  if (!storage || !key) return false;

  try {
    const existing = loadUiOnlySessionMessages(params);
    const nextMessage = normalizeUiOnlySessionMessage(params.message);
    const nextIdentity = getMessageIdentity(nextMessage);
    const withoutDuplicate = existing.filter(message => getMessageIdentity(message) !== nextIdentity);
    const nextMessages = [...withoutDuplicate, nextMessage].slice(-MAX_EVENTS_PER_SESSION);

    storage.setItem(key, JSON.stringify(nextMessages));
    return true;
  } catch (err) {
    console.warn('[uiOnlySessionEvents] Failed to persist UI-only session message:', err);
    return false;
  }
}

export function pruneUiOnlySessionMessagesAfter(
  params: UiOnlySessionMessageParams,
  cutoffTimeMs: number,
): boolean {
  const storage = getStorage(params.storage);
  const key = getUiOnlySessionEventsStorageKey(params);
  if (!storage || !key) return false;
  if (!Number.isFinite(cutoffTimeMs)) return false;

  try {
    const existing = loadUiOnlySessionMessages(params);
    if (existing.length === 0) return true;
    // 撤回后裁剪：剔除「晚于撤回保留边界」的 UI-only 事件（如"✅ 本次执行完成，用时 X"），
    // 否则后端截断了会话 JSONL，但这些独立存于 localStorage 的事件仍会被 merge 回来而残留。
    // 无有效时间戳的事件一律保留（无法判定先后，从宽不误删）。
    const kept = existing.filter((message) => {
      const t = getMessageTime(message);
      if (!Number.isFinite(t)) return true;
      return t <= cutoffTimeMs;
    });
    if (kept.length === existing.length) return true;
    storage.setItem(key, JSON.stringify(kept));
    return true;
  } catch (err) {
    console.warn('[uiOnlySessionEvents] Failed to prune UI-only session messages:', err);
    return false;
  }
}

export function mergeUiOnlySessionMessages(
  historyMessages: ClaudeStreamMessage[],
  uiOnlyMessages: ClaudeStreamMessage[],
): ClaudeStreamMessage[] {
  if (uiOnlyMessages.length === 0) return historyMessages;

  const seen = new Set(historyMessages.map(getMessageIdentity));
  const uniqueUiMessages: Array<{
    message: ClaudeStreamMessage;
    time: number;
    order: number;
  }> = [];

  for (const sourceMessage of uiOnlyMessages) {
    const message = normalizeUiOnlySessionMessage(sourceMessage);
    const identity = getMessageIdentity(message);
    if (seen.has(identity)) continue;
    seen.add(identity);
    uniqueUiMessages.push({
      message,
      time: getMessageTime(message),
      order: uniqueUiMessages.length,
    });
  }

  if (uniqueUiMessages.length === 0) return historyMessages;
  if (historyMessages.length === 0) {
    return uniqueUiMessages.map(entry => entry.message);
  }

  // JSONL 物理行序是不可移动的骨架。真实历史里普遍存在时间戳回退、相同或缺失，
  // 因此不能用一个“真实消息比 index、混合消息比 timestamp”的非传递 comparator
  // 对整表排序；那会让 UI-only 事件跨过错误的真实行，并让提示词索引看起来乱序。
  //
  // UI-only 事件上限为 50。逐事件扫描骨架既保留精确物理顺序，又把最坏工作量
  // 限定为 O(history × 50)，无需复制或排序真实历史。
  const historyTimes = historyMessages.map(getMessageTime);
  const buckets: Array<Array<typeof uniqueUiMessages[number]>> = Array.from(
    { length: historyMessages.length + 1 },
    () => [],
  );

  for (const entry of uniqueUiMessages) {
    // 无有效时间的 UI-only 事件稳定追加到时间线末尾。
    let bucketIndex = historyMessages.length;
    if (Number.isFinite(entry.time)) {
      bucketIndex = 0;
      // 插到物理顺序中“最后一个时间 <= 事件时间”的消息后面。
      // 即使中间时间戳回退，也绝不移动任何已有消息。
      for (let index = 0; index < historyTimes.length; index += 1) {
        const historyTime = historyTimes[index];
        if (Number.isFinite(historyTime) && historyTime <= entry.time) {
          bucketIndex = index + 1;
        }
      }
    }
    buckets[bucketIndex].push(entry);
  }

  // 同一物理插入位内按有效时间 + 原 UI-only 顺序稳定排列。
  for (const bucket of buckets) {
    bucket.sort((left, right) => {
      const leftHasTime = Number.isFinite(left.time);
      const rightHasTime = Number.isFinite(right.time);
      if (leftHasTime && rightHasTime && left.time !== right.time) {
        return left.time - right.time;
      }
      if (leftHasTime !== rightHasTime) return leftHasTime ? -1 : 1;
      return left.order - right.order;
    });
  }

  const merged: ClaudeStreamMessage[] = [];
  merged.push(...buckets[0].map(entry => entry.message));
  historyMessages.forEach((message, index) => {
    merged.push(message, ...buckets[index + 1].map(entry => entry.message));
  });
  return merged;
}

export function mergePendingLocalSubmittedPrompts(
  loadedMessages: ClaudeStreamMessage[],
  currentMessages: ClaudeStreamMessage[],
): ClaudeStreamMessage[] {
  const pendingPrompts = currentMessages.filter(isLocalSubmittedPrompt);
  if (pendingPrompts.length === 0) return loadedMessages;

  const loadedIdentities = new Set(loadedMessages.map(getMessageIdentity));
  const promptsToKeep: ClaudeStreamMessage[] = [];

  for (const prompt of pendingPrompts) {
    const normalizedPrompt = normalizeUiOnlySessionMessage(prompt);
    const identity = getMessageIdentity(normalizedPrompt);
    if (loadedIdentities.has(identity)) {
      continue;
    }

    if (loadedHistoryAlreadyContainsPrompt(loadedMessages, normalizedPrompt)) {
      continue;
    }

    loadedIdentities.add(identity);
    promptsToKeep.push(normalizedPrompt);
  }

  if (promptsToKeep.length === 0) return loadedMessages;
  return mergeUiOnlySessionMessages(loadedMessages, promptsToKeep);
}
