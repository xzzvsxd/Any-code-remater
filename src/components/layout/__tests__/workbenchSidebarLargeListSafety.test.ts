import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const sidebarSource = readFileSync(
  resolve(process.cwd(), 'src/components/layout/WorkbenchSidebar.tsx'),
  'utf8',
);

describe('WorkbenchSidebar large-list render safety', () => {
  test('does not mount sortable project rows when the workspace has hundreds of projects', () => {
    expect(sidebarSource).toContain('WORKBENCH_PROJECT_DND_LIMIT');
    expect(sidebarSource).toMatch(
      /<SortableList[\s\S]*items=\{projects\}[\s\S]*disableSortingAbove=\{WORKBENCH_PROJECT_DND_LIMIT\}/,
    );
  });

  test('does not render every session row at once when expanding a project with hundreds of sessions', () => {
    expect(sidebarSource).toContain('EXPANDED_SESSION_BATCH_SIZE');
    expect(sidebarSource).toContain('expandedSessionLimitByProject');
    expect(sidebarSource).toContain('hiddenSessionCount');
    expect(sidebarSource).not.toContain(
      'const visible = expandedAll ? visibleSorted : visibleSorted.slice(0, RECENT_SESSION_COUNT);',
    );
  });

  test('precomputes project order indexes before sorting large project lists', () => {
    expect(sidebarSource).toContain('projectOrderIndex');
    expect(sidebarSource).not.toContain('projectOrder.indexOf(id)');
  });

  test('lazy-mounts project row dropdown menus instead of keeping hundreds of Radix roots alive', () => {
    expect(sidebarSource).toContain('项目行操作菜单：懒挂载');
    expect(sidebarSource).toMatch(/menuFor === `proj:\$\{project\.id\}` \? \(\s*<DropdownMenu open/);
  });
});
