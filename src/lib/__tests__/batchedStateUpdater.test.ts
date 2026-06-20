import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
  createBatchedAppendUpdater,
  createBatchedUpdater,
} from '../stream/batchedStateUpdater';
import { readFileSync } from 'node:fs';

type RafCallback = FrameRequestCallback;

describe('batched state updaters', () => {
  let rafCallbacks: Map<number, RafCallback>;
  let nextRafId: number;

  const runNextFrame = () => {
    const first = rafCallbacks.entries().next().value as [number, RafCallback] | undefined;
    if (!first) return false;
    const [id, callback] = first;
    rafCallbacks.delete(id);
    callback(performance.now());
    return true;
  };

  beforeEach(() => {
    vi.useFakeTimers();
    rafCallbacks = new Map();
    nextRafId = 1;

    vi.stubGlobal('requestAnimationFrame', (callback: RafCallback) => {
      const id = nextRafId++;
      rafCallbacks.set(id, callback);
      return id;
    });

    vi.stubGlobal('cancelAnimationFrame', (id: number) => {
      rafCallbacks.delete(id);
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  test('limits generic functional updater work per frame', () => {
    let state: number[] = [];
    const updater = createBatchedUpdater<number[]>(
      (apply) => {
        state = apply(state);
      },
      { maxUpdatesPerFrame: 2 },
    );

    updater.enqueue((prev) => [...prev, 1]);
    updater.enqueue((prev) => [...prev, 2]);
    updater.enqueue((prev) => [...prev, 3]);

    expect(runNextFrame()).toBe(true);
    expect(state).toEqual([1, 2]);
    expect(rafCallbacks.size).toBe(1);

    expect(runNextFrame()).toBe(true);
    expect(state).toEqual([1, 2, 3]);
    expect(rafCallbacks.size).toBe(0);
  });

  test('keeps the default generic updater frame budget low enough for long histories', () => {
    const source = readFileSync('src/lib/stream/batchedStateUpdater.ts', 'utf8');

    expect(source).toContain('const DEFAULT_MAX_UPDATES_PER_FRAME = 16');
  });

  test('coalesces append-only updates into one concat per frame', () => {
    let state: number[] = [0];
    let setStateCalls = 0;
    const updater = createBatchedAppendUpdater<number>(
      (apply) => {
        setStateCalls += 1;
        state = apply(state);
      },
      { maxItemsPerFrame: 3 },
    );

    updater.enqueue(1);
    updater.enqueueAll([2, 3, 4]);

    expect(runNextFrame()).toBe(true);
    expect(state).toEqual([0, 1, 2, 3]);
    expect(setStateCalls).toBe(1);
    expect(rafCallbacks.size).toBe(1);

    expect(runNextFrame()).toBe(true);
    expect(state).toEqual([0, 1, 2, 3, 4]);
    expect(setStateCalls).toBe(2);
    expect(rafCallbacks.size).toBe(0);
  });

  test('flushes generic updates when requestAnimationFrame is suspended', async () => {
    let state: number[] = [];
    const updater = createBatchedUpdater<number[]>((apply) => {
      state = apply(state);
    });

    updater.enqueue((prev) => [...prev, 1]);

    expect(state).toEqual([]);
    expect(rafCallbacks.size).toBe(1);

    await vi.advanceTimersByTimeAsync(1_000);

    expect(state).toEqual([1]);
  });

  test('flushes append-only updates when requestAnimationFrame is suspended', async () => {
    let state: number[] = [];
    const updater = createBatchedAppendUpdater<number>((apply) => {
      state = apply(state);
    });

    updater.enqueueAll([1, 2, 3]);

    expect(state).toEqual([]);
    expect(rafCallbacks.size).toBe(1);

    await vi.advanceTimersByTimeAsync(1_000);

    expect(state).toEqual([1, 2, 3]);
  });
});
