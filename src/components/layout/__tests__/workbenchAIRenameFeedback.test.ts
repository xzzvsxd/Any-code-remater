import { describe, expect, test } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (path: string) => {
  const absolutePath = resolve(process.cwd(), path);
  return existsSync(absolutePath) ? readFileSync(absolutePath, 'utf8') : '';
};

const status = read('src/components/layout/SessionAIRenameStatus.tsx');
const sidebar = read('src/components/layout/WorkbenchSidebar.tsx');
const css = read('src/styles/components.css');
const zh = read('src/i18n/locales/zh.json');
const en = read('src/i18n/locales/en.json');
const zhTW = read('src/i18n/locales/zh-TW.json');

describe('Workbench AI rename feedback', () => {
  test('renders the selected in-row naming animation accessibly', () => {
    expect(status).toContain('Wand2');
    expect(status).toContain("t('workbench.ctx.aiRenaming')");
    expect(status).toContain('ai-rename-spinner');
    expect(status).toContain('ai-rename-shimmer-text');
    expect(status).toContain('aria-live="polite"');
    expect(status).toContain('aria-busy="true"');
  });

  test('provides scoped motion and reduced-motion fallbacks', () => {
    expect(css).toContain('@keyframes ai-rename-spin');
    expect(css).toContain('@keyframes ai-rename-text-shimmer');
    expect(css).toContain('.ai-rename-title-enter');
    expect(css).toContain('@media (prefers-reduced-motion: reduce)');
  });

  test('wires one active session into the row and disables duplicate requests', () => {
    expect(sidebar).toContain('const isAIRenaming = aiRenamingSessionId === session.id');
    expect(sidebar).toContain('<SessionAIRenameStatus />');
    expect(sidebar).toContain('disabled={Boolean(aiRenamingSessionId)}');
    expect(sidebar).toContain('recentlyAIRenamedSessionId');
  });

  test('localizes the naming status in every supported locale', () => {
    expect(zh).toContain('"aiRenaming": "AI 正在命名…"');
    expect(en).toContain('"aiRenaming": "AI is naming…"');
    expect(zhTW).toContain('"aiRenaming": "AI 正在命名…"');
  });
});
