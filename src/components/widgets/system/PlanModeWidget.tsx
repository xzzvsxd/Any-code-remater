/**
 * PlanModeWidget - Plan 模式切换工具渲染器
 *
 * 用于渲染 ExitPlanMode 和 EnterPlanMode 工具调用
 * Claude Code 官方 Plan 模式：AI 可动态进入/退出规划模式
 *
 * V2 改进实现：
 * - EnterPlanMode: 显示工具限制说明和最佳实践提示
 * - ExitPlanMode: 显示计划内容（支持Markdown）和审批按钮
 * - 使用 PlanModeContext 触发审批对话框
 * - 追踪已审批/已拒绝的计划，显示对应状态
 * - 避免重复弹窗
 */

import { useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Search, LogOut, CheckCircle, AlertCircle, Play, RefreshCw, Info, Lightbulb, Shield } from "lucide-react";
import { Button } from "@/components/ui/button";
import { usePlanMode, getPlanId, type PlanStatus } from "@/contexts/PlanModeContext";
import ReactMarkdown from 'react-markdown';

export interface PlanModeWidgetProps {
  /** 操作类型：进入或退出 Plan 模式 */
  action: "enter" | "exit";
  /** 计划内容（ExitPlanMode 时） */
  plan?: string;
  /** 工具执行结果 */
  result?: {
    content?: any;
    is_error?: boolean;
  };
  /** 工具调用唯一 ID（用作去重键，避免「内容相似的 plan 第二次给出」被误吞） */
  toolId?: string;
  /**
   * 桥接（阻塞式 MCP submit_plan）模式：审批交互由后端事件驱动的弹窗统一负责，
   * 会话流卡片仅做展示 + 审批状态回显，不自动弹窗、不提供审批入口，避免与 bridge 弹窗双弹。
   * 审批结果以 tool_result 内容为准（回灌文本含「批准」/「拒绝」）。
   */
  bridgeMode?: boolean;
}

/**
 * 从 bridge 提交的 tool_result 文本判定审批结果。
 * 回灌文本约定：批准含「批准」、拒绝含「拒绝」（见 PlanModeContext.approvePlan/rejectPlan）。
 */
function resolveBridgePlanStatus(result?: { content?: any; is_error?: boolean }): PlanStatus {
  if (!result || result.is_error) return 'pending';
  const text = typeof result.content === 'string'
    ? result.content
    : JSON.stringify(result.content ?? '');
  if (text.includes('批准')) return 'approved';
  if (text.includes('拒绝')) return 'rejected';
  return 'pending';
}

/**
 * Plan 模式切换 Widget
 *
 * 展示 AI 进入或退出 Plan 模式的操作
 */
export const PlanModeWidget: React.FC<PlanModeWidgetProps> = ({
  action,
  plan,
  result,
  toolId,
  bridgeMode = false,
}) => {
  const { t } = useTranslation();
  const isEnter = action === "enter";
  const isExit = action === "exit";
  const isError = result?.is_error;

  // 计算去重键：优先用工具调用唯一 toolId，回退到计划内容哈希
  const planId = useMemo(() => {
    if (toolId) return `plan_tool_${toolId}`;
    return plan ? getPlanId(plan) : null;
  }, [plan, toolId]);

  // 尝试获取 PlanMode Context
  let triggerPlanApproval: ((plan: string, toolId?: string, auto?: boolean) => void) | undefined;
  let getPlanStatus: ((planId: string) => PlanStatus) | undefined;
  let planStatus: PlanStatus = 'pending';

  try {
    const planModeContext = usePlanMode();
    triggerPlanApproval = planModeContext.triggerPlanApproval;
    getPlanStatus = planModeContext.getPlanStatus;

    // 获取当前计划状态
    if (planId && getPlanStatus) {
      planStatus = getPlanStatus(planId);
    }
  } catch {
    // Context 不可用时忽略（组件可能在 Provider 外部渲染）
  }

  // 桥接模式：审批状态改从 tool_result 判定（bridge 用 bridge_${requestId} 存状态，
  // 与本卡片的 plan_tool_${toolId} 键不通，无法直接读取）。
  if (bridgeMode && planStatus === 'pending') {
    planStatus = resolveBridgePlanStatus(result);
  }

  const isApproved = planStatus === 'approved';
  const isRejected = planStatus === 'rejected';
  const hasDecision = isApproved || isRejected;

  // 自动触发审批对话框（仅在 ExitPlanMode 且有计划内容且未决策时）。
  // 桥接模式不在卡片侧自动弹，交互统一由 bridge 弹窗负责，避免双弹。
  useEffect(() => {
    if (!bridgeMode && isExit && plan && triggerPlanApproval && !hasDecision && !result) {
      // 延迟触发，确保 UI 已渲染
      const timer = setTimeout(() => {
        triggerPlanApproval(plan, toolId, true);
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [bridgeMode, isExit, plan, triggerPlanApproval, hasDecision, result, toolId]);

  // 根据操作类型和审批状态选择样式
  const Icon = isEnter ? Search : LogOut;

  // 根据状态选择颜色
  const colorClass = isError
    ? "border-destructive/20 bg-destructive/5"
    : isApproved
      ? "border-green-500/30 bg-green-500/10"  // 已审批：绿色
      : isRejected
        ? "border-amber-500/30 bg-amber-500/10"  // 已拒绝：琥珀色
        : isEnter
          ? "border-blue-500/20 bg-blue-500/5"
          : "border-green-500/20 bg-green-500/5";

  const iconBgClass = isError
    ? "bg-destructive/10"
    : isApproved
      ? "bg-green-500/20"
      : isRejected
        ? "bg-amber-500/20"
        : isEnter
          ? "bg-blue-500/10"
          : "bg-green-500/10";

  const iconColorClass = isError
    ? "text-destructive"
    : isApproved
      ? "text-green-600"
      : isRejected
        ? "text-amber-600"
        : isEnter
          ? "text-blue-500"
          : "text-green-500";

  // 根据状态显示不同标题
  const title = isEnter
    ? t('promptInput.enterPlanMode')
    : isApproved
      ? t('promptInput.planApproved')
      : isRejected
        ? t('promptInput.planRejected')
        : t('promptInput.exitPlanMode');

  const description = isEnter
    ? t('promptInput.enterPlanModeDesc')
    : isApproved
      ? t('promptInput.planApprovedDesc')
      : isRejected
        ? t('promptInput.planRejectedDesc')
        : t('promptInput.exitPlanModeDesc');

  // 手动触发审批：始终放行（auto=false），即便此前已自动弹过。
  const handleTriggerApproval = () => {
    if (plan && triggerPlanApproval) {
      triggerPlanApproval(plan, toolId, false);
    }
  };

  // 选择图标
  const StatusIcon = isApproved
    ? CheckCircle
    : isRejected
      ? RefreshCw
      : Icon;

  // 未决策的 ExitPlanMode：整个卡片头部可点击触发审批（标题区与操作融为一体）。
  // 桥接模式不提供卡片侧审批入口（交互交给 bridge 弹窗）。
  const headerClickable = !bridgeMode && isExit && !!plan && !!triggerPlanApproval && !hasDecision && !result;

  return (
    <div className={`rounded-lg border ${colorClass} overflow-hidden`}>
      <div
        className={`px-4 py-3 flex items-start gap-3 transition-colors ${
          headerClickable ? "cursor-pointer hover:bg-green-500/10" : ""
        }`}
        onClick={headerClickable ? handleTriggerApproval : undefined}
      >
        <div className="mt-0.5">
          <div className={`h-8 w-8 rounded-full ${iconBgClass} flex items-center justify-center`}>
            <StatusIcon className={`h-4 w-4 ${iconColorClass}`} />
          </div>
        </div>
        <div className="flex-1 space-y-2">
          <div className="flex items-center gap-2">
            <span className={`text-xs font-medium ${iconColorClass}`}>
              {title}
            </span>
            {isApproved && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-green-500/20 text-green-600 font-medium">
                {t('widget.executed')}
              </span>
            )}
            {isRejected && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-500/20 text-amber-600 font-medium">
                {t('widget.rejected')}
              </span>
            )}
            {result && !isError && !isExit && !hasDecision && (
              <CheckCircle className="h-3.5 w-3.5 text-green-500" />
            )}
            {isError && (
              <AlertCircle className="h-3.5 w-3.5 text-destructive" />
            )}
          </div>
          <p className="text-sm text-muted-foreground">
            {description}
          </p>

          {/* EnterPlanMode: 显示工具限制和最佳实践 */}
          {isEnter && !isError && (
            <div className="mt-3 space-y-2">
              {/* 工具限制说明 */}
              <div className="flex items-start gap-2 p-2.5 rounded-md bg-blue-500/5 border border-blue-500/20">
                <Shield className="h-4 w-4 text-blue-600 mt-0.5 flex-shrink-0" />
                <div className="flex-1 text-xs space-y-1">
                  <div className="font-medium text-blue-700 dark:text-blue-300">
                    {t('widget.readOnlyMode')}
                  </div>
                  <div className="text-muted-foreground space-y-0.5">
                    <div className="text-green-600 dark:text-green-400">
                      ✓ {t('widget.allowedTools')}
                    </div>
                    <div className="text-red-600 dark:text-red-400">
                      ✗ {t('widget.forbiddenTools')}
                    </div>
                  </div>
                </div>
              </div>

              {/* 最佳实践提示 */}
              <div className="flex items-start gap-2 p-2.5 rounded-md bg-amber-500/5 border border-amber-500/20">
                <Lightbulb className="h-4 w-4 text-amber-600 mt-0.5 flex-shrink-0" />
                <div className="flex-1 text-xs space-y-1">
                  <div className="font-medium text-amber-700 dark:text-amber-300">
                    {t('widget.planModeBestPractices')}
                  </div>
                  <ul className="text-muted-foreground space-y-0.5 list-disc list-inside">
                    <li>{t('widget.keepPlanSmall')}</li>
                    <li>{t('widget.exploreCodebase')}</li>
                    <li>{t('widget.specificSteps')}</li>
                  </ul>
                </div>
              </div>
            </div>
          )}

          {/* ExitPlanMode: 显示计划内容预览 */}
          {isExit && plan && (
            <div className="mt-3 space-y-2">
              <div className="p-3 rounded-md bg-background/50 border border-border/50">
                <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground mb-2">
                  <Info className="h-3.5 w-3.5" />
                  <span>{t('widget.planContent')}</span>
                </div>
                <div className="text-xs text-foreground prose prose-sm dark:prose-invert max-w-none max-h-32 overflow-y-auto">
                  <ReactMarkdown>
                    {plan.length > 500 ? plan.substring(0, 500) + "\n\n..." : plan}
                  </ReactMarkdown>
                </div>
              </div>

              {/* 根据状态显示不同内容 */}
              {isApproved ? (
                // 已审批：显示状态标签
                <div className="flex items-center gap-2 text-xs text-green-600">
                  <CheckCircle className="h-3.5 w-3.5" />
                  <span>{t('widget.planApprovedExecuting')}</span>
                </div>
              ) : isRejected ? (
                // 已拒绝：显示状态标签
                <div className="flex items-center gap-2 text-xs text-amber-600">
                  <RefreshCw className="h-3.5 w-3.5" />
                  <span>{t('widget.planRejectedReplanning')}</span>
                </div>
              ) : bridgeMode ? (
                // 桥接模式未决策：审批交给 bridge 弹窗，卡片仅提示等待状态
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Info className="h-3.5 w-3.5" />
                  <span>{t('widget.planWaitingApproval')}</span>
                </div>
              ) : triggerPlanApproval ? (
                // 未决策：显示审批按钮（阻止冒泡，避免与可点击头部重复触发）
                <Button
                  size="sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleTriggerApproval();
                  }}
                  className="gap-2 bg-green-600 hover:bg-green-700"
                >
                  <Play className="h-3.5 w-3.5" />
                  {t('widget.viewFullPlanAndApprove')}
                </Button>
              ) : null}
            </div>
          )}

          {/* 显示错误信息 */}
          {isError && result?.content && (
            <div className="mt-2 p-2 rounded bg-destructive/10 text-xs text-destructive">
              {typeof result.content === 'string'
                ? result.content
                : JSON.stringify(result.content)}
            </div>
          )}

          {/* 显示成功消息（非 ExitPlanMode） */}
          {!isError && !isExit && result?.content && typeof result.content === 'string' && (
            <div className="mt-2 text-xs text-muted-foreground">
              {result.content}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
