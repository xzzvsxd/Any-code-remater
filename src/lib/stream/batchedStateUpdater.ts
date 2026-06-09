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

export interface BatchedUpdater<T> {
  /** 入队一个函数式更新器，在下一帧合并 flush。 */
  enqueue: (updater: FunctionalUpdater<T>) => void;
  /** 立即同步 flush 当前所有待应用更新（用于重置前排空，保证顺序正确）。 */
  flushNow: () => void;
  /** 取消挂起的 rAF 并清空队列（卸载时调用，避免泄漏与卸载后 setState）。 */
  dispose: () => void;
}

/**
 * 创建一个绑定到指定 React setState 的 rAF 批量合并器。
 *
 * @param setState 目标 React setState（必须支持函数式更新器）
 */
export function createBatchedUpdater<T>(
  setState: (updater: FunctionalUpdater<T>) => void,
): BatchedUpdater<T> {
  let pending: FunctionalUpdater<T>[] = [];
  let rafId: number | null = null;

  const flush = () => {
    rafId = null;
    if (pending.length === 0) return;
    // 取出本帧累积的所有更新器，按入队顺序折叠成一次 setState：
    // setState(prev => updaterN(...updater2(updater1(prev))))。
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

  const enqueue = (updater: FunctionalUpdater<T>) => {
    pending.push(updater);
    if (rafId === null) {
      rafId = requestAnimationFrame(flush);
    }
  };

  const flushNow = () => {
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
    flush();
  };

  const dispose = () => {
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
    pending = [];
  };

  return { enqueue, flushNow, dispose };
}
