import { describe, expect, test, vi } from 'vitest';
import { createIdlePersistScheduler } from '../tabPersistenceScheduler';

describe('tab persistence idle scheduler', () => {
  test('coalesces rapid schedules and writes only the latest value on the fallback timer', async () => {
    vi.useFakeTimers();
    const writes: string[] = [];

    const scheduler = createIdlePersistScheduler<string>(
      (value) => {
        writes.push(value);
      },
      {
        fallbackDelayMs: 50,
        requestIdleCallbackFn: undefined,
        cancelIdleCallbackFn: undefined,
        setTimeoutFn: setTimeout,
        clearTimeoutFn: clearTimeout,
      },
    );

    scheduler.schedule('first');
    scheduler.schedule('latest');

    await vi.advanceTimersByTimeAsync(49);
    expect(writes).toEqual([]);

    await vi.advanceTimersByTimeAsync(1);
    expect(writes).toEqual(['latest']);

    scheduler.dispose();
    vi.useRealTimers();
  });

  test('flush writes the latest pending value immediately and cancels the fallback timer', async () => {
    vi.useFakeTimers();
    const writes: string[] = [];

    const scheduler = createIdlePersistScheduler<string>(
      (value) => {
        writes.push(value);
      },
      {
        fallbackDelayMs: 100,
        requestIdleCallbackFn: undefined,
        cancelIdleCallbackFn: undefined,
        setTimeoutFn: setTimeout,
        clearTimeoutFn: clearTimeout,
      },
    );

    scheduler.schedule('stale');
    scheduler.schedule('final');
    scheduler.flush();

    expect(writes).toEqual(['final']);

    await vi.advanceTimersByTimeAsync(200);
    expect(writes).toEqual(['final']);

    scheduler.dispose();
    vi.useRealTimers();
  });

  test('prefers requestIdleCallback when available and still coalesces to the latest value', () => {
    const idleCallbackRef: { current: IdleRequestCallback | null } = { current: null };
    let cancelledIdleHandle: number | null = null;
    const writes: string[] = [];

    const scheduler = createIdlePersistScheduler<string>(
      (value) => {
        writes.push(value);
      },
      {
        requestIdleCallbackFn: (callback) => {
          idleCallbackRef.current = callback;
          return 42;
        },
        cancelIdleCallbackFn: (handle) => {
          cancelledIdleHandle = handle;
        },
      },
    );

    scheduler.schedule('one');
    scheduler.schedule('two');

    expect(writes).toEqual([]);
    expect(idleCallbackRef.current).not.toBeNull();

    const runIdleCallback = idleCallbackRef.current as IdleRequestCallback;
    runIdleCallback({ didTimeout: false, timeRemaining: () => 10 });
    expect(writes).toEqual(['two']);

    scheduler.schedule('three');
    scheduler.dispose();

    expect(cancelledIdleHandle).toBe(42);
    expect(writes).toEqual(['two']);
  });
});
