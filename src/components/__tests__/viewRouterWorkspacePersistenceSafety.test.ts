import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const viewRouterSource = readFileSync(
  resolve(process.cwd(), 'src/components/layout/ViewRouter.tsx'),
  'utf8',
);
const tabManagerSource = readFileSync(
  resolve(process.cwd(), 'src/components/TabManager.tsx'),
  'utf8',
);

describe('conversation workspace persistence across app pages', () => {
  test('keeps the tab workspace mounted after its first visit and only hides it on other pages', () => {
    expect(viewRouterSource).toContain(
      'const workspaceVisible = currentView === "claude-tab-manager"',
    );
    expect(viewRouterSource).toContain('workspaceInitialParamsRef');
    expect(viewRouterSource).toMatch(
      /workspaceInitialParamsRef\.current[\s\S]{0,1000}<TabManager[\s\S]{0,240}isVisible=\{workspaceVisible\}/,
    );
    expect(viewRouterSource).toContain('!workspaceVisible && "hidden"');
    expect(viewRouterSource).toContain('!workspaceVisible && (');
    expect(viewRouterSource).not.toMatch(
      /case "claude-tab-manager":[\s\S]{0,260}<TabManager/,
    );
  });

  test('creates a fresh tab explicitly when the already-mounted workspace is reopened for a new session', () => {
    expect(viewRouterSource).toMatch(
      /onNewSession=\{\(projectPath\) => \{[\s\S]{0,180}createNewTab\(undefined, projectPath\)[\s\S]{0,180}navigateTo\("claude-tab-manager"/,
    );
  });

  test('suppresses active-session rendering while the persistent workspace is hidden', () => {
    expect(tabManagerSource).toContain('isVisible?: boolean');
    expect(tabManagerSource).toContain('isVisible = true');
    expect(tabManagerSource).toContain(
      'const tabIsVisible = tab.isActive && isVisible',
    );
    expect(tabManagerSource).toContain('!tabIsVisible && "hidden"');
    expect(tabManagerSource).toContain('isActive={tabIsVisible}');
  });
});
