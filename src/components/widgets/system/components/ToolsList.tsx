/**
 * ✅ Tools List Component - 工具列表展示子组件
 *
 * 从 SystemInitializedWidget 中提取，用于展示可用工具列表
 */

import React, { useCallback, useMemo, useRef, useState } from "react";
import { Wrench, Package, Package2, ChevronDown } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { useTranslation } from "@/hooks/useTranslation";
import {
  SESSION_MESSAGE_LAYOUT_CHANGED_EVENT,
  type SessionMessageLayoutChangedReason,
} from "@/components/session/sessionMessageLayoutEvents";

export interface ToolsListProps {
  /** 工具列表 */
  tools: string[];
  /** MCP 工具是否展开 */
  mcpExpanded: boolean;
  /** 切换 MCP 展开状态 */
  onMcpToggle: () => void;
}

/**
 * 格式化 MCP 工具名称
 */
const formatMcpToolName = (toolName: string) => {
  const withoutPrefix = toolName.replace(/^mcp__/, '');
  const parts = withoutPrefix.split('__');

  if (parts.length >= 2) {
    const provider = parts[0].replace(/_/g, ' ').replace(/-/g, ' ')
      .split(' ')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
    const method = parts.slice(1).join('__').replace(/_/g, ' ')
      .split(' ')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
    return { provider, method };
  }

  return {
    provider: 'MCP',
    method: withoutPrefix.replace(/_/g, ' ')
      .split(' ')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ')
  };
};

export const areToolListsEqual = (prevTools: string[] = [], nextTools: string[] = []): boolean => {
  if (prevTools === nextTools) return true;
  if (prevTools.length !== nextTools.length) return false;
  for (let index = 0; index < prevTools.length; index += 1) {
    if (prevTools[index] !== nextTools[index]) {
      return false;
    }
  }
  return true;
};

interface McpToolDisplay {
  tool: string;
  method: string;
}

interface SplitToolsForDisplay {
  regularTools: string[];
  mcpToolsByProvider: Record<string, McpToolDisplay[]>;
  mcpToolCount: number;
}

const REGULAR_TOOL_PREVIEW_COUNT = 8;

const splitToolsForDisplay = (tools: string[]): SplitToolsForDisplay => {
  const regularTools: string[] = [];
  const mcpToolsByProvider: Record<string, McpToolDisplay[]> = {};
  let mcpToolCount = 0;

  for (const tool of tools) {
    if (!tool.startsWith('mcp__')) {
      regularTools.push(tool);
      continue;
    }

    const { provider, method } = formatMcpToolName(tool);
    if (!mcpToolsByProvider[provider]) {
      mcpToolsByProvider[provider] = [];
    }
    mcpToolsByProvider[provider].push({ tool, method });
    mcpToolCount += 1;
  }

  return { regularTools, mcpToolsByProvider, mcpToolCount };
};

/**
 * 工具列表展示组件
 */
export const ToolsList = React.memo<ToolsListProps>(({
  tools,
  mcpExpanded,
  onMcpToggle,
}) => {
  const { t } = useTranslation();
  const rootRef = useRef<HTMLDivElement>(null);
  const splitTools = useMemo(
    () => splitToolsForDisplay(tools),
    [tools]
  );
  const regularTools = useMemo(
    () => splitTools.regularTools,
    [splitTools]
  );
  const mcpToolsByProvider = useMemo(
    () => splitTools.mcpToolsByProvider,
    [splitTools]
  );
  const mcpToolCount = splitTools.mcpToolCount;
  const [regularExpanded, setRegularExpanded] = useState(false);
  const displayedRegularTools = useMemo(
    () => regularExpanded
      ? regularTools
      : regularTools.slice(0, REGULAR_TOOL_PREVIEW_COUNT),
    [regularExpanded, regularTools]
  );
  const hiddenRegularToolCount = regularExpanded
    ? 0
    : Math.max(0, regularTools.length - displayedRegularTools.length);
  const notifyLayoutChanged = useCallback((reason: SessionMessageLayoutChangedReason) => {
    if (typeof window === 'undefined') return;

    const rowElement = rootRef.current?.closest('[data-item-key]');
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
  }, []);
  const handleRegularToggle = useCallback(() => {
    setRegularExpanded((expanded) => !expanded);
    notifyLayoutChanged('system-tools-toggle');
  }, [notifyLayoutChanged]);

  const handleMcpToggle = useCallback(() => {
    onMcpToggle();
    notifyLayoutChanged('mcp-tools-toggle');
  }, [notifyLayoutChanged, onMcpToggle]);

  if (tools.length === 0) {
    return (
      <div className="text-xs text-muted-foreground italic">
        {t('systemInit.noTools', '无工具可用')}
      </div>
    );
  }

  return (
    <div ref={rootRef} className="space-y-4">
      {/* 常规工具 */}
      {regularTools.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Wrench className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-xs font-medium text-muted-foreground">
              {t('systemInit.availableTools', '可用工具')} ({regularTools.length})
            </span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {displayedRegularTools.map((tool, idx) => (
              <Badge
                key={`${tool}-${idx}`}
                variant="secondary"
                className="text-xs py-0.5 px-2 font-mono font-normal"
              >
                {tool}
              </Badge>
            ))}
            {(hiddenRegularToolCount > 0 || regularExpanded) && (
              <button
                type="button"
                onClick={handleRegularToggle}
                className="rounded-md border border-border/60 px-2 py-0.5 text-xs text-muted-foreground transition-colors hover:border-border hover:text-foreground"
              >
                {regularExpanded ? t('systemInit.collapse', '收起') : t('systemInit.moreTools', '+{{count}} 个', { count: hiddenRegularToolCount })}
              </button>
            )}
          </div>
        </div>
      )}

      {/* MCP 工具 */}
      {mcpToolCount > 0 && (
        <div className="space-y-2">
          <button
            onClick={handleMcpToggle}
            className="flex items-center gap-2 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
          >
            <Package className="h-3.5 w-3.5" />
            <span>{t('systemInit.mcpServices', 'MCP 服务')} ({mcpToolCount})</span>
            <ChevronDown className={cn(
              "h-3 w-3 transition-transform",
              mcpExpanded && "rotate-180"
            )} />
          </button>

          {mcpExpanded && (
            <div className="ml-5 space-y-3">
              {Object.entries(mcpToolsByProvider).map(([provider, providerTools]) => (
                <div key={provider} className="space-y-1.5">
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Package2 className="h-3 w-3" />
                    <span className="font-medium">{provider}</span>
                    <span className="text-muted-foreground/60">({providerTools.length})</span>
                  </div>
                  <div className="ml-4 flex flex-wrap gap-1">
                    {providerTools.map(({ tool, method }) => (
                      <Badge
                        key={tool}
                        variant="outline"
                        className="text-xs py-0 px-1.5 font-normal"
                      >
                        {method}
                      </Badge>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}, (prev, next) => (
  prev.mcpExpanded === next.mcpExpanded &&
  prev.onMcpToggle === next.onMcpToggle &&
  areToolListsEqual(prev.tools, next.tools)
));

ToolsList.displayName = 'ToolsList';
