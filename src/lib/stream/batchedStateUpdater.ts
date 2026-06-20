/**
 * batchedStateUpdater - rAF 批量状态更新合并器
 *
 * 背景（Linux/WebKit 前端卡死根因之一）：
 * streaming 期间后端「来一行 emit 一行」，前端每条消息触发一次 setState → 全量重渲染 +
 * 虚拟列表重测，高频时主线程被渲染风暴打满，表现为「前端卡死、后端仍在跑」。
 * WebKit 没有 Chromium 的事件外 setState 自动批处理，每次 set 都同步渲染，问题尤甚。
 *
 * 方案：把「函数式 setState 更新器」缓存在一帧窗口内，rAF 触发时按入队顺序一次性折叠应用，
 * N 条消息合并为 1 次渲染。React 的函数式 updater 可组合，保序、语义等价。
 *
 * 仅用于「函数式更新器」(prev => next)。直接赋值/重置场景请绕过本合并器直接 setState，
 * 否则会与队列中待应用的增量更新乱序（见 flushNow 的使用约定）。
 */

type FunctionalUpdater<T> = (prev: T) => T;

interface BatchedUpdaterOptions {
  /**
   * 单帧最多折叠多少个通用函数式更新。
   *
   * 这些 updater 可能内部做 `prev => [...prev, item]`，每个都会复制数组。
   * Linux WebKit 下如果一帧内折叠几百/几千个，会形成长任务并把前端拖到白屏。
   */
  maxUpdatesPerFrame?: number;
}

interface BatchedAppendUpdaterOptions {
  /** 单帧最多追加多少个 item；剩余 item 延后到下一帧，避免单帧长任务。 */
  maxItemsPerFrame?: number;
}

export interface BatchedUpdater<T> {
  /** 入队一个函数式更新器，在下一帧合并 flush。 */
  enqueue: (updater: FunctionalUpdater<T>) => void;
  /** 立即同步 flush 当前所有待应用更新（用于重置前排空，保证顺序正确）。 */
  flushNow: () => void;
  /** 取消挂起的 rAF 并清空队列（卸载时调用，避免泄漏与卸载后 setState）。 */
  dispose: () => void;
}

export interface BatchedAppendUpdater<T> {
  /** 入队一个 append-only item，在下一帧用一次 concat 批量追加。 */
  enqueue: (item: T) => void;
  /** 批量入队 append-only items。 */
  enqueueAll: (items: T[]) => void;
  /** 立即同步 flush 当前所有待追加项。 */
  flushNow: () => void;
  /** 取消挂起任务并清空队列。 */
  dispose: () => void;
}

const DEFAULT_MAX_UPDATES_PER_FRAME = 16;
const DEFAULT_MAX_APPEND_ITEMS_PER_FRAME = 128;
/**
 * WebKitGTK 在窗口被遮挡、最小化或合成线程异常时可能暂停 rAF，但 Tauri IPC 仍继续送达。
 * 若只等 rAF，pending 会无限增长；100ms watchdog 保证后台流也能持续排空，同时把渲染频率
 * 限制在最多约 10fps，避免非活跃窗口反过来占满主线程。
 */
const MAX_FRAME_WAIT_MS = 100;

const requestFrame = (callback: FrameRequestCallback): number | null => {
  if (typeof requestAnimationFrame === 'function') {
    return requestAnimationFrame(callback);
  }
  return null;
};

const cancelFrame = (id: number | null) => {
  if (id === null) return;
  if (typeof cancelAnimationFrame === 'function') {
    cancelAnimationFrame(id);
  }
};

/**
 * 创建一个绑定到指定 React setState 的 rAF 批量合并器。
 *
 * @param setState 目标 React setState（必须支持函数式更新器）
 */
export function createBatchedUpdater<T>(
  setState: (updater: FunctionalUpdater<T>) => void,
  options: BatchedUpdaterOptions = {},
): BatchedUpdater<T> {
  let pending: FunctionalUpdater<T>[] = [];
  let rafId: number | null = null;
  let watchdogId: ReturnType<typeof globalThis.setTimeout> | null = null;
  const maxUpdatesPerFrame = Math.max(
    1,
    options.maxUpdatesPerFrame ?? DEFAULT_MAX_UPDATES_PER_FRAME,
  );

  const schedule = () => {
    if (rafId === null && watchdogId === null) {
      rafId = requestFrame(flush);
      watchdogId = globalThis.setTimeout(flush, rafId === null ? 16 : MAX_FRAME_WAIT_MS);
    }
  };

  const flush = () => {
    cancelFrame(rafId);
    rafId = null;
    if (watchdogId !== null) {
      clearTimeout(watchdogId);
      watchdogId = null;
    }
    if (pending.length === 0) return;
    // 取出本帧累积的所有更新器，按入队顺序折叠成一次 setState：
    // setState(prev => updaterN(...updater2(updater1(prev))))。
    const batch = pending.splice(0, maxUpdatesPerFrame);
    setState((prev) => {
      let next = prev;
      for (let i = 0; i < batch.length; i++) {
        next = batch[i](next);
      }
      return next;
    });

    if (pending.length > 0) {
      schedule();
    }
  };

  const enqueue = (updater: FunctionalUpdater<T>) => {
    pending.push(updater);
    schedule();
  };

  const flushNow = () => {
    cancelFrame(rafId);
    rafId = null;
    if (watchdogId !== null) {
      clearTimeout(watchdogId);
      watchdogId = null;
    }
    if (pending.length === 0) return;
    const batch = pending;
    pending = [];
    setState((prev) => {
      let next = prev;
      for (let i = 0; i < batch.length; i++) {
        next = batch[i](next);
      }
      return next;
    });
  };

  const dispose = () => {
    cancelFrame(rafId);
    rafId = null;
    if (watchdogId !== null) {
      clearTimeout(watchdogId);
      watchdogId = null;
    }
    pending = [];
  };

  return { enqueue, flushNow, dispose };
}

/**
 * append-only 批量合并器。
 *
 * 与通用函数式 updater 不同，streaming 主路径大多只是追加消息：
 * `prev => [...prev, message]`。如果照通用 updater 折叠，仍会在一帧内反复复制数组。
 * 本合并器把 N 个 append 合并为一次 `prev.concat(batch)`，把 N 次数组复制降为 1 次。
 */
export function createBatchedAppendUpdater<T>(
  setState: (updater: (prev: T[]) => T[]) => void,
  options: BatchedAppendUpdaterOptions = {},
): BatchedAppendUpdater<T> {
  let pending: T[] = [];
  let rafId: number | null = null;
  let watchdogId: ReturnType<typeof globalThis.setTimeout> | null = null;
  const maxItemsPerFrame = Math.max(
    1,
    options.maxItemsPerFrame ?? DEFAULT_MAX_APPEND_ITEMS_PER_FRAME,
  );

  const schedule = () => {
    if (rafId === null && watchdogId === null) {
      rafId = requestFrame(flush);
      watchdogId = globalThis.setTimeout(flush, rafId === null ? 16 : MAX_FRAME_WAIT_MS);
    }
  };

  const flush = () => {
    cancelFrame(rafId);
    rafId = null;
    if (watchdogId !== null) {
      clearTimeout(watchdogId);
      watchdogId = null;
    }
    if (pending.length === 0) return;
    const batch = pending.splice(0, maxItemsPerFrame);
    setState((prev) => prev.concat(batch));

    if (pending.length > 0) {
      schedule();
    }
  };

  const enqueue = (item: T) => {
    pending.push(item);
    schedule();
  };

  const enqueueAll = (items: T[]) => {
    if (items.length === 0) return;
    pending.push(...items);
    schedule();
  };

  const flushNow = () => {
    cancelFrame(rafId);
    rafId = null;
    if (watchdogId !== null) {
      clearTimeout(watchdogId);
      watchdogId = null;
    }
    if (pending.length === 0) return;
    const batch = pending;
    pending = [];
    setState((prev) => prev.concat(batch));
  };

  const dispose = () => {
    cancelFrame(rafId);
    rafId = null;
    if (watchdogId !== null) {
      clearTimeout(watchdogId);
      watchdogId = null;
    }
    pending = [];
  };

  return { enqueue, enqueueAll, flushNow, dispose };
}
