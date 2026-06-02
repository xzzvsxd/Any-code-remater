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

export interface PendingPlanApproval {
  plan: string;
  planId: string;
  timestamp: number;
}

export type PlanStatus = 'pending' | 'approved' | 'rejected';

interface PlanModeContextValue {
  isPlanMode: boolean;
  setIsPlanMode: (value: boolean) => void;
  togglePlanMode: () => void;
  pendingApproval: PendingPlanApproval | null;
  showApprovalDialog: boolean;
  triggerPlanApproval: (plan: string) => void;
  approvePlan: () => void;
  rejectPlan: () => void;
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

function loadPlanIds(key: string): Set<string> {
  try {
    const stored = sessionStorage.getItem(key);
    if (stored) {
      return new Set(JSON.parse(stored));
    }
  } catch (e) {
    console.error(`[PlanMode] Failed to load ${key}:`, e);
  }
  return new Set();
}

function savePlanIds(key: string, ids: Set<string>) {
  try {
    sessionStorage.setItem(key, JSON.stringify([...ids]));
  } catch (e) {
    console.error(`[PlanMode] Failed to save ${key}:`, e);
  }
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
  const [approvedPlanIds, setApprovedPlanIds] = useState<Set<string>>(() => loadPlanIds('approved_plan_ids'));
  const [rejectedPlanIds, setRejectedPlanIds] = useState<Set<string>>(() => loadPlanIds('rejected_plan_ids'));

  const sendPromptCallbackRef = useRef<((prompt: string) => void) | null>(null);
  const storageKeyRef = useRef<string | undefined>(storageKey);

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

  const triggerPlanApproval = useCallback((plan: string) => {
    const planId = generatePlanId(plan);

    if (approvedPlanIds.has(planId) || rejectedPlanIds.has(planId)) {
      return;
    }

    setPendingApproval({
      plan,
      planId,
      timestamp: Date.now(),
    });
    setShowApprovalDialog(true);
  }, [approvedPlanIds, rejectedPlanIds]);

  const setSendPromptCallback = useCallback((callback: ((prompt: string) => void) | null) => {
    sendPromptCallbackRef.current = callback;
  }, []);

  const approvePlan = useCallback(() => {
    if (!pendingApproval) return;

    const { planId } = pendingApproval;
    setApprovedPlanIds(prev => {
      const next = new Set(prev);
      next.add(planId);
      savePlanIds('approved_plan_ids', next);
      return next;
    });

    setIsPlanModeInternal(false);
    savePlanMode(storageKeyRef.current, false);
    onPlanModeChange?.(false);
    setPendingApproval(null);
    setShowApprovalDialog(false);

    if (sendPromptCallbackRef.current) {
      setTimeout(() => {
        sendPromptCallbackRef.current?.("请开始执行上述计划。");
      }, 100);
    }
  }, [pendingApproval, onPlanModeChange]);

  const rejectPlan = useCallback(() => {
    if (!pendingApproval) return;

    const { planId } = pendingApproval;
    setRejectedPlanIds(prev => {
      const next = new Set(prev);
      next.add(planId);
      savePlanIds('rejected_plan_ids', next);
      return next;
    });

    setPendingApproval(null);
    setShowApprovalDialog(false);
  }, [pendingApproval]);

  const closeApprovalDialog = useCallback(() => {
    setShowApprovalDialog(false);
  }, []);

  const value: PlanModeContextValue = {
    isPlanMode,
    setIsPlanMode,
    togglePlanMode,
    pendingApproval,
    showApprovalDialog,
    triggerPlanApproval,
    approvePlan,
    rejectPlan,
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
