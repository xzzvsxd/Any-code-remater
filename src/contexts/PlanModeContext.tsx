/**
 * PlanModeContext - Plan 模式状态管理
 * 负责管理 Plan 模式状态和审批流程，并支持按键持久化。
 */

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useRef,
  type ReactNode,
} from "react";
import { api } from "@/lib/api";
import {
  enqueuePendingInteraction,
  shiftPendingInteraction,
} from "@/lib/pendingInteractionQueue";

export interface PendingPlanApproval {
  plan: string;
  planId: string;
  timestamp: number;
  /**
   * 阻塞式 MCP 提交（submit_plan）的桥接请求 id。存在时，审批结果经 api.answerUserQuestion
   * 回灌唤醒被阻塞的工具调用，CLI 在同一轮据结果继续；不存在时退化为旧的"发新一轮提示"。
   */
  requestId?: string;
  /** 关联会话 id（MCP 提交携带），用于必要时按会话取消。 */
  sessionId?: string;
  /** 后端等待用户审批的超时时长（秒）。 */
  timeoutSeconds?: number;
  /** 后端等待用户审批的截止时间（毫秒时间戳）。 */
  expiresAtMs?: number;
}

export type PlanStatus = 'pending' | 'approved' | 'rejected';

interface PlanModeContextValue {
  isPlanMode: boolean;
  setIsPlanMode: (value: boolean) => void;
  togglePlanMode: () => void;
  pendingApproval: PendingPlanApproval | null;
  showApprovalDialog: boolean;
  /** 触发计划审批对话框；toolId 优先用作去重键。
   *  auto=true 表示「自动弹出」，同一计划仅允许自动弹一次；用户手动点击触发（auto=false/省略）则始终放行。 */
  triggerPlanApproval: (plan: string, toolId?: string, auto?: boolean) => void;
  /**
   * 触发一次「阻塞式 MCP 计划审批」对话框：由后端 ask-user-plan 事件驱动，必然弹出并携带 requestId。
   */
  triggerBridgePlan: (
    requestId: string,
    sessionId: string,
    plan: string,
    metadata?: { timeoutSeconds?: number; expiresAtMs?: number }
  ) => void;
  approvePlan: (feedback?: string) => void;
  rejectPlan: (feedback?: string) => void;
  deferPlanDecision: () => void;
  closeApprovalDialog: () => void;
  getPlanStatus: (planId: string) => PlanStatus;
  isPlanApproved: (planId: string) => boolean;
  isPlanRejected: (planId: string) => boolean;
  approvedPlanIds: Set<string>;
  rejectedPlanIds: Set<string>;
  setSendPromptCallback: (callback: ((prompt: string) => void) | null) => void;
}

const PlanModeContext = createContext<PlanModeContextValue | undefined>(undefined);

interface PlanModeProviderProps {
  children: ReactNode;
  initialPlanMode?: boolean;
  storageKey?: string;
  onPlanModeChange?: (isPlanMode: boolean) => void;
}

function generatePlanId(plan: string): string {
  const content = plan.substring(0, 200);
  let hash = 0;
  for (let i = 0; i < content.length; i++) {
    const char = content.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return `plan_${Math.abs(hash)}_${plan.length}`;
}

/**
 * 解析计划审批的去重键：优先使用工具调用唯一 toolId（每次调用唯一，可避免「内容相似的 plan 第二次给出」被误吞），
 * 无 toolId 时回退到内容哈希。
 */
function resolvePlanDedupeKey(plan: string, toolId?: string): string {
  return toolId ? `plan_tool_${toolId}` : generatePlanId(plan);
}

function loadPlanMode(storageKey: string | undefined, fallback: boolean): boolean {
  if (!storageKey) return fallback;

  try {
    const stored = localStorage.getItem(storageKey);
    if (stored === null) return fallback;
    return stored === 'true';
  } catch (e) {
    console.error(`[PlanMode] Failed to load ${storageKey}:`, e);
    return fallback;
  }
}

function savePlanMode(storageKey: string | undefined, value: boolean) {
  if (!storageKey) return;

  try {
    localStorage.setItem(storageKey, String(value));
  } catch (e) {
    console.error(`[PlanMode] Failed to save ${storageKey}:`, e);
  }
}

export function PlanModeProvider({
  children,
  initialPlanMode = false,
  storageKey,
  onPlanModeChange,
}: PlanModeProviderProps) {
  const [isPlanMode, setIsPlanModeInternal] = useState(() => loadPlanMode(storageKey, initialPlanMode));
  const [pendingApproval, setPendingApproval] = useState<PendingPlanApproval | null>(null);
  const [showApprovalDialog, setShowApprovalDialog] = useState(false);
  const pendingApprovalRef = useRef<PendingPlanApproval | null>(null);
  const showApprovalDialogRef = useRef(false);
  const approvalQueueRef = useRef<PendingPlanApproval[]>([]);
  // 已决策集合仅存内存：刷新/重开会话应允许重新审批，避免「内容相似的 plan 被永久跳过」导致审批对话框不弹。
  const [approvedPlanIds, setApprovedPlanIds] = useState<Set<string>>(() => new Set());
  const [rejectedPlanIds, setRejectedPlanIds] = useState<Set<string>>(() => new Set());

  const sendPromptCallbackRef = useRef<((prompt: string) => void) | null>(null);
  const storageKeyRef = useRef<string | undefined>(storageKey);

  // 「已自动弹出过」的计划去重集合。
  // 用 ref 而非 state，使其与 widget 生命周期解耦——列表滚动导致 widget 卸载/重挂载时记录仍存活，
  // 从而保证同一计划「只自动弹一次」，滚回来不再自动弹（用户可手动点按钮再弹）。
  const autoTriggeredPlanIdsRef = useRef<Set<string>>(new Set());

  const setActiveApproval = useCallback((approval: PendingPlanApproval | null, visible: boolean) => {
    pendingApprovalRef.current = approval;
    showApprovalDialogRef.current = visible;
    setPendingApproval(approval);
    setShowApprovalDialog(visible);
  }, []);

  useEffect(() => {
    if (storageKeyRef.current === storageKey) {
      return;
    }

    storageKeyRef.current = storageKey;
    const nextValue = loadPlanMode(storageKey, initialPlanMode);
    setIsPlanModeInternal(nextValue);
    savePlanMode(storageKey, nextValue);
  }, [storageKey, initialPlanMode]);

  useEffect(() => {
    savePlanMode(storageKeyRef.current, isPlanMode);
  }, [isPlanMode]);

  const setIsPlanMode = useCallback((value: boolean) => {
    setIsPlanModeInternal(value);
    savePlanMode(storageKeyRef.current, value);
    onPlanModeChange?.(value);
  }, [onPlanModeChange]);

  const togglePlanMode = useCallback(() => {
    setIsPlanModeInternal(prev => {
      const nextValue = !prev;
      savePlanMode(storageKeyRef.current, nextValue);
      onPlanModeChange?.(nextValue);
      return nextValue;
    });
  }, [onPlanModeChange]);

  const getPlanStatus = useCallback((planId: string): PlanStatus => {
    if (approvedPlanIds.has(planId)) return 'approved';
    if (rejectedPlanIds.has(planId)) return 'rejected';
    return 'pending';
  }, [approvedPlanIds, rejectedPlanIds]);

  const isPlanApproved = useCallback((planId: string) => approvedPlanIds.has(planId), [approvedPlanIds]);

  const isPlanRejected = useCallback((planId: string) => rejectedPlanIds.has(planId), [rejectedPlanIds]);

  const activateOrQueueApproval = useCallback((nextApproval: PendingPlanApproval) => {
    // 不覆盖当前正在等待用户处理的计划。连续 submit_plan / ExitPlanMode
    // 请求按 planId/requestId 排队，避免第二个计划把第一个 bridge 请求挤掉。
    const activeApproval = pendingApprovalRef.current;
    if (activeApproval && showApprovalDialogRef.current) {
      approvalQueueRef.current = enqueuePendingInteraction(
        approvalQueueRef.current,
        activeApproval,
        nextApproval,
        plan => plan.planId,
      );
      return;
    }

    setActiveApproval(nextApproval, true);
  }, [setActiveApproval]);

  const showNextQueuedApproval = useCallback(() => {
    const { next, rest } = shiftPendingInteraction(approvalQueueRef.current);
    approvalQueueRef.current = rest;
    setActiveApproval(next, Boolean(next));
  }, [setActiveApproval]);

  const triggerPlanApproval = useCallback((plan: string, toolId?: string, auto: boolean = false) => {
    const planId = resolvePlanDedupeKey(plan, toolId);

    if (approvedPlanIds.has(planId) || rejectedPlanIds.has(planId)) {
      return;
    }

    // 自动弹出仅允许首次：同一计划自动弹过一次后，用户若未决策而继续往下，
    // 之后即使滚回该 widget 也不再自动弹，只能手动点审批按钮触发。
    if (auto) {
      if (autoTriggeredPlanIdsRef.current.has(planId)) {
        return;
      }
      autoTriggeredPlanIdsRef.current.add(planId);
    }

    activateOrQueueApproval({
      plan,
      planId,
      timestamp: Date.now(),
    });
  }, [approvedPlanIds, rejectedPlanIds, activateOrQueueApproval]);

  // 触发阻塞式 MCP 计划审批：由后端 ask-user-plan 事件驱动，必然弹出并携带 requestId。
  // 不走去重——每个 submit_plan 调用唯一，且 CLI 正阻塞等待，必须弹。
  const triggerBridgePlan = useCallback(
    (
      requestId: string,
      sessionId: string,
      plan: string,
      metadata?: { timeoutSeconds?: number; expiresAtMs?: number },
    ) => {
      activateOrQueueApproval({
        plan,
        planId: `bridge_${requestId}`,
        timestamp: Date.now(),
        requestId,
        sessionId,
        timeoutSeconds: metadata?.timeoutSeconds,
        expiresAtMs: metadata?.expiresAtMs,
      });
    },
    [activateOrQueueApproval],
  );

  const setSendPromptCallback = useCallback((callback: ((prompt: string) => void) | null) => {
    sendPromptCallbackRef.current = callback;
  }, []);

  const approvePlan = useCallback((feedback?: string) => {
    if (!pendingApproval) return;

    const { planId, requestId } = pendingApproval;
    setApprovedPlanIds(prev => {
      const next = new Set(prev);
      next.add(planId);
      return next;
    });

    setIsPlanModeInternal(false);
    savePlanMode(storageKeyRef.current, false);
    onPlanModeChange?.(false);
    showNextQueuedApproval();

    const feedbackSuffix = feedback ? `\n\n用户附加说明：${feedback}` : '';

    // 路径①：阻塞式 MCP 提交——回灌"已批准"唤醒被阻塞的 submit_plan，CLI 在同一轮开始执行。
    if (requestId) {
      const text = `用户已【批准】该计划。请立即开始执行上述计划。${feedbackSuffix}`;
      api.answerUserQuestion(requestId, text)
        .then((hit) => {
          if (!hit && sendPromptCallbackRef.current) {
            sendPromptCallbackRef.current(`请开始执行上述计划。${feedbackSuffix}`);
          }
        })
        .catch((e) => {
          console.error("[PlanMode] approve回灌失败:", e);
          if (sendPromptCallbackRef.current) sendPromptCallbackRef.current(`请开始执行上述计划。${feedbackSuffix}`);
        });
      return;
    }

    // 路径②：旧的"发新一轮"
    if (sendPromptCallbackRef.current) {
      setTimeout(() => {
        sendPromptCallbackRef.current?.(`请开始执行上述计划。${feedbackSuffix}`);
      }, 100);
    }
  }, [pendingApproval, onPlanModeChange, showNextQueuedApproval]);

  const rejectPlan = useCallback((feedback?: string) => {
    if (!pendingApproval) return;

    const { planId, requestId } = pendingApproval;
    setRejectedPlanIds(prev => {
      const next = new Set(prev);
      next.add(planId);
      return next;
    });

    showNextQueuedApproval();

    const feedbackSuffix = feedback ? `\n\n用户的修改意见：${feedback}` : '';

    // 路径①：阻塞式 MCP 提交——回灌"已拒绝"唤醒被阻塞的 submit_plan，CLI 据此停下/调整，不会擅自执行。
    if (requestId) {
      const text = `用户【拒绝】了该计划。请不要执行，停下来根据用户意见修改计划后重新提交。${feedbackSuffix}`;
      api.answerUserQuestion(requestId, text).catch((e) => {
        console.error("[PlanMode] reject回灌失败:", e);
      });
    }
    // 旧路径：拒绝不发任何消息（维持原行为）。
  }, [pendingApproval, showNextQueuedApproval]);

  const deferPlanDecision = useCallback(() => {
    const activeApproval = pendingApprovalRef.current;
    if (!activeApproval) {
      return;
    }

    const { requestId } = activeApproval;

    if (requestId) {
      const text = "用户暂时未决定是否批准该计划。请不要执行计划；先暂停，等待用户后续确认或修改意见。";
      showNextQueuedApproval();
      api.answerUserQuestion(requestId, text).catch((e) => {
        console.error("[PlanMode] defer回灌失败:", e);
      });
      return;
    }

    if (approvalQueueRef.current.length > 0) {
      showNextQueuedApproval();
      return;
    }

    showApprovalDialogRef.current = false;
    setShowApprovalDialog(false);
  }, [showNextQueuedApproval]);

  const closeApprovalDialog = useCallback(() => {
    // 阻塞式 submit_plan 不能被隐藏，否则后端 handler 会一直等待。
    if (pendingApprovalRef.current?.requestId) {
      return;
    }

    // 如果关闭的是可延后处理的旧 ExitPlanMode，而队列已有 submit_plan，
    // 立即切到下一项，避免后续计划审批被永久压住。
    if (approvalQueueRef.current.length > 0) {
      showNextQueuedApproval();
      return;
    }

    showApprovalDialogRef.current = false;
    setShowApprovalDialog(false);
  }, [showNextQueuedApproval]);

  const value: PlanModeContextValue = {
    isPlanMode,
    setIsPlanMode,
    togglePlanMode,
    pendingApproval,
    showApprovalDialog,
    triggerPlanApproval,
    triggerBridgePlan,
    approvePlan,
    rejectPlan,
    deferPlanDecision,
    closeApprovalDialog,
    getPlanStatus,
    isPlanApproved,
    isPlanRejected,
    approvedPlanIds,
    rejectedPlanIds,
    setSendPromptCallback,
  };

  return (
    <PlanModeContext.Provider value={value}>
      {children}
    </PlanModeContext.Provider>
  );
}

export function usePlanMode() {
  const context = useContext(PlanModeContext);
  if (!context) {
    throw new Error("usePlanMode must be used within PlanModeProvider");
  }
  return context;
}

export function getPlanId(plan: string): string {
  return generatePlanId(plan);
}

export function extractExitPlanModeFromMessage(message: any): string | null {
  if (!message) return null;

  if (message.type === "tool_use" || message.type === "assistant") {
    const content = message.message?.content || message.content;
    if (Array.isArray(content)) {
      for (const block of content) {
        if (block.type === "tool_use") {
          const toolName = (block.name || "").toLowerCase();
          if (
            toolName === "exitplanmode" ||
            toolName === "exit_plan_mode" ||
            toolName === "exit-plan-mode"
          ) {
            const input = block.input || {};
            return input.plan || input.content || "";
          }
        }
      }
    }
  }

  return null;
}
