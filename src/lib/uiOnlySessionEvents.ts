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
  const raw = message.receivedAt || message.timestamp;
  if (typeof raw !== 'string') return Number.NaN;
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
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
  if (historyMessages.length === 0) return uiOnlyMessages.map(normalizeUiOnlySessionMessage);

  const merged = [...historyMessages];
  const seen = new Set(merged.map(getMessageIdentity));

  for (const message of uiOnlyMessages.map(normalizeUiOnlySessionMessage)) {
    const identity = getMessageIdentity(message);
    if (seen.has(identity)) continue;
    seen.add(identity);
    merged.push(message);
  }

  return merged.sort((a, b) => {
    const left = getMessageTime(a);
    const right = getMessageTime(b);
    if (!Number.isFinite(left) || !Number.isFinite(right) || left === right) return 0;
    return left - right;
  });
}
