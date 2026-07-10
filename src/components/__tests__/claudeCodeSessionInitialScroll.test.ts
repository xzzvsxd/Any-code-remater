import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source = readFileSync(
  resolve(process.cwd(), 'src/components/ClaudeCodeSession.tsx'),
  'utf8',
);

describe('ClaudeCodeSession initial bottom scroll invariants', () => {
  test('waits for grouped message rows before marking initial bottom scroll complete', () => {
    expect(source).toMatch(
      /if \(isHistoryLoading\) return;[\s\S]*?if \(isLoading\) return;[\s\S]*?if \(messageGroups\.length === 0\) return;/,
    );
    expect(source).toMatch(
      /if \(isLoadingRef\.current\) return;\s*if \(!sessionMessagesRef\.current\) return;\s*sessionMessagesRef\.current\.scrollToBottom\(\);\s*initialScrolledSessionRef\.current = sid;/,
    );
  });

  test('jump-to-latest always delegates to SessionMessages so streaming uses virtualizer-aware bottom alignment', () => {
    expect(source).toContain('const isLoadingRef = useRef(isLoading);');
    expect(source).toContain('isLoadingRef.current = isLoading;');
    expect(source).toMatch(
      /const handleJumpToLatest = useCallback\(\(\) => \{[\s\S]*?setUserScrolled\(false\);[\s\S]*?setShouldAutoScroll\(true\);[\s\S]*?sessionMessagesRef\.current\?\.scrollToBottom\(\);[\s\S]*?\},/,
    );
    expect(source).not.toContain('el.scrollTop = el.scrollHeight - el.clientHeight');
  });

  test('passes sticky bottom ownership into SessionMessages for streaming measurement policy', () => {
    expect(source).toContain('autoScrollLockedToBottom={isLoading && !userScrolled}');
  });

  test('cancels stale initial bottom scroll frames when the session changes', () => {
    expect(source).toContain('const rafId = requestAnimationFrame(() => {');
    expect(source).toMatch(
      /return \(\) => \{\s*cancelAnimationFrame\(rafId\);\s*if \(initialScrollPendingSessionRef\.current === sid\) \{\s*initialScrollPendingSessionRef\.current = null;\s*\}\s*\};/,
    );
  });
});
