import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const useTabsSource = readFileSync(
  resolve(process.cwd(), 'src/hooks/useTabs.tsx'),
  'utf8',
);

describe('useTabs persistence and render safety', () => {
  test('persists tab state through an idle scheduler instead of synchronously on every render', () => {
    expect(useTabsSource).toContain("from '@/lib/tabPersistenceScheduler'");
    expect(useTabsSource).toContain('persistTabsSchedulerRef');
    expect(useTabsSource).toContain('schedule({ tabs, activeTabId })');
    expect(useTabsSource).toContain('persistTabsSchedulerRef.current?.flush()');
    expect(useTabsSource).not.toMatch(
      /useEffect\(\(\) => \{[\s\S]*?localStorage\.setItem\(STORAGE_KEY,\s*JSON\.stringify\(\{\s*tabs,\s*activeTabId\s*\}\)\);[\s\S]*?\}, \[tabs, activeTabId\]\);/,
    );
  });

  test('memoizes derived active tabs and context value to avoid avoidable provider churn', () => {
    expect(useTabsSource).toMatch(/const tabsWithActive:\s*TabSession\[\]\s*=\s*useMemo\(/);
    expect(useTabsSource).toMatch(/const contextValue:\s*TabContextValue\s*=\s*useMemo\(/);
    expect(useTabsSource).not.toContain('const contextValue: TabContextValue = {');
  });
});
