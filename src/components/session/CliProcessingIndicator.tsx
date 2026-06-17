import React, { useState, useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";

interface CliProcessingIndicatorProps {
  isProcessing: boolean;
  onCancel?: () => void;
  engineName?: string;
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
  elapsedSeconds = 0,
  idleSeconds = 0,
  canCancel = true,
  isCancelling = false,
}) => {
  const { t } = useTranslation();
  const [dotCount, setDotCount] = useState(0);
  const [verbIndex, setVerbIndex] = useState(0);

  // 随机选择初始动词
  const initialVerbIndex = useMemo(() =>
    Math.floor(Math.random() * PROCESSING_VERBS.length),
    []
  );

  useEffect(() => {
    if (isProcessing) {
      setVerbIndex(initialVerbIndex);
    }
  }, [isProcessing, initialVerbIndex]);

  // 动态省略号动画
  useEffect(() => {
    if (!isProcessing) return;

    const dotInterval = setInterval(() => {
      setDotCount((prev) => (prev + 1) % 4);
    }, 400);

    return () => clearInterval(dotInterval);
  }, [isProcessing]);

  // 定期切换动词
  useEffect(() => {
    if (!isProcessing) return;

    const verbInterval = setInterval(() => {
      setVerbIndex((prev) => (prev + 1) % PROCESSING_VERBS.length);
    }, 3000);

    return () => clearInterval(verbInterval);
  }, [isProcessing]);

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

  const currentVerb = PROCESSING_VERBS[verbIndex];
  const dots = ".".repeat(dotCount);
  const paddedDots = dots.padEnd(3, " ");
  const formatElapsed = (seconds: number) => {
    const safeSeconds = Math.max(0, Math.floor(seconds));
    const minutes = Math.floor(safeSeconds / 60);
    const remainingSeconds = safeSeconds % 60;
    return `${String(minutes).padStart(2, "0")}:${String(remainingSeconds).padStart(2, "0")}`;
  };
  const idleNotice = idleSeconds >= 60
    ? `长时间无新输出（${formatElapsed(idleSeconds)}），${engineName} 可能仍在后台执行`
    : null;

  if (!isProcessing) return null;

  return (
    <div className="w-full max-w-5xl lg:max-w-6xl xl:max-w-7xl 2xl:max-w-[85%] mx-auto px-4 py-3">
      <div className="flex items-center gap-2 font-mono text-sm">
        {/* 星号指示器：用 CSS 动画，避免在滚动容器内跑每帧 JS motion */}
        <span className="text-amber-500 dark:text-amber-400 font-bold animate-pulse">
          ✦
        </span>

        {/* 动态处理文本：只按 interval 更新文本，不再做入场/位移动画 */}
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
          <span className="font-mono">已运行 {formatElapsed(elapsedSeconds)}</span>
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
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-500/70 animate-pulse" />
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

      {/* 底部进度提示：CSS pulse 代替 JS transform 动画，降低 WebView/Linux 主线程压力 */}
      <div className="mt-2 h-[2px] bg-muted-foreground/10 rounded-full overflow-hidden">
        <div className="h-full w-full bg-gradient-to-r from-amber-500/30 via-amber-400 to-amber-500/30 animate-pulse" />
      </div>
    </div>
  );
};

export default CliProcessingIndicator;
