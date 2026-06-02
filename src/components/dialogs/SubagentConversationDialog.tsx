/**
 * SubagentConversationDialog - 子代理（Task）子对话独立视图
 *
 * 将某个 Task 的完整子代理对话放到独立模态中查看，
 * 使主对话区只保留紧凑的 Task 入口卡片，互不干扰。
 */

import { Bot } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { AIMessage } from "@/components/message/AIMessage";
import { UserMessage } from "@/components/message/UserMessage";
import type { SubagentGroup } from "@/lib/subagentGrouping";
import { getSubagentMessageRole } from "@/lib/subagentGrouping";
import { useTranslation } from "@/hooks/useTranslation";

/**
 * 获取子代理类型的显示名称
 */
function getSubagentTypeLabel(type: string | undefined, t: (key: string) => string): string {
  if (!type) return t('subagent.subagent');
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

export interface SubagentConversationDialogProps {
  /** 是否显示 */
  open: boolean;
  /** 关闭回调 */
  onClose: () => void;
  /** 子代理消息组 */
  group: SubagentGroup;
  /** 链接检测回调 */
  onLinkDetected?: (url: string) => void;
}

/**
 * 子代理子对话模态视图
 */
export function SubagentConversationDialog({
  open,
  onClose,
  group,
  onLinkDetected,
}: SubagentConversationDialogProps) {
  const { t } = useTranslation();

  const subagentMessages = Array.isArray(group.subagentMessages) ? group.subagentMessages : [];
  const messageCount = subagentMessages.length;
  const typeLabel = getSubagentTypeLabel(group.subagentType, t);

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="sm:max-w-4xl max-h-[88vh] flex flex-col gap-0 p-0 overflow-hidden">
        {/* 头部 */}
        <DialogHeader className="px-5 pt-5 pb-4 border-b border-border/60">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-full bg-blue-500/10 flex items-center justify-center flex-shrink-0">
              <Bot className="h-[18px] w-[18px] text-blue-500" />
            </div>
            <div className="min-w-0">
              <DialogTitle className="text-base leading-tight">{typeLabel}</DialogTitle>
              <DialogDescription className="text-xs mt-0.5">
                {t('subagent.executionProcess')} · {t('subagent.messageCount', { count: messageCount })}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {/* 子对话消息列表 */}
        <ScrollArea className="flex-1 min-h-0 max-h-[calc(88vh-5rem)]">
          <div className="p-3 space-y-2">
            {/* Task 输入（主代理发起的任务） */}
            {group.taskMessage && (
              <div className="rounded-lg border border-border/50 bg-muted/20 overflow-hidden">
                <AIMessage
                  message={group.taskMessage}
                  isStreaming={false}
                  onLinkDetected={onLinkDetected}
                  className="m-0"
                />
              </div>
            )}

            {/* 子代理消息 */}
            {subagentMessages.length > 0 ? (
              subagentMessages.map((message, index) => {
                if (!message) return null;
                const role = getSubagentMessageRole(message);

                if (role === 'assistant' || message.type === 'assistant') {
                  return (
                    <div key={`msg-${index}-${message.timestamp || index}`} className="px-1">
                      <AIMessage
                        message={message}
                        isStreaming={false}
                        onLinkDetected={onLinkDetected}
                        className="shadow-none"
                      />
                    </div>
                  );
                } else if (role === 'user' || message.type === 'user') {
                  const isPromptToSubagent = message.type === 'user' &&
                    Array.isArray(message.message?.content) &&
                    message.message.content.some((item: any) => item?.type === 'text');

                  return (
                    <div key={`msg-${index}-${message.timestamp || index}`} className="px-1">
                      {isPromptToSubagent && (
                        <div className="text-[10px] text-muted-foreground mb-1 px-2 flex items-center gap-1 opacity-60">
                          <span className="uppercase tracking-wider font-medium">Task Input</span>
                        </div>
                      )}
                      <UserMessage
                        message={message}
                        className="shadow-none"
                      />
                    </div>
                  );
                }

                return null;
              })
            ) : (
              <div className="text-xs text-muted-foreground px-2 py-8 text-center italic">
                {t('subagent.noSubagentMessages')}
              </div>
            )}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
