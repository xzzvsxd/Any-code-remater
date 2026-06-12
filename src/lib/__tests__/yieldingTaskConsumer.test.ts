import { describe, expect, test } from 'vitest';
import {
  consumeYielding,
  shouldYieldTaskConsumer,
} from '../stream/yieldingTaskConsumer';

async function* fromArray<T>(items: T[]): AsyncGenerator<T> {
  for (const item of items) {
    yield item;
  }
}

describe('yielding task consumer', () => {
  test('yields after the max task count even when time budget remains', () => {
    expect(shouldYieldTaskConsumer({
      processedInSlice: 16,
      sliceElapsedMs: 1,
      maxTasksPerSlice: 16,
      maxSliceMs: 8,
    })).toBe(true);
  });

  test('yields after the max slice time even when task count is low', () => {
    expect(shouldYieldTaskConsumer({
      processedInSlice: 2,
      sliceElapsedMs: 8,
      maxTasksPerSlice: 16,
      maxSliceMs: 8,
    })).toBe(true);
  });

  test('keeps processing while both budgets remain', () => {
    expect(shouldYieldTaskConsumer({
      processedInSlice: 4,
      sliceElapsedMs: 2,
      maxTasksPerSlice: 16,
      maxSliceMs: 8,
    })).toBe(false);
  });

  test('consumer yields between task slices even when tasks complete synchronously', async () => {
    const processed: number[] = [];
    const yieldAfterCounts: number[] = [];

    await consumeYielding(
      fromArray([1, 2, 3, 4, 5]),
      (item) => {
        processed.push(item);
      },
      () => true,
      {
        maxTasksPerSlice: 2,
        maxSliceMs: 999,
        now: () => 0,
        yieldFn: async () => {
          yieldAfterCounts.push(processed.length);
        },
      },
    );

    expect(processed).toEqual([1, 2, 3, 4, 5]);
    expect(yieldAfterCounts).toEqual([2, 4]);
  });
});
