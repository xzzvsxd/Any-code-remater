import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source = readFileSync(
  resolve(process.cwd(), 'src/components/ClaudeCodeSession.tsx'),
  'utf8',
);

describe('ClaudeCodeSession initial bottom scroll invariants', () => {
  test('waits for grouped message rows before marking initial bottom scroll complete', () => {
    expect(source).toContain('if (messageGroups.length === 0) return;');
    expect(source).toMatch(
      /if \(!sessionMessagesRef\.current\) return;\s*sessionMessagesRef\.current\.scrollToBottom\(\);\s*initialScrolledSessionRef\.current = sid;/,
    );
  });

  test('cancels stale initial bottom scroll frames when the session changes', () => {
    expect(source).toContain('const rafId = requestAnimationFrame(() => {');
    expect(source).toMatch(
      /return \(\) => \{\s*cancelAnimationFrame\(rafId\);\s*if \(initialScrollPendingSessionRef\.current === sid\) \{\s*initialScrollPendingSessionRef\.current = null;\s*\}\s*\};/,
    );
  });
});
