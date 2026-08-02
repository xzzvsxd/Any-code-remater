import React from 'react';
import {
  AlertCircle,
  Archive,
  CheckCircle2,
  Clock3,
  Loader2,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import {
  getCompactSavings,
  type CompactLifecycleEvent,
} from '@/lib/compactLifecycle';

interface CompactLifecycleMessageProps {
  lifecycle: CompactLifecycleEvent;
  className?: string;
}

const formatTokens = (tokens: number): string => (
  tokens >= 1_000
    ? `${(tokens / 1_000).toFixed(1)}K`
    : tokens.toLocaleString()
);

const formatDuration = (durationMs: number): string => (
  durationMs >= 1_000
    ? `${(durationMs / 1_000).toFixed(2)}s`
    : `${Math.round(durationMs)}ms`
);

export const CompactLifecycleMessage: React.FC<CompactLifecycleMessageProps> = ({
  lifecycle,
  className,
}) => {
  const { t } = useTranslation();
  const savings = getCompactSavings(lifecycle);
  const isActive = lifecycle.phase === 'scheduled'
    || lifecycle.phase === 'preparing'
    || lifecycle.phase === 'running';
  const phaseLabel = t(`compactLifecycle.${lifecycle.phase}`, lifecycle.phase);
  const triggerLabel = t(`compactLifecycle.${lifecycle.trigger}`, lifecycle.trigger);

  const Icon = lifecycle.phase === 'completed'
    ? CheckCircle2
    : lifecycle.phase === 'failed'
      ? AlertCircle
      : lifecycle.phase === 'scheduled'
        ? Clock3
        : lifecycle.phase === 'running'
          ? Loader2
          : Archive;

  return (
    <div
      className={cn('my-4 flex min-h-12 w-full items-center gap-3', className)}
      data-compact-lifecycle={lifecycle.phase}
      role="status"
      aria-live={isActive ? 'polite' : 'off'}
    >
      <div className="h-px min-w-4 flex-1 bg-border" aria-hidden="true" />
      <div
        className={cn(
          'flex min-w-0 max-w-[calc(100%_-_2rem)] flex-wrap items-center justify-center gap-x-2 gap-y-1 text-xs',
          lifecycle.phase === 'failed' ? 'text-destructive' : 'text-muted-foreground',
        )}
      >
        <Icon
          className={cn(
            'h-3.5 w-3.5 flex-none',
            lifecycle.phase === 'running' && 'animate-spin motion-reduce:animate-none',
            (lifecycle.phase === 'scheduled' || lifecycle.phase === 'preparing')
              && 'animate-pulse motion-reduce:animate-none',
            lifecycle.phase === 'completed' && 'text-emerald-600 dark:text-emerald-400',
          )}
          aria-hidden="true"
        />
        <span className="font-medium text-foreground">
          {triggerLabel} · {phaseLabel}
        </span>
        {lifecycle.beforeTokens !== undefined && lifecycle.afterTokens !== undefined && (
          <span className="font-mono tabular-nums">
            {formatTokens(lifecycle.beforeTokens)} → {formatTokens(lifecycle.afterTokens)}
          </span>
        )}
        {savings && (
          <span className="text-emerald-600 dark:text-emerald-400">
            {t('compactLifecycle.released', 'released')} {formatTokens(savings.releasedTokens)} ({savings.releasedPercentage}%)
          </span>
        )}
        {lifecycle.durationMs !== undefined && (
          <span className="font-mono tabular-nums">{formatDuration(lifecycle.durationMs)}</span>
        )}
        {lifecycle.error && (
          <span className="max-w-full break-words text-destructive">{lifecycle.error}</span>
        )}
      </div>
      <div className="h-px min-w-4 flex-1 bg-border" aria-hidden="true" />
    </div>
  );
};

CompactLifecycleMessage.displayName = 'CompactLifecycleMessage';
