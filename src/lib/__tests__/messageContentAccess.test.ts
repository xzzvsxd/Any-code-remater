import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  getMessageContent,
  normalizeMessageContentShape,
  normalizeMessagesContentShape,
} from '../messageContentAccess';
import { extractTrackedPromptText, isTrackedUserPrompt } from '../promptIndex';

describe('message content access and normalization', () => {
  test('normalizes legacy top-level user content into official message.content', () => {
    const legacyUser = {
      type: 'user',
      content: [{ type: 'text', text: '旧历史 prompt' }],
    } as any;

    const normalized = normalizeMessageContentShape(legacyUser) as any;

    expect(normalized).not.toBe(legacyUser);
    expect(normalized.content).toBe(legacyUser.content);
    expect(normalized.message).toEqual({
      role: 'user',
      content: legacyUser.content,
    });
    expect(getMessageContent(normalized)).toBe(legacyUser.content);
    expect(extractTrackedPromptText(normalized)).toMatchObject({
      text: '旧历史 prompt',
      hasTextContent: true,
      hasToolResult: false,
    });
    expect(isTrackedUserPrompt(normalized)).toBe(true);
  });

  test('normalizes legacy assistant and system content without overwriting existing message fields', () => {
    const legacyAssistant = {
      type: 'assistant',
      message: { role: 'assistant', usage: { input_tokens: 1, output_tokens: 2 } },
      content: [{ type: 'text', text: '旧历史回复' }],
    } as any;
    const legacySystem = {
      type: 'system',
      content: [{ type: 'text', text: '旧系统消息' }],
    } as any;

    const [assistant, system] = normalizeMessagesContentShape([
      legacyAssistant,
      legacySystem,
    ]) as any[];

    expect(assistant.message).toEqual({
      role: 'assistant',
      usage: { input_tokens: 1, output_tokens: 2 },
      content: legacyAssistant.content,
    });
    expect(system.message).toEqual({
      role: 'system',
      content: legacySystem.content,
    });
  });

  test('leaves current SDK rows and standalone thinking rows unchanged', () => {
    const current = {
      type: 'assistant',
      message: { role: 'assistant', content: [{ type: 'text', text: '当前格式' }] },
      content: [{ type: 'text', text: '旧字段不应覆盖当前格式' }],
    } as any;
    const thinking = {
      type: 'thinking',
      content: '保留独立 thinking',
    } as any;

    expect(normalizeMessageContentShape(current)).toBe(current);
    expect(normalizeMessageContentShape(thinking)).toBe(thinking);
  });

  test('Claude history is normalized at the API boundary before UI consumers see it', () => {
    const apiSource = readFileSync('src/lib/api.ts', 'utf8');

    expect(apiSource).toContain("import { normalizeMessagesContentShape } from '@/lib/messageContentAccess'");
    expect(apiSource).toContain('normalizeMessagesContentShape(history as any[])');
  });
});
