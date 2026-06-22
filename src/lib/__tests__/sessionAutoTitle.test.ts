import { beforeEach, describe, expect, test, vi } from 'vitest';
import { api } from '../api';
import { claudeSDK } from '../claudeSDK';
import {
  AUTO_TOPIC_NAMING_MODEL,
  autoNameSessionFromPrompt,
  generateFallbackSessionTitleFromPrompt,
  isAutoTopicNamingEnabled,
  sanitizeGeneratedSessionTitle,
} from '../sessionAutoTitle';

vi.mock('../api', () => ({
  api: {
    getClaudeSettings: vi.fn(),
    getSessionMeta: vi.fn(),
    setSessionTitle: vi.fn(),
  },
}));

vi.mock('../claudeSDK', () => ({
  claudeSDK: {
    sendMessage: vi.fn(),
  },
}));

describe('session auto topic naming helpers', () => {
  beforeEach(() => {
    vi.mocked(api.getClaudeSettings).mockResolvedValue({});
    vi.mocked(api.getSessionMeta).mockResolvedValue({ titles: {}, order: {} });
    vi.mocked(api.setSessionTitle).mockResolvedValue(undefined);
    vi.mocked(claudeSDK.sendMessage).mockReset();
  });

  test('auto topic naming is enabled by default and can be disabled explicitly', () => {
    expect(isAutoTopicNamingEnabled({})).toBe(true);
    expect(isAutoTopicNamingEnabled({ autoTopicNaming: true })).toBe(true);
    expect(isAutoTopicNamingEnabled({ autoTopicNaming: false })).toBe(false);
  });

  test('uses the versioned Haiku model accepted by direct API calls', () => {
    expect(AUTO_TOPIC_NAMING_MODEL).toBe('claude-haiku-4-5-20251001');
  });

  test('sanitizes generated titles into a single clean remark title', () => {
    expect(sanitizeGeneratedSessionTitle('"修复 Linux 卡顿问题"\n')).toBe('修复 Linux 卡顿问题');
    expect(sanitizeGeneratedSessionTitle('- 自动话题命名与搜索修复')).toBe('自动话题命名与搜索修复');
    expect(sanitizeGeneratedSessionTitle('标题：提问弹窗体验优化')).toBe('提问弹窗体验优化');
  });

  test('bounds generated titles for session-list stability', () => {
    const longTitle = '这是一个非常非常非常非常非常非常非常非常非常非常长的自动标题';
    expect(sanitizeGeneratedSessionTitle(longTitle).length).toBeLessThanOrEqual(48);
  });

  test('derives a bounded local fallback title when Haiku is unavailable', () => {
    expect(generateFallbackSessionTitleFromPrompt('请彻底修复 Linux 卡顿和自动命名问题\n附加说明')).toBe('请彻底修复 Linux 卡顿和自动命名问题');
    expect(generateFallbackSessionTitleFromPrompt('```ts\nconst x = 1\n```')).toBe('const x = 1');
  });

  test('still persists an automatic title when the Haiku request fails', async () => {
    vi.mocked(claudeSDK.sendMessage).mockRejectedValue(new Error('No API key available'));
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const title = await autoNameSessionFromPrompt({
      sessionId: 'session-1',
      prompt: '帮我修复工作区自动话题命名\n越稳定越好',
    });

    expect(title).toBe('帮我修复工作区自动话题命名');
    expect(api.setSessionTitle).toHaveBeenCalledWith('session-1', '帮我修复工作区自动话题命名');
    expect(warnSpy).toHaveBeenCalledWith(
      '[SessionAutoTitle] Haiku topic naming failed, using local fallback:',
      expect.any(Error),
    );
    warnSpy.mockRestore();
  });
});
