export const MAX_SYNTAX_HIGHLIGHT_CHARS = 40_000;
export const MAX_SYNTAX_HIGHLIGHT_LINES = 1_200;
export const MAX_MARKDOWN_RENDER_CHARS = 80_000;
export const MAX_MARKDOWN_RENDER_LINES = 2_000;
export const MAX_STREAMING_MARKDOWN_RENDER_CHARS = 24_000;
export const MAX_STREAMING_MARKDOWN_RENDER_LINES = 800;
export const MAX_MARKDOWN_FENCED_CODE_CHARS = 12_000;
export const MAX_MARKDOWN_FENCE_COUNT = 6;
export const MAX_INCREMENTAL_TYPEWRITER_CHARS = 12_000;
export const MAX_INCREMENTAL_TYPEWRITER_LINES = 200;
export const MAX_INCREMENTAL_TYPEWRITER_LINE_CHARS = 2_000;
export const MAX_STRUCTURED_COMMAND_OUTPUT_CHARS = 32_000;
export const MAX_STRUCTURED_COMMAND_OUTPUT_LINES = 900;

export interface IncrementalTypewriterOptions {
  isStreaming?: boolean;
  maxChars?: number;
  maxLines?: number;
  maxLineChars?: number;
}

export interface MarkdownRenderOptions {
  isStreaming?: boolean;
  maxChars?: number;
  maxLines?: number;
  maxFenceChars?: number;
  maxFenceCount?: number;
}

export interface BoundedLineCount {
  lineCount: number;
  exceeded: boolean;
}

/**
 * 有上限地统计换行数，避免为了一个折叠态摘要对超大字符串做完整 split。
 *
 * 返回的 lineCount 在 exceeded=true 时最多为 maxLines + 1，用来表达“超过上限”，
 * 调用方不应把它当作精确总行数。
 */
export function countLinesUpTo(text: string, maxLines: number): BoundedLineCount {
  const limit = Math.max(1, Math.floor(maxLines));
  let lineCount = 1;

  for (let index = 0; index < text.length; index += 1) {
    if (text.charCodeAt(index) === 10) {
      lineCount += 1;
      if (lineCount > limit) {
        return { lineCount, exceeded: true };
      }
    }
  }

  return { lineCount, exceeded: false };
}

/**
 * Linux WebKit 对超大代码块做 Prism 语法高亮时容易形成长任务：
 * Markdown parse + Prism tokenize + 行号/包行渲染会把主线程打满，严重时表现为白屏。
 * 超过阈值时降级为纯文本代码块，保留完整内容与复制能力，只跳过高亮分词。
 */
export function shouldRenderCodeBlockAsPlainText(code: string): boolean {
  if (code.length > MAX_SYNTAX_HIGHLIGHT_CHARS) {
    return true;
  }

  if (countLinesUpTo(code, MAX_SYNTAX_HIGHLIGHT_LINES).exceeded) {
    return true;
  }

  return false;
}

function getFenceMarkerAt(content: string, index: number): '```' | '~~~' | null {
  const marker = content.slice(index, index + 3);
  return marker === '```' || marker === '~~~' ? marker : null;
}

/**
 * Completed Markdown can still freeze WebKit if it contains a medium-sized
 * fenced code block: ReactMarkdown builds the full AST first, then Prism walks
 * the block again.  Detect those cases before entering ReactMarkdown.  This is
 * intentionally a single linear scan and avoids split()/matchAll() allocations
 * on large strings.
 */
export function hasUnsafeMarkdownCodeFences(
  content: string,
  maxFenceChars = MAX_MARKDOWN_FENCED_CODE_CHARS,
  maxFenceCount = MAX_MARKDOWN_FENCE_COUNT,
): boolean {
  let openFenceMarker: '```' | '~~~' | null = null;
  let openFenceContentStart = 0;
  let fenceCount = 0;

  for (let index = 0; index <= content.length - 3; index += 1) {
    const marker = getFenceMarkerAt(content, index);
    if (!marker) {
      continue;
    }

    if (!openFenceMarker) {
      openFenceMarker = marker;
      openFenceContentStart = index + 3;
      fenceCount += 1;
      if (fenceCount > maxFenceCount) {
        return true;
      }
      index += 2;
      continue;
    }

    if (marker === openFenceMarker) {
      if (index - openFenceContentStart > maxFenceChars) {
        return true;
      }
      openFenceMarker = null;
      openFenceContentStart = 0;
      index += 2;
    }
  }

  return openFenceMarker !== null && content.length - openFenceContentStart > maxFenceChars;
}

/**
 * ReactMarkdown + remark-gfm 会把 Markdown 展开成大量 React 节点；超大内容在 Linux
 * WebKitGTK 下容易把 renderer 主线程拖成白屏。超过阈值时改走“有界纯文本预览”，
 * 保留复制/展开能力，但默认不构造庞大的 Markdown AST/DOM。
 */
export function shouldRenderMarkdownAsPlainText(
  content: string,
  options: MarkdownRenderOptions = {},
): boolean {
  // 流式阶段任何 Markdown 都不应走 ReactMarkdown/remark/Prism。
  // 即使是普通列表/粗体，在高频 delta 下也会重复构建 Markdown AST 与 React 子树，
  // 在 Linux WebKitGTK、Windows WebView2 和低配 macOS 上都会变成主线程长任务。
  // 完成后再恢复 Markdown/高亮渲染，保留最终视觉质量。
  if (options.isStreaming) {
    return true;
  }

  const maxChars = Math.max(
    1,
    Math.floor(
      options.maxChars
      ?? (options.isStreaming ? MAX_STREAMING_MARKDOWN_RENDER_CHARS : MAX_MARKDOWN_RENDER_CHARS),
    ),
  );
  const maxLines = Math.max(
    1,
    Math.floor(
      options.maxLines
      ?? (options.isStreaming ? MAX_STREAMING_MARKDOWN_RENDER_LINES : MAX_MARKDOWN_RENDER_LINES),
    ),
  );

  if (content.length > maxChars) {
    return true;
  }

  if (countLinesUpTo(content, maxLines).exceeded) {
    return true;
  }

  return hasUnsafeMarkdownCodeFences(
    content,
    Math.max(1, Math.floor(options.maxFenceChars ?? MAX_MARKDOWN_FENCED_CODE_CHARS)),
    Math.max(1, Math.floor(options.maxFenceCount ?? MAX_MARKDOWN_FENCE_COUNT)),
  );
}

export function shouldRenderStructuredCommandOutputAsPlainText(
  content: string,
  options: { maxChars?: number; maxLines?: number } = {},
): boolean {
  const maxChars = Math.max(1, Math.floor(options.maxChars ?? MAX_STRUCTURED_COMMAND_OUTPUT_CHARS));
  const maxLines = Math.max(1, Math.floor(options.maxLines ?? MAX_STRUCTURED_COMMAND_OUTPUT_LINES));

  if (content.length > maxChars) {
    return true;
  }

  return countLinesUpTo(content, maxLines).exceeded;
}

/**
 * 打字机效果是纯视觉增强。若让它对长 Markdown/代码块逐字符推进，会在每一帧重新
 * ReactMarkdown parse + Prism tokenize，是 Linux/WebKitGTK 卡顿白屏的高危热路径。
 * 大内容或富 Markdown 直接显示当前流式文本，避免按字符制造额外渲染风暴。
 */
export function shouldUseIncrementalTypewriter(
  content: string,
  options: IncrementalTypewriterOptions = {},
): boolean {
  if (!options.isStreaming) {
    return false;
  }

  const maxChars = Math.max(1, Math.floor(options.maxChars ?? MAX_INCREMENTAL_TYPEWRITER_CHARS));
  const maxLines = Math.max(1, Math.floor(options.maxLines ?? MAX_INCREMENTAL_TYPEWRITER_LINES));
  const maxLineChars = Math.max(1, Math.floor(options.maxLineChars ?? MAX_INCREMENTAL_TYPEWRITER_LINE_CHARS));

  if (content.length > maxChars) {
    return false;
  }

  if (content.includes('```') || content.includes('~~~')) {
    return false;
  }

  const lineInfo = countLinesUpTo(content, maxLines);
  if (lineInfo.exceeded) {
    return false;
  }

  let currentLineLength = 0;
  for (let index = 0; index < content.length; index += 1) {
    if (content.charCodeAt(index) === 10) {
      currentLineLength = 0;
      continue;
    }
    currentLineLength += 1;
    if (currentLineLength > maxLineChars) {
      return false;
    }
  }

  return true;
}
