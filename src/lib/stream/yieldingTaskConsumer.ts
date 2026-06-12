const DEFAULT_MAX_TASKS_PER_SLICE = 16;
const DEFAULT_MAX_SLICE_MS = 8;

export interface TaskConsumerBudget {
  processedInSlice: number;
  sliceElapsedMs: number;
  maxTasksPerSlice?: number;
  maxSliceMs?: number;
}

export interface ConsumeYieldingOptions {
  maxTasksPerSlice?: number;
  maxSliceMs?: number;
  now?: () => number;
  yieldFn?: () => Promise<void>;
}

const clampPositiveInteger = (value: number | undefined, fallback: number): number => {
  if (!Number.isFinite(value) || value === undefined) {
    return fallback;
  }
  return Math.max(1, Math.floor(value));
};

const getMonotonicNow = (): number => {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now();
  }
  return Date.now();
};

/**
 * 判断队列消费循环是否应该主动让出 event loop。
 *
 * 高频 streaming 时，即使每个 task 都是同步完成，连续 `await task()` 也会在 microtask
 * 链上长期占住主线程。按任务数 + 时间双预算切片，能让浏览器有机会处理输入、绘制和 IPC。
 */
export function shouldYieldTaskConsumer({
  processedInSlice,
  sliceElapsedMs,
  maxTasksPerSlice = DEFAULT_MAX_TASKS_PER_SLICE,
  maxSliceMs = DEFAULT_MAX_SLICE_MS,
}: TaskConsumerBudget): boolean {
  const taskBudget = clampPositiveInteger(maxTasksPerSlice, DEFAULT_MAX_TASKS_PER_SLICE);
  const timeBudget = clampPositiveInteger(maxSliceMs, DEFAULT_MAX_SLICE_MS);

  return processedInSlice >= taskBudget || sliceElapsedMs >= timeBudget;
}

/**
 * 主动让出到 macrotask，避免只在 microtask 队列里自旋，给 WebKit/Chromium 绘制和输入处理机会。
 */
export function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

/**
 * 按预算消费 AsyncIterable，保持业务处理顺序，同时在高吞吐流式输出下协作式让出主线程。
 */
export async function consumeYielding<T>(
  iterable: AsyncIterable<T>,
  processItem: (item: T) => void | Promise<void>,
  shouldContinue: () => boolean,
  options: ConsumeYieldingOptions = {},
): Promise<void> {
  const now = options.now ?? getMonotonicNow;
  const yieldFn = options.yieldFn ?? yieldToEventLoop;
  let processedInSlice = 0;
  let sliceStart = now();

  for await (const item of iterable) {
    if (!shouldContinue()) {
      break;
    }

    await processItem(item);
    processedInSlice += 1;

    const sliceElapsedMs = now() - sliceStart;
    if (shouldYieldTaskConsumer({
      processedInSlice,
      sliceElapsedMs,
      maxTasksPerSlice: options.maxTasksPerSlice,
      maxSliceMs: options.maxSliceMs,
    })) {
      processedInSlice = 0;
      await yieldFn();
      sliceStart = now();
    }
  }
}
