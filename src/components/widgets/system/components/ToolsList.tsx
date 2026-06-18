/**
 * ✅ Tools List Component - 工具列表展示子组件
 *
 * 从 SystemInitializedWidget 中提取，用于展示可用工具列表
 */

import React from "react";
import { Wrench, Package, Package2, ChevronDown } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

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

/**
 * 工具列表展示组件
 */
export const ToolsList: React.FC<ToolsListProps> = ({
  tools,
  mcpExpanded,
  onMcpToggle,
}) => {
  // 分离常规工具和 MCP 工具
  const regularTools = tools.filter(tool => !tool.startsWith('mcp__'));
  const mcpTools = tools.filter(tool => tool.startsWith('mcp__'));

  // 按提供商分组 MCP 工具
  const mcpToolsByProvider = mcpTools.reduce((acc, tool) => {
    const { provider } = formatMcpToolName(tool);
    if (!acc[provider]) {
      acc[provider] = [];
    }
    acc[provider].push(tool);
    return acc;
  }, {} as Record<string, string[]>);

  if (tools.length === 0) {
    return (
      <div className="text-xs text-muted-foreground italic">
        无工具可用
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* 常规工具 */}
      {regularTools.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Wrench className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-xs font-medium text-muted-foreground">
              Available Tools ({regularTools.length})
            </span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {regularTools.map((tool, idx) => (
              <Badge
                key={`${tool}-${idx}`}
                variant="secondary"
                className="text-xs py-0.5 px-2 font-mono font-normal"
              >
                {tool}
              </Badge>
            ))}
          </div>
        </div>
      )}

      {/* MCP 工具 */}
      {mcpTools.length > 0 && (
        <div className="space-y-2">
          <button
            onClick={onMcpToggle}
            className="flex items-center gap-2 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
          >
            <Package className="h-3.5 w-3.5" />
            <span>MCP Services ({mcpTools.length})</span>
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
                    {providerTools.map((tool, idx) => {
                      const { method } = formatMcpToolName(tool);
                      return (
                        <Badge
                          key={idx}
                          variant="outline"
                          className="text-xs py-0 px-1.5 font-normal"
                        >
                          {method}
                        </Badge>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
