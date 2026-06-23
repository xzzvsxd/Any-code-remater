import { describe, expect, test } from 'vitest';
import { extractImagePathsFromText } from '../MessageImagePreview';

describe('message image path extraction', () => {
  test('keeps plain first prompts unchanged when no image extension is present', () => {
    const prompt = '请分析  /home/project/src/main.ts  和  C:\\Users\\me\\notes.md\n保留原始空格';

    expect(extractImagePathsFromText(prompt)).toEqual({
      images: [],
      cleanText: prompt,
    });
  });

  test('still extracts image paths when an image extension is present', () => {
    const result = extractImagePathsFromText('请看 @"/tmp/screenshots/a b.png" 后继续');

    expect(result.images).toEqual([
      {
        sourceType: 'file',
        data: '/tmp/screenshots/a b.png',
      },
    ]);
    expect(result.cleanText).toBe('请看 后继续');
  });
});
