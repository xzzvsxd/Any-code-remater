import React, { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

interface CliProcessingIndicatorProps {
  isProcessing: boolean;
  onCancel?: () => void;
  engineName?: string;
  startedAt?: number | null;
  lastOutputAt?: number | null;
  elapsedSeconds?: number;
  idleSeconds?: number;
  canCancel?: boolean;
  isCancelling?: boolean;
}

// CLI风格的处理状态词汇
const PROCESSING_VERBS = [
  "Thinking",
  "Reasoning",
  "Analyzing",
  "Processing",
  "Computing",
  "Evaluating",
  "Unravelling",
  "Pondering",
];

/**
 * CLI风格的处理状态指示器
 * 模仿CLI窗口的 "* Unravelling... (esc to interrupt · thinking)" 样式
 */
export const CliProcessingIndicator: React.FC<CliProcessingIndicatorProps> = ({
  isProcessing,
  onCancel,
  engineName = "AI",
  startedAt = null,
  lastOutputAt = null,
  elapsedSeconds = 0,
  idleSeconds = 0,
  canCancel = true,
  isCancelling = false,
}) => {
  const { t } = useTranslation();
  const [clockNow, setClockNow] = useState(() => Date.now());

  // 随机选择初始动词
  const initialVerbIndex = useMemo(() =>
    Math.floor(Math.random() * PROCESSING_VERBS.length),
    []
  );

  // 监听 Escape 键取消
  useEffect(() => {
    if (!isProcessing || !onCancel || !canCancel || isCancelling) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isProcessing, onCancel, canCancel, isCancelling]);

  // 运行时间必须秒级刷新，但只让这个轻量指示器局部 re-render；
  // 不在 ClaudeCodeSession 上放全局 tick，避免整棵消息树每秒刷新。
  useEffect(() => {
    if (!isProcessing) return;

    setClockNow(Date.now());
    const intervalId = window.setInterval(() => {
      setClockNow(Date.now());
    }, 1000);

    return () => window.clearInterval(intervalId);
  }, [isProcessing]);

  const currentVerb = PROCESSING_VERBS[initialVerbIndex];
  const paddedDots = "...";
  const formatElapsed = (seconds: number) => {
    const safeSeconds = Math.max(0, Math.floor(seconds));
    const minutes = Math.floor(safeSeconds / 60);
    const remainingSeconds = safeSeconds % 60;
    return `${String(minutes).padStart(2, "0")}:${String(remainingSeconds).padStart(2, "0")}`;
  };
  const stableElapsedSeconds = typeof startedAt === 'number'
    ? Math.max(0, Math.floor((clockNow - startedAt) / 1000))
    : Math.max(0, Math.floor(elapsedSeconds));
  const stableIdleSeconds = typeof lastOutputAt === 'number'
    ? Math.max(0, Math.floor((clockNow - lastOutputAt) / 1000))
    : Math.max(0, Math.floor(idleSeconds));
  const idleNotice = stableIdleSeconds >= 60
    ? `长时间无新输出（${formatElapsed(stableIdleSeconds)}），${engineName} 可能仍在后台执行`
    : null;

  if (!isProcessing) return null;

  return (
    <div className="w-full max-w-5xl lg:max-w-6xl xl:max-w-7xl 2xl:max-w-[85%] mx-auto px-4 py-3">
      <div className="flex items-center gap-2 font-mono text-sm">
        {/* 星号指示器：保留低成本 opacity/transform 脉冲，避免界面像卡死 */}
        <span className="cli-processing-spark text-amber-500 dark:text-amber-400 font-bold">
          ✦
        </span>

        {/* 处理文本保持静态，不再做入场/位移/省略号动画 */}
        <span className="text-foreground/90">
          <span className="text-amber-600 dark:text-amber-400 font-medium">
            {currentVerb}
          </span>
          <span className="text-muted-foreground font-mono w-[24px] inline-block">
            {paddedDots}
          </span>
        </span>

        {/* 提示信息 */}
        <span className="text-muted-foreground/60 text-xs">
          (
          <span>
            {t('cliIndicator.elapsed', '已运行')} {formatElapsed(stableElapsedSeconds)}
          </span>
          <span className="mx-1">·</span>
          {onCancel && canCancel && !isCancelling && (
            <button
              onClick={onCancel}
              className="hover:text-red-500 transition-colors cursor-pointer"
            >
              {t('cliIndicator.escToCancel', 'esc to cancel')}
            </button>
          )}
          {onCancel && canCancel && !isCancelling && <span className="mx-1">·</span>}
          {onCancel && !canCancel && (
            <>
              <span>等待会话 ID</span>
              <span className="mx-1">·</span>
            </>
          )}
          {isCancelling && (
            <>
              <span className="text-red-500">正在取消当前会话</span>
              <span className="mx-1">·</span>
            </>
          )}
          <span className="inline-flex items-center gap-1">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-500/70" />
            {t('cliIndicator.thinking', 'thinking')}
          </span>
          )
        </span>
      </div>

      {idleNotice && (
        <div className="mt-2 rounded-md border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
          {idleNotice}
        </div>
      )}

      {/* 底部进度提示：低成本 CSS 闪烁，保留运行中反馈 */}
      <div className="mt-2 h-[2px] bg-muted-foreground/10 rounded-full overflow-hidden">
        <div className="cli-processing-progress h-full w-full bg-amber-500/40" />
      </div>
    </div>
  );
};

export default CliProcessingIndicator;
