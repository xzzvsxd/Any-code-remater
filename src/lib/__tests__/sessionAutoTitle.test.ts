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
    vi.mocked(api.getClaudeSettings).mockReset();
    vi.mocked(api.getSessionMeta).mockReset();
    vi.mocked(api.setSessionTitle).mockReset();
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
    const title = sanitizeGeneratedSessionTitle(longTitle);
    expect(Array.from(title).length).toBeLessThanOrEqual(20);
    expect(title.endsWith('…')).toBe(true);
  });

  test('derives a bounded local fallback title when Haiku is unavailable', () => {
    const title = generateFallbackSessionTitleFromPrompt('请彻底修复 Linux 卡顿和自动命名问题，保证每次成功\n附加说明');
    expect(Array.from(title).length).toBeLessThanOrEqual(20);
    expect(title).toBe('请彻底修复 Linux 卡顿和自动命名…');
    expect(generateFallbackSessionTitleFromPrompt('```ts\nconst x = 1\n```')).toBe('const x = 1');
  });

  test('asks Haiku for a title that is no longer than 20 characters', async () => {
    vi.mocked(claudeSDK.sendMessage).mockResolvedValue({ content: '短标题' } as any);

    await autoNameSessionFromPrompt({
      sessionId: 'session-prompt',
      prompt: '这里是一个很长的复杂需求',
    });

    expect(claudeSDK.sendMessage).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({
        maxTokens: 24,
        systemPrompt: expect.stringContaining('不超过 20 个字'),
      }),
    );
  });

  test('retries Haiku once before falling back so transient model failures still use generated names', async () => {
    vi.mocked(claudeSDK.sendMessage)
      .mockRejectedValueOnce(new Error('temporary network error'))
      .mockResolvedValueOnce({ content: '重试后标题' } as any);

    const title = await autoNameSessionFromPrompt({
      sessionId: 'session-retry-haiku',
      prompt: '帮我修复自动命名偶发失败',
    });

    expect(title).toBe('重试后标题');
    expect(claudeSDK.sendMessage).toHaveBeenCalledTimes(2);
    expect(api.setSessionTitle).toHaveBeenCalledWith('session-retry-haiku', '重试后标题');
  });

  test('retries persisting the title so a transient metadata write does not lose auto naming', async () => {
    vi.mocked(claudeSDK.sendMessage).mockResolvedValue({ content: '持久化重试' } as any);
    vi.mocked(api.setSessionTitle)
      .mockRejectedValueOnce(new Error('metadata busy'))
      .mockResolvedValueOnce(undefined);

    const title = await autoNameSessionFromPrompt({
      sessionId: 'session-write-retry',
      prompt: '帮我保证自动命名每次都写入成功',
    });

    expect(title).toBe('持久化重试');
    expect(api.setSessionTitle).toHaveBeenCalledTimes(2);
    expect(api.setSessionTitle).toHaveBeenLastCalledWith('session-write-retry', '持久化重试');
  });

  test('still persists an automatic title when the Haiku request fails', async () => {
    vi.mocked(claudeSDK.sendMessage).mockRejectedValue(new Error('No API key available'));
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const title = await autoNameSessionFromPrompt({
      sessionId: 'session-1',
      prompt: '帮我修复工作区自动话题命名\n越稳定越好',
    });

    expect(title).toBe('帮我修复工作区自动话题命名');
    expect(Array.from(title ?? '').length).toBeLessThanOrEqual(20);
    expect(api.setSessionTitle).toHaveBeenCalledWith('session-1', '帮我修复工作区自动话题命名');
    expect(warnSpy).toHaveBeenCalledWith(
      '[SessionAutoTitle] Haiku topic naming failed, using local fallback:',
      expect.any(Error),
    );
    warnSpy.mockRestore();
  });

  test('falls back to a local title when the Haiku request hangs', async () => {
    vi.useFakeTimers();
    vi.mocked(claudeSDK.sendMessage).mockReturnValue(new Promise(() => {}) as any);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const naming = autoNameSessionFromPrompt({
      sessionId: 'session-hangs',
      prompt: 'Linux 下工作区新会话应该自动命名\n不要一直等网络',
    });

    const outcome = await Promise.race([
      naming.then((title) => ({ kind: 'resolved' as const, title })),
      vi.advanceTimersByTimeAsync(8_100).then(() => ({ kind: 'pending' as const })),
    ]);

    expect(outcome).toEqual({
      kind: 'resolved',
      title: 'Linux 下工作区新会话应该自动命名',
    });
    expect(api.setSessionTitle).toHaveBeenCalledWith(
      'session-hangs',
      'Linux 下工作区新会话应该自动命名',
    );
    expect(warnSpy).toHaveBeenCalledWith(
      '[SessionAutoTitle] Haiku topic naming failed, using local fallback:',
      expect.any(Error),
    );

    warnSpy.mockRestore();
    vi.useRealTimers();
  });
});
