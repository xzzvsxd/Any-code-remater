/**
 * AskUserQuestionDialog - 用户问答对话框
 *
 * 当 Claude 调用 AskUserQuestion 工具时显示此对话框
 * 让用户选择答案，确认后自动发送给 Claude
 *
 * 参考：PlanApprovalDialog 的实现模式
 */

import { useState, useMemo, useEffect } from "react";
import { HelpCircle, Send, XCircle, CheckCircle, Check, PenLine } from "lucide-react";
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
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import type { Question, UserAnswers } from "@/contexts/UserQuestionContext";
import { getQuestionKey, normalizeQuestions } from "@/lib/askUserQuestionUtils";

export interface AskUserQuestionDialogProps {
  /** 是否显示对话框 */
  open: boolean;
  /** 问题列表 */
  questions: Question[];
  /** 关闭对话框 */
  onClose: () => void;
  /** 提交答案 */
  onSubmit: (answers: UserAnswers) => boolean | void;
  /** CLI 不支持流式输入时为 true：回答将作为「新一轮」继续，而非插入当前轮 */
  continuesAsNewTurn?: boolean;
  /** 当前问题批次的稳定 key；同一个弹窗未关闭但切到下一批问题时用于清空旧选择 */
  resetKey?: string;
  /** 是否允许稍后回答；阻塞式 bridge 请求不允许关闭后悬挂 */
  canDefer?: boolean;
}

/**
 * 用户问答对话框
 */
export function AskUserQuestionDialog({
  open,
  questions,
  onClose,
  onSubmit,
  continuesAsNewTurn = false,
  resetKey,
  canDefer = true,
}: AskUserQuestionDialogProps) {
  // 用户选择的答案
  const [selectedAnswers, setSelectedAnswers] = useState<UserAnswers>({});
  // 自由输入：每个问题可选"其他"并手写答案
  const [customInputs, setCustomInputs] = useState<Record<string, string>>({});
  // 标记哪些问题选择了"自由输入"模式
  const [usingCustom, setUsingCustom] = useState<Record<string, boolean>>({});
  const safeQuestions = useMemo(() => normalizeQuestions(questions), [questions]);

  // 每次重新打开对话框，或同一个打开的对话框切换到下一批问题时清空旧选择。
  // 否则连续 ask-user / request_user_input 会复用上一批选择，造成“第二遍弹了但内容/选择不对”。
  useEffect(() => {
    if (open) {
      setSelectedAnswers({});
      setCustomInputs({});
      setUsingCustom({});
    }
  }, [open, resetKey]);

  // 处理单选
  const handleSingleSelect = (questionKey: string, optionLabel: string) => {
    setUsingCustom(prev => ({ ...prev, [questionKey]: false }));
    setSelectedAnswers(prev => ({
      ...prev,
      [questionKey]: optionLabel,
    }));
  };

  // 处理多选
  const handleMultiSelect = (questionKey: string, optionLabel: string, checked: boolean) => {
    setUsingCustom(prev => ({ ...prev, [questionKey]: false }));
    setSelectedAnswers(prev => {
      const current = prev[questionKey];
      const currentArray = Array.isArray(current) ? current : [];

      if (checked) {
        return {
          ...prev,
          [questionKey]: [...currentArray, optionLabel],
        };
      } else {
        return {
          ...prev,
          [questionKey]: currentArray.filter(item => item !== optionLabel),
        };
      }
    });
  };

  // 切换到自由输入模式
  const handleSwitchToCustom = (questionKey: string) => {
    setUsingCustom(prev => ({ ...prev, [questionKey]: true }));
    // 用 customInputs 当前值（可能为空）更新 selectedAnswers
    const text = customInputs[questionKey]?.trim() || '';
    setSelectedAnswers(prev => ({
      ...prev,
      [questionKey]: text || undefined as any,
    }));
  };

  // 更新自由输入文本
  const handleCustomInputChange = (questionKey: string, text: string) => {
    setCustomInputs(prev => ({ ...prev, [questionKey]: text }));
    if (usingCustom[questionKey]) {
      setSelectedAnswers(prev => ({
        ...prev,
        [questionKey]: text.trim() || undefined as any,
      }));
    }
  };

  // 检查选项是否被选中
  const isOptionSelected = (questionKey: string, optionLabel: string): boolean => {
    const answer = selectedAnswers[questionKey];
    if (!answer) return false;

    if (Array.isArray(answer)) {
      return answer.includes(optionLabel);
    } else {
      return answer === optionLabel;
    }
  };

  // 检查是否所有问题都已回答
  const allAnswered = useMemo(() => {
    return safeQuestions.every(q => {
      const key = getQuestionKey(q);
      const answer = selectedAnswers[key];
      if (Array.isArray(answer)) {
        return answer.length > 0;
      }
      return !!answer;
    });
  }, [safeQuestions, selectedAnswers]);

  // 已回答问题数（用于底部进度展示）
  const answeredCount = useMemo(() => {
    return safeQuestions.filter(q => {
      const answer = selectedAnswers[getQuestionKey(q)];
      return Array.isArray(answer) ? answer.length > 0 : !!answer;
    }).length;
  }, [safeQuestions, selectedAnswers]);

  // 提交答案
  const handleSubmit = () => {
    if (!allAnswered) return;
    const submitted = onSubmit(selectedAnswers);
    if (submitted === false) {
      return;
    }
    // 父级 submitAnswers 负责关闭当前问题或切到队列里的下一批问题；
    // 这里不能再调用 onClose，否则会把刚弹出的下一批问题立即隐藏。
    // 重置选择
    setSelectedAnswers({});
  };

  // 关闭对话框
  const handleClose = () => {
    onClose();
    // 保留选择，用户可能稍后继续
  };

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && canDefer && handleClose()}>
      <DialogContent
        className="sm:max-w-2xl max-h-[88vh] flex flex-col gap-0 p-0 overflow-hidden"
        hideCloseButton={!canDefer}
      >
        {/* 头部 */}
        <DialogHeader className="px-5 pt-5 pb-4 border-b border-border/60">
          <div className="flex items-center gap-3">
            <div className={cn(
              "h-9 w-9 rounded-full flex items-center justify-center flex-shrink-0 transition-colors",
              allAnswered ? "bg-green-500/15" : "bg-blue-500/10"
            )}>
              {allAnswered ? (
                <CheckCircle className="h-[18px] w-[18px] text-green-600" />
              ) : (
                <HelpCircle className="h-[18px] w-[18px] text-blue-500" />
              )}
            </div>
            <div className="min-w-0">
              <DialogTitle className="text-base leading-tight">Claude 正在询问你</DialogTitle>
              <DialogDescription className="text-xs mt-0.5">
                {continuesAsNewTurn
                  ? "本轮对话已结束，提交答案后将作为新一轮继续"
                  : "选择答案后提交，Claude 将据此继续"}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {/* 问题列表 */}
        <ScrollArea className="flex-1 min-h-0 max-h-[min(60vh,520px)]">
          <div className="space-y-2.5 px-5 py-4">
            {safeQuestions.map((q, qIndex) => {
              const questionKey = getQuestionKey(q);
              const hasAnswer = !!selectedAnswers[questionKey];

              return (
                <div
                  key={qIndex}
                  className={cn(
                    "p-3 rounded-lg border space-y-2.5 transition-colors",
                    hasAnswer
                      ? "border-green-500/30 bg-green-500/5"
                      : "border-border bg-muted/20"
                  )}
                >
                  {/* 问题头部 */}
                  <div className="flex items-start gap-2">
                    <div className="flex-shrink-0 mt-0.5">
                      {hasAnswer ? (
                        <div className="h-4 w-4 rounded-full bg-green-500 flex items-center justify-center">
                          <Check className="h-2.5 w-2.5 text-white" strokeWidth={3} />
                        </div>
                      ) : (
                        <div className="h-4 w-4 rounded-full border-2 border-muted-foreground/30 bg-background" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      {q.header && (
                        <div className="text-xs font-semibold text-primary mb-0.5">
                          {q.header}
                        </div>
                      )}
                      <div className="text-sm text-foreground leading-snug">{q.question}</div>
                    </div>
                  </div>

                  {/* 选项列表 */}
                  {q.options && q.options.length > 0 && (
                    <div className="space-y-1.5 pl-6">
                      {q.options.map((option, optIndex) => {
                        const isSelected = isOptionSelected(questionKey, option.label);

                        return (
                          <div
                            key={optIndex}
                            className={cn(
                              "px-3 py-2 rounded-md border cursor-pointer transition-colors",
                              isSelected
                                ? "border-green-500/40 bg-green-500/10"
                                : "border-border/50 bg-background hover:bg-muted/50"
                            )}
                            onClick={() => {
                              if (q.multiSelect) {
                                handleMultiSelect(questionKey, option.label, !isSelected);
                              } else {
                                handleSingleSelect(questionKey, option.label);
                              }
                            }}
                          >
                            <div className="flex items-start gap-2.5">
                              {/* 选择图标 */}
                              {q.multiSelect ? (
                                <Checkbox
                                  checked={isSelected}
                                  onCheckedChange={(checked) =>
                                    handleMultiSelect(questionKey, option.label, checked as boolean)
                                  }
                                  className="mt-0.5 h-4 w-4"
                                />
                              ) : (
                                <div
                                  className={cn(
                                    "flex-shrink-0 mt-0.5 h-4 w-4 rounded-full border-2 flex items-center justify-center transition-colors",
                                    isSelected
                                      ? "bg-green-500 border-green-500"
                                      : "border-muted-foreground/30 bg-background"
                                  )}
                                >
                                  {isSelected && (
                                    <div className="h-1.5 w-1.5 rounded-full bg-white" />
                                  )}
                                </div>
                              )}

                              {/* 选项内容 */}
                              <div className="flex-1 min-w-0">
                                <div
                                  className={cn(
                                    "text-sm font-medium leading-snug",
                                    isSelected ? "text-green-700 dark:text-green-300" : "text-foreground"
                                  )}
                                >
                                  {option.label}
                                </div>
                                {option.description && (
                                  <div
                                    className={cn(
                                      "text-xs mt-0.5 leading-snug",
                                      isSelected
                                        ? "text-green-600 dark:text-green-400"
                                        : "text-muted-foreground"
                                    )}
                                  >
                                    {option.description}
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                        );
                      })}

                      {/* 多选提示 */}
                      {q.multiSelect && (
                        <div className="text-[11px] text-muted-foreground flex items-center gap-1 pl-1">
                          <span className="text-blue-500">ℹ️</span>
                          <span>可多选</span>
                        </div>
                      )}

                      {/* 自由输入选项：以上都不合适时可手动输入 */}
                      {!q.multiSelect && (
                        <div className="mt-1.5">
                          <div
                            className={cn(
                              "px-3 py-2 rounded-md border cursor-pointer transition-colors",
                              usingCustom[questionKey]
                                ? "border-blue-500/40 bg-blue-500/10"
                                : "border-border/50 bg-background hover:bg-muted/50"
                            )}
                            onClick={() => handleSwitchToCustom(questionKey)}
                          >
                            <div className="flex items-start gap-2.5">
                              <div
                                className={cn(
                                  "flex-shrink-0 mt-0.5 h-4 w-4 rounded-full border-2 flex items-center justify-center transition-colors",
                                  usingCustom[questionKey]
                                    ? "bg-blue-500 border-blue-500"
                                    : "border-muted-foreground/30 bg-background"
                                )}
                              >
                                {usingCustom[questionKey] && (
                                  <div className="h-1.5 w-1.5 rounded-full bg-white" />
                                )}
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className={cn(
                                  "text-sm font-medium leading-snug flex items-center gap-1.5",
                                  usingCustom[questionKey] ? "text-blue-700 dark:text-blue-300" : "text-muted-foreground"
                                )}>
                                  <PenLine className="h-3.5 w-3.5" />
                                  以上都不是，我自己输入
                                </div>
                              </div>
                            </div>
                          </div>
                          {usingCustom[questionKey] && (
                            <textarea
                              className="mt-1.5 w-full px-3 py-2 text-sm rounded-md border border-blue-500/30 bg-background resize-none focus:outline-none focus:ring-1 focus:ring-blue-500/50"
                              rows={2}
                              placeholder="输入你的答案..."
                              value={customInputs[questionKey] || ''}
                              onChange={(e) => handleCustomInputChange(questionKey, e.target.value)}
                              autoFocus
                            />
                          )}
                        </div>
                      )}
                    </div>
                  )}

                  {/* 无预设选项的纯开放式问题：直接显示输入框 */}
                  {(!q.options || q.options.length === 0) && (
                    <div className="pl-6 mt-1">
                      <textarea
                        className="w-full px-3 py-2 text-sm rounded-md border border-border bg-background resize-none focus:outline-none focus:ring-1 focus:ring-blue-500/50"
                        rows={2}
                        placeholder="输入你的答案..."
                        value={customInputs[questionKey] || ''}
                        onChange={(e) => {
                          const text = e.target.value;
                          setCustomInputs(prev => ({ ...prev, [questionKey]: text }));
                          setSelectedAnswers(prev => ({
                            ...prev,
                            [questionKey]: text.trim() || undefined as any,
                          }));
                        }}
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </ScrollArea>

        {/* 提示信息 */}
        {/* 底部操作栏：左侧进度计数 + 右侧操作按钮 */}
        <DialogFooter className="px-5 py-3.5 border-t border-border/60 flex-row items-center sm:justify-between gap-2">
          <div className="text-xs text-muted-foreground flex items-center gap-1.5 mr-auto">
            {allAnswered ? (
              <>
                <CheckCircle className="h-3.5 w-3.5 text-green-600" />
                <span className="text-green-600 font-medium">已全部回答</span>
              </>
            ) : !canDefer ? (
              <span className="text-blue-600 dark:text-blue-400 font-medium">
                当前轮正在等待你的回答
              </span>
            ) : (
              <span>已回答 {answeredCount}/{safeQuestions.length}</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {canDefer && (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleClose}
                className="gap-1.5 text-muted-foreground"
              >
                <XCircle className="h-4 w-4" />
                稍后回答
              </Button>
            )}
            <Button
              size="sm"
              onClick={handleSubmit}
              disabled={!allAnswered}
              className="gap-1.5 bg-green-600 hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Send className="h-4 w-4" />
              提交答案
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
