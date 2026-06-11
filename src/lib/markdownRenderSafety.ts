export const MAX_SYNTAX_HIGHLIGHT_CHARS = 80_000;
export const MAX_SYNTAX_HIGHLIGHT_LINES = 2_000;

/**
 * Linux WebKit 对超大代码块做 Prism 语法高亮时容易形成长任务：
 * Markdown parse + Prism tokenize + 行号/包行渲染会把主线程打满，严重时表现为白屏。
 * 超过阈值时降级为纯文本代码块，保留完整内容与复制能力，只跳过高亮分词。
 */
export function shouldRenderCodeBlockAsPlainText(code: string): boolean {
  if (code.length > MAX_SYNTAX_HIGHLIGHT_CHARS) {
    return true;
  }

  let lineCount = 1;
  for (let index = 0; index < code.length; index += 1) {
    if (code.charCodeAt(index) === 10) {
      lineCount += 1;
      if (lineCount > MAX_SYNTAX_HIGHLIGHT_LINES) {
        return true;
      }
    }
  }

  return false;
}
