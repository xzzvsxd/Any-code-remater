import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const messageContentSource = readFileSync(
  resolve(process.cwd(), 'src/components/message/MessageContent.tsx'),
  'utf8',
);

const codePreviewSource = readFileSync(
  resolve(process.cwd(), 'src/components/widgets/file-operations/components/CodePreview.tsx'),
  'utf8',
);

const readResultSource = readFileSync(
  resolve(process.cwd(), 'src/components/widgets/file-operations/ReadResultWidget.tsx'),
  'utf8',
);

describe('message render safety wiring', () => {
  test('MessageContent gates typewriter and huge markdown through safety policies', () => {
    expect(messageContentSource).toContain('shouldUseIncrementalTypewriter');
    expect(messageContentSource).toContain('shouldRenderMarkdownAsPlainText');
    expect(messageContentSource).toContain('LargePlainTextContent');
  });

  test('CodePreview disables streaming typewriter and Prism for unsafe code previews', () => {
    expect(codePreviewSource).toContain('shouldUseIncrementalTypewriter');
    expect(codePreviewSource).toContain('shouldRenderCodeBlockAsPlainText');
  });

  test('ReadResultWidget avoids full parse and syntax highlighting while collapsed', () => {
    expect(readResultSource).toContain('countLinesUpTo');
    expect(readResultSource).toMatch(/if \(!isExpanded\) \{\s*return null;\s*\}/);
    expect(readResultSource).toContain('shouldRenderCodeBlockAsPlainText(codeContent)');
  });
});
