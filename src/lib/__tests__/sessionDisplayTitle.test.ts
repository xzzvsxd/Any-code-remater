import { describe, expect, test } from 'vitest';
import type { Session } from '../api';
import {
  getSessionDisplayTitle,
  sessionMatchesDisplayTitle,
} from '../sessionDisplayTitle';

const makeSession = (overrides: Partial<Session>): Session => ({
  id: 'session-1234567890',
  project_id: 'project-1',
  project_path: '/tmp/project',
  created_at: 1,
  ...overrides,
});

describe('session display title helpers', () => {
  test('custom session title overrides first_message for list previews', () => {
    const session = makeSession({
      first_message: 'old prompt title\nsecond line',
    });

    expect(getSessionDisplayTitle(session, { [session.id]: 'renamed title' })).toBe('renamed title');
  });

  test('falls back to the first line of first_message when no custom title exists', () => {
    const session = makeSession({
      first_message: 'first prompt line\nsecond line',
    });

    expect(getSessionDisplayTitle(session, {})).toBe('first prompt line');
  });

  test('search can match renamed titles even when the original first_message does not match', () => {
    const session = makeSession({
      first_message: 'old unrelated prompt',
    });

    expect(sessionMatchesDisplayTitle(session, { [session.id]: 'BGM fixed title' }, 'bgm')).toBe(true);
  });
});
