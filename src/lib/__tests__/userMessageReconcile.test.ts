import { describe, expect, test } from 'vitest';
import { reconcileEchoedUserMessage } from '../stream/userMessageReconcile';
import type { ClaudeStreamMessage } from '@/types/claude';

const optimisticUser = (text: string, sentAt = '2026-06-25T00:00:00.000Z'): ClaudeStreamMessage => ({
  type: 'user',
  message: { content: [{ type: 'text', text }] },
  sentAt,
  uiOnly: true,
  uiOptimisticPrompt: true,
  uiEventId: `ui-${text}`,
});

const echoedUser = (text: string, timestamp = '2026-06-25T00:00:05.000Z'): ClaudeStreamMessage => ({
  type: 'user',
  message: { content: [{ type: 'text', text }] },
  timestamp,
});

const assistant = (text: string): ClaudeStreamMessage => ({
  type: 'assistant',
  message: { content: [{ type: 'text', text }] },
  receivedAt: '2026-06-25T00:00:03.000Z',
});

describe('reconcileEchoedUserMessage', () => {
  test('命中：回显替换乐观消息，长度与顺序不变', () => {
    const prev = [optimisticUser('你好世界')];
    const next = reconcileEchoedUserMessage(prev, echoedUser('你好世界'));

    expect(next).toHaveLength(1);
    expect(next[0].uiOptimisticPrompt).toBe(false);
    expect(next[0].uiOnly).toBe(false);
    expect(next[0].timestamp).toBe('2026-06-25T00:00:05.000Z');
  });

  test('命中：保留乐观消息的 sentAt 作为统一时钟', () => {
    const prev = [optimisticUser('保留时钟', '2026-06-25T00:00:01.000Z')];
    const next = reconcileEchoedUserMessage(prev, echoedUser('保留时钟'));

    expect(next[0].sentAt).toBe('2026-06-25T00:00:01.000Z');
  });

  test('未命中：无对应乐观消息时追加', () => {
    const prev = [assistant('某条回答')];
    const next = reconcileEchoedUserMessage(prev, echoedUser('全新输入'));

    expect(next).toHaveLength(2);
    expect(next[1].type).toBe('user');
  });

  test('文本归一化匹配：多余空白不影响命中', () => {
    const prev = [optimisticUser('a   b')];
    const next = reconcileEchoedUserMessage(prev, echoedUser('a b'));

    expect(next).toHaveLength(1);
    expect(next[0].uiOptimisticPrompt).toBe(false);
  });

  test('连发相同 prompt：仅吸收一条乐观消息，不误并第二条', () => {
    // 第一条已对账成真实消息（uiOptimisticPrompt:false），第二条仍是乐观待对账。
    const reconciledFirst: ClaudeStreamMessage = {
      ...echoedUser('重复发送', '2026-06-25T00:00:05.000Z'),
      sentAt: '2026-06-25T00:00:01.000Z',
      uiOptimisticPrompt: false,
      uiOnly: false,
    };
    const prev = [reconciledFirst, assistant('第一次回答'), optimisticUser('重复发送', '2026-06-25T00:00:10.000Z')];

    const next = reconcileEchoedUserMessage(prev, echoedUser('重复发送', '2026-06-25T00:00:12.000Z'));

    // 长度不变（替换了第三项的乐观消息），第一项保持已对账状态。
    expect(next).toHaveLength(3);
    expect(next[0]).toBe(prev[0]);
    expect(next[2].uiOptimisticPrompt).toBe(false);
    expect(next[2].timestamp).toBe('2026-06-25T00:00:12.000Z');
  });

  test('尾部窗口外的乐观消息不被误吸收', () => {
    const prev: ClaudeStreamMessage[] = [
      optimisticUser('远古输入'),
      ...Array.from({ length: 8 }, (_, i) => assistant(`填充 ${i}`)),
    ];
    const next = reconcileEchoedUserMessage(prev, echoedUser('远古输入'));

    // 乐观消息在窗口（最后 8 条）之外 → 追加而非替换。
    expect(next).toHaveLength(prev.length + 1);
    expect(next[0].uiOptimisticPrompt).toBe(true);
  });

  test('保留乐观消息的翻译信息', () => {
    const opt = optimisticUser('翻译消息');
    opt.translationMeta = { wasTranslated: true, detectedLanguage: 'zh', translatedText: 'translated' };
    const next = reconcileEchoedUserMessage([opt], echoedUser('翻译消息'));

    expect(next[0].translationMeta?.translatedText).toBe('translated');
  });

  test('纯函数：不修改入参数组', () => {
    const prev = [optimisticUser('不可变')];
    const snapshot = prev[0];
    reconcileEchoedUserMessage(prev, echoedUser('不可变'));

    expect(prev[0]).toBe(snapshot);
    expect(prev[0].uiOptimisticPrompt).toBe(true);
  });
});
