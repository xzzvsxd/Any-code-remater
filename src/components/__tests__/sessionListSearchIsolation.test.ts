import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';

const source = readFileSync('src/components/SessionList.tsx', 'utf8');

describe('SessionList search isolation wiring', () => {
  test('content search is restarted by user query/project changes, not by background session refreshes', () => {
    expect(source).toContain('searchSessionsRef.current = searchSessions');

    const effectMatch = source.match(/useEffect\(\(\) => \{[\s\S]*?api\.searchSessionsContent[\s\S]*?\}, \[([^\]]*)\]\);/);
    expect(effectMatch?.[1]).toBeDefined();
    expect(effectMatch![1]).toContain('searchKeyword');
    expect(effectMatch![1]).toContain('projectPath');
    expect(effectMatch![1]).not.toContain('searchSessions');
  });

  test('session list renders and filters with persisted session titles', () => {
    expect(source).toContain('getSessionDisplayTitle');
    expect(source).toContain('sessionTitles');
    expect(source).toContain('session-title-changed');
  });
});
