export interface IdlePersistScheduler<T> {
  /** Schedule a value to be persisted when the main thread is idle. */
  schedule: (value: T) => void;
  /** Persist the latest pending value immediately. */
  flush: () => void;
  /** Cancel pending work without writing it. */
  dispose: () => void;
}

export interface IdlePersistSchedulerOptions {
  requestIdleCallbackFn?: typeof globalThis.requestIdleCallback;
  cancelIdleCallbackFn?: typeof globalThis.cancelIdleCallback;
  setTimeoutFn?: typeof globalThis.setTimeout;
  clearTimeoutFn?: typeof globalThis.clearTimeout;
  /** requestIdleCallback timeout. */
  idleTimeoutMs?: number;
  /** Fallback delay when requestIdleCallback is unavailable. */
  fallbackDelayMs?: number;
}

const DEFAULT_IDLE_TIMEOUT_MS = 1_000;
const DEFAULT_FALLBACK_DELAY_MS = 120;

const getRequestIdleCallback = (
  explicit: IdlePersistSchedulerOptions['requestIdleCallbackFn'],
): IdlePersistSchedulerOptions['requestIdleCallbackFn'] => {
  if (explicit) return explicit;
  return typeof globalThis.requestIdleCallback === 'function'
    ? globalThis.requestIdleCallback.bind(globalThis)
    : undefined;
};

const getCancelIdleCallback = (
  explicit: IdlePersistSchedulerOptions['cancelIdleCallbackFn'],
): IdlePersistSchedulerOptions['cancelIdleCallbackFn'] => {
  if (explicit) return explicit;
  return typeof globalThis.cancelIdleCallback === 'function'
    ? globalThis.cancelIdleCallback.bind(globalThis)
    : undefined;
};

/**
 * Coalesces synchronous persistence work onto idle time.
 *
 * localStorage writes block the UI thread.  Tab metadata can change in short
 * bursts (new tab → project path → session id → auto title), so writing every
 * intermediate state wastes main-thread time and can amplify sidebar jank.
 * This scheduler keeps only the latest value, writes it during idle time, and
 * exposes flush() so callers can still persist the final state on unmount.
 */
export function createIdlePersistScheduler<T>(
  write: (value: T) => void,
  options: IdlePersistSchedulerOptions = {},
): IdlePersistScheduler<T> {
  const requestIdleCallbackFn = getRequestIdleCallback(options.requestIdleCallbackFn);
  const cancelIdleCallbackFn = getCancelIdleCallback(options.cancelIdleCallbackFn);
  const setTimeoutFn = options.setTimeoutFn ?? globalThis.setTimeout.bind(globalThis);
  const clearTimeoutFn = options.clearTimeoutFn ?? globalThis.clearTimeout.bind(globalThis);
  const idleTimeoutMs = Math.max(1, Math.floor(options.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS));
  const fallbackDelayMs = Math.max(0, Math.floor(options.fallbackDelayMs ?? DEFAULT_FALLBACK_DELAY_MS));

  let hasPendingValue = false;
  let pendingValue: T | undefined;
  let idleHandle: number | null = null;
  let timeoutHandle: ReturnType<typeof globalThis.setTimeout> | null = null;

  const cancelScheduledCallback = () => {
    if (idleHandle !== null) {
      cancelIdleCallbackFn?.(idleHandle);
      idleHandle = null;
    }

    if (timeoutHandle !== null) {
      clearTimeoutFn(timeoutHandle);
      timeoutHandle = null;
    }
  };

  const writePendingValue = () => {
    idleHandle = null;
    timeoutHandle = null;

    if (!hasPendingValue) return;
    const value = pendingValue as T;
    hasPendingValue = false;
    pendingValue = undefined;
    write(value);
  };

  const schedule = (value: T) => {
    pendingValue = value;
    hasPendingValue = true;

    if (idleHandle !== null || timeoutHandle !== null) {
      return;
    }

    if (requestIdleCallbackFn) {
      idleHandle = requestIdleCallbackFn(writePendingValue, { timeout: idleTimeoutMs });
      return;
    }

    timeoutHandle = setTimeoutFn(writePendingValue, fallbackDelayMs);
  };

  const flush = () => {
    cancelScheduledCallback();
    writePendingValue();
  };

  const dispose = () => {
    cancelScheduledCallback();
    hasPendingValue = false;
    pendingValue = undefined;
  };

  return { schedule, flush, dispose };
}
