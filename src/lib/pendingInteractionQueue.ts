/**
 * Helpers for modal-like interaction queues.
 *
 * request_user_input / submit_plan can arrive while a previous prompt is still
 * open.  A single `pendingInteraction` slot overwrites the first request and
 * leaves its backend bridge hanging.  These helpers keep the active item intact
 * and queue distinct follow-up requests by their stable call/request id.
 */

export function enqueuePendingInteraction<T>(
  queue: T[],
  active: T | null | undefined,
  item: T,
  getKey: (item: T) => string,
): T[] {
  const itemKey = getKey(item);
  if (!itemKey) {
    return queue;
  }

  if (active && getKey(active) === itemKey) {
    return queue;
  }

  if (queue.some((queued) => getKey(queued) === itemKey)) {
    return queue;
  }

  return [...queue, item];
}

export function shiftPendingInteraction<T>(queue: T[]): {
  next: T | null;
  rest: T[];
} {
  if (queue.length === 0) {
    return { next: null, rest: [] };
  }

  const [next, ...rest] = queue;
  return { next, rest };
}
