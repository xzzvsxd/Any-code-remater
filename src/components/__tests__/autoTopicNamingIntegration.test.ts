import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';

const tabWrapper = readFileSync('src/components/TabSessionWrapper.tsx', 'utf8');
const claudeCodeSession = readFileSync('src/components/ClaudeCodeSession.tsx', 'utf8');
const generalSettings = readFileSync('src/components/settings/GeneralSettings.tsx', 'utf8');
const zh = readFileSync('src/i18n/locales/zh.json', 'utf8');
const en = readFileSync('src/i18n/locales/en.json', 'utf8');
const zhTW = readFileSync('src/i18n/locales/zh-TW.json', 'utf8');

describe('auto topic naming integration', () => {
  test('new sessions keep first prompt and trigger Haiku auto naming after real session id is known', () => {
    expect(tabWrapper).toContain('firstPromptForAutoTitleRef');
    expect(claudeCodeSession).toContain('autoNameSessionFromPrompt');
    expect(claudeCodeSession).toContain('autoTitleSessionIdsRef');
    expect(claudeCodeSession).toContain('onAutoSessionTitle');
    expect(tabWrapper).toContain('onAutoSessionTitle');
    expect(tabWrapper).not.toContain("import { autoNameSessionFromPrompt }");
  });

  test('first prompt capture is not blocked by system/init messages', () => {
    const firstPromptCaptureBlock = claudeCodeSession.slice(
      claudeCodeSession.indexOf('// 新会话首条消息'),
      claudeCodeSession.indexOf('if (sendJumpTimeoutRef.current)'),
    );
    expect(firstPromptCaptureBlock).toContain('hasUserAuthoredMessage');
    expect(firstPromptCaptureBlock).toContain('wasCreatedAsNewSessionRef.current');
    expect(firstPromptCaptureBlock).not.toContain('messagesRef.current.length === 0');
  });

  test('session promotion carries the first prompt as a fallback for workspace auto naming', () => {
    expect(claudeCodeSession).toContain('firstUserPrompt?: string');
    expect(claudeCodeSession).toContain('firstSubmittedPromptRef');
    expect(tabWrapper).toContain('info.firstUserPrompt');
    expect(tabWrapper).toContain('firstPromptForAutoTitleRef.current ?? info.firstUserPrompt');
  });

  test('detached and direct ClaudeCodeSession entrypoints still have internal auto naming', () => {
    expect(claudeCodeSession).toContain('wasCreatedAsNewSessionRef.current');
    expect(claudeCodeSession).toContain('autoNameSessionFromPrompt({');
    expect(claudeCodeSession).toContain('onAutoSessionTitle?.');
  });

  test('general settings exposes default-on auto topic naming toggle in all locales', () => {
    expect(generalSettings).toContain('autoTopicNaming');
    expect(generalSettings).toContain('settings?.autoTopicNaming !== false');
    expect(zh).toContain('"autoTopicNaming"');
    expect(en).toContain('"autoTopicNaming"');
    expect(zhTW).toContain('"autoTopicNaming"');
  });
});
