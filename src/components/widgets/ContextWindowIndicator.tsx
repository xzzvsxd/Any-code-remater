/**
 * 上下文窗口使用指示器组件
 *
 * 显示当前会话的上下文窗口使用百分比
 * 参考 Claude Code v2.0.64 的 current_usage 功能
 */

import React from 'react';
import { useTranslation } from 'react-i18next';
import { Layers, Info, Archive } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Popover } from '@/components/ui/popover';
import { useContextWindowUsage } from '@/hooks/useContextWindowUsage';
import { USAGE_LEVEL_COLORS } from '@/types/contextWindow';
import { cn } from '@/lib/utils';
import type { ClaudeStreamMessage } from '@/types/claude';
import type { ClaudeSettings } from '@/lib/api';
import { resolveClaudeAutoCompactConfig } from '@/lib/claudeAutoCompact';

export interface ContextWindowIndicatorProps {
  /** 会话消息列表 */
  messages: ClaudeStreamMessage[];
  /** 当前使用的模型 */
  model?: string;
  /** 引擎类型（claude/codex/gemini） */
  engine?: string;
  /** Claude 官方 auto-compact 设置快照 */
  autoCompactSettings?: ClaudeSettings | null;
  /** 是否显示（需要有消息时才显示） */
  show?: boolean;
  /** 自定义类名 */
  className?: string;
}

/**
 * 格式化 token 数量为 k 格式
 */
const formatK = (tokens: number): string => {
  if (tokens >= 1000) {
    return `${(tokens / 1000).toFixed(1)}k`;
  }
  return tokens.toString();
};

/**
 * 上下文窗口使用指示器
 *
 * 显示一个带有进度条和百分比的 Badge，悬停时显示详细信息
 * 支持多引擎（Claude/Codex）
 */
const ContextWindowIndicatorComponent: React.FC<ContextWindowIndicatorProps> = ({
  messages,
  model,
  engine,
  autoCompactSettings,
  show = true,
  className,
}) => {
  const { t } = useTranslation();
  const [showPopover, setShowPopover] = React.useState(false);

  const usage = useContextWindowUsage(messages, model, engine);
  const displayUsage = usage.hasData
    ? usage
    : {
      ...usage,
      formattedPercentage: '0.0%',
    };
  const colors = USAGE_LEVEL_COLORS[displayUsage.level];

  // show=false 才隐藏；没有 usage 快照时仍显示 0.0% 占位，避免新/运行中会话底部指标消失。
  if (!show) {
    return null;
  }

  // 计算 Auto-compact 相关数据（仅 Claude 引擎）
  const isClaudeEngine = engine === 'claude';
  const autoCompactConfig = resolveClaudeAutoCompactConfig(
    autoCompactSettings,
    displayUsage.contextWindowSize,
  );
  const autoCompactWindow = autoCompactConfig.effectiveWindow;
  const showAutoCompactWindow = isClaudeEngine
    && autoCompactConfig.enabled
    && typeof autoCompactWindow === 'number';
  const autoCompactWindowPercentage = autoCompactWindow
    ? (autoCompactWindow / displayUsage.contextWindowSize) * 100
    : 0;
  const tokensUntilCompactWindow = autoCompactWindow
    ? Math.max(0, autoCompactWindow - displayUsage.currentTokens)
    : 0;
  const isNearCompact = showAutoCompactWindow
    && displayUsage.currentTokens >= autoCompactWindow * 0.9;
  const willTriggerCompact = showAutoCompactWindow
    && displayUsage.currentTokens >= autoCompactWindow;

  return (
    <div
      onMouseEnter={() => setShowPopover(true)}
      onMouseLeave={() => setShowPopover(false)}
      className={className}
    >
      <Popover
        open={showPopover}
        onOpenChange={setShowPopover}
        trigger={
          <Badge
            variant="outline"
            className={cn(
              'flex items-center gap-1.5 px-2 py-1 h-8 cursor-default hover:bg-accent transition-colors border-border/50',
              colors.border,
              willTriggerCompact && 'border-amber-400 dark:border-amber-600'
            )}
          >
            <Layers className={cn('h-3 w-3', colors.text)} />
            {/* 迷你进度条 - 带 auto-compact 阈值线 */}
            <div className="w-12 h-1.5 bg-muted rounded-full overflow-hidden relative">
              <div
                className={cn('h-full transition-all duration-300', colors.progress)}
                style={{ width: `${Math.min(displayUsage.percentage, 100)}%` }}
              />
              {/* Auto-compact 阈值线（仅 Claude） */}
              {showAutoCompactWindow && (
                <div
                  className="absolute top-0 bottom-0 w-px bg-amber-500 dark:bg-amber-400"
                  style={{ left: `${Math.min(autoCompactWindowPercentage, 100)}%` }}
                />
              )}
            </div>
            <span className={cn('font-mono text-xs', colors.text)}>
              {displayUsage.formattedPercentage}
            </span>
            {/* 显示压缩图标提示即将压缩 */}
            {willTriggerCompact ? (
              <Archive className="h-3 w-3 text-amber-500 ml-0.5" />
            ) : (
              <Info className="h-3 w-3 text-muted-foreground ml-0.5" />
            )}
          </Badge>
        }
        content={
          <div className="space-y-3">
            {/* 标题 */}
            <div className="font-medium text-sm border-b pb-2 flex items-center gap-2">
              <Layers className="h-4 w-4" />
              {t('contextWindow.title', '上下文窗口使用情况')}
            </div>

            {/* 进度条 - 带 auto-compact 阈值线 */}
            <div className="space-y-1.5">
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">
                  {t('contextWindow.usage', '使用率')}
                </span>
                <span className={cn('font-mono font-medium', colors.text)}>
                  {displayUsage.formattedPercentage}
                </span>
              </div>
              {/* 自定义进度条以支持阈值线 */}
              <div className="relative h-2 w-full overflow-hidden rounded-full bg-secondary">
                <div
                  className={cn('h-full transition-all duration-300', colors.progress)}
                  style={{ width: `${Math.min(displayUsage.percentage, 100)}%` }}
                />
                {/* Auto-compact 阈值线（仅 Claude） */}
                {showAutoCompactWindow && (
                  <div
                    className="absolute top-0 bottom-0 w-0.5 bg-amber-500 dark:bg-amber-400 z-10"
                    style={{ left: `${Math.min(autoCompactWindowPercentage, 100)}%` }}
                    title={`${t('contextWindow.autoCompactWindow', 'Auto-compact Window')}: ${formatK(autoCompactWindow)}`}
                  />
                )}
              </div>
              <div className="text-xs text-muted-foreground text-center">
                {displayUsage.formattedTokens}
              </div>
              {!usage.hasData && (
                <div className="text-[11px] text-muted-foreground text-center">
                  等待运行时 usage 快照
                </div>
              )}
            </div>

            {/* Claude 官方 auto-compact 窗口信息 */}
            {showAutoCompactWindow && (
              <div className={cn(
                "p-2 rounded-md border text-xs",
                willTriggerCompact
                  ? "bg-amber-50 border-amber-200 dark:bg-amber-900/20 dark:border-amber-800"
                  : isNearCompact
                    ? "bg-yellow-50 border-yellow-200 dark:bg-yellow-900/20 dark:border-yellow-800"
                    : "bg-muted/50 border-border"
              )}>
                <div className="flex items-center gap-1.5 mb-1.5">
                  <Archive className={cn(
                    "h-3.5 w-3.5",
                    willTriggerCompact
                      ? "text-amber-600 dark:text-amber-400"
                      : "text-muted-foreground"
                  )} />
                  <span className={cn(
                    "font-medium",
                    willTriggerCompact
                      ? "text-amber-700 dark:text-amber-300"
                      : "text-foreground"
                  )}>
                    {t('contextWindow.autoCompactWindow', 'Auto-compact Window')}
                  </span>
                </div>
                <div className="space-y-1 pl-5">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">
                      {t('contextWindow.configuredWindow', '配置窗口')}:
                    </span>
                    <span className="font-mono">{formatK(autoCompactWindow)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">
                      {t('contextWindow.tokensUntilWindow', '距离窗口')}:
                    </span>
                    <span className={cn(
                      "font-mono",
                      willTriggerCompact
                        ? "text-amber-600 dark:text-amber-400 font-medium"
                        : isNearCompact
                          ? "text-yellow-600 dark:text-yellow-400"
                          : ""
                    )}>
                      {willTriggerCompact
                        ? t('contextWindow.compactWindowReached', '已进入窗口')
                        : formatK(tokensUntilCompactWindow)}
                    </span>
                  </div>
                </div>
                {willTriggerCompact && (
                  <div className="mt-2 pt-2 border-t border-amber-200 dark:border-amber-700 text-amber-700 dark:text-amber-300">
                    {t('contextWindow.compactWindowReachedDescription', '已进入配置窗口，Claude 将立即按原生逻辑处理压缩。')}
                  </div>
                )}
                {!willTriggerCompact && (
                  <div className="mt-2 pt-2 border-t text-muted-foreground">
                    {isNearCompact
                      ? t('contextWindow.compactWindowNear', '即将压缩：上下文使用量已接近配置窗口。')
                      : t('contextWindow.compactWindowDescription', 'Claude 会在上下文使用量接近该窗口时按原生逻辑自动压缩。')}
                  </div>
                )}
              </div>
            )}

            {/* Token 详情 */}
            <div className="space-y-1 text-xs border-t pt-2">
              <div className="flex justify-between gap-4">
                <span className="text-muted-foreground">
                  {t('contextWindow.inputTokens', '输入 Tokens')}:
                </span>
                <span className="font-mono">
                  {displayUsage.breakdown.inputTokens.toLocaleString()}
                </span>
              </div>
              {displayUsage.breakdown.cacheCreationTokens > 0 && (
                <div className="flex justify-between gap-4">
                  <span className="text-muted-foreground">
                    {t('contextWindow.cacheCreation', '缓存创建')}:
                  </span>
                  <span className="font-mono">
                    {displayUsage.breakdown.cacheCreationTokens.toLocaleString()}
                  </span>
                </div>
              )}
              {displayUsage.breakdown.cacheReadTokens > 0 && (
                <div className="flex justify-between gap-4">
                  <span className="text-muted-foreground">
                    {t('contextWindow.cacheRead', '缓存读取')}:
                  </span>
                  <span className="font-mono">
                    {displayUsage.breakdown.cacheReadTokens.toLocaleString()}
                  </span>
                </div>
              )}
              <div className="flex justify-between gap-4 border-t pt-1 mt-1">
                <span className="text-muted-foreground">
                  {t('contextWindow.outputTokens', '输出 Tokens')}:
                </span>
                <span className="font-mono text-muted-foreground">
                  {displayUsage.breakdown.outputTokens.toLocaleString()}
                </span>
              </div>
            </div>

            {/* 提示信息 */}
            {displayUsage.level === 'critical' && !isClaudeEngine && (
              <div className="text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 p-2 rounded">
                {t('contextWindow.criticalWarning', '上下文窗口接近上限，建议开始新会话')}
              </div>
            )}
            {displayUsage.level === 'high' && !isClaudeEngine && (
              <div className="text-xs text-orange-600 dark:text-orange-400 bg-orange-50 dark:bg-orange-900/20 p-2 rounded">
                {t('contextWindow.highWarning', '上下文使用率较高')}
              </div>
            )}
          </div>
        }
        side="top"
        align="center"
        className="w-72"
      />
    </div>
  );
};

export const ContextWindowIndicator = React.memo(
  ContextWindowIndicatorComponent,
  (prevProps, nextProps) => (
    prevProps.messages === nextProps.messages &&
    prevProps.model === nextProps.model &&
    prevProps.engine === nextProps.engine &&
    prevProps.autoCompactSettings === nextProps.autoCompactSettings &&
    prevProps.show === nextProps.show &&
    prevProps.className === nextProps.className
  )
);

ContextWindowIndicator.displayName = 'ContextWindowIndicator';

export default ContextWindowIndicator;
