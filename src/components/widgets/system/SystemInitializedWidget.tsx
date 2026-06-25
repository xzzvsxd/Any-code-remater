/**
 * ✅ System Initialized Widget - 系统初始化信息展示
 *
 * 迁移并拆分自 ToolWidgets.tsx (原 2266-2493 行)
 * 主组件 (~100行) + ToolsList 子组件 (~180行)
 */

import React, { useCallback, useMemo, useState } from "react";
import { Settings, Fingerprint, Cpu, FolderOpen } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { areToolListsEqual, ToolsList } from "./components/ToolsList";
import { useTranslation } from "@/hooks/useTranslation";

export interface SystemInitializedWidgetProps {
  /** 会话 ID */
  sessionId?: string;
  /** 模型名称 */
  model?: string;
  /** 工作目录 */
  cwd?: string;
  /** 可用工具列表 */
  tools?: string[];
  /** 时间戳 */
  timestamp?: string;
}

const EMPTY_TOOLS: string[] = [];

/**
 * 格式化时间戳
 */
const formatTimestamp = (timestamp: string | undefined): string => {
  if (!timestamp) return '';

  try {
    const date = new Date(timestamp);
    if (isNaN(date.getTime())) return '';

    return date.toLocaleTimeString('en-US', {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
  } catch {
    return '';
  }
};

/**
 * 系统初始化 Widget
 *
 * 展示会话初始化信息，包括会话 ID、模型、工作目录和可用工具
 */
export const SystemInitializedWidget = React.memo<SystemInitializedWidgetProps>(({
  sessionId,
  model,
  cwd,
  tools = EMPTY_TOOLS,
  timestamp,
}) => {
  const { t } = useTranslation();
  const [mcpExpanded, setMcpExpanded] = useState(false);
  const formattedTimestamp = useMemo(() => formatTimestamp(timestamp), [timestamp]);
  const handleMcpToggle = useCallback(() => {
    setMcpExpanded((expanded) => !expanded);
  }, []);

  // transition-none：覆盖 Card 基类的 transition-all。该卡片是静态信息且常驻虚拟列表，
  // streaming 期间会被反复重测/重排，transition-all 会让 WebKitGTK 每次布局都对所有可过渡
  // 属性(含 box-shadow/半透明背景)重新求值+重绘，造成"此行在视口内即持续卡顿、滚走即恢复"。
  return (
    <Card className="border-blue-500/20 bg-blue-500/5 transition-none">
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          <Settings className="h-5 w-5 text-blue-500 mt-0.5" />
          <div className="flex-1 space-y-4">
            {/* 头部 */}
            <div className="flex items-center justify-between">
              <h4 className="font-semibold text-sm">{t('systemInit.title', '系统初始化')}</h4>
              {formattedTimestamp && (
                <span className="text-xs text-muted-foreground font-mono">
                  {formattedTimestamp}
                </span>
              )}
            </div>

            {/* 会话信息 */}
            <div className="space-y-2">
              {sessionId && (
                <div className="flex items-center gap-2 text-xs">
                  <Fingerprint className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="text-muted-foreground">{t('systemInit.sessionId', '会话 ID')}:</span>
                  <code className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded">
                    {sessionId}
                  </code>
                </div>
              )}

              {model && (
                <div className="flex items-center gap-2 text-xs">
                  <Cpu className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="text-muted-foreground">{t('systemInit.model', '模型')}:</span>
                  <code className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded">
                    {model}
                  </code>
                </div>
              )}

              {cwd && (
                <div className="flex items-center gap-2 text-xs">
                  <FolderOpen className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="text-muted-foreground">{t('systemInit.workingDirectory', '工作目录')}:</span>
                  <code className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded break-all">
                    {cwd}
                  </code>
                </div>
              )}
            </div>

            {/* 工具列表 */}
            <ToolsList
              tools={tools}
              mcpExpanded={mcpExpanded}
              onMcpToggle={handleMcpToggle}
            />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}, (prev, next) => (
  prev.sessionId === next.sessionId &&
  prev.model === next.model &&
  prev.cwd === next.cwd &&
  prev.timestamp === next.timestamp &&
  areToolListsEqual(prev.tools ?? EMPTY_TOOLS, next.tools ?? EMPTY_TOOLS)
));

SystemInitializedWidget.displayName = 'SystemInitializedWidget';
