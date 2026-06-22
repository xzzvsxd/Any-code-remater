import React, { useState, useEffect, useRef } from "react";
import { BrainCircuit, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  SESSION_MESSAGE_LAYOUT_CHANGED_EVENT,
  type SessionMessageLayoutChangedReason,
} from "@/components/session/sessionMessageLayoutEvents";

interface ThinkingBlockProps {
  /** 思考内容 */
  content: string;
  /** 是否正在流式输出 */
  isStreaming?: boolean;
  /** 流式结束后自动收起延迟 */
  autoCollapseDelay?: number;
  /** 保留兼容旧调用；思考内容不再逐字符打字，避免每帧重渲染 */
  typewriterSpeed?: number;
}

/**
 * 思考块组件
 *
 * 功能：
 * - 流式思考内容直接显示当前文本，避免逐字符 setState 造成 Linux/WebKitGTK 卡顿
 * - 默认展开状态
 * - 历史消息默认收起；流式思考结束后延迟自动收起
 * - 支持手动展开/收起
 */
export const ThinkingBlock: React.FC<ThinkingBlockProps> = ({
  content,
  isStreaming = false,
  autoCollapseDelay = 2500,
}) => {
  const rootRef = useRef<HTMLDivElement>(null);
  // 历史消息首帧就保持收起，避免先按展开态测出大行高，再折叠后留下虚拟列表旧高度空白。
  // 正在流式输出的 thinking 仍然默认展开。
  const [isOpen, setIsOpen] = useState(isStreaming);

  // 历史消息只在首次挂载时默认收起；流式消息结束后只自动收起一次。
  // v5.29.64 已让 layout-change 后把真实 DOM 高度 resizeItem 回 TanStack cache，
  // 因此恢复延迟自动收起不会再留下虚拟高度空白。
  const hasInitializedHistoricalCollapseRef = useRef(false);
  const hasEverStreamedRef = useRef(isStreaming);
  const hasAutoCollapsedAfterStreamingRef = useRef(false);
  const autoCollapseTimerRef = useRef<number | null>(null);

  // 是否用户手动操作过（手动操作后不再自动收起）
  const userInteractedRef = useRef(false);

  const textToDisplay = content;
  const showStreamingCursor = isStreaming;

  const notifyLayoutChanged = (reason: SessionMessageLayoutChangedReason) => {
    if (typeof window === 'undefined') return;

    const rowElement = rootRef.current?.closest('[data-item-key]');
    const itemKey =
      rowElement?.getAttribute('data-item-key') ?? undefined;
    const itemIndexRaw = rowElement?.getAttribute('data-index');
    const itemIndex =
      itemIndexRaw != null && itemIndexRaw.trim() !== ''
        ? Number(itemIndexRaw)
        : undefined;

    window.requestAnimationFrame(() => {
      window.dispatchEvent(
        new CustomEvent(SESSION_MESSAGE_LAYOUT_CHANGED_EVENT, {
          detail: {
            reason,
            itemKey,
            itemIndex: Number.isFinite(itemIndex) ? itemIndex : undefined,
          },
        }),
      );
    });
  };

  const clearAutoCollapseTimer = () => {
    if (autoCollapseTimerRef.current !== null) {
      window.clearTimeout(autoCollapseTimerRef.current);
      autoCollapseTimerRef.current = null;
    }
  };
  
  // 处理分割符：将 ---divider--- 替换为可视化的分割线组件
  // 如果内容中包含分割符，说明是聚合后的多段思考
  const renderContent = () => {
    // 移除用于打字机计算的分割符干扰（虽然 useTypewriter 可能已经处理了纯文本）
    // 但在渲染阶段，我们需要将 textToDisplay 按分割符切分
    const parts = textToDisplay.split('---divider---');
    
    if (parts.length === 1) {
      return (
        <>
          {textToDisplay}
          {showStreamingCursor && (
            <span className="inline-block w-1 h-3 ml-0.5 bg-amber-500 rounded-sm" />
          )}
        </>
      );
    }
    
    return parts.map((part, index) => (
      <React.Fragment key={index}>
        {index > 0 && (
          <div className="flex items-center gap-2 my-3 opacity-50 select-none">
            <div className="h-px bg-amber-500/30 flex-1" />
            <div className="text-[10px] text-amber-700/50 dark:text-amber-300/50 font-mono">STEP {index + 1}</div>
            <div className="h-px bg-amber-500/30 flex-1" />
          </div>
        )}
        <span>{part.trim()}</span>
        {index === parts.length - 1 && showStreamingCursor && (
          <span className="inline-block w-1 h-3 ml-0.5 bg-amber-500 rounded-sm" />
        )}
      </React.Fragment>
    ));
  };

  // 历史消息默认收起；流式消息结束后按 autoCollapseDelay 延迟自动收起。
  useEffect(() => {
    if (isStreaming) {
      hasEverStreamedRef.current = true;
      clearAutoCollapseTimer();
      return;
    }

    if (!content || userInteractedRef.current) {
      clearAutoCollapseTimer();
      return;
    }

    if (!hasEverStreamedRef.current && !hasInitializedHistoricalCollapseRef.current) {
      setIsOpen((prev) => {
        if (prev) {
          notifyLayoutChanged('thinking-block-auto-collapse');
        }
        return false;
      });
      hasInitializedHistoricalCollapseRef.current = true;
      clearAutoCollapseTimer();
      return;
    }

    if (hasEverStreamedRef.current && !hasAutoCollapsedAfterStreamingRef.current) {
      clearAutoCollapseTimer();
      autoCollapseTimerRef.current = window.setTimeout(() => {
        autoCollapseTimerRef.current = null;
        if (userInteractedRef.current) return;

        hasAutoCollapsedAfterStreamingRef.current = true;
        setIsOpen((prev) => {
          if (prev) {
            notifyLayoutChanged('thinking-block-auto-collapse');
          }
          return false;
        });
      }, Math.max(0, autoCollapseDelay));
    }

    return clearAutoCollapseTimer;
  }, [isStreaming, content, autoCollapseDelay]);

  useEffect(() => {
    return clearAutoCollapseTimer;
  }, []);

  // 用户点击切换展开/收起
  const handleToggle = () => {
    clearAutoCollapseTimer();
    userInteractedRef.current = true;
    setIsOpen(prev => !prev);
    notifyLayoutChanged('thinking-block-toggle');
  };

  if (!content) return null;

  return (
    <div ref={rootRef} className="border-l-2 border-amber-500/30 bg-amber-500/5 rounded-md overflow-hidden my-2">
      {/* Header - 可点击切换 */}
      <button
        onClick={handleToggle}
        className="w-full cursor-pointer px-3 py-2 text-xs text-amber-700 dark:text-amber-300 font-medium hover:bg-amber-500/10 transition-colors select-none flex items-center gap-2 outline-none text-left"
      >
        <BrainCircuit className="w-3.5 h-3.5 opacity-70" />
        <span>Thinking Process</span>

        {showStreamingCursor && (
          <span className="inline-block w-1.5 h-3 bg-amber-500 rounded-full" />
        )}

        <span className="ml-auto flex items-center gap-2">
          <span className="text-[10px] opacity-60">
            {content.length} chars
          </span>
          <ChevronDown
            className={cn(
              "w-3.5 h-3.5 opacity-60 transition-transform duration-200",
              isOpen ? "rotate-180" : ""
            )}
          />
        </span>
      </button>

      {isOpen && (
      <div className="overflow-hidden">
        <div
          className="px-3 pb-3 pt-1"
        >
          <div className="text-xs text-muted-foreground/80 whitespace-pre-wrap font-mono leading-relaxed max-h-[400px] overflow-y-auto">
            {renderContent()}
          </div>
        </div>
      </div>
      )}
    </div>
  );
};

export default ThinkingBlock;
