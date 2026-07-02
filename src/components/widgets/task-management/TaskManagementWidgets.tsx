/**
 * Task Management Widgets - Claude Code 任务管理工具
 *
 * 每个消息只渲染当前消息中的 TaskCreate/TaskUpdate 操作
 * 通过扫描所有消息构建 taskId→subject 查找表
 * 使 TaskUpdate 能显示任务标题
 */

import React from "react";
import { useTranslation } from "react-i18next";
import { CheckCircle2, Clock, Circle, Trash2, Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { useTaskSubjectLookup } from "@/contexts/MessagesContext";

const statusIcons: Record<string, React.ReactNode> = {
  completed: <CheckCircle2 className="h-4 w-4 text-success" />,
  in_progress: <Clock className="h-4 w-4 text-info animate-pulse" />,
  pending: <Circle className="h-4 w-4 text-muted-foreground" />,
  deleted: <Trash2 className="h-4 w-4 text-destructive" />,
};

// 状态 → i18n key，运行时经 t() 本地化，避免硬编码中文导致英文/繁体环境不切换。
const statusLabelKeys: Record<string, string> = {
  completed: "taskWidget.statusCompleted",
  in_progress: "taskWidget.statusInProgress",
  pending: "taskWidget.statusPending",
  deleted: "taskWidget.statusDeleted",
};

// ============================================================================
// 导出类型
// ============================================================================

export interface TaskToolCall {
  name: string;
  input: any;
  result?: any;
  id?: string;
}

export interface TaskListAggregateWidgetProps {
  toolCalls: TaskToolCall[];
}

/**
 * 聚合渲染当前消息中的 TaskCreate/TaskUpdate 操作
 * 每个操作渲染为一行，TaskUpdate 通过 lookup 显示任务标题
 */
export const TaskListAggregateWidget: React.FC<TaskListAggregateWidgetProps> = ({
  toolCalls,
}) => {
  const { t } = useTranslation();
  const lookup = useTaskSubjectLookup();

  return (
    <div className="space-y-1">
      {toolCalls.map((tc, idx) => {
        if (/^TaskCreate$/i.test(tc.name)) {
          return (
            <TaskCreateRow
              key={tc.id || idx}
              subject={tc.input?.subject}
              description={tc.input?.description}
            />
          );
        }
        if (/^TaskUpdate$/i.test(tc.name)) {
          const taskId = tc.input?.taskId ? String(tc.input.taskId) : '';
          const subject = tc.input?.subject || lookup.get(taskId);
          return (
            <TaskUpdateRow
              key={tc.id || idx}
              taskId={taskId}
              status={tc.input?.status}
              subject={subject}
            />
          );
        }
        if (/^TaskList$/i.test(tc.name)) {
          return (
            <div key={tc.id || idx} className="flex items-center gap-2 py-0.5 text-xs text-muted-foreground">
              <Circle className="h-3 w-3" />
              <span>{t('taskWidget.viewTaskList')}</span>
            </div>
          );
        }
        if (/^TaskGet$/i.test(tc.name)) {
          return (
            <div key={tc.id || idx} className="flex items-center gap-2 py-0.5 text-xs text-muted-foreground">
              <Circle className="h-3 w-3" />
              <span>{t('taskWidget.viewTask', { id: tc.input?.taskId })}</span>
            </div>
          );
        }
        return null;
      })}
    </div>
  );
};

// ============================================================================
// TaskCreate 行
// ============================================================================

const TaskCreateRow: React.FC<{ subject?: string; description?: string }> = ({
  subject,
  description,
}) => {
  const { t } = useTranslation();
  return (
    <div className="flex items-start gap-2.5 px-3 py-2 rounded-md border bg-card/50">
      <div className="mt-0.5 shrink-0">
        <Plus className="h-4 w-4 text-primary" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm leading-snug">{subject || t('taskWidget.newTask')}</p>
        {description && (
          <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{description}</p>
        )}
      </div>
      <Badge variant="outline" className="text-xs shrink-0 bg-muted/10 text-muted-foreground border-muted/20">
        {t('taskWidget.statusPending')}
      </Badge>
    </div>
  );
};

// ============================================================================
// TaskUpdate 行
// ============================================================================

const TaskUpdateRow: React.FC<{ taskId: string; status?: string; subject?: string }> = ({
  taskId,
  status,
  subject,
}) => {
  const { t } = useTranslation();
  const displayStatus = status || 'pending';
  return (
    <div className={cn(
      "flex items-start gap-2.5 px-3 py-2 rounded-md border bg-card/50",
      displayStatus === "completed" && "opacity-70",
    )}>
      <div className="mt-0.5 shrink-0">
        {statusIcons[displayStatus] || statusIcons.pending}
      </div>
      <div className="flex-1 min-w-0">
        <p className={cn(
          "text-sm leading-snug",
          displayStatus === "completed" && "line-through text-muted-foreground"
        )}>
          {subject || t('taskWidget.taskLabel', { id: taskId })}
        </p>
      </div>
      <Badge variant="outline" className={cn("text-xs shrink-0", {
        "bg-success/10 text-success border-success/20": displayStatus === "completed",
        "bg-info/10 text-info border-info/20": displayStatus === "in_progress",
        "bg-muted/10 text-muted-foreground border-muted/20": displayStatus === "pending",
        "bg-destructive/10 text-destructive border-destructive/20": displayStatus === "deleted",
      })}>
        {statusLabelKeys[displayStatus] ? t(statusLabelKeys[displayStatus]) : displayStatus}
      </Badge>
    </div>
  );
};

// ============================================================================
// 单独的 Widget 导出（兼容 toolRegistryInit 注册）
// 实际渲染由 TaskListAggregateWidget 在 ToolCallsGroup 中接管
// ============================================================================

export interface TaskCreateWidgetProps {
  subject?: string; description?: string; activeForm?: string; result?: any;
}
export const TaskCreateWidget: React.FC<TaskCreateWidgetProps> = () => null;

export interface TaskUpdateWidgetProps {
  taskId?: string; status?: string; subject?: string;
  description?: string; activeForm?: string; result?: any;
}
export const TaskUpdateWidget: React.FC<TaskUpdateWidgetProps> = () => null;

export interface TaskListWidgetProps { result?: any; }
export const TaskListWidget: React.FC<TaskListWidgetProps> = () => null;

export interface TaskGetWidgetProps { taskId?: string; result?: any; }
export const TaskGetWidget: React.FC<TaskGetWidgetProps> = () => null;
