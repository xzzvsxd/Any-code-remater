/**
 * PlanApprovalDialog - 计划审批对话框
 *
 * 当 Claude 调用 ExitPlanMode 工具时显示此对话框
 * 让用户审批计划，确认后关闭 Plan 模式开始执行
 *
 * V2 改进：
 * - 支持 Markdown 渲染计划内容
 * - 添加计划分析统计
 */

import { XCircle, FileText, Play, ListChecks, PenLine, Clock } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import ReactMarkdown from 'react-markdown';
import { useEffect, useMemo, useState } from 'react';
import { formatInteractionCountdown, getInteractionRemainingMs } from "@/lib/interactionDeadline";

export interface PlanApprovalDialogProps {
  /** 是否显示对话框 */
  open: boolean;
  /** 计划内容 */
  plan: string;
  /** 关闭对话框 */
  onClose: () => void;
  /** 批准计划 - 关闭 Plan 模式开始执行。feedback 为用户附加意见（可选）。 */
  onApprove: (feedback?: string) => void;
  /** 拒绝/修改计划 - 保持 Plan 模式。feedback 为拒绝理由或修改意见。 */
  onReject: (feedback?: string) => void;
  /** CLI 不支持流式输入时为 true：批准将作为「新一轮」继续，而非插入当前轮 */
  continuesAsNewTurn?: boolean;
  /** 是否允许关闭后稍后处理；阻塞式 bridge 计划审批不允许隐藏后悬挂 */
  canDefer?: boolean;
  /** 当前交互所属会话标题（优先传入用户备注标题） */
  sessionTitle?: string;
  /** 阻塞式 bridge 请求的超时时刻（毫秒时间戳） */
  expiresAtMs?: number;
  /** 暂不决定：bridge 请求会回灌“不批准也不执行”，非 bridge 请求则退化为关闭 */
  onDeferDecision?: () => void;
}

/**
 * 计划审批对话框
 */
export function PlanApprovalDialog({
  open,
  plan,
  onClose,
  onApprove,
  onReject,
  continuesAsNewTurn = false,
  canDefer = true,
  sessionTitle,
  expiresAtMs,
  onDeferDecision,
}: PlanApprovalDialogProps) {
  const [feedback, setFeedback] = useState('');
  const [remainingMs, setRemainingMs] = useState(0);
  const trimmedSessionTitle = sessionTitle?.trim() ?? "";

  useEffect(() => {
    if (open) {
      setFeedback('');
    }
  }, [open, plan]);

  useEffect(() => {
    if (!open || !expiresAtMs) {
      setRemainingMs(0);
      return;
    }

    const updateRemaining = () => {
      setRemainingMs(getInteractionRemainingMs(expiresAtMs));
    };

    updateRemaining();
    const timer = window.setInterval(updateRemaining, 1000);
    return () => window.clearInterval(timer);
  }, [open, expiresAtMs]);

  const handleApprove = () => {
    onApprove(feedback.trim() || undefined);
    // 父级 approvePlan 负责关闭当前计划或切到队列里的下一条计划；
    // 这里不能再调用 onClose，否则会把刚弹出的下一条计划立即隐藏。
    setFeedback('');
  };

  const handleReject = () => {
    onReject(feedback.trim() || undefined);
    // 父级 rejectPlan 负责关闭当前计划或切到队列里的下一条计划。
    setFeedback('');
  };

  const handleDeferDecision = () => {
    if (onDeferDecision) {
      onDeferDecision();
      setFeedback('');
      return;
    }

    onClose();
  };

  // 分析计划内容
  const planStats = useMemo(() => {
    if (!plan) return null;

    // 计算步骤数（根据编号列表）
    const stepMatches = plan.match(/^\d+\./gm);
    const steps = stepMatches ? stepMatches.length : 0;

    // 计算字符数和行数
    const chars = plan.length;
    const lines = plan.split('\n').length;

    return { steps, chars, lines };
  }, [plan]);

  const countdownText = expiresAtMs ? formatInteractionCountdown(remainingMs) : "";

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && canDefer && onClose()}>
      <DialogContent
        className="sm:max-w-2xl max-h-[88vh] flex flex-col gap-0 p-0 overflow-hidden"
        hideCloseButton={!canDefer}
      >
        <DialogHeader className="shrink-0 px-5 pt-5 pb-4 border-b border-border/60">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-full bg-blue-500/10 flex items-center justify-center shrink-0">
              <FileText className="h-5 w-5 text-blue-500" />
            </div>
            <div className="min-w-0 flex-1">
              <DialogTitle className="text-lg">计划已完成</DialogTitle>
              <DialogDescription className="mt-1">
                {continuesAsNewTurn
                  ? "Claude 已完成规划。本轮对话已结束，批准后将作为新一轮开始执行"
                  : "Claude 已完成规划，请审批以下计划"}
              </DialogDescription>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                {trimmedSessionTitle && (
                  <span
                    className="inline-flex max-w-[22rem] items-center gap-1 rounded-full border border-border/70 bg-muted/50 px-2 py-0.5"
                    title={trimmedSessionTitle}
                  >
                    <span className="shrink-0">当前会话：</span>
                    <span className="truncate font-medium text-foreground/80">
                      {trimmedSessionTitle}
                    </span>
                  </span>
                )}
                {countdownText && (
                  <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/25 bg-amber-500/10 px-2 py-0.5 text-amber-700 dark:text-amber-300">
                    <Clock className="h-3 w-3" />
                    <span>剩余 {countdownText}</span>
                  </span>
                )}
              </div>
            </div>
          </div>
        </DialogHeader>

        {/* 计划统计 */}
        {planStats && planStats.steps > 0 && (
          <div className="shrink-0 px-5 py-3 border-b border-border/60 bg-blue-500/[0.03]">
            <div className="flex items-center gap-4 p-3 rounded-xl bg-blue-500/5 border border-blue-500/20">
              <ListChecks className="h-5 w-5 text-blue-500 flex-shrink-0" />
              <div className="flex-1 flex items-center gap-4 text-xs">
                <div>
                  <span className="text-muted-foreground">步骤数：</span>
                  <span className="font-medium ml-1">{planStats.steps}</span>
                </div>
                <div className="h-4 w-px bg-border" />
                <div>
                  <span className="text-muted-foreground">内容：</span>
                  <span className="font-medium ml-1">{planStats.lines} 行</span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* 计划内容 */}
        <div className="flex-1 min-h-0 px-5 py-4 flex flex-col gap-2">
          <div className="text-sm font-medium text-muted-foreground">
            计划内容：
          </div>
          <ScrollArea className="flex-1 min-h-0 rounded-xl border border-border/70 bg-background/80 p-4 overscroll-contain">
            <div className="prose prose-sm dark:prose-invert max-w-none">
              <ReactMarkdown>
                {plan || "（无计划内容）"}
              </ReactMarkdown>
            </div>
          </ScrollArea>
        </div>

        {/* 底部说明与输入：独立 shrink 区域，永远不覆盖计划滚动区 */}
        <div className="shrink-0 border-t border-border/60 bg-background/95 px-5 py-3 space-y-3">
          {/* 提示信息 */}
          <div className="text-xs text-muted-foreground bg-muted/45 border border-border/60 rounded-xl p-3">
            <p className="font-medium text-foreground/80 mb-1">提示：</p>
            <ul className="list-disc list-inside space-y-1 leading-relaxed">
              <li><strong>批准执行</strong>：关闭 Plan 模式，Claude 将开始执行计划中的操作</li>
              <li><strong>继续规划</strong>：保持 Plan 模式，你可以要求 Claude 修改或完善计划</li>
            </ul>
          </div>

          {/* 用户反馈输入 */}
          <div>
            <div className="text-xs font-medium text-muted-foreground mb-1.5 flex items-center gap-1.5">
              <PenLine className="h-3.5 w-3.5" />
              修改意见 / 附加说明（可选）
            </div>
            <textarea
              className="w-full px-3 py-2 text-sm rounded-lg border border-border bg-background resize-none focus:outline-none focus:ring-1 focus:ring-blue-500/50"
              rows={2}
              placeholder="写下修改意见、补充说明，或留空直接操作…"
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
            />
          </div>
        </div>

        <DialogFooter className="shrink-0 px-5 py-3.5 border-t border-border/60 bg-muted/20 flex-row flex-wrap items-center sm:justify-end gap-2 sm:gap-2">
          {(canDefer || onDeferDecision) && (
            <Button
              variant="ghost"
              onClick={handleDeferDecision}
              className="gap-2 text-muted-foreground"
            >
              <XCircle className="h-4 w-4" />
              暂不决定，先别执行
            </Button>
          )}
          <Button
            variant="outline"
            onClick={handleReject}
            className="gap-2"
          >
            <XCircle className="h-4 w-4" />
            {feedback.trim() ? "提交意见并继续规划" : "继续规划"}
          </Button>
          <Button
            onClick={handleApprove}
            className="gap-2 bg-green-600 hover:bg-green-700"
          >
            <Play className="h-4 w-4" />
            批准执行
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
