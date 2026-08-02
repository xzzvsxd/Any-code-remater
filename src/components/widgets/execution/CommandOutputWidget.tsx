/**
 * ✅ Command Output Widget - 命令执行输出展示
 *
 * 迁移自 ToolWidgets.tsx (原 1875-1973 行)
 * 用于展示命令执行的输出结果，支持 ANSI 样式解析和链接检测
 */

import React from "react";
import { ChevronRight } from "lucide-react";
import { detectLinks, makeLinksClickable } from "@/lib/linkDetector";
import { countLinesUpTo } from "@/lib/markdownRenderSafety";
import { normalizeLegacyCompactOutput } from "@/lib/compactLifecycle";
import { CompactLifecycleMessage } from "@/components/message/CompactLifecycleMessage";

const MAX_CLICKABLE_OUTPUT_CHARS = 80_000;
const MAX_CLICKABLE_OUTPUT_LINES = 2_000;
const MAX_OUTPUT_PREVIEW_CHARS = 120_000;

const getSafeOutputPreview = (output: string, maxChars = MAX_OUTPUT_PREVIEW_CHARS): string => {
  if (output.length <= maxChars) {
    return output;
  }

  return `${output.slice(0, maxChars)}\n\n…输出过长，已截断预览（保留前 ${maxChars.toLocaleString()} 字符以避免 Linux WebKit 渲染卡死）…`;
};

const shouldUsePlainTextOutput = (output: string): boolean => {
  if (output.length > MAX_CLICKABLE_OUTPUT_CHARS) {
    return true;
  }

  return countLinesUpTo(output, MAX_CLICKABLE_OUTPUT_LINES).exceeded;
};

export interface CommandOutputWidgetProps {
  /** 命令输出内容 */
  output: string;
  /** 链接检测回调 */
  onLinkDetected?: (url: string) => void;
}

/**
 * 命令输出 Widget
 *
 * Features:
 * - ANSI 样式解析（粗体等）
 * - 自动链接检测和可点击
 * - /compact 命令成功的特殊样式
 */
export const CommandOutputWidget: React.FC<CommandOutputWidgetProps> = ({
  output,
  onLinkDetected,
}) => {
  const safeOutput = React.useMemo(() => getSafeOutputPreview(output), [output]);
  const plainTextOutput = shouldUsePlainTextOutput(output);
  const compactLifecycle = normalizeLegacyCompactOutput(output);

  // 链接检测
  React.useEffect(() => {
    if (output && onLinkDetected) {
      const links = detectLinks(getSafeOutputPreview(output, MAX_CLICKABLE_OUTPUT_CHARS));
      if (links.length > 0) {
        // 通知第一个检测到的链接
        onLinkDetected(links[0].fullUrl);
      }
    }
  }, [output, onLinkDetected]);

  // ANSI 样式解析函数
  const parseAnsiToReact = (text: string) => {
    // 简单的 ANSI 解析 - 处理粗体 (\u001b[1m) 和重置 (\u001b[22m)
    const parts = text.split(/(\u001b\[\d+m)/);
    let isBold = false;
    const elements: React.ReactNode[] = [];

    parts.forEach((part, idx) => {
      if (part === '\u001b[1m') {
        isBold = true;
        return;
      } else if (part === '\u001b[22m') {
        isBold = false;
        return;
      } else if (part.match(/\u001b\[\d+m/)) {
        // 忽略其他 ANSI 代码
        return;
      }

      if (!part) return;

      // 将链接变为可点击
      const linkElements = makeLinksClickable(part, (url) => {
        onLinkDetected?.(url);
      });

      if (isBold) {
        elements.push(
          <span key={idx} className="font-bold">
            {linkElements}
          </span>
        );
      } else {
        elements.push(...linkElements);
      }
    });

    return elements;
  };

  // /compact 命令成功的特殊渲染
  if (compactLifecycle) {
    return <CompactLifecycleMessage lifecycle={compactLifecycle} />;
  }

  // 常规输出渲染
  return (
    <div className="rounded-lg border overflow-hidden bg-zinc-100 dark:bg-zinc-950/50 border-zinc-300 dark:border-zinc-800">
      <div className="px-4 py-2 flex items-center gap-2 bg-zinc-200/50 dark:bg-zinc-700/30">
        <ChevronRight className="h-3 w-3 text-success" />
        <span className="text-xs font-mono text-success">输出</span>
      </div>
      <div className="p-3">
        <pre className="text-sm font-mono whitespace-pre-wrap text-zinc-700 dark:text-zinc-300">
          {output
            ? plainTextOutput
              ? safeOutput
              : parseAnsiToReact(safeOutput)
            : <span className="italic text-zinc-400 dark:text-zinc-500">无输出</span>}
        </pre>
      </div>
    </div>
  );
};
