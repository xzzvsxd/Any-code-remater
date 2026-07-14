import React from "react";
import { ClaudeIcon } from "@/components/icons/ClaudeIcon";
import { CodexIcon } from "@/components/icons/CodexIcon";
import { GeminiIcon } from "@/components/icons/GeminiIcon";
import { MessageBubble } from "./MessageBubble";
import { MessageContent } from "./MessageContent";
import { ToolCallsGroup } from "./ToolCallsGroup";
import { ThinkingBlock } from "./ThinkingBlock";
import { MessageActions } from "./MessageActions";
import { cn } from "@/lib/utils";
import { tokenExtractor } from "@/lib/tokenExtractor";
import { formatTimestamp } from "@/lib/messageUtils";
import { getRenderableAiContentParts, summarizeRenderableAiContentParts } from "@/lib/aiMessageContent";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import type { ClaudeStreamMessage } from '@/types/claude';

interface AIMessageProps {
  /** 消息数据 */
  message: ClaudeStreamMessage;
  /** 是否正在流式输出 */
  isStreaming?: boolean;
  /** 自定义类名 */
  className?: string;
  /** 链接检测回调 */
  onLinkDetected?: (url: string) => void;
  branchPromptIndex?: number;
  onBranch?: (promptIndex: number) => void | Promise<void>;
}

/**
 * AI消息组件（重构版）
 * 左对齐卡片样式，支持工具调用展示和思考块
 *
 * 打字机效果逻辑：
 * - 统一依赖 isStreaming prop（只有在流式输出时才启用）
 * - isStreaming 由 SessionMessages 组件传入，表示当前是最后一条消息且会话正在进行
 * - 历史消息加载时 isStreaming=false，不会触发打字机效果
 */
export const AIMessage: React.FC<AIMessageProps> = ({
  message,
  isStreaming = false,
  className,
  onLinkDetected,
  branchPromptIndex,
  onBranch
}) => {
  const contentParts = getRenderableAiContentParts(message);
  const {
    text,
    hasToolCalls: hasTools,
    hasThinking,
    thinkingContent,
  } = summarizeRenderableAiContentParts(contentParts);

  // Detect engine type for avatar styling
  const isCodexMessage = (message as any).engine === 'codex';
  const isGeminiMessage = (message as any).geminiMetadata?.provider === 'gemini' || (message as any).engine === 'gemini';

  // 打字机效果只在流式输出时启用
  // isStreaming=true 表示：当前是最后一条消息 && 会话正在进行中
  const enableTypewriter = isStreaming;

  // 如果既没有文本又没有工具调用又没有思考块，不渲染
  if (!text && !hasTools && !hasThinking) return null;

  // 提取 tokens 统计
  const tokenStats = message.message?.usage ? (() => {
    const extractedTokens = tokenExtractor.extract({
      type: 'assistant',
      message: { usage: message.message.usage }
    });
    const parts = [`${extractedTokens.input_tokens}/${extractedTokens.output_tokens}`];
    if (extractedTokens.cache_creation_tokens > 0) {
      parts.push(`创建${extractedTokens.cache_creation_tokens}`);
    }
    if (extractedTokens.cache_read_tokens > 0) {
      parts.push(`缓存${extractedTokens.cache_read_tokens}`);
    }
    return parts.join(' | ');
  })() : null;

  const assistantName = isGeminiMessage ? 'Gemini' : isCodexMessage ? 'Codex' : 'Claude';
  
  // Select icon based on engine
  const Icon = isGeminiMessage ? GeminiIcon : isCodexMessage ? CodexIcon : ClaudeIcon;

  // 构建 tooltip 内容
  const formattedTime = formatTimestamp((message as any).receivedAt ?? (message as any).timestamp);
  const tooltipParts: string[] = [];
  if (formattedTime) tooltipParts.push(formattedTime);
  if (tokenStats) tooltipParts.push(tokenStats);

  return (
    <div className={cn("relative group", className)}>
      <MessageBubble variant="assistant">
        <div className="flex gap-4 items-start">
          {/* Left Column: Avatar with Tooltip */}
          <TooltipProvider delayDuration={300}>
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="flex-shrink-0 mt-0.5 select-none cursor-default">
                  <div className="flex items-center justify-center w-7 h-7 rounded-lg hover:bg-muted/50 transition-colors">
                    <Icon className={cn(isGeminiMessage || isCodexMessage ? "w-4 h-4" : "w-5 h-5")} />
                  </div>
                </div>
              </TooltipTrigger>
              {tooltipParts.length > 0 && (
                <TooltipContent side="right" className="text-[11px]">
                  <div className="flex flex-col gap-0.5">
                    <span className="font-medium">{assistantName}</span>
                    {formattedTime && <span className="text-muted-foreground">{formattedTime}</span>}
                    {tokenStats && <span className="font-mono text-muted-foreground">{tokenStats}</span>}
                  </div>
                </TooltipContent>
              )}
            </Tooltip>
          </TooltipProvider>

          {/* Right Column: Content */}
          <div className="flex-1 min-w-0 space-y-1 relative">
            {/* Actions Toolbar - Visible on Hover */}
            <div className="absolute -top-2 right-0 opacity-0 group-hover:opacity-100 transition-opacity duration-200 z-10">
              <MessageActions
                content={text || thinkingContent}
                branchPromptIndex={branchPromptIndex}
                onBranch={onBranch}
              />
            </div>

            {/* Main Content */}
            <div className="space-y-3">
              {contentParts.map((part, index) => {
                if (part.type === 'text') {
                  return (
                    <div
                      key={`text-${index}`}
                      className="prose prose-neutral dark:prose-invert max-w-none leading-relaxed text-[15px] break-words"
                      style={{ overflowWrap: 'anywhere' }}
                    >
                      <MessageContent
                        content={part.content}
                        isStreaming={enableTypewriter && !hasTools && !hasThinking && contentParts.length === 1}
                        enableTypewriter={enableTypewriter && !hasTools && !hasThinking && contentParts.length === 1}
                      />
                    </div>
                  );
                }

                if (part.type === 'thinking') {
                  // 思维块的"流式中"必须收紧为「整条消息流式 && 该 thinking 是最后一个 part」。
                  // contentParts 有序：若此 thinking 后面已出现 text/tools part，说明思考阶段早已结束、
                  // 模型已进入输出正文 / 调用工具。但整条 assistant 消息只要工具还在跑，enableTypewriter
                  // 就一直为 true —— 若直接透传，ThinkingBlock 依赖 isStreaming 变 false 的自动收起永不触发，
                  // 表现为"思维过程明明结束了却一直展开"。这里只在它仍是末尾 part 时才视为流式。
                  const isLastPart = index === contentParts.length - 1;
                  return (
                    <ThinkingBlock
                      key={`thinking-${index}`}
                      content={part.content}
                      isStreaming={enableTypewriter && isLastPart}
                      autoCollapseDelay={2500}
                    />
                  );
                }

                return (
                  <div key={`tools-${index}`} className="mt-2">
                    <ToolCallsGroup
                      message={message}
                      onLinkDetected={onLinkDetected}
                    />
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </MessageBubble>
    </div>
  );
};
