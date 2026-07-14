import React, { useState } from "react";
import { Info, Terminal, AlertCircle, Command, ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { toolRegistry } from "@/lib/toolRegistry";
import { shouldRenderStructuredCommandOutputAsPlainText } from "@/lib/markdownRenderSafety";
import { LargePlainTextContent } from "./MessageContent";
import { MessageActions } from "./MessageActions";
import type { ClaudeStreamMessage } from "@/types/claude";

/**
 * 格式化斜杠命令输出
 * 提取 <local-command-stdout> 标签内的内容并美化显示
 */
const formatCommandOutput = (text: string): React.ReactNode => {
  // 提取 local-command-stdout 内容
  const match = text.match(/<local-command-stdout>([\s\S]*?)<\/local-command-stdout>/);
  if (!match) return text;

  const content = match[1].trim();
  if (shouldRenderStructuredCommandOutputAsPlainText(content)) {
    return <LargePlainTextContent content={content} />;
  }

  // 检测是否是表格格式（包含 | 分隔符）
  const isTable = content.includes('|') && content.includes('---');

  if (isTable) {
    // 解析并渲染表格
    const lines = content.split('\n').filter(line => line.trim());
    const tableRows: string[][] = [];
    const nonTableLines: string[] = [];

    for (const line of lines) {
      // 跳过分隔行（如 |---|---|---|）
      if (line.match(/^\|[-\s|]+\|$/)) continue;

      // 检查是否是表格行
      if (line.includes('|') && !line.startsWith('#')) {
        const cells = line.split('|').filter(cell => cell.trim()).map(cell => cell.trim());
        if (cells.length > 0) {
          tableRows.push(cells);
        }
      } else {
        nonTableLines.push(line);
      }
    }

    if (tableRows.length > 0) {
      const [header, ...dataRows] = tableRows;
      return (
        <div className="space-y-3">
          {/* 非表格内容（如标题） */}
          {nonTableLines.map((line, i) => (
            line.trim() && (
              <div key={i} className={line.startsWith('#') ? 'font-semibold text-foreground' : ''}>
                {line.replace(/^#+\s*/, '')}
              </div>
            )
          ))}

          {/* 表格 */}
          <div className="overflow-x-auto">
            <table className="text-xs w-full border-collapse">
              <thead>
                <tr className="border-b border-border/50">
                  {header.map((cell, i) => (
                    <th key={i} className="text-left py-1.5 px-2 font-medium text-foreground/80">
                      {cell}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {dataRows.map((row, rowIdx) => (
                  <tr key={rowIdx} className="border-b border-border/30 last:border-0">
                    {row.map((cell, cellIdx) => (
                      <td key={cellIdx} className="py-1.5 px-2 text-muted-foreground">
                        {cell}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      );
    }
  }

  // 非表格内容 - 简单格式化显示
  return (
    <div className="space-y-1">
      {content.split('\n').map((line, i) => {
        const trimmedLine = line.trim();
        if (!trimmedLine) return null;

        // 标题样式
        if (trimmedLine.startsWith('#')) {
          return (
            <div key={i} className="font-semibold text-foreground mt-2 first:mt-0">
              {trimmedLine.replace(/^#+\s*/, '')}
            </div>
          );
        }

        // 键值对样式（如 **Key:** Value）
        const kvMatch = trimmedLine.match(/^\*\*(.+?)\*\*:?\s*(.*)$/);
        if (kvMatch) {
          return (
            <div key={i} className="flex gap-2">
              <span className="font-medium text-foreground/80">{kvMatch[1]}:</span>
              <span>{kvMatch[2]}</span>
            </div>
          );
        }

        // 普通行
        return <div key={i}>{trimmedLine}</div>;
      })}
    </div>
  );
};

interface SystemMessageProps {
  message: ClaudeStreamMessage;
  className?: string;
  claudeSettings?: { showSystemInitialization?: boolean };
  branchPromptIndex?: number;
  onBranch?: (promptIndex: number) => void | Promise<void>;
}

const formatTimestamp = (timestamp: string | undefined): string => {
  if (!timestamp) {
    return "";
  }

  try {
    const date = new Date(timestamp);
    if (Number.isNaN(date.getTime())) {
      return "";
    }

    return date.toLocaleTimeString("zh-CN", {
      hour12: false,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return "";
  }
};

const extractMessageContent = (message: ClaudeStreamMessage): string => {
  const content = message.message?.content;

  if (!content) {
    return "";
  }

  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (typeof item === "string") {
          return item;
        }
        if (item && typeof item === "object" && typeof item.text === "string") {
          return item.text;
        }
        if (item && typeof item === "object" && typeof item.content === "string") {
          return item.content;
        }
        try {
          return JSON.stringify(item, null, 2);
        } catch {
          return String(item);
        }
      })
      .filter(Boolean)
      .join("\n");
  }

  if (typeof content === "object") {
    if (typeof (content as any).text === "string") {
      return (content as any).text;
    }
    if (typeof (content as any).message === "string") {
      return (content as any).message;
    }

    try {
      return JSON.stringify(content, null, 2);
    } catch {
      return String(content);
    }
  }

  return String(content);
};

export const SystemMessage: React.FC<SystemMessageProps> = ({
  message,
  className,
  claudeSettings,
  branchPromptIndex,
  onBranch,
}) => {
  const subtype = message.subtype;

  if (subtype === "init") {
    const showSystemInit = claudeSettings?.showSystemInitialization !== false;
    if (!showSystemInit) {
      return null;
    }

    const renderer = toolRegistry.getRenderer("system_initialized");

    if (renderer) {
      const Renderer = renderer.render;
      return (
        <div className={cn("my-4", className)}>
          <Renderer
            toolName="system_initialized"
            input={{
              sessionId: (message as any).session_id ?? (message as any).sessionId ?? undefined,
              model: (message as any).model ?? undefined,
              cwd: (message as any).cwd ?? undefined,
              tools: (message as any).tools ?? undefined,
              timestamp: (message as any).receivedAt ?? (message as any).timestamp ?? undefined,
            }}
          />
        </div>
      );
    }

    // Fallback rendering when registry is unavailable
    return (
      <div className={cn("my-4", className)}>
        <div className="rounded-lg border border-border bg-muted/20 px-4 py-3 text-sm text-muted-foreground">
          系统初始化完成。
        </div>
      </div>
    );
  }

  // 🆕 处理斜杠命令输出（如 /cost, /context）
  if (subtype === "command-output") {
    return <CommandOutputMessage message={message} className={className} />;
  }

  if (subtype === "execution-complete" || subtype === "execution-cancelled" || subtype === "execution-error") {
    return (
      <ExecutionStatusMessage
        message={message}
        className={className}
        branchPromptIndex={branchPromptIndex}
        onBranch={onBranch}
      />
    );
  }

  // 🆕 处理斜杠命令错误（如 "Unknown slash command: help"）
  if (subtype === "command-error") {
    return <CommandErrorMessage message={message} className={className} />;
  }

  // 🆕 处理斜杠命令元信息（如 <command-name>/cost</command-name>）
  if (subtype === "command-meta") {
    const content = extractMessageContent(message);
    if (!content) return null;

    // 提取命令名称
    const commandNameMatch = content.match(/<command-name>([^<]+)<\/command-name>/);
    const commandMessageMatch = content.match(/<command-message>([^<]+)<\/command-message>/);
    const commandName = commandNameMatch ? commandNameMatch[1] : null;
    const commandMessage = commandMessageMatch ? commandMessageMatch[1] : null;

    const formattedTime = formatTimestamp((message as any).receivedAt ?? (message as any).timestamp);

    return (
      <div className={cn("my-2", className)}>
        <div className="rounded-lg border border-border/30 bg-muted/20 px-3 py-2 text-sm">
          <div className="flex items-center gap-2 text-xs text-muted-foreground/80">
            <Command className="h-3.5 w-3.5" />
            {commandName ? (
              <span>
                执行命令 <code className="rounded bg-muted px-1 py-0.5 font-mono text-foreground/80">{commandName}</code>
              </span>
            ) : commandMessage ? (
              <span>{commandMessage}</span>
            ) : (
              <span>命令执行中...</span>
            )}
            {formattedTime && (
              <>
                <span className="text-muted-foreground/40">•</span>
                <span className="font-mono text-muted-foreground/70">{formattedTime}</span>
              </>
            )}
          </div>
        </div>
      </div>
    );
  }

  const content = extractMessageContent(message);
  if (!content) {
    return null;
  }

  const formattedTime = formatTimestamp((message as any).receivedAt ?? (message as any).timestamp);

  return (
    <div className={cn("my-4", className)}>
      <div className="rounded-lg border border-dashed border-border bg-muted/10 px-4 py-3 text-sm text-muted-foreground">
        <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground/80">
          <Info className="h-3.5 w-3.5" />
          系统消息
          {formattedTime && (
            <>
              <span className="text-muted-foreground/40">•</span>
              <span className="font-mono normal-case text-muted-foreground/70">{formattedTime}</span>
            </>
          )}
        </div>
        <div className="whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">
          {content}
        </div>
      </div>
    </div>
  );
};

SystemMessage.displayName = "SystemMessage";

const ExecutionStatusMessage: React.FC<{
  message: ClaudeStreamMessage;
  className?: string;
  branchPromptIndex?: number;
  onBranch?: (promptIndex: number) => void | Promise<void>;
}> = ({
  message,
  className,
  branchPromptIndex,
  onBranch,
}) => {
  const content = (message as any).result || extractMessageContent(message);
  if (!content) return null;

  const subtype = message.subtype;
  const formattedTime = formatTimestamp((message as any).receivedAt ?? (message as any).timestamp);
  const isComplete = subtype === "execution-complete";
  const isCancelled = subtype === "execution-cancelled";
  const title = isComplete ? "AI 执行完成" : isCancelled ? "已取消当前会话" : "AI 执行失败";
  const Icon = isComplete ? Info : isCancelled ? Terminal : AlertCircle;

  return (
    <div className={cn("group relative my-4", className)}>
      {branchPromptIndex !== undefined && branchPromptIndex >= 0 && onBranch && (
        <div className="absolute -top-2 right-0 z-10 opacity-0 transition-opacity duration-200 group-hover:opacity-100">
          <MessageActions
            content={content}
            branchPromptIndex={branchPromptIndex}
            onBranch={onBranch}
          />
        </div>
      )}
      <div
        className={cn(
          "rounded-lg border px-4 py-3 text-sm",
          isComplete && "border-green-500/30 bg-green-500/10 text-green-800 dark:text-green-200",
          isCancelled && "border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-200",
          !isComplete && !isCancelled && "border-destructive/30 bg-destructive/10 text-destructive"
        )}
      >
        <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-wide">
          <Icon className="h-3.5 w-3.5" />
          {title}
          {formattedTime && (
            <>
              <span className="opacity-50">•</span>
              <span className="font-mono normal-case opacity-80">{formattedTime}</span>
            </>
          )}
        </div>
        <div className="whitespace-pre-wrap text-sm leading-relaxed">
          {content}
        </div>
      </div>
    </div>
  );
};

/**
 * 可折叠的命令输出消息组件
 */
const CommandOutputMessage: React.FC<{ message: ClaudeStreamMessage; className?: string }> = ({
  message,
  className,
}) => {
  const [isExpanded, setIsExpanded] = useState(true); // 默认展开
  const content = extractMessageContent(message);
  if (!content) return null;

  const formattedTime = formatTimestamp((message as any).receivedAt ?? (message as any).timestamp);

  return (
    <div className={cn("my-4", className)}>
      <div className="rounded-lg border border-border/50 bg-muted/30 text-sm overflow-hidden">
        {/* 可点击的头部 */}
        <div
          className="flex items-center justify-between px-4 py-2.5 cursor-pointer hover:bg-muted/50 transition-colors select-none"
          onClick={() => setIsExpanded(!isExpanded)}
        >
          <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground/80">
            <Terminal className="h-3.5 w-3.5" />
            命令输出
            {formattedTime && (
              <>
                <span className="text-muted-foreground/40">•</span>
                <span className="font-mono normal-case text-muted-foreground/70">{formattedTime}</span>
              </>
            )}
          </div>
          <div className="text-muted-foreground/60 hover:text-muted-foreground transition-colors">
            {isExpanded ? (
              <ChevronUp className="h-4 w-4" />
            ) : (
              <ChevronDown className="h-4 w-4" />
            )}
          </div>
        </div>

        {/* 可折叠的内容 */}
        {isExpanded && (
          <div className="px-4 pb-3 text-sm leading-relaxed text-muted-foreground border-t border-border/30">
            <div className="pt-3">
              {formatCommandOutput(content)}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

/**
 * 可折叠的命令错误消息组件
 */
const CommandErrorMessage: React.FC<{ message: ClaudeStreamMessage; className?: string }> = ({
  message,
  className,
}) => {
  const [isExpanded, setIsExpanded] = useState(true); // 默认展开
  const content = extractMessageContent(message);
  if (!content) return null;

  const formattedTime = formatTimestamp((message as any).receivedAt ?? (message as any).timestamp);

  return (
    <div className={cn("my-4", className)}>
      <div className="rounded-lg border border-destructive/30 bg-destructive/5 text-sm overflow-hidden">
        {/* 可点击的头部 */}
        <div
          className="flex items-center justify-between px-4 py-2.5 cursor-pointer hover:bg-destructive/10 transition-colors select-none"
          onClick={() => setIsExpanded(!isExpanded)}
        >
          <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-destructive/80">
            <AlertCircle className="h-3.5 w-3.5" />
            命令错误
            {formattedTime && (
              <>
                <span className="text-destructive/40">•</span>
                <span className="font-mono normal-case text-destructive/70">{formattedTime}</span>
              </>
            )}
          </div>
          <div className="text-destructive/60 hover:text-destructive transition-colors">
            {isExpanded ? (
              <ChevronUp className="h-4 w-4" />
            ) : (
              <ChevronDown className="h-4 w-4" />
            )}
          </div>
        </div>

        {/* 可折叠的内容 */}
        {isExpanded && (
          <div className="px-4 pb-3 text-sm leading-relaxed text-destructive/90 border-t border-destructive/20">
            <div className="pt-3">
              {content}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
