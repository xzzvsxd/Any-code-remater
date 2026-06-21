import type { Session } from './api';
import type { SessionTitleMap } from './sessionDisplayTitle';
import { getFirstLine } from './date-utils';

const SYNTHETIC_FIRST_MESSAGES = new Set([
  'claude session',
  'codex session',
  'gemini session',
  'new session',
  'untitled session',
  '未命名会话',
  '新会话',
]);

export function normalizeSessionSearchQuery(query: string): string {
  return query.trim().toLowerCase();
}

function normalizeSearchTitle(value: string | undefined | null): string {
  return value?.trim() ?? '';
}

function isSyntheticFirstMessage(value: string): boolean {
  return SYNTHETIC_FIRST_MESSAGES.has(value.trim().toLowerCase());
}

/**
 * Search title matching intentionally differs from display-title fallback:
 * - custom remark title is searchable;
 * - real first user message is searchable;
 * - session id / synthetic labels like "Codex Session" are NOT searchable.
 *
 * This prevents "search all sessions" from showing sessions that only matched
 * metadata/default labels rather than user-visible content.
 */
export function sessionMatchesSearchableTitle(
  session: Pick<Session, 'id' | 'first_message'>,
  titles: SessionTitleMap,
  query: string
): boolean {
  const normalizedQuery = normalizeSessionSearchQuery(query);
  if (!normalizedQuery) {
    return true;
  }

  const customTitle = normalizeSearchTitle(titles[session.id]);
  if (customTitle) {
    return customTitle.toLowerCase().includes(normalizedQuery);
  }

  const firstMessage = normalizeSearchTitle(session.first_message);
  if (!firstMessage || isSyntheticFirstMessage(firstMessage)) {
    return false;
  }

  return getFirstLine(firstMessage).toLowerCase().includes(normalizedQuery);
}

export function filterSessionsForSearch({
  sessions,
  searchKeyword,
  searchHitIds,
  titles,
}: {
  sessions: Session[];
  searchKeyword: string;
  searchHitIds: Set<string>;
  titles: SessionTitleMap;
}): Session[] {
  const normalizedQuery = normalizeSessionSearchQuery(searchKeyword);
  if (!normalizedQuery) {
    return sessions;
  }

  return sessions.filter(
    (session) =>
      searchHitIds.has(session.id) ||
      sessionMatchesSearchableTitle(session, titles, normalizedQuery)
  );
}
