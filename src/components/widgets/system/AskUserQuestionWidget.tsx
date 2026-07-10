/**
 * AskUserQuestion Widget - 用户问题询问展示
 *
 * V4 改进版本：
 * - 添加折叠/展开功能
 * - 优化UI布局，更紧凑的设计
 * - 在选项上直接显示用户的选择（高亮）
 * - 完全隐藏底部的result.content冗余信息
 * - 添加问题统计信息
 * - 🆕 自动触发交互式对话框（未回答时）
 */

import React, { useState, useMemo, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { HelpCircle, CheckCircle, MessageCircle, ChevronDown, ChevronUp, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useOptionalUserQuestion, getQuestionId } from "@/contexts/UserQuestionContext";
import {
  getUnmatchedAnswerParts,
  getQuestionKey,
  isOptionSelectedSafe,
  normalizeAnswers,
  normalizeQuestions,
} from "@/lib/askUserQuestionUtils";
import {
  parseAskUserAnswersFromResultContent,
  resolveAskUserResultStatus,
} from "@/lib/interactionResultParsing";

export interface AskUserQuestionWidgetProps {
  /** 问题列表 */
  questions?: Array<{
    /** 问题文本 */
    question: string;
    /** 问题头部（简短标签） */
    header?: string;
    /** 选项列表 */
    options?: Array<{
      label: string;
      description?: string;
    }>;
    /** 是否支持多选 */
    multiSelect?: boolean;
  }>;
  /** 用户答案 */
  answers?: Record<string, string | string[]>;
  /** 工具执行结果 */
  result?: {
    content?: any;
    is_error?: boolean;
  };
  /** 工具调用唯一 ID（用作去重键，避免「相同内容问题第二次问」被误吞） */
  toolId?: string;
  /**
   * 桥接（阻塞式 MCP）模式：ask_user 的交互由后端事件驱动的弹窗统一负责，
   * 会话流卡片仅做展示 + 状态回显，不自动弹窗、不提供回答入口，避免与 bridge 弹窗双弹。
   * 「已回答」以 tool_result 是否到达为准。
   */
  bridgeMode?: boolean;
}

export const AskUserQuestionWidget: React.FC<AskUserQuestionWidgetProps> = ({
  questions = [],
  answers = {},
  result,
  toolId,
  bridgeMode = false,
}) => {
  const { t } = useTranslation();
  const isError = result?.is_error;
  const safeQuestions = useMemo(() => normalizeQuestions(questions), [questions]);
  const safeAnswers = useMemo(() => normalizeAnswers(answers), [answers]);
  const resultAnswers = useMemo(
    () => parseAskUserAnswersFromResultContent(result?.content),
    [result?.content]
  );
  const bridgeResultStatus = useMemo(
    () => bridgeMode ? resolveAskUserResultStatus(result?.content, isError) : 'pending',
    [bridgeMode, result?.content, isError]
  );
  const bridgeDeferred = bridgeMode && bridgeResultStatus === 'deferred';
  const parsedAnswers = useMemo(() => {
    // 如果answers不为空，直接使用
    if (Object.keys(safeAnswers).length > 0) {
      return safeAnswers;
    }

    return resultAnswers;
  }, [safeAnswers, resultAnswers]);
  const hasParsedAnswers = Object.keys(parsedAnswers).length > 0;
  // 桥接模式下，优先用真实解析出的答案；只有非 defer 的未知成功结果才退化为“已回答”。
  const bridgeAnswered = bridgeMode && bridgeResultStatus === 'answered';
  const hasAnswers = hasParsedAnswers || bridgeAnswered;

  // 折叠状态：已回答时默认折叠，未回答时默认展开
  const [isCollapsed, setIsCollapsed] = useState(hasAnswers);

  const toggleCollapse = () => {
    setIsCollapsed(!isCollapsed);
  };

  // 🆕 尝试获取 UserQuestion Context；Provider 外渲染时只展示静态 widget。
  const userQuestionContext = useOptionalUserQuestion();
  const triggerQuestionDialog = userQuestionContext?.triggerQuestionDialog;
  const isQuestionAnswered = userQuestionContext?.isQuestionAnswered;

  // 计算去重键：优先用工具调用唯一 toolId，回退到问题内容哈希
  const questionId = useMemo(() => {
    if (toolId) return `tool_${toolId}`;
    return safeQuestions.length > 0 ? getQuestionId(safeQuestions) : null;
  }, [safeQuestions, toolId]);

  // 检查是否已回答
  const answered = questionId && isQuestionAnswered ? isQuestionAnswered(questionId) : false;
  // 桥接模式：交互交给 bridge 弹窗，卡片永不提供「回答」入口，避免双弹。
  const canAnswerQuestion = !bridgeMode && safeQuestions.length > 0 && !hasAnswers && !answered;

  // 🆕 自动触发问答对话框（仅在有问题且未回答时）。
  // 「只自动弹一次」由 Context 的 autoTriggeredIds 统一去重（与 widget 生命周期解耦），
  // 因此 widget 卸载/重挂载（列表滚动）也不会重复自动弹——这里只负责按需发起请求。
  useEffect(() => {
    if (canAnswerQuestion && triggerQuestionDialog) {
      // 延迟触发，确保 UI 已渲染
      const timer = setTimeout(() => {
        triggerQuestionDialog(safeQuestions, toolId, true);
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [safeQuestions, canAnswerQuestion, triggerQuestionDialog, toolId]);

  const handleAnswerNow = (event: React.MouseEvent) => {
    event.stopPropagation();
    if (!triggerQuestionDialog || !canAnswerQuestion) {
      return;
    }
    // 手动点击：始终放行（auto=false），即便此前已自动弹过。
    triggerQuestionDialog(safeQuestions, toolId, false);
  };

  // 构建问题到答案的映射
  const questionAnswerMap = useMemo(() => {
    const map = new Map<string, string | string[]>();

    safeQuestions.forEach((q) => {
      // 尝试多种方式匹配答案
      const possibleKeys = [
        q.question,                    // 使用完整问题文本作为key（最常见）
        q.question.replace(/\?$/, ''), // 去掉问号
        q.question.replace(/\s+/g, ' ').trim(), // 标准化空格
        q.header,                      // 使用header作为key
      ].filter(Boolean);

      for (const key of possibleKeys) {
        if (key && parsedAnswers[key]) {
          map.set(getQuestionKey(q), parsedAnswers[key]);
          break;
        }
      }

      // 如果仍然没匹配到，尝试模糊匹配
      if (!map.has(getQuestionKey(q))) {
        const questionText = q.question.toLowerCase();
        for (const [answerKey, answerValue] of Object.entries(parsedAnswers)) {
          const keyLower = answerKey.toLowerCase();
          // 检查问题文本的前30个字符是否匹配
          if (questionText.substring(0, 30) === keyLower.substring(0, 30)) {
            map.set(getQuestionKey(q), answerValue as string | string[]);
            break;
          }
        }
      }
    });

    return map;
  }, [safeQuestions, parsedAnswers]);

  return (
    <div
      className={cn(
        "rounded-lg border overflow-hidden",
        isError
          ? "border-destructive/20 bg-destructive/5"
          : bridgeDeferred
            ? "border-amber-500/20 bg-amber-500/5"
          : hasAnswers
            ? "border-green-500/20 bg-green-500/5"
            : "border-blue-500/20 bg-blue-500/5"
      )}
    >
      {/* 头部：待回答时整行点击=触发回答对话框（标题区与操作融为一体）；已回答时整行点击=折叠/展开 */}
      <div
        className={cn(
          "px-4 py-3 flex items-start gap-3 transition-colors",
          canAnswerQuestion && triggerQuestionDialog
            ? "cursor-pointer hover:bg-blue-500/10"
            : "cursor-pointer hover:bg-background/30"
        )}
        onClick={canAnswerQuestion && triggerQuestionDialog ? handleAnswerNow : toggleCollapse}
      >
        {/* 图标 */}
        <div className="mt-0.5">
          <div
            className={cn(
              "h-8 w-8 rounded-full flex items-center justify-center",
              isError
                ? "bg-destructive/10"
                : bridgeDeferred
                  ? "bg-amber-500/15"
                : hasAnswers
                  ? "bg-green-500/20"
                  : "bg-blue-500/10"
            )}
          >
            {hasAnswers ? (
              <CheckCircle
                className={cn(
                  "h-4 w-4",
                  isError ? "text-destructive" : "text-green-600"
                )}
              />
            ) : (
              <HelpCircle className={cn("h-4 w-4", bridgeDeferred ? "text-amber-600" : "text-blue-500")} />
            )}
          </div>
        </div>

        {/* 标题和摘要 */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span
                className={cn(
                  "text-xs font-medium",
                  isError
                    ? "text-destructive"
                    : bridgeDeferred
                      ? "text-amber-600"
                    : hasAnswers
                      ? "text-green-600"
                      : "text-blue-500"
                )}
              >
                {bridgeDeferred
                  ? t('widget.answerDeferred', '暂未回答')
                  : hasAnswers
                    ? t('widget.userAnswered')
                    : t('widget.waitingAnswer')}
              </span>
              {safeQuestions.length > 0 && (
                <span className="text-xs text-muted-foreground">
                  {t('widget.questionsCount', { count: safeQuestions.length })}
                </span>
              )}
              {/* 回答问题按钮紧跟问题数文本，而非推到行尾（视觉上作为文本标签的直接操作入口） */}
              {canAnswerQuestion && triggerQuestionDialog && (
                <Button
                  size="sm"
                  className="h-7 px-2.5 text-xs gap-1 bg-blue-600 hover:bg-blue-700 text-white"
                  onClick={handleAnswerNow}
                >
                  <MessageCircle className="h-3.5 w-3.5" />
                  {t('widget.answerQuestions')}
                </Button>
              )}
            </div>

            <Button
              variant="ghost"
              size="sm"
              className="h-6 w-6 p-0"
              onClick={(e) => {
                e.stopPropagation();
                toggleCollapse();
              }}
            >
              {isCollapsed ? (
                <ChevronDown className="h-4 w-4" />
              ) : (
                <ChevronUp className="h-4 w-4" />
              )}
            </Button>
          </div>

          {/* 折叠时显示的简要信息。优先结构化答案，其次从 result.content 解析出的答案 */}
          {isCollapsed && hasAnswers && (() => {
            const summaryAnswers = Object.keys(safeAnswers).length > 0 ? safeAnswers : parsedAnswers;
            const entries = Object.entries(summaryAnswers);
            if (entries.length === 0) {
              // 桥接模式下已回答但无可解析答案明细：给出通用回执文案
              return (
                <div className="mt-1 text-xs text-muted-foreground truncate">
                  {t('widget.userAnswered')}
                </div>
              );
            }
            return (
              <div className="mt-1 text-xs text-muted-foreground truncate">
                {entries.slice(0, 2).map(([key, value]) => {
                  const displayValue = Array.isArray(value) ? value.join(", ") : value;
                  return `${key}: ${displayValue}`;
                }).join(" | ")}
                {entries.length > 2 && ` +${entries.length - 2}...`}
              </div>
            );
          })()}
          {isCollapsed && bridgeDeferred && (
            <div className="mt-1 text-xs text-muted-foreground truncate">
              {t('widget.answerDeferredDesc', '用户选择暂时不回答，Claude 将暂停或继续处理不依赖答案的部分')}
            </div>
          )}
        </div>
      </div>

      {/* 展开的内容 */}
      {!isCollapsed && (
        <div className="px-4 pb-3 space-y-3 border-t border-border/30">
          {/* 问题列表 */}
          {safeQuestions.length > 0 && (
            <div className="space-y-2 pt-3">
              {safeQuestions.map((q, qIndex) => {
                // 获取这个问题的答案
                const questionKey = getQuestionKey(q);
                const answer = questionAnswerMap.get(questionKey);
                const hasAnswer = !!answer;
                const customAnswerParts = getUnmatchedAnswerParts(answer, q.options || []);

                return (
                  <div
                    key={qIndex}
                    className={cn(
                      "p-3 rounded-md border space-y-2",
                      hasAnswer
                        ? "bg-green-500/5 border-green-500/20"
                        : "bg-background/50 border-border/50"
                    )}
                  >
                    {/* 问题文本 */}
                    <div className="flex items-start gap-2">
                      <MessageCircle className="h-4 w-4 text-muted-foreground mt-0.5 flex-shrink-0" />
                      <div className="flex-1">
                        {q.header && (
                          <div className="text-xs font-medium text-primary mb-1 flex items-center gap-2">
                            <span>{q.header}</span>
                            {hasAnswer && (
                              <CheckCircle className="h-3 w-3 text-green-600" />
                            )}
                          </div>
                        )}
                        <div className="text-sm text-foreground">{q.question}</div>
                      </div>
                    </div>

                    {/* 选项列表 */}
                    {q.options && q.options.length > 0 && (
                      <div className="pl-6 space-y-1.5">
                        {q.options.map((option, optIndex) => {
                          const isSelected = isOptionSelectedSafe(option.label, answer);

                          return (
                            <div
                              key={optIndex}
                              className={cn(
                                "text-xs p-2.5 rounded-md transition-all relative",
                                isSelected
                                  ? "bg-green-500/15 border-2 border-green-500/40 shadow-md"
                                  : "bg-muted/30 hover:bg-muted/50 border border-transparent"
                              )}
                            >
                              <div className="flex items-start gap-2.5">
                                {/* 选中徽章 */}
                                {isSelected ? (
                                  <div className="flex-shrink-0 h-5 w-5 rounded-full bg-green-500 flex items-center justify-center shadow-sm">
                                    <Check className="h-3.5 w-3.5 text-white font-bold" strokeWidth={3} />
                                  </div>
                                ) : (
                                  <div className="flex-shrink-0 h-5 w-5 rounded-full border-2 border-muted-foreground/30 bg-background" />
                                )}
                                <div className="flex-1 pt-0.5">
                                  <div className="flex items-center gap-2">
                                    <div
                                      className={cn(
                                        "font-medium",
                                        isSelected
                                          ? "text-green-700 dark:text-green-300"
                                          : "text-foreground"
                                      )}
                                    >
                                      {option.label}
                                    </div>
                                    {/* 选中标签 */}
                                    {isSelected && (
                                      <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-green-500 text-white shadow-sm">
                                        {t('widget.selected')}
                                      </span>
                                    )}
                                  </div>
                                  {option.description && (
                                    <div
                                      className={cn(
                                        "mt-0.5",
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
                        {q.multiSelect && (
                          <div className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                            <span className="text-blue-500">ℹ️</span>
                            <span>{t('widget.multipleChoice')}</span>
                          </div>
                        )}
                      </div>
                    )}

                    {/* 自定义/开放式回答：答案不匹配任何预设选项时也必须显式渲染 */}
                    {customAnswerParts.length > 0 && (
                      <div className="pl-6 space-y-1.5">
                        {customAnswerParts.map((customAnswer, customIndex) => (
                          <div
                            key={`custom-answer-${customIndex}`}
                            className="text-xs p-2.5 rounded-md transition-all relative bg-green-500/15 border-2 border-green-500/40 shadow-md"
                          >
                            <div className="flex items-start gap-2.5">
                              <div className="flex-shrink-0 h-5 w-5 rounded-full bg-green-500 flex items-center justify-center shadow-sm">
                                <Check className="h-3.5 w-3.5 text-white font-bold" strokeWidth={3} />
                              </div>
                              <div className="flex-1 min-w-0 pt-0.5">
                                <div className="flex items-center gap-2">
                                  <div className="font-medium text-green-700 dark:text-green-300">
                                    {t('widget.customAnswer', '自定义回答')}
                                  </div>
                                  <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-green-500 text-white shadow-sm">
                                    {t('widget.selected')}
                                  </span>
                                </div>
                                <div className="mt-0.5 text-green-600 dark:text-green-400 whitespace-pre-wrap break-words">
                                  {customAnswer}
                                </div>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* 错误信息：仅在无法再回答时显示真正的错误内容。
              避免把工具占位结果（如未回答时返回的 "Answer questions?"）当作错误文本展示，
              那种情况下应引导用户去点「回答问题」按钮，而非显示一行裸英文。 */}
          {isError && result?.content && !canAnswerQuestion && (
            <div className="p-2 rounded bg-destructive/10 text-xs text-destructive">
              {typeof result.content === "string"
                ? result.content
                : JSON.stringify(result.content)}
            </div>
          )}

          {/* 完全隐藏result.content，因为答案已经在选项上显示 */}
        </div>
      )}
    </div>
  );
};
