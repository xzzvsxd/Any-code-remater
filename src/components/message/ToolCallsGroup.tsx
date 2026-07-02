/**
 * ToolCallsGroup - 工具调用组组件（重构版）
 *
 * 基于工具注册中心的插件化架构
 * 支持批量管理工具调用，提供折叠/展开功能
 * 当工具数量 >= 3 时默认折叠，显示摘要信息
 */

import React, { memo, useState, useMemo, useRef, useEffect } from 'react';
import { ChevronDown, ChevronRight, Wrench, AlertCircle, CheckCircle, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { toolRegistry } from '@/lib/toolRegistry';
import { useToolResults } from '@/hooks/useToolResults';
import { useTranslation } from '@/hooks/useTranslation';
import { TaskListAggregateWidget } from '@/components/widgets';
import { getMessageContentArray } from '@/lib/messageContentAccess';
import { getLocalizedToolName } from '@/lib/toolDisplayNames';
import {
  SESSION_MESSAGE_LAYOUT_CHANGED_EVENT,
  type SessionMessageLayoutChangedReason,
} from '@/components/session/sessionMessageLayoutEvents';
import type { TaskToolCall } from '@/components/widgets';
import type { ClaudeStreamMessage } from '@/types/claude';
import type { ToolResultEntry } from '@/contexts/MessagesContext';

interface ToolCall {
  id: string;
  type: 'tool_use';
  name: string;
  input?: Record<string, any>;
}

const notifyLayoutChangedFromElement = (
  element: HTMLElement | null,
  reason: SessionMessageLayoutChangedReason,
) => {
  if (typeof window === 'undefined') return;

  const rowElement = element?.closest('[data-item-key]');
  const itemKey = rowElement?.getAttribute('data-item-key') ?? undefined;
  const measurementKey = rowElement?.getAttribute('data-measurement-key') ?? undefined;
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
          measurementKey,
          itemIndex: Number.isFinite(itemIndex) ? itemIndex : undefined,
        },
      }),
    );
  });
};

export interface ToolCallsGroupProps {
  /** 消息数据 */
  message: ClaudeStreamMessage;

  /** 默认折叠状态 */
  defaultCollapsed?: boolean;

  /** 折叠阈值（工具数量 >= 此值时默认折叠） */
  collapseThreshold?: number;

  /** 折叠状态变化回调 */
  onToggle?: (collapsed: boolean) => void;

  /** 链接检测回调 */
  onLinkDetected?: (url: string) => void;

  /** 自定义类名 */
  className?: string;
}

export const ToolCallsGroup: React.FC<ToolCallsGroupProps> = ({
  message,
  defaultCollapsed,
  collapseThreshold = 3,
  onToggle,
  onLinkDetected,
  className,
}) => {
  const { t } = useTranslation();
  const rootRef = useRef<HTMLDivElement>(null);
  // 提取工具调用
  const toolCalls = useMemo((): ToolCall[] => {
    const content = getMessageContentArray(message);
    if (!content) {
      return [];
    }
    return content.filter((item: any) => item.type === 'tool_use') as ToolCall[];
  }, [message]);

  const { getResultById, getStatusById } = useToolResults();

  // 自动判断是否应该折叠
  const shouldCollapse = defaultCollapsed ?? toolCalls.length >= collapseThreshold;
  const [isCollapsed, setIsCollapsed] = useState(shouldCollapse);

  // 计算工具执行统计
  const stats = useMemo(() => {
    let successCount = 0;
    let errorCount = 0;
    let pendingCount = 0;

    toolCalls.forEach(tool => {
      const status = getStatusById(tool.id);
      if (status === 'pending') {
        pendingCount++;
      } else if (status === 'error') {
        errorCount++;
      } else {
        successCount++;
      }
    });

    return { successCount, errorCount, pendingCount, total: toolCalls.length };
  }, [toolCalls, getStatusById]);

  // 切换折叠状态
  const toggleCollapse = () => {
    const newState = !isCollapsed;
    setIsCollapsed(newState);
    notifyLayoutChangedFromElement(rootRef.current, 'tool-calls-toggle');
    onToggle?.(newState);
  };

  // 获取工具类型摘要
  const toolTypesSummary = useMemo(() => {
    const types = new Set(toolCalls.map((tool) => getLocalizedToolName(tool.name, t)));
    const typeArray = Array.from(types);
    if (typeArray.length <= 3) {
      return typeArray.join(', ');
    }
    return `${typeArray.slice(0, 3).join(', ')} +${typeArray.length - 3}`;
  }, [t, toolCalls]);

  if (toolCalls.length === 0) return null;

  // 检测是否包含 Task 管理工具，聚合渲染为任务列表
  const TASK_TOOL_PATTERN = /^(TaskCreate|TaskUpdate|TaskList|TaskGet)$/i;
  const taskToolCalls = toolCalls.filter(t => TASK_TOOL_PATTERN.test(t.name));
  const otherToolCalls = toolCalls.filter(t => !TASK_TOOL_PATTERN.test(t.name));

  // 构建聚合 task 数据
  const taskAggregateData: TaskToolCall[] | null = taskToolCalls.length > 0
    ? taskToolCalls.map(t => ({
        name: t.name,
        input: t.input,
        result: (() => {
          const r = getResultById(t.id);
          return r ? { content: r.content, is_error: r.isError, sourceMessage: r.sourceMessage } : undefined;
        })(),
        id: t.id,
      }))
    : null;

  // 如果全部都是 task 工具，直接渲染聚合组件
  if (taskAggregateData && otherToolCalls.length === 0) {
    return (
      <div ref={rootRef} className={cn('tool-single-call my-2', className)}>
        <TaskListAggregateWidget toolCalls={taskAggregateData} />
      </div>
    );
  }

  // 只有一个工具时，直接渲染不提供折叠功能
  if (toolCalls.length === 1) {
    const tool = toolCalls[0];
    return (
      <div ref={rootRef} className={cn('tool-single-call my-2', className)}>
        <SingleToolCall
          tool={tool}
          result={getResultById(tool.id)}
          status={getStatusById(tool.id)}
          onLinkDetected={onLinkDetected}
        />
      </div>
    );
  }

  return (
    <div ref={rootRef} className={cn('tool-calls-group my-2 border border-border rounded-lg overflow-hidden', className)}>
      {/* 折叠/展开头部 */}
      <button
        onClick={toggleCollapse}
        className="flex items-center gap-2 w-full px-4 py-3 text-left bg-muted/30 hover:bg-muted/50 transition-colors"
      >
        {isCollapsed ? <ChevronRight className="w-4 h-4 shrink-0" /> : <ChevronDown className="w-4 h-4 shrink-0" />}
        <Wrench className="w-4 h-4 text-blue-500 shrink-0" />
        <span className="font-medium text-sm">{t('tools.toolCalls', { count: stats.total })}</span>

        {/* 状态徽章 */}
        <div className="flex items-center gap-2 ml-auto">
          {stats.successCount > 0 && (
            <span className="flex items-center gap-1 text-xs text-green-600 bg-green-500/10 px-2 py-1 rounded">
              <CheckCircle className="w-3 h-3" />
              {stats.successCount}
            </span>
          )}
          {stats.errorCount > 0 && (
            <span className="flex items-center gap-1 text-xs text-red-600 bg-red-500/10 px-2 py-1 rounded">
              <AlertCircle className="w-3 h-3" />
              {stats.errorCount}
            </span>
          )}
          {stats.pendingCount > 0 && (
            <span className="flex items-center gap-1 text-xs text-blue-600 bg-blue-500/10 px-2 py-1 rounded">
              <Loader2 className="w-3 h-3 animate-spin" />
              {stats.pendingCount}
            </span>
          )}
        </div>

        <span className="text-xs text-muted-foreground ml-2 truncate max-w-[200px]">{toolTypesSummary}</span>
      </button>

      {/* 折叠摘要或完整内容 */}
      {isCollapsed ? (
        <CollapsedSummary
          toolCalls={toolCalls}
          getStatusById={getStatusById}
          onExpand={toggleCollapse}
        />
      ) : (
        <div className="space-y-2 p-4 bg-background">
          {/* 如果有 task 工具，先渲染聚合任务列表 */}
          {taskAggregateData && (
            <TaskListAggregateWidget toolCalls={taskAggregateData} />
          )}
          {/* 渲染非 task 工具 */}
          {(taskAggregateData ? otherToolCalls : toolCalls).map((tool, index) => (
            <SingleToolCall
              key={tool.id}
              tool={tool}
              result={getResultById(tool.id)}
              status={getStatusById(tool.id)}
              onLinkDetected={onLinkDetected}
              index={index + 1}
              total={taskAggregateData ? otherToolCalls.length : toolCalls.length}
            />
          ))}
        </div>
      )}
    </div>
  );
};

/**
 * 折叠时的摘要显示
 */
interface CollapsedSummaryProps {
  toolCalls: ToolCall[];
  getStatusById: (toolUseId?: string | null) => 'pending' | 'success' | 'error';
  onExpand?: () => void;
}

const CollapsedSummary: React.FC<CollapsedSummaryProps> = ({ toolCalls, getStatusById, onExpand }) => {
  const { t } = useTranslation();
  return (
    <div className="px-4 py-3 bg-background/50 border-t border-border space-y-2">
      {/* 显示前3个工具 */}
      {toolCalls.slice(0, 3).map((tool, idx) => {
        const status = getStatusById(tool.id);
        const hasResult = status !== 'pending';
        const isError = status === 'error';

        let StatusIcon = Loader2;
        let statusColor = 'text-blue-600';

        if (hasResult) {
          if (isError) {
            StatusIcon = AlertCircle;
            statusColor = 'text-red-600';
          } else {
            StatusIcon = CheckCircle;
            statusColor = 'text-green-600';
          }
        }

        return (
          <div key={idx} className="flex items-center gap-2 text-xs">
            <StatusIcon className={cn('w-3 h-3', statusColor, !hasResult && 'animate-spin')} />
            <span className="font-medium" title={tool.name}>{getLocalizedToolName(tool.name, t)}</span>
            {tool.input?.path && <span className="text-muted-foreground truncate">: {tool.input.path}</span>}
          </div>
        );
      })}

      {toolCalls.length > 3 && (
        <div className="text-xs text-muted-foreground pl-5">{t('tools.moreTools', { count: toolCalls.length - 3 })}</div>
      )}

      <button
        type="button"
        onClick={onExpand}
        className="text-[10px] text-muted-foreground/70 pt-1 hover:text-foreground transition-colors cursor-pointer text-left w-full"
      >
        {t('tools.clickToExpand')}
      </button>
    </div>
  );
};

/**
 * 单个工具调用渲染
 */
interface SingleToolCallProps {
  tool: ToolCall;
  result?: ToolResultEntry;
  status: 'pending' | 'success' | 'error';
  onLinkDetected?: (url: string) => void;
  index?: number;
  total?: number;
}

const SingleToolCallComponent: React.FC<SingleToolCallProps> = ({ tool, result, status, onLinkDetected, index, total }) => {
  const { t } = useTranslation();
  const renderer = toolRegistry.getRenderer(tool.name);

  const normalizedResult = result
    ? {
        content: result.content,
        is_error: result.isError,
        sourceMessage: result.sourceMessage,
      }
    : undefined;

  // 判断是否正在流式输出（工具执行中）
  const isStreaming = status === 'pending';

  // 构建渲染 props
  const renderProps = {
    toolName: tool.name,
    input: tool.input,
    result: normalizedResult,
    toolId: tool.id,
    onLinkDetected,
    isStreaming,
  };

  // 判断状态
  const hasResult = status !== 'pending';
  const isError = status === 'error';

  let StatusIcon = Loader2;
  let statusColor = 'text-blue-600';
  let statusBg = 'bg-blue-500/10';

  if (hasResult) {
    if (isError) {
      StatusIcon = AlertCircle;
      statusColor = 'text-red-600';
      statusBg = 'bg-red-500/10';
    } else {
      StatusIcon = CheckCircle;
      statusColor = 'text-green-600';
      statusBg = 'bg-green-500/10';
    }
  }

  return (
    <div className={cn('tool-call-item my-2', renderer ? '' : 'bg-card border rounded-lg p-3 border-border')}>
      {/* 工具头部 - 仅在没有专用渲染器时显示 */}
      {!renderer && (
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <StatusIcon className={cn('w-4 h-4', statusColor, !hasResult && 'animate-spin')} />
            <span className="text-sm font-medium" title={tool.name}>{getLocalizedToolName(tool.name, t)}</span>
            {index && total && (
              <span className="text-xs text-muted-foreground">
                ({index}/{total})
              </span>
            )}
          </div>
          <span className={cn('text-xs px-2 py-0.5 rounded', statusBg, statusColor)}>
            {hasResult ? (isError ? t('tools.failed') : t('tools.success')) : t('tools.executing')}
          </span>
        </div>
      )}

      {/* 使用注册的工具渲染器 */}
      {renderer ? (
        <div className="tool-widget-container" style={{ overflowWrap: 'normal', wordBreak: 'normal' }}>
          <renderer.render {...renderProps} />
        </div>
      ) : (
        <FallbackToolRender tool={tool} result={normalizedResult} />
      )}
    </div>
  );
};

SingleToolCallComponent.displayName = "SingleToolCall";

const SingleToolCall = memo(SingleToolCallComponent);

/**
 * 未注册工具的降级渲染
 */
interface FallbackToolRenderProps {
  tool: ToolCall;
  result?: {
    content?: any;
    is_error?: boolean;
  };
}

const MAX_FALLBACK_PREVIEW_CHARS = 40_000;
const SUMMARY_SCAN_LIMIT = 4_096;

interface ToolContentSummary {
  charCountEstimate: number;
  truncated: boolean;
}

const hasObjectContent = (value: unknown): boolean => {
  if (value == null) return false;
  if (typeof value === 'string') return value.length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') {
    for (const _key in value as Record<string, unknown>) {
      return true;
    }
    return false;
  }
  return true;
};

const getToolContentSummary = (value: unknown, limit = SUMMARY_SCAN_LIMIT): ToolContentSummary => {
  let charCountEstimate = 0;
  let truncated = false;

  const add = (amount: number) => {
    if (truncated) return;
    charCountEstimate += amount;
    if (charCountEstimate > limit) {
      charCountEstimate = limit;
      truncated = true;
    }
  };

  const visit = (current: unknown, depth: number) => {
    if (truncated || current == null) return;
    if (typeof current === 'string') {
      add(current.length);
      return;
    }
    if (typeof current === 'number' || typeof current === 'boolean' || typeof current === 'bigint') {
      add(String(current).length);
      return;
    }
    if (Array.isArray(current)) {
      for (const item of current) {
        visit(item, depth + 1);
        add(1);
        if (truncated) return;
      }
      return;
    }
    if (typeof current === 'object') {
      const record = current as Record<string, unknown>;
      for (const field of ['text', 'message', 'content']) {
        if (typeof record[field] === 'string') {
          add((record[field] as string).length);
          return;
        }
      }
      if (depth > 3) {
        add(16);
        return;
      }
      for (const key in record) {
        add(key.length + 2);
        visit(record[key], depth + 1);
        if (truncated) return;
      }
    }
  };

  visit(value, 0);
  return { charCountEstimate, truncated };
};

/**
 * 递归提取内容中的文本
 * 支持多种格式：字符串、数组、对象（含 text/message/content 字段）
 */
const extractTextContent = (value: unknown, maxChars = Number.POSITIVE_INFINITY): string => {
  if (typeof value === 'string') {
    return value.length > maxChars ? `${value.slice(0, maxChars)}\n\n…内容过长，已截断预览…` : value;
  }

  if (value == null) {
    return '';
  }

  if (Array.isArray(value)) {
    // 递归处理数组中的每个元素，用换行符连接
    const parts: string[] = [];
    let remaining = maxChars;
    for (const item of value) {
      if (remaining <= 0) break;
      const text = extractTextContent(item, remaining);
      if (text) {
        parts.push(text);
        remaining -= text.length + 1;
      }
    }
    if (remaining <= 0) {
      parts.push('…内容过长，已截断预览…');
    }
    return parts.filter(Boolean).join('\n');
  }

  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;

    // 优先提取 text 字段（MCP 工具常见格式）
    if (typeof record.text === 'string') {
      return extractTextContent(record.text, maxChars);
    }

    // 其次尝试 message 字段
    if (typeof record.message === 'string') {
      return extractTextContent(record.message, maxChars);
    }

    // 再次尝试 content 字段
    if (typeof record.content === 'string') {
      return extractTextContent(record.content, maxChars);
    }

    const lines: string[] = ['{'];
    let remaining = Math.max(0, maxChars - 4);
    for (const key in record) {
      if (remaining <= 0) break;
      const valuePreview = extractTextContent(record[key], Math.max(0, remaining - key.length - 8));
      const line = `  ${JSON.stringify(key)}: ${valuePreview}`;
      lines.push(line);
      remaining -= line.length + 1;
    }
    if (remaining <= 0) {
      lines.push('  …内容过长，已截断预览…');
    }
    lines.push('}');
    return lines.join('\n');
  }

  return String(value);
};

/**
 * 处理结果内容，将转义的换行符转换为实际换行符
 */
const parseResultContent = (content: any, maxChars = Number.POSITIVE_INFINITY): string => {
  // 先提取文本内容
  const text = extractTextContent(content, maxChars);

  // 然后处理转义字符
  return text
    .replace(/\\r\\n/g, '\n')
    .replace(/\\n/g, '\n')
    .replace(/\\t/g, '\t');
};

const FallbackToolDetails: React.FC<FallbackToolRenderProps> = ({ tool, result }) => {
  const { t } = useTranslation();
  const COLLAPSE_HEIGHT = 300;
  const rootRef = useRef<HTMLDivElement>(null);
  const resultRef = useRef<HTMLPreElement>(null);
  const [shouldCollapse, setShouldCollapse] = useState(false);
  const [collapsed, setCollapsed] = useState(true);

  useEffect(() => {
    const el = resultRef.current;
    if (!el) return;
    const h = el.scrollHeight;
    const need = h > COLLAPSE_HEIGHT;
    setShouldCollapse(need);
    setCollapsed(need);
  }, [result]);

  const toggle = () => {
    setCollapsed((v) => !v);
    notifyLayoutChangedFromElement(rootRef.current, 'fallback-tool-toggle');
  };

  // 处理结果内容
  const resultContent = result ? parseResultContent(result.content, MAX_FALLBACK_PREVIEW_CHARS) : '';
  const inputPreview = tool.input ? extractTextContent(tool.input, MAX_FALLBACK_PREVIEW_CHARS) : '';

  return (
    <div ref={rootRef} className="fallback-tool-details space-y-2 text-xs">
      {tool.input && Object.keys(tool.input).length > 0 && (
        <details
          className="text-xs"
          onToggle={() => notifyLayoutChangedFromElement(rootRef.current, 'fallback-tool-toggle')}
        >
          <summary className="cursor-pointer text-muted-foreground hover:text-foreground select-none">
            {t('tools.inputParams')}
          </summary>
          <pre className="mt-1 p-2 bg-muted rounded text-[10px] overflow-x-auto whitespace-pre-wrap break-words" style={{ overflowWrap: 'anywhere' }}>
            {inputPreview}
          </pre>
        </details>
      )}

      {result && (
        <div className={cn('p-2 rounded relative', result.is_error ? 'bg-red-500/10' : 'bg-muted')}>
          <div className="font-medium mb-1 text-xs">{result.is_error ? t('tools.executionFailed') : t('tools.executionResult')}:</div>
          <div className="relative">
            <pre
              ref={resultRef}
              className={cn(
                'text-[10px] overflow-x-auto whitespace-pre-wrap break-words transition-[max-height]',
                shouldCollapse && collapsed && 'overflow-hidden'
              )}
              style={{ overflowWrap: 'anywhere', ...(shouldCollapse && collapsed ? { maxHeight: `${COLLAPSE_HEIGHT}px` } : {}) }}
            >
              {resultContent}
            </pre>
            {shouldCollapse && collapsed && (
              <div className="pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-background/80 via-background/50 to-transparent" />
            )}
          </div>
          {shouldCollapse && (
            <button
              onClick={toggle}
              className="mt-2 text-[11px] text-primary underline underline-offset-2"
            >
              {collapsed ? t('tools.expandAll') : t('tools.collapseContent')}
            </button>
          )}
        </div>
      )}
    </div>
  );
};

const FallbackToolRender: React.FC<FallbackToolRenderProps> = ({ tool, result }) => {
  const { t } = useTranslation();
  const rootRef = useRef<HTMLDivElement>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const hasInput = hasObjectContent(tool.input);
  const resultSummary = result ? getToolContentSummary(result.content) : { charCountEstimate: 0, truncated: false };
  const inputSummary = hasInput ? getToolContentSummary(tool.input) : { charCountEstimate: 0, truncated: false };

  return (
    <div ref={rootRef} className="fallback-tool-render space-y-2 text-xs">
      <div className="flex items-center justify-between gap-2">
        <div className="text-muted-foreground">{t('tools.unregisteredTool')}</div>
        {(hasInput || result) && (
          <button
            onClick={() => {
              setDetailsOpen(open => !open);
              notifyLayoutChangedFromElement(rootRef.current, 'fallback-tool-toggle');
            }}
            className="text-[11px] text-primary underline underline-offset-2"
          >
            {detailsOpen ? t('tools.collapseContent') : t('tools.expandAll')}
          </button>
        )}
      </div>

      {(hasInput || result) && (
        <div className="flex flex-wrap gap-2 text-[10px] text-muted-foreground/80">
          {hasInput && (
            <span className="rounded bg-muted px-1.5 py-0.5">
              input ~{Math.ceil(inputSummary.charCountEstimate / 4)} toks{inputSummary.truncated ? '+' : ''}
            </span>
          )}
          {result && (
            <span className={cn('rounded px-1.5 py-0.5', result.is_error ? 'bg-red-500/10 text-red-600' : 'bg-muted')}>
              result ~{Math.ceil(resultSummary.charCountEstimate / 4)} toks{resultSummary.truncated ? '+' : ''}
            </span>
          )}
        </div>
      )}

      {detailsOpen && <FallbackToolDetails tool={tool} result={result} />}
    </div>
  );
};

export default ToolCallsGroup;
