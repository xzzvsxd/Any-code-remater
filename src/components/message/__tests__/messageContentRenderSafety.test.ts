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

const userMessageSource = readFileSync(
  resolve(process.cwd(), 'src/components/message/UserMessage.tsx'),
  'utf8',
);

const thinkingBlockSource = readFileSync(
  resolve(process.cwd(), 'src/components/message/ThinkingBlock.tsx'),
  'utf8',
);

const sessionMessagesSource = readFileSync(
  resolve(process.cwd(), 'src/components/session/SessionMessages.tsx'),
  'utf8',
);

const animationsCssSource = readFileSync(
  resolve(process.cwd(), 'src/styles/animations.css'),
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

  test('UserMessage detects long prompts with bounded line scanning', () => {
    expect(userMessageSource).toContain('countLinesUpTo');
    expect(userMessageSource).not.toContain(".split('\\n').length");
  });

  test('streaming message row cursors avoid continuous pulse animations', () => {
    expect(messageContentSource).not.toContain('animate-pulse');
    expect(thinkingBlockSource).not.toContain('animate-pulse');
    expect(codePreviewSource).not.toContain('animate-pulse');
  });

  test('message scroll container disables continuous Tailwind animations inside streamed history', () => {
    expect(sessionMessagesSource).toContain('session-message-scroll');
    expect(animationsCssSource).toContain('.session-message-scroll .animate-spin');
    expect(animationsCssSource).toContain('.session-message-scroll .animate-pulse');
    expect(animationsCssSource).toContain('.session-message-scroll .animate-bounce');
    expect(animationsCssSource).toContain('animation: none !important');
  });
});
