import { describe, expect, test } from 'vitest';
import { enqueuePendingInteraction, shiftPendingInteraction } from '../pendingInteractionQueue';

type Item = { id: string; value: string };
const idOf = (item: Item) => item.id;

describe('pending interaction queue', () => {
  test('queues a distinct interaction behind the active one', () => {
    const active = { id: 'call_1', value: 'first' };
    const next = { id: 'call_2', value: 'second' };

    const queue = enqueuePendingInteraction([], active, next, idOf);

    expect(queue).toEqual([next]);
  });

  test('does not enqueue duplicates of active or queued interactions', () => {
    const active = { id: 'call_1', value: 'first' };
    const queued = { id: 'call_2', value: 'second' };

    expect(enqueuePendingInteraction([queued], active, active, idOf)).toEqual([queued]);
    expect(enqueuePendingInteraction([queued], active, { ...queued }, idOf)).toEqual([queued]);
  });

  test('shifts the next interaction and returns the remaining queue', () => {
    const first = { id: 'call_2', value: 'second' };
    const second = { id: 'call_3', value: 'third' };

    expect(shiftPendingInteraction([first, second])).toEqual({
      next: first,
      rest: [second],
    });
  });
});
