import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const tabManagerSource = readFileSync(
  resolve(process.cwd(), 'src/components/TabManager.tsx'),
  'utf8',
);

const zhLocaleSource = readFileSync(
  resolve(process.cwd(), 'src/i18n/locales/zh.json'),
  'utf8',
);

describe('TabManager session menu actions', () => {
  test('top-right overflow menu exposes rename session action for the active tab', () => {
    expect(tabManagerSource).toContain('startRenameActiveSessionFromMenu');
    expect(tabManagerSource).toContain('activeTabForMenu');
    expect(tabManagerSource).toContain('<DropdownMenuItem onClick={startRenameActiveSessionFromMenu}');
    expect(tabManagerSource).toContain("t('tabs.renameSession')");
    expect(tabManagerSource).toContain('renameTargetTabId');
    expect(tabManagerSource).toContain('api.setSessionTitle');
    expect(tabManagerSource).toContain('session-title-changed');
  });

  test('Chinese locale names the action as rename session, not generic rename', () => {
    expect(zhLocaleSource).toContain('"renameSession": "重命名会话"');
  });
});
