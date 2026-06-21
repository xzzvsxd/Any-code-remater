import { describe, expect, test } from 'vitest';
import type { Session } from '../api';
import { filterSessionsForSearch, sessionMatchesSearchableTitle } from '../sessionSearchFilter';

const makeSession = (overrides: Partial<Session>): Session => ({
  id: 'session-1234567890',
  project_id: 'project-1',
  project_path: '/tmp/project',
  created_at: 1,
  engine: 'claude',
  ...overrides,
});

describe('session search filtering', () => {
  test('only content-hit sessions are shown when titles do not really contain the query', () => {
    const contentHit = makeSession({ id: 'hit', first_message: 'unrelated intro' });
    const codexFallback = makeSession({ id: 'miss-codex', engine: 'codex', first_message: 'Codex Session' });
    const idFallback = makeSession({ id: 'linux-in-id-only', first_message: undefined });

    const result = filterSessionsForSearch({
      sessions: [contentHit, codexFallback, idFallback],
      searchKeyword: 'linux',
      searchHitIds: new Set(['hit']),
      titles: {},
    });

    expect(result.map((s) => s.id)).toEqual(['hit']);
  });

  test('custom remark title can match immediately without waiting for backend content scan', () => {
    const renamed = makeSession({ id: 'renamed', first_message: 'old prompt' });

    expect(
      sessionMatchesSearchableTitle(renamed, { renamed: 'Linux 卡顿修复备注' }, 'linux')
    ).toBe(true);
  });

  test('session id and synthetic engine fallback labels are never search matches', () => {
    const idOnly = makeSession({ id: 'contains-linux-id', first_message: undefined });
    const codexFallback = makeSession({ id: 'codex-default', engine: 'codex', first_message: 'Codex Session' });
    const geminiFallback = makeSession({ id: 'gemini-default', engine: 'gemini', first_message: 'Gemini Session' });

    expect(sessionMatchesSearchableTitle(idOnly, {}, 'linux')).toBe(false);
    expect(sessionMatchesSearchableTitle(codexFallback, {}, 'codex')).toBe(false);
    expect(sessionMatchesSearchableTitle(geminiFallback, {}, 'gemini')).toBe(false);
  });

  test('does not filter by engine: Claude, Codex and Gemini can all be returned by content hits', () => {
    const claude = makeSession({ id: 'claude-hit', engine: 'claude' });
    const codex = makeSession({ id: 'codex-hit', engine: 'codex' });
    const gemini = makeSession({ id: 'gemini-hit', engine: 'gemini' });

    const result = filterSessionsForSearch({
      sessions: [claude, codex, gemini],
      searchKeyword: 'shared keyword',
      searchHitIds: new Set(['claude-hit', 'codex-hit', 'gemini-hit']),
      titles: {},
    });

    expect(result.map((s) => s.engine)).toEqual(['claude', 'codex', 'gemini']);
  });
});
