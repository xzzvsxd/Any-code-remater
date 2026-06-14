import type { Session } from './api';
import { getFirstLine } from './date-utils';

export type SessionTitleMap = Record<string, string | undefined>;

const normalizeTitle = (value: string | undefined | null) => value?.trim() ?? '';

export function getSessionDisplayTitle(
  session: Pick<Session, 'id' | 'first_message'>,
  titles: SessionTitleMap = {}
): string {
  const customTitle = normalizeTitle(titles[session.id]);
  if (customTitle) {
    return customTitle;
  }

  const firstMessage = normalizeTitle(session.first_message);
  if (firstMessage) {
    return getFirstLine(firstMessage);
  }

  return session.id;
}

export function sessionMatchesDisplayTitle(
  session: Pick<Session, 'id' | 'first_message'>,
  titles: SessionTitleMap,
  query: string
): boolean {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) {
    return true;
  }

  return getSessionDisplayTitle(session, titles).toLowerCase().includes(normalizedQuery);
}
