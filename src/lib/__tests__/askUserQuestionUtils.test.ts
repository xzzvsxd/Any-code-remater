import { describe, expect, test } from 'vitest';
import { getUnmatchedAnswerParts } from '../askUserQuestionUtils';

describe('askUserQuestionUtils', () => {
  test('keeps custom free-form answers visible when no preset option matches', () => {
    expect(
      getUnmatchedAnswerParts(
        '客户说“一长串那个就是”——那指的是 32 位 Client Secret，不是 8 位 AppKey。',
        [
          { label: '我再发给你' },
          { label: '只有这些凭证' },
          { label: '不确定哪个是app_secret' },
        ],
      ),
    ).toEqual([
      '客户说“一长串那个就是”——那指的是 32 位 Client Secret，不是 8 位 AppKey。',
    ]);
  });

  test('does not duplicate normal preset selections as custom answers', () => {
    expect(
      getUnmatchedAnswerParts('只有这些凭证', [
        { label: '我再发给你' },
        { label: '只有这些凭证' },
        { label: '不确定哪个是app_secret' },
      ]),
    ).toEqual([]);
  });

  test('preserves multi-select extra text while filtering matched option labels', () => {
    expect(
      getUnmatchedAnswerParts(['Linux', '还要兼容 AppImage 离线安装'], [
        { label: 'Windows' },
        { label: 'Linux' },
        { label: 'macOS' },
      ]),
    ).toEqual(['还要兼容 AppImage 离线安装']);
  });
});
