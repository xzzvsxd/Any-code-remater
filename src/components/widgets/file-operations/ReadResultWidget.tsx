/**
 * ✅ Read Result Widget - 文件内容结果展示
 *
 * 迁移自 ToolWidgets.tsx (原 474-635 行)
 * 用于展示文件读取的结果内容，支持语法高亮和行号显示
 */

import React, { useMemo, useState } from "react";
import { FileText, ChevronUp, ChevronDown } from "lucide-react";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { getClaudeSyntaxTheme } from "@/lib/claudeSyntaxTheme";
import { useTheme } from "@/contexts/ThemeContext";
import { getLanguage } from "../common/languageDetector";
import { cn } from "@/lib/utils";
import { useTranslation } from "@/hooks/useTranslation";
import {
  countLinesUpTo,
  shouldRenderCodeBlockAsPlainText,
} from "@/lib/markdownRenderSafety";

export interface ReadResultWidgetProps {
  /** 文件内容 */
  content: string;
  /** 文件路径（用于语法高亮） */
  filePath?: string;
}

/**
 * 解析内容，分离行号和代码。
 * 只在用户展开 Read 结果时调用；折叠态不能对大文件做 full split / full parse。
 */
const parseReadContent = (rawContent: string) => {
  const lines = rawContent.split('\n');
  const codeLines: string[] = [];
  let minLineNumber = Infinity;

  // 判断内容是否可能是带行号的格式
  // 如果超过 50% 的非空行匹配 "数字→" 格式，则认为是带行号的
  const nonEmptyLines = lines.filter(line => line.trim() !== '');
  if (nonEmptyLines.length === 0) {
    return { codeContent: rawContent, startLineNumber: 1 };
  }

  const parsableLines = nonEmptyLines.filter(line => /^\s*\d+→/.test(line)).length;
  const isLikelyNumbered = (parsableLines / nonEmptyLines.length) > 0.5;

  if (!isLikelyNumbered) {
    return { codeContent: rawContent, startLineNumber: 1 };
  }

  // 解析带行号的内容
  for (const line of lines) {
    const trimmedLine = line.trimStart();
    const match = trimmedLine.match(/^(\d+)→(.*)$/);

    if (match) {
      const lineNum = parseInt(match[1], 10);
      if (minLineNumber === Infinity) {
        minLineNumber = lineNum;
      }
      // 保留箭头后的代码内容
      codeLines.push(match[2]);
    } else if (line.trim() === '') {
      // 保留空行
      codeLines.push('');
    } else {
      // 格式异常的行渲染为空行
      codeLines.push('');
    }
  }

  // 移除末尾空行
  while (codeLines.length > 0 && codeLines[codeLines.length - 1] === '') {
    codeLines.pop();
  }

  return {
    codeContent: codeLines.join('\n'),
    startLineNumber: minLineNumber === Infinity ? 1 : minLineNumber
  };
};

const ReadResultBody: React.FC<{
  isExpanded: boolean;
  content: string;
  filePath?: string;
  theme: string;
}> = ({ isExpanded, content, filePath, theme }) => {
  if (!isExpanded) {
    return null;
  }

  return (
    <ReadResultExpandedContent
      content={content}
      filePath={filePath}
      theme={theme}
    />
  );
};

const ReadResultExpandedContent: React.FC<{
  content: string;
  filePath?: string;
  theme: string;
}> = ({ content, filePath, theme }) => {
  const language = getLanguage(filePath || '');
  const { codeContent, startLineNumber } = useMemo(() => parseReadContent(content), [content]);
  const shouldUsePlainText = shouldRenderCodeBlockAsPlainText(codeContent);

  return (
    <div className="rounded-lg border overflow-hidden bg-muted border-border/50">
      <div className="relative overflow-x-auto">
        {shouldUsePlainText ? (
          <pre
            className="m-0 max-h-[520px] overflow-auto whitespace-pre-wrap break-words bg-transparent p-3 font-mono text-xs text-foreground/80"
            style={{ overflowWrap: 'anywhere', wordBreak: 'break-word' }}
          >
            {codeContent}
          </pre>
        ) : (
          <SyntaxHighlighter
            language={language}
            style={getClaudeSyntaxTheme(theme === 'dark')}
            showLineNumbers
            startingLineNumber={startLineNumber}
            wrapLongLines={false}
            customStyle={{
              margin: 0,
              background: 'transparent',
              lineHeight: '1.6'
            }}
            codeTagProps={{
              style: {
                fontSize: '0.8rem'
              }
            }}
            lineNumberStyle={{
              minWidth: "3.5rem",
              paddingRight: "1rem",
              textAlign: "right",
              opacity: 0.5,
            }}
          >
            {codeContent}
          </SyntaxHighlighter>
        )}
      </div>
    </div>
  );
};

/**
 * 文件内容结果 Widget
 *
 * Features:
 * - 自动语法高亮
 * - 行号显示
 * - 大文件折叠
 * - 解析 Read 工具的行号格式 (如 "123→code")
 */
export const ReadResultWidget: React.FC<ReadResultWidgetProps> = ({ content, filePath }) => {
  const { theme } = useTheme();
  const { t } = useTranslation();

  // 折叠态只做有上限的换行扫描，避免大文件 Read 结果还没展开就 full split。
  const lineSummary = countLinesUpTo(content, 10_000);
  const lineLabel = lineSummary.exceeded
    ? `>${(lineSummary.lineCount - 1).toLocaleString()}`
    : lineSummary.lineCount.toLocaleString();
  // 所有文件默认折叠
  const [isExpanded, setIsExpanded] = useState(false);
  const fileName = filePath ? filePath.split(/[/\\]/).pop() : t('tool.fileContent', '文件内容');

  return (
    <div className="w-full">
      {/* 头部 - Detached Header Style */}
      <div
        className={cn(
          "flex items-center justify-between bg-muted/30 p-2.5 rounded-md border border-border/50 mb-2 group/header select-none transition-colors",
          "cursor-pointer hover:bg-muted/50"
        )}
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="flex items-center gap-3 flex-1 min-w-0 overflow-hidden">
          <div
            className="flex items-center gap-2 flex-1 min-w-0 whitespace-nowrap overflow-hidden"
            style={{ overflowWrap: 'normal', wordBreak: 'keep-all' }}
          >
            <FileText className="h-4 w-4 text-blue-500 flex-shrink-0" />
            <span
              className="text-sm font-medium text-muted-foreground flex-shrink-0 whitespace-nowrap"
              style={{ whiteSpace: 'nowrap', wordBreak: 'keep-all' }}
            >
              {t('tool.read', '读取')}
            </span>
            <span className="text-muted-foreground/30 flex-shrink-0">|</span>
            <span className="text-sm font-mono text-foreground/90 font-medium truncate min-w-0 flex-1" title={filePath}>
              {fileName}
            </span>
            {filePath && (
              <span className="text-xs text-muted-foreground truncate hidden md:inline-block max-w-[200px] opacity-70 flex-shrink-0">
                {filePath}
              </span>
            )}
          </div>
          <span className="text-xs text-muted-foreground ml-1 flex-shrink-0 font-mono">
            ({lineLabel} {t('tool.lines', '行')})
          </span>
        </div>

        {/* 折叠按钮 */}
        <div className="h-6 px-2 ml-2 text-muted-foreground group-hover/header:text-foreground flex items-center gap-1 transition-colors">
          {isExpanded ? (
            <ChevronUp className="h-3.5 w-3.5" />
          ) : (
            <ChevronDown className="h-3.5 w-3.5" />
          )}
        </div>
      </div>

      {/* 代码内容 - Separated Box */}
      <ReadResultBody
        isExpanded={isExpanded}
        content={content}
        filePath={filePath}
        theme={theme}
      />
    </div>
  );
};
