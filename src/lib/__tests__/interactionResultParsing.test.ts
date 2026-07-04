import { describe, expect, test } from 'vitest';
import {
  extractInteractionResultText,
  parseAskUserAnswersFromResultContent,
  resolveAskUserResultStatus,
  resolvePlanResultStatus,
} from '../interactionResultParsing';

describe('interaction result parsing', () => {
  test('parses canonical ask-user bridge answer text into question keyed answers', () => {
    const content = [
      {
        type: 'text',
        text: [
          '以下是我对上述问题的回答：',
          '',
          '问题：是否继续？',
          '回答：继续',
          '',
          '问题：选择平台？',
          '回答：Linux、macOS',
        ].join('\n'),
      },
    ];

    expect(parseAskUserAnswersFromResultContent(content)).toEqual({
      '是否继续？': '继续',
      '选择平台？': 'Linux、macOS',
    });
    expect(resolveAskUserResultStatus(content, false)).toBe('answered');
  });

  test('keeps deferred ask-user responses distinct from answered responses', () => {
    const content = '用户暂时没想好，暂时不回答。请不要替用户选择；如果可以继续处理不依赖该答案的部分就继续，否则暂停等待用户后续说明。';

    expect(parseAskUserAnswersFromResultContent(content)).toEqual({});
    expect(resolveAskUserResultStatus(content, false)).toBe('deferred');
  });

  test('parses legacy quoted ask-user answer format', () => {
    const content = '"是否继续？"="继续"\n"选择平台？"="Linux"';

    expect(parseAskUserAnswersFromResultContent(content)).toEqual({
      '是否继续？': '继续',
      '选择平台？': 'Linux',
    });
  });

  test('extracts text from nested MCP content blocks', () => {
    expect(extractInteractionResultText({
      content: [
        { type: 'text', text: '第一段' },
        { text: '第二段' },
      ],
    })).toBe('第一段\n第二段');
  });

  test('does not treat plan defer text containing 批准 as approved', () => {
    const content = [
      {
        type: 'text',
        text: '用户暂时未决定是否批准该计划。请不要执行计划；先暂停，等待用户后续确认或修改意见。',
      },
    ];

    expect(resolvePlanResultStatus(content, false)).toBe('deferred');
  });

  test('resolves approved and rejected plan bridge results from text blocks', () => {
    expect(resolvePlanResultStatus([{ text: '用户已【批准】该计划。请立即开始执行上述计划。' }], false)).toBe('approved');
    expect(resolvePlanResultStatus([{ text: '用户【拒绝】了该计划。请不要执行。' }], false)).toBe('rejected');
  });
});
