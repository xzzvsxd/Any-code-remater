import type { Session } from './api';

const isReasonableTimestamp = (timestamp: number, now: number) =>
  timestamp <= now;

const parseSessionTimestamp = (value: string | undefined, now: number): number | undefined => {
  if (typeof value !== 'string' || value.trim() === '') return undefined;

  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined;

  // A corrupted clock or malformed JSONL can produce dates years in the future.
  // Do not let one such row permanently outrank every real conversation.
  if (!isReasonableTimestamp(parsed, now)) return undefined;
  return parsed;
};

const normalizeCreatedAt = (value: number, now: number): number => {
  if (!Number.isFinite(value) || value <= 0) return 0;
  // In-memory tabs historically used milliseconds while persisted sessions use seconds.
  const normalized = value > 1_000_000_000_000 ? value : value * 1000;
  return isReasonableTimestamp(normalized, now) ? normalized : 0;
};

export function getSessionActivityTimestamp(
  session: Pick<Session, 'created_at' | 'message_timestamp' | 'last_message_timestamp'>,
  now = Date.now(),
): number {
  return parseSessionTimestamp(session.last_message_timestamp, now)
    ?? parseSessionTimestamp(session.message_timestamp, now)
    ?? normalizeCreatedAt(session.created_at, now);
}

export function sortSessionsByActivity(sessions: readonly Session[]): Session[] {
  const now = Date.now();
  return sessions
    .map((session, index) => ({
      session,
      index,
      activity: getSessionActivityTimestamp(session, now),
    }))
    .sort((a, b) => {
      const activityDelta = b.activity - a.activity;
      return activityDelta !== 0 ? activityDelta : a.index - b.index;
    })
    .map(({ session }) => session);
}

/**
 * Apply a user's partial manual order without allowing stale, unlisted rows to
 * outrank a genuinely new conversation. Known ids remain exactly where the
 * user placed them; unlisted rows with activity newer than the known baseline
 * are treated as new and go first, while stale rows are appended by activity.
 */
export function orderSessionsWithSavedOrder(
  sessions: readonly Session[],
  savedOrder: readonly string[],
): Session[] {
  if (savedOrder.length === 0) return sortSessionsByActivity(sessions);

  const now = Date.now();
  const orderIndex = new Map(savedOrder.map((id, index) => [id, index]));
  const knownActivities = sessions
    .filter((session) => orderIndex.has(session.id))
    .map((session) => getSessionActivityTimestamp(session, now));

  if (knownActivities.length === 0) return sortSessionsByActivity(sessions);

  const newestKnownActivity = Math.max(...knownActivities);
  return sessions
    .map((session, index) => ({
      session,
      index,
      savedIndex: orderIndex.get(session.id),
      activity: getSessionActivityTimestamp(session, now),
    }))
    .sort((a, b) => {
      const aIsNew = a.savedIndex === undefined && a.activity > newestKnownActivity;
      const bIsNew = b.savedIndex === undefined && b.activity > newestKnownActivity;

      if (aIsNew !== bIsNew) return aIsNew ? -1 : 1;
      if (aIsNew && bIsNew) {
        const activityDelta = b.activity - a.activity;
        return activityDelta !== 0 ? activityDelta : a.index - b.index;
      }

      if (a.savedIndex !== undefined && b.savedIndex !== undefined) {
        return a.savedIndex - b.savedIndex;
      }
      if (a.savedIndex !== undefined) return -1;
      if (b.savedIndex !== undefined) return 1;

      const activityDelta = b.activity - a.activity;
      return activityDelta !== 0 ? activityDelta : a.index - b.index;
    })
    .map(({ session }) => session);
}
