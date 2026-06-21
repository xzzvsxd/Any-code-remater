import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';

const tabWrapper = readFileSync('src/components/TabSessionWrapper.tsx', 'utf8');
const generalSettings = readFileSync('src/components/settings/GeneralSettings.tsx', 'utf8');
const zh = readFileSync('src/i18n/locales/zh.json', 'utf8');
const en = readFileSync('src/i18n/locales/en.json', 'utf8');
const zhTW = readFileSync('src/i18n/locales/zh-TW.json', 'utf8');

describe('auto topic naming integration', () => {
  test('new sessions keep first prompt and trigger Haiku auto naming after real session id is known', () => {
    expect(tabWrapper).toContain('firstPromptForAutoTitleRef');
    expect(tabWrapper).toContain('autoNameSessionFromPrompt');
    expect(tabWrapper).toContain('autoTitleSessionIdsRef');
  });

  test('general settings exposes default-on auto topic naming toggle in all locales', () => {
    expect(generalSettings).toContain('autoTopicNaming');
    expect(generalSettings).toContain('settings?.autoTopicNaming !== false');
    expect(zh).toContain('"autoTopicNaming"');
    expect(en).toContain('"autoTopicNaming"');
    expect(zhTW).toContain('"autoTopicNaming"');
  });
});
