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

const getMessageIdentity = (message: ClaudeStreamMessage): string => {
  const explicitId = (message as LegacyAny).uiEventId || (message as LegacyAny).id;
  if (typeof explicitId === 'string' && explicitId.trim()) {
    return `id:${explicitId}`;
  }

  return [
    message.type || '',
    message.subtype || '',
    message.engine || '',
    message.timestamp || '',
    message.receivedAt || '',
    typeof message.result === 'string' ? message.result : JSON.stringify(message.result ?? ''),
  ].join('\u001f');
};

const getMessageTime = (message: ClaudeStreamMessage): number => {
  const raw = message.receivedAt || message.sentAt || message.timestamp;
  if (typeof raw !== 'string') return Number.NaN;
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
};

const sortUiOnlyMessagesByTime = (messages: ClaudeStreamMessage[]): ClaudeStreamMessage[] => messages
  .map((message, index) => ({ message, index, time: getMessageTime(message) }))
  .sort((a, b) => {
    const leftHasTime = Number.isFinite(a.time);
    const rightHasTime = Number.isFinite(b.time);
    if (leftHasTime && rightHasTime && a.time !== b.time) return a.time - b.time;
    if (leftHasTime !== rightHasTime) return leftHasTime ? -1 : 1;
    return a.index - b.index;
  })
  .map(item => item.message);

const findUiOnlyInsertIndex = (
  historyTimes: number[],
  hasKnownHistoryTime: boolean,
  uiOnlyTime: number,
): number => {
  if (!hasKnownHistoryTime || !Number.isFinite(uiOnlyTime)) {
    return historyTimes.length - 1;
  }

  for (let index = historyTimes.length - 1; index >= 0; index -= 1) {
    const historyTime = historyTimes[index];
    if (Number.isFinite(historyTime) && historyTime <= uiOnlyTime) {
      return index;
    }
  }

  return -1;
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

export function mergeUiOnlySessionMessages(
  historyMessages: ClaudeStreamMessage[],
  uiOnlyMessages: ClaudeStreamMessage[],
): ClaudeStreamMessage[] {
  if (uiOnlyMessages.length === 0) return historyMessages;
  if (historyMessages.length === 0) {
    return sortUiOnlyMessagesByTime(uiOnlyMessages.map(normalizeUiOnlySessionMessage));
  }

  const seen = new Set(historyMessages.map(getMessageIdentity));
  const dedupedUiOnlyMessages: ClaudeStreamMessage[] = [];

  for (const message of uiOnlyMessages.map(normalizeUiOnlySessionMessage)) {
    const identity = getMessageIdentity(message);
    if (seen.has(identity)) continue;
    seen.add(identity);
    dedupedUiOnlyMessages.push(message);
  }

  if (dedupedUiOnlyMessages.length === 0) return historyMessages;

  // 历史消息来自 append-only JSONL，数组顺序就是对话顺序，不能为了插入
  // 前端 UI-only 完成/错误提醒而对全量历史做 sort。全量 sort 不仅会把
  // timestamp 缺失或不单调的历史打乱，也会让长会话反复 Date.parse + O(N log N)。
  // 这里仅对最多 50 条 UI-only 事件排序，再按时间插入；历史消息相对顺序永不改变。
  const historyTimes = historyMessages.map(getMessageTime);
  const hasKnownHistoryTime = historyTimes.some(Number.isFinite);
  const uiOnlyByInsertIndex = new Map<number, ClaudeStreamMessage[]>();

  for (const message of sortUiOnlyMessagesByTime(dedupedUiOnlyMessages)) {
    const insertIndex = findUiOnlyInsertIndex(
      historyTimes,
      hasKnownHistoryTime,
      getMessageTime(message),
    );
    const bucket = uiOnlyByInsertIndex.get(insertIndex) ?? [];
    bucket.push(message);
    uiOnlyByInsertIndex.set(insertIndex, bucket);
  }

  const merged: ClaudeStreamMessage[] = [];
  const beforeFirst = uiOnlyByInsertIndex.get(-1);
  if (beforeFirst) merged.push(...beforeFirst);

  historyMessages.forEach((message, index) => {
    merged.push(message);
    const afterCurrent = uiOnlyByInsertIndex.get(index);
    if (afterCurrent) merged.push(...afterCurrent);
  });

  return merged;
}
