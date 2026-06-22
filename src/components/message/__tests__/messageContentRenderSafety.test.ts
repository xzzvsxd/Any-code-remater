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

const resultMessageSource = readFileSync(
  resolve(process.cwd(), 'src/components/message/ResultMessage.tsx'),
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

  test('ResultMessage gates large error output before Markdown and Prism rendering', () => {
    expect(resultMessageSource).toContain('shouldRenderMarkdownAsPlainText');
    expect(resultMessageSource).toContain('LargePlainTextContent');
    expect(resultMessageSource).toContain('shouldRenderCodeBlockAsPlainText(codeStr)');
  });

  test('ResultMessage avoids unbounded JSON.stringify for object error payloads', () => {
    expect(resultMessageSource).toContain('MAX_RESULT_CONTENT_CHARS');
    expect(resultMessageSource).toContain('appendBoundedResultText');
    expect(resultMessageSource).not.toContain('JSON.stringify(value, null, 2)');
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

  test('ThinkingBlock avoids per-character streaming renders and layout-height transitions', () => {
    expect(thinkingBlockSource).toContain('const textToDisplay = content');
    expect(thinkingBlockSource).not.toContain('useTypewriter(');
    expect(thinkingBlockSource).not.toContain('transition-all');
    expect(thinkingBlockSource).not.toContain('max-h-[500px]');
    expect(thinkingBlockSource).not.toContain('setTimeout(() =>');
  });

  test('message scroll container does not blanket-disable loader animations', () => {
    expect(sessionMessagesSource).toContain('session-message-scroll');
    expect(animationsCssSource).toContain('cli-processing-spark');
    expect(animationsCssSource).toContain('cli-processing-progress');
    expect(animationsCssSource).not.toContain('.session-message-scroll .animate-spin');
    expect(animationsCssSource).not.toContain('.session-message-scroll .animate-pulse');
    expect(animationsCssSource).not.toContain('.session-message-scroll .animate-bounce');
  });
});
