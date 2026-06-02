/**
 * 子代理消息组组件
 *
 * 主对话区只显示紧凑的 Task 入口：Task 工具调用 + 子代理摘要 + 「查看子对话」按钮。
 * 完整子对话内容不在主对话铺开，点击按钮在独立模态（SubagentConversationDialog）中查看，
 * 避免子对话与主对话混杂。
 */

import React, { useState } from "react";
import { Bot, MessagesSquare } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { AIMessage } from "./AIMessage";
import type { SubagentGroup } from "@/lib/subagentGrouping";
import { SubagentConversationDialog } from "@/components/dialogs/SubagentConversationDialog";
import { useTranslation } from "@/hooks/useTranslation";

/**
 * 获取子代理类型的显示名称
 */
function getSubagentTypeLabel(type?: string, t?: (key: string) => string): string {
  if (!type || !t) return t ? t('subagent.subagent') : '子代理';
  const labelMap: Record<string, string> = {
    'general-purpose': t('subagent.generalPurpose'),
    'Explore': t('subagent.explore'),
    'Plan': t('subagent.plan'),
    'statusline-setup': t('subagent.statuslineSetup'),
    'code-reviewer': t('subagent.codeReviewer'),
    'analyst': t('subagent.analyst'),
    'executor': t('subagent.executor'),
  };
  return labelMap[type] || type;
}

interface SubagentMessageGroupProps {
  /** 子代理消息组 */
  group: SubagentGroup;
  /** 自定义类名 */
  className?: string;
  /** 链接检测回调 */
  onLinkDetected?: (url: string) => void;
}

/**
 * 子代理消息组（紧凑入口）
 *
 * 主对话只渲染 Task 调用与一个进入子对话的按钮，完整对话在模态中查看。
 */
export const SubagentMessageGroup: React.FC<SubagentMessageGroupProps> = ({
  group,
  className,
  onLinkDetected,
}) => {
  const { t } = useTranslation();
  const [showConversation, setShowConversation] = useState(false);

  // 🛡️ 防御性编程：验证 subagentMessages 数组
  const subagentMessages = Array.isArray(group.subagentMessages) ? group.subagentMessages : [];
  const messageCount = subagentMessages.length;

  // 🛡️ 如果没有 taskMessage，返回 null 防止崩溃
  if (!group.taskMessage) {
    if (process.env.NODE_ENV !== 'production') {
      console.error('[SubagentMessageGroup] Missing taskMessage in group:', group);
    }
    return null;
  }

  return (
    <div className={cn("relative my-2", className)}>
      <div className="rounded-lg border border-border/50 bg-muted/10 overflow-hidden">
        {/* Task 工具调用（固定显示） */}
        <div className="border-b border-border/30">
          <AIMessage
            message={group.taskMessage}
            isStreaming={false}
            onLinkDetected={onLinkDetected}
            className="m-0"
          />
        </div>

        {/* 紧凑入口栏：子代理摘要 + 查看子对话按钮 */}
        <div className="px-3 py-2 bg-muted/30 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <div className="flex items-center justify-center w-5 h-5 rounded bg-blue-500/10 text-blue-600 dark:text-blue-400 flex-shrink-0">
              <Bot className="h-3.5 w-3.5" />
            </div>
            <span className="text-sm font-medium text-foreground/80 truncate">
              {group.subagentType ? getSubagentTypeLabel(group.subagentType, t) : t('subagent.subagent')}
            </span>
            <div className="h-3 w-px bg-border/50 mx-1 flex-shrink-0" />
            <span className="text-xs text-muted-foreground/60 truncate">
              {t('subagent.messageCount', { count: messageCount })}
            </span>
          </div>

          <Button
            variant="outline"
            size="sm"
            className="h-7 px-2.5 gap-1.5 flex-shrink-0"
            onClick={() => setShowConversation(true)}
            disabled={messageCount === 0}
          >
            <MessagesSquare className="h-3.5 w-3.5" />
            <span className="text-xs">{t('subagent.viewConversation')}</span>
          </Button>
        </div>
      </div>

      {/* 子对话独立模态 */}
      <SubagentConversationDialog
        open={showConversation}
        onClose={() => setShowConversation(false)}
        group={group}
        onLinkDetected={onLinkDetected}
      />
    </div>
  );
};
