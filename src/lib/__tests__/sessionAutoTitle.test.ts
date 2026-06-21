import { describe, expect, test } from 'vitest';
import {
  AUTO_TOPIC_NAMING_MODEL,
  isAutoTopicNamingEnabled,
  sanitizeGeneratedSessionTitle,
} from '../sessionAutoTitle';

describe('session auto topic naming helpers', () => {
  test('auto topic naming is enabled by default and can be disabled explicitly', () => {
    expect(isAutoTopicNamingEnabled({})).toBe(true);
    expect(isAutoTopicNamingEnabled({ autoTopicNaming: true })).toBe(true);
    expect(isAutoTopicNamingEnabled({ autoTopicNaming: false })).toBe(false);
  });

  test('uses the Haiku model for low-latency topic naming', () => {
    expect(AUTO_TOPIC_NAMING_MODEL.toLowerCase()).toContain('haiku');
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
});
