import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { motion, AnimatePresence } from "framer-motion";
import {
  ChevronDown,
  ChevronUp,
  X,
  List,
  GripVertical,
  Pencil,
  ArrowUp,
  Play
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { SortableList, SortableDragHandle } from "@/components/ui/sortable-list";
import { api, type Session, type Project } from "@/lib/api";
import { cn } from "@/lib/utils";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { notifyUserInputNeeded } from "@/lib/aiCompletionNotification";
import { FloatingPromptInput, type FloatingPromptInputRef, type ModelType } from "./FloatingPromptInput";
import { ErrorBoundary } from "./ErrorBoundary";
import { RevertPromptPicker } from "./RevertPromptPicker";
import { PromptNavigator } from "./PromptNavigator";
import { SplitPane } from "@/components/ui/split-pane";
import { WebviewPreview } from "./WebviewPreview";
import { type TranslationResult } from '@/lib/translationMiddleware';
import { useSessionCostCalculation } from '@/hooks/useSessionCostCalculation';
import { useDisplayableMessages } from '@/hooks/useDisplayableMessages';
import { useGroupedMessages } from '@/hooks/useGroupedMessages';
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts';
import { useSmartAutoScroll } from '@/hooks/useSmartAutoScroll';
import { useMessageTranslation } from '@/hooks/useMessageTranslation';
import { useSessionStream } from '@/hooks/useSessionStream';
import { usePromptExecution, type QueuedPrompt } from '@/hooks/usePromptExecution';
import { formatDuration } from '@/lib/pricing';
import { MessagesProvider, useMessagesContext } from '@/contexts/MessagesContext';
import { SessionProvider } from '@/contexts/SessionContext';
import { PlanModeProvider, usePlanMode } from '@/contexts/PlanModeContext';
import { PlanApprovalDialog } from '@/components/dialogs/PlanApprovalDialog';
import { PlanModeStatusBar } from '@/components/widgets/system/PlanModeStatusBar';
import { UserQuestionProvider, useUserQuestion } from '@/contexts/UserQuestionContext';
import { AskUserQuestionDialog } from '@/components/dialogs/AskUserQuestionDialog';
import { codexConverter } from '@/lib/codexConverter';
import { convertGeminiSessionDetailToClaudeMessages } from '@/lib/geminiConverter';
import { formatClaudeModelLabel, resolveClaudeContinuationModel } from '@/lib/claudeModelSelection';
import { buildQueueStorageKey, loadQueuedPrompts, saveQueuedPrompts } from '@/lib/queuedPromptsStore';
import { resolveInitialExecutionEngineConfig } from './executionEngineConfigPolicy';
import {
  getBranchPromptIndexForDisplayableMessage,
  getPromptNavigationIndexForDisplayableMessage,
  getPromptIndexForDisplayableMessage,
} from '@/lib/promptIndex';
import { usePromptIndexMaps } from '@/hooks/usePromptIndexMaps';
import { loadUiOnlySessionMessages, mergeUiOnlySessionMessages, pruneUiOnlySessionMessagesAfter } from '@/lib/uiOnlySessionEvents';
import { prepareRecentProjects } from '@/lib/recentProjects';
import { safeRandomUUID } from '@/lib/browserCompat';
import { getSessionDisplayTitle } from '@/lib/sessionDisplayTitle';
import { autoNameSessionFromPrompt } from '@/lib/sessionAutoTitle';
import { SessionHeader } from "./session/SessionHeader";
import { SessionMessages, type SessionMessagesRef } from "./session/SessionMessages";

import * as SessionHelpers from '@/lib/sessionHelpers';

import type { ClaudeStreamMessage } from '@/types/claude';
import type { CodexRateLimits } from '@/types/codex';
import type { ExecutionStatusInfo } from '@/components/FloatingPromptInput';

interface ClaudeCodeSessionProps {
  /**
   * Optional session to resume (when clicking from SessionList)
   */
  session?: Session;
  /**
   * Initial project path (for new sessions)
   */
  initialProjectPath?: string;
  /**
   * Initial engine restored from a tab/window shell. Brand-new tabs leave this
   * empty and therefore start as Claude; persisted draft/window shells can
   * restore an explicitly selected Codex/Gemini engine without making it the
   * global default for every future new session.
   */
  initialEngine?: 'claude' | 'codex' | 'gemini';
  /**
   * Optional className for styling
   */
  className?: string;
  /**
   * Callback when streaming state changes
   */
  onStreamingChange?: (isStreaming: boolean, sessionId: string | null) => void;
  /**
   * Callback when project path changes (for updating tab title)
   */
  onProjectPathChange?: (newPath: string) => void;
  /**
   * 🆕 Callback when execution engine changes (for updating tab icon)
   */
  onEngineChange?: (engine: 'claude' | 'codex' | 'gemini') => void;
  /**
   * 🔧 FIX: Callback when session info is extracted (for persisting new session to tab)
   * Called when a new session receives its sessionId and projectId from backend
   */
  onSessionInfoChange?: (info: { sessionId: string; projectId: string; projectPath: string; engine?: 'claude' | 'codex' | 'gemini'; firstUserPrompt?: string }) => void;
  /**
   * 当用户在「新会话」中发出首条消息时回调，用于把标签标题从「新对话」改为该消息内容。
   * 仅在本会话此前没有任何消息时触发一次。
   */
  onFirstUserPrompt?: (prompt: string) => void;
  /**
   * 新会话自动备注名写入成功后回调。Tab 场景用于把标签名同步成 Haiku/兜底生成的备注名；
   * 直接会话/独立窗口即使不传该回调，也会在组件内部持久化 session title。
   */
  onAutoSessionTitle?: (title: string, sessionId: string) => void;
  /**
   * Whether this session is currently active (for event listener management)
   */
  isActive?: boolean;
  /**
   * ??? Plan ??????
   */
  planModeStorageKey?: string;
  /**
   * 队列提示词持久化存储键（按会话身份隔离）。由 TabSessionWrapper 计算下传，
   * 使队列跨重启 / 跨视图保活且不同会话互不串味。缺省时 Inner 会按 session/path 兜底。
   */
  queueStorageKey?: string;
  /** 承载本会话的 tab id：用于新会话(未落盘)草稿的后端持久化唯一标识，支持多草稿互不覆盖。 */
  tabId?: string;
}

const engineDisplayNames: Record<'claude' | 'codex' | 'gemini', string> = {
  claude: 'Claude',
  codex: 'Codex',
  gemini: 'Gemini',
};
const EMPTY_VISIBLE_MESSAGES: ClaudeStreamMessage[] = [];
const AUTO_TITLE_RETRY_DELAYS_MS = [1_000, 3_000, 7_000, 15_000, 30_000, 60_000, 120_000] as const;

const getProjectLabel = (path: string) => {
  if (!path) return '';
  const normalized = path.replace(/\\/g, '/').replace(/\/+$/, '');
  return normalized.split('/').pop() || normalized;
};

const getContentActivityLengthHint = (value: unknown): number => {
  if (value == null) return 0;
  if (typeof value === 'string') return value.length;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value).length;

  if (Array.isArray(value)) {
    let total = 0;
    for (const item of value) {
      total += getContentActivityLengthHint(item);
    }
    return total;
  }

  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    let total = 0;
    if (typeof record.text === 'string') total += record.text.length;
    if (typeof record.content === 'string') total += record.content.length;
    if (typeof record.result === 'string') total += record.result.length;
    if (typeof record.type === 'string') total += record.type.length;
    if (typeof record.id === 'string') total += record.id.length;
    return total + Object.keys(record).length;
  }

  return 0;
};

const getMessageActivityKey = (messages: ClaudeStreamMessage[]): string => {
  if (messages.length === 0) return '0';
  const lastMessage = messages[messages.length - 1];
  const contentLength = getContentActivityLengthHint(lastMessage.message?.content);
  const timestamp = (lastMessage as any).receivedAt ?? (lastMessage as any).timestamp ?? '';
  return `${messages.length}:${lastMessage.type}:${contentLength}:${timestamp}`;
};

/**
 * ClaudeCodeSession component for interactive Claude Code sessions
 * 
 * @example
 * <ClaudeCodeSession onBack={() => setView('projects')} />
 */
const ClaudeCodeSessionInner: React.FC<ClaudeCodeSessionProps> = ({
  session,
  initialProjectPath = "",
  initialEngine,
  className,
  onStreamingChange,
  onProjectPathChange,
  onEngineChange,
  onSessionInfoChange,
  onFirstUserPrompt,
  onAutoSessionTitle,
  isActive = true, // 默认为活跃状态，保持向后兼容
  queueStorageKey: queueStorageKeyProp,
  tabId: tabIdProp,
}) => {
  const { t } = useTranslation();
  const [projectPath, setProjectPath] = useState(initialProjectPath || session?.project_path || "");
  const [recentProjects, setRecentProjects] = useState<Project[]>([]);
  const {
    messages,
    setMessages,
    appendMessage,
    appendMessageImmediate,
    appendOrReconcileUserMessage,
    replaceLastMessage,
    isStreaming,
    setIsStreaming,
    filterConfig,
    setFilterConfig
  } = useMessagesContext();
  const isLoading = isStreaming;
  const setIsLoading = setIsStreaming;
  const isLoadingRef = useRef(isLoading);
  isLoadingRef.current = isLoading;
  const visibleMessages = isActive ? messages : EMPTY_VISIBLE_MESSAGES;
  // 长流式输出时 messages 每帧都会变化；把“发送/问答/上下文”回调读取的最新消息放到 ref，
  // 避免 useCallback 依赖 messages 后在后台 tab 中反复重注册 Plan/UserQuestion 回调。
  const messagesRef = useRef<ClaudeStreamMessage[]>(messages);
  messagesRef.current = messages;
  const lastMessageActivityKey = useMemo(
    () => getMessageActivityKey(messages),
    [messages],
  );
  const [error, setError] = useState<string | null>(null);
  const [isHistoryLoading, setIsHistoryLoading] = useState(false);
  // 原始 JSONL 已由后端会话文件持久化，导出功能也从规范化后的 messages 生成。
  // 前端运行期不再保留第二份 raw JSONL：长任务中工具结果可能很大，在 Linux/WebKitGTK
  // renderer 内无界累积会制造内存压力并诱发白屏。保留 no-op 回调仅为 hook 接口兼容。
  const setRawJsonlOutput = useCallback<React.Dispatch<React.SetStateAction<string[]>>>((_action) => {}, []);
  const appendRawJsonlOutput = useCallback((_payload: string) => {}, []);
  const [isFirstPrompt, setIsFirstPrompt] = useState(!session); // Key state for session continuation
  const [extractedSessionInfo, setExtractedSessionInfo] = useState<{ sessionId: string; projectId: string; engine?: 'claude' | 'codex' | 'gemini' } | null>(null);
  // 🔧 FIX: 标记会话是否不存在（历史记录文件未找到）
  // 当为 true 时，effectiveSession 应返回 null，显示路径选择界面
  const [sessionNotFound, setSessionNotFound] = useState(false);
  const [claudeSessionId, setClaudeSessionId] = useState<string | null>(null);
  const claudeSessionIdRef = useRef<string | null>(null);
  const activeSessionIdRef = useRef<string | null>(null);
  const [cancelSessionId, setCancelSessionId] = useState<string | null>(null);
  const [codexRateLimits, setCodexRateLimits] = useState<CodexRateLimits | null>(null);
  const [isCancellingExecution, setIsCancellingExecution] = useState(false);
  const [executionStartedAt, setExecutionStartedAt] = useState<number | null>(null);
  const [lastOutputAt, setLastOutputAt] = useState<number | null>(null);
  const executionStartedAtRef = useRef<number | null>(null);
  const lastOutputAtRef = useRef<number | null>(null);

  useEffect(() => {
    claudeSessionIdRef.current = claudeSessionId;
  }, [claudeSessionId]);

  useEffect(() => {
    const now = Date.now();
    if (isLoading) {
      setIsCancellingExecution(false);
      setExecutionStartedAt(prev => prev ?? now);
      setLastOutputAt(prev => prev ?? now);
    } else {
      setIsCancellingExecution(false);
      setExecutionStartedAt(null);
      setLastOutputAt(null);
    }
  }, [isLoading]);

  useEffect(() => {
    executionStartedAtRef.current = executionStartedAt;
  }, [executionStartedAt]);

  // 跟随 isLoading 变化上报 streaming 状态：驱动 tab.state(idle↔streaming)，使侧栏实时反映「运行中」。
  // 关键：不要求 session 存在——新会话首轮还没拿到 sessionId 就已在 streaming，
  // 这条上报让它也能即时点亮侧栏运行标识（修复「会话已运行但侧栏不显示」）。
  useEffect(() => {
    onStreamingChange?.(isLoading, claudeSessionId);
  }, [isLoading]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    lastOutputAtRef.current = lastOutputAt;
  }, [lastOutputAt]);

  // 🔧 FIX: Track whether this component instance was created as a "new session" (no session prop).
  // When true, we must NOT auto-load/resume any session even if the session prop later
  // becomes defined (due to TabSessionWrapper memo allowing re-render on isActive change
  // after the tab's session was upgraded via updateTabSession).
  const wasCreatedAsNewSessionRef = useRef(!session);

  // Plan Mode state - 使用 Context（方案 B-1）
  const {
    isPlanMode,
    setIsPlanMode,
    showApprovalDialog,
    pendingApproval,
    approvePlan,
    rejectPlan,
    deferPlanDecision,
    closeApprovalDialog,
    setSendPromptCallback,
    triggerBridgePlan,
  } = usePlanMode();

  // 🆕 UserQuestion Context - 用户问答交互
  const {
    pendingQuestion,
    showQuestionDialog,
    submitAnswers,
    deferQuestionResponse,
    closeQuestionDialog,
    setSendMessageCallback,
    triggerBridgeQuestion,
  } = useUserQuestion();

  // 注：ask-user / ask-user-plan 的事件监听器移至 usePromptExecution 解构之后，
  // 因为它们需要 hook 暴露的真实 runTabId（后端事件路由用的 id）来过滤，而非外层 tabIdProp。

  // 🆕 Execution Engine Config (Codex/Gemini integration)
  // localStorage 只记住非引擎细节（Codex 模型/权限、Gemini 模型等）。
  // 引擎身份必须是 session/tab scoped：已有会话用 session.engine，恢复的草稿/独立窗口用
  // initialEngine，全新会话永远从 Claude 开始，避免上一次选过 Codex/Gemini 后污染新会话。
  const [executionEngineConfig, setExecutionEngineConfig] = useState<import('@/components/FloatingPromptInput/types').ExecutionEngineConfig>(() => {
    let storedConfig: unknown;
    try {
      const stored = localStorage.getItem('execution_engine_config');
      if (stored) {
        storedConfig = JSON.parse(stored);
      }
    } catch (error) {
      console.error('[ClaudeCodeSession] Failed to load engine config from localStorage:', error);
    }

    return resolveInitialExecutionEngineConfig({
      storedConfig,
      sessionEngine: session?.engine || initialEngine,
    });
  });

  // 队列持久化键：优先用 TabSessionWrapper 下传的 prop，缺省时按 session/path 兜底（与下传逻辑同款）。
  // 队列持久化键：正常由 TabSessionWrapper 下传（已对齐 effectiveSession，键稳定不漂移）。
  // 此处兜底仅用于极端无 prop 的场景（如单元/独立挂载），按 session/path 退化，不随 projectPath state 漂移。
  const queueStorageKey = useMemo(
    () => queueStorageKeyProp
      ?? buildQueueStorageKey({ sessionId: session?.id, projectPath: initialProjectPath, tabId: 'fallback' }),
    [queueStorageKeyProp, session?.id, initialProjectPath],
  );

  // Queued prompts state —— 惰性初始化时从 localStorage 恢复（恢复项标记 restored=true，不会被自动发送）。
  const [queuedPrompts, setQueuedPrompts] = useState<QueuedPrompt[]>(() => loadQueuedPrompts(queueStorageKey));
  const lastSubmittedClaudeModelRef = useRef<ModelType | null>(null);
  // 首条用户消息是否已用于标签自动命名（防止重复触发）。
  // 已有会话本就有名，挂载即视为已通知，避免覆盖。
  const firstPromptNotifiedRef = useRef(!!session);
  const firstSubmittedPromptRef = useRef<string | null>(null);
  const autoTitleSessionIdsRef = useRef<Set<string>>(new Set());
  const autoTitleInFlightSessionIdsRef = useRef<Set<string>>(new Set());
  const autoTitleRetryCountsRef = useRef<Map<string, number>>(new Map());
  const autoTitleRetryTimersRef = useRef<Map<string, number>>(new Map());
  const [autoTitleRetryTick, setAutoTitleRetryTick] = useState(0);
  const hasUserAuthoredMessage = useCallback(() => (
    messagesRef.current.some((message) => message.type === 'user')
  ), []);
  const getFirstUserAuthoredPrompt = useCallback((): string | null => {
    const firstUserMessage = messagesRef.current.find((message) => (
      message.type === 'user' && !message.isMeta
    ));
    const text = SessionHelpers.extractTextFromContent(firstUserMessage?.message?.content).trim();
    return text || null;
  }, []);

  // State for revert prompt picker (defined early for useKeyboardShortcuts)
  const [showRevertPicker, setShowRevertPicker] = useState(false);

  // State for prompt navigator
  const [showPromptNavigator, setShowPromptNavigator] = useState(false);

  // Settings state to avoid repeated loading in StreamMessage components
  const [claudeSettings, setClaudeSettings] = useState<{
    showSystemInitialization?: boolean;
    hideWarmupMessages?: boolean;
  }>({});

  // CLI 能力：是否支持 --input-format stream-json（决定交互模型：流式硬阻塞 vs 干净断开）
  const [supportsStreamJsonInput, setSupportsStreamJsonInput] = useState(false);

  // ✅ Refactored: Use custom Hook for session cost calculation
  const { stats: costStats, formatCost } = useSessionCostCalculation(visibleMessages, executionEngineConfig.engine);

  // ✅ Refactored: Use custom Hook for message filtering
  useEffect(() => {
    setFilterConfig(prev => {
      const hideWarmup = claudeSettings?.hideWarmupMessages !== false;
      if (prev.hideWarmupMessages === hideWarmup) {
        return prev;
      }
      return {
        ...prev,
        hideWarmupMessages: hideWarmup
      };
    });
  }, [claudeSettings?.hideWarmupMessages, setFilterConfig]);

  // 🆕 Notify parent when execution engine changes (for tab icon update)
  useEffect(() => {
    if (onEngineChange) {
      onEngineChange(executionEngineConfig.engine);
    }
  }, [executionEngineConfig.engine, onEngineChange]);

  // 🔧 FIX: Notify parent when session info is extracted (for new session persistence)
  // This fixes the issue where new session messages are lost after route switch
  useEffect(() => {
    if (extractedSessionInfo && onSessionInfoChange && projectPath) {
      console.debug('[ClaudeCodeSession] Session info extracted, notifying parent:', extractedSessionInfo);
      onSessionInfoChange({
        sessionId: extractedSessionInfo.sessionId,
        projectId: extractedSessionInfo.projectId,
        projectPath: projectPath,
        engine: extractedSessionInfo.engine,
        firstUserPrompt: firstSubmittedPromptRef.current ?? getFirstUserAuthoredPrompt() ?? undefined,
      });
    }
  }, [extractedSessionInfo, projectPath, onSessionInfoChange, getFirstUserAuthoredPrompt]);

  // 自动话题命名是“会话”行为，不能只绑在 TabSessionWrapper 上：
  // 独立窗口 / 旧 direct ClaudeCodeSession 入口不经过 TabSessionWrapper，也必须在拿到真实
  // sessionId 后写入 session_meta，否则工作区列表只会继续显示首条 prompt 或短 id。
  const scheduleAutoTitleRetry = useCallback((sessionId: string) => {
    if (!sessionId || autoTitleSessionIdsRef.current.has(sessionId)) return;
    if (autoTitleRetryTimersRef.current.has(sessionId)) return;

    const retryCount = autoTitleRetryCountsRef.current.get(sessionId) ?? 0;
    if (retryCount >= AUTO_TITLE_RETRY_DELAYS_MS.length) {
      autoTitleSessionIdsRef.current.add(sessionId);
      console.warn('[ClaudeCodeSession] Auto session title gave up after retries:', { sessionId });
      return;
    }

    const timerId = window.setTimeout(() => {
      autoTitleRetryTimersRef.current.delete(sessionId);
      setAutoTitleRetryTick((tick) => tick + 1);
    }, AUTO_TITLE_RETRY_DELAYS_MS[retryCount]);

    autoTitleRetryCountsRef.current.set(sessionId, retryCount + 1);
    autoTitleRetryTimersRef.current.set(sessionId, timerId);
  }, []);

  useEffect(() => () => {
    autoTitleRetryTimersRef.current.forEach((timerId) => window.clearTimeout(timerId));
    autoTitleRetryTimersRef.current.clear();
  }, []);

  useEffect(() => {
    const sessionId = extractedSessionInfo?.sessionId;
    if (!wasCreatedAsNewSessionRef.current || !sessionId) return;
    if (autoTitleSessionIdsRef.current.has(sessionId)) return;
    if (autoTitleInFlightSessionIdsRef.current.has(sessionId)) return;

    const firstPrompt = firstSubmittedPromptRef.current ?? getFirstUserAuthoredPrompt();
    if (!firstPrompt?.trim()) {
      scheduleAutoTitleRetry(sessionId);
      return;
    }

    autoTitleInFlightSessionIdsRef.current.add(sessionId);
    autoNameSessionFromPrompt({
      sessionId,
      prompt: firstPrompt,
    }).then((title) => {
      if (title) {
        autoTitleSessionIdsRef.current.add(sessionId);
        onAutoSessionTitle?.(title, sessionId);
      } else {
        scheduleAutoTitleRetry(sessionId);
      }
    }).catch((error) => {
      console.warn('[ClaudeCodeSession] Auto session title failed, will retry:', error);
      scheduleAutoTitleRetry(sessionId);
    }).finally(() => {
      autoTitleInFlightSessionIdsRef.current.delete(sessionId);
    });
  }, [autoTitleRetryTick, extractedSessionInfo?.sessionId, getFirstUserAuthoredPrompt, onAutoSessionTitle, scheduleAutoTitleRetry]);

  const displayableMessages = useDisplayableMessages(visibleMessages, {
    hideWarmupMessages: filterConfig.hideWarmupMessages
  });

  useEffect(() => {
    if (isLoading) {
      setLastOutputAt(Date.now());
    }
  }, [lastMessageActivityKey, isLoading]);

  const executionStatus = useMemo<ExecutionStatusInfo>(() => {
    const now = Date.now();
    const startedAt = executionStartedAt ?? now;
    const outputAt = lastOutputAt ?? startedAt;
    const elapsedSeconds = isLoading ? Math.max(0, Math.floor((now - startedAt) / 1000)) : 0;
    const idleSeconds = isLoading ? Math.max(0, Math.floor((now - outputAt) / 1000)) : 0;
    const engine = executionEngineConfig.engine;
    const engineName = engineDisplayNames[engine];
    const projectLabel = getProjectLabel(projectPath);
    const canCancel = Boolean(cancelSessionId);
    const statusLabel = isCancellingExecution
      ? `正在取消当前 ${engineName} 会话...`
      : `${engineName} 正在执行`;
    const statusHint = idleSeconds >= 60
      ? `已 ${formatDuration(idleSeconds)} 无新输出，可能仍在后台执行。完成后会弹出提醒。`
      : canCancel
        ? `取消只会影响当前会话${projectLabel ? `（${projectLabel}）` : ''}，不会断开其他对话。`
        : '正在启动进程，拿到当前会话 ID 后即可安全取消。';

    return {
      engine,
      engineName,
      isRunning: isLoading,
      canCancel,
      isCancelling: isCancellingExecution,
      startedAt,
      lastOutputAt: outputAt,
      elapsedSeconds,
      idleSeconds,
      activeSessionId: cancelSessionId,
      projectLabel,
      statusLabel,
      statusHint,
    };
  }, [
    executionEngineConfig.engine,
    executionStartedAt,
    isCancellingExecution,
    isLoading,
    lastOutputAt,
    projectPath,
    cancelSessionId,
  ]);

  // 🆕 将消息分组（处理子代理消息）
  const messageGroups = useGroupedMessages(displayableMessages, {
    enableSubagentGrouping: true
  });

  // Stable callback for toggling plan mode (prevents unnecessary event listener re-registration)
  const handleTogglePlanMode = useCallback(() => {
    setIsPlanMode(!isPlanMode);
  }, [isPlanMode, setIsPlanMode]);

  // Stable callback for showing revert dialog
  const handleShowRevertDialog = useCallback(() => {
    setShowRevertPicker(true);
  }, []);

  // ✅ Refactored: Use custom Hook for keyboard shortcuts
  useKeyboardShortcuts({
    isActive,
    onTogglePlanMode: handleTogglePlanMode,
    onShowRevertDialog: handleShowRevertDialog,
    hasDialogOpen: showRevertPicker
  });

  // ✅ Refactored: Use custom Hook for smart auto-scroll
  const { parentRef, userScrolled, setUserScrolled, setShouldAutoScroll } =
    useSmartAutoScroll({
      displayableMessages,
      isLoading
    });

  // 注：首屏进入会话的"贴底"已统一交给 useSmartAutoScroll（其初始 shouldAutoScroll=true，
  // "新消息到达" effect 会在首屏消息就位后自动贴底）。此处原有的"强制 scrollTop + 120px 二次补滚"
  // 逻辑与 hook 多套机制并存、互相覆盖，是滚动回弹/卡顿的诱因之一，已移除。

  // ============================================================================
  // MESSAGE-LEVEL OPERATIONS (Fine-grained Undo/Redo)
  // ============================================================================
  // Operations extracted to useMessageOperations Hook

  // New state for preview feature
  const [showPreview, setShowPreview] = useState(false);
  const [previewUrl, setPreviewUrl] = useState("");
  
  // Translation state
  const [lastTranslationResult, setLastTranslationResult] = useState<TranslationResult | null>(null);
  const [showPreviewPrompt, setShowPreviewPrompt] = useState(false);
  const [splitPosition, setSplitPosition] = useState(50);
  const [isPreviewMaximized, setIsPreviewMaximized] = useState(false);

  // Add collapsed state for queued prompts
  const [queuedPromptsCollapsed, setQueuedPromptsCollapsed] = useState(false);

  // ✅ All refs declared BEFORE custom Hooks that depend on them
  const unlistenRefs = useRef<UnlistenFn[]>([]);
  const hasActiveSessionRef = useRef(false);
  const floatingPromptRef = useRef<FloatingPromptInputRef>(null);
  const sessionMessagesRef = useRef<SessionMessagesRef>(null);
  const sendJumpTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingPromptNavRafRef = useRef<number | null>(null);
  const queuedPromptsRef = useRef<QueuedPrompt[]>([]);
  const isMountedRef = useRef(true);
  const isListeningRef = useRef(false);

  // ✅ Refactored: Use custom Hook for message translation (AFTER refs are declared)
  const {
    processMessageWithTranslation,
    initializeProgressiveTranslation,
  } = useMessageTranslation({
    isMountedRef,
    lastTranslationResult: lastTranslationResult || undefined,
    onMessagesUpdate: setMessages,
    onMessageAppend: appendMessage,
    onUserEcho: appendOrReconcileUserMessage
  });

  // 🔧 FIX: 处理会话历史不存在的情况，重置到初始状态
  const handleSessionNotFound = useCallback(() => {
    console.debug('[ClaudeCodeSession] Session not found, resetting to initial state');
    setSessionNotFound(true);
    // 重置为新会话状态
    setIsFirstPrompt(true);
  }, []);

  // ✅ 新架构: 使用 useSessionStream（基于 AsyncQueue + ConverterRegistry）
  const {
    loadSessionHistory,
    checkForActiveSession,
    // reconnectToSession removed - listeners now persist across tab switches
    // messageQueue - 新增：消息队列，支持 for await...of 消费
  } = useSessionStream({
    session,
    isMountedRef,
    isListeningRef,
    hasActiveSessionRef,
    unlistenRefs,
    setIsLoading,
    setIsHistoryLoading,
    setError,
    setMessages,
    setRawJsonlOutput,
    appendRawJsonlOutput,
    setClaudeSessionId,
    setCancelSessionId,
    setCodexRateLimits,
    initializeProgressiveTranslation,
    processMessageWithTranslation,
    onSessionNotFound: handleSessionNotFound,
    // 🔧 FIX: Pass isNewSessionInstance flag to prevent auto-loading/reconnecting
    // when the session prop later gets upgraded (after tab session update + isActive change).
    isNewSessionInstance: wasCreatedAsNewSessionRef.current,
    getRunElapsedSeconds: () => {
      const startedAt = executionStartedAtRef.current;
      return startedAt ? Math.max(0, Math.floor((Date.now() - startedAt) / 1000)) : null;
    },
  });

  // Keep ref in sync with state
  useEffect(() => {
    queuedPromptsRef.current = queuedPrompts;
  }, [queuedPrompts]);

  // 队列持久化：任何增删 / 重排 / 抽取都写回 localStorage，空队列则清理 key。
  // 使队列跨重启（重启后恢复项为 restored，需手动确认）与跨视图（ViewRouter 卸载 TabManager）保活。
  useEffect(() => {
    saveQueuedPrompts(queueStorageKey, queuedPrompts);
  }, [queueStorageKey, queuedPrompts]);

  // 🔧 NEW: Notify parent when project path changes (for tab title update)
  useEffect(() => {
    // Only notify if projectPath is valid and not the initial placeholder
    if (projectPath && projectPath !== initialProjectPath && onProjectPathChange) {
      onProjectPathChange(projectPath);
    }
  }, [projectPath, initialProjectPath, onProjectPathChange]);

  // ⚡ PERFORMANCE FIX: Git 初始化延迟到真正需要时
  // 原问题：每次加载会话都立即执行 git init + git add + git commit
  // 在大项目中，git add . 可能需要数秒，导致会话加载卡顿
  // 解决方案：只在发送提示词时才初始化 Git（在 recordPromptSent 中已有）
  // useEffect(() => {
  //   if (!projectPath) return;
  //   api.checkAndInitGit(projectPath).then(...);
  // }, [projectPath]);

  // Get effective session info (from prop or extracted) - use useMemo to ensure it updates
  const effectiveSession = useMemo(() => {
    // 🔧 FIX: 当会话历史不存在时，返回 null 以显示路径选择界面
    // 这处理了从 localStorage 恢复的无效会话（历史文件已删除或不存在）
    if (sessionNotFound) {
      return null;
    }
    if (session) return session;
    if (extractedSessionInfo) {
      return {
        id: extractedSessionInfo.sessionId,
        project_id: extractedSessionInfo.projectId,
        project_path: projectPath,
        created_at: Date.now(),
        engine: extractedSessionInfo.engine, // 🔧 FIX: Include engine field
      } as Session;
    }
    return null;
  }, [session, extractedSessionInfo, projectPath, sessionNotFound]);

  useEffect(() => {
    if (executionEngineConfig.engine !== 'codex') {
      setCodexRateLimits(null);
      return;
    }

    setCodexRateLimits(null);
  }, [executionEngineConfig.engine, effectiveSession?.id]);

  // ✅ Refactored: Use custom Hook for prompt execution (AFTER all other Hooks)
  const { handleSendPrompt, runTabId } = usePromptExecution({
    projectPath,
    isLoading,
    claudeSessionId,
    effectiveSession,
    isPlanMode,
    isActive,
    isFirstPrompt,
    extractedSessionInfo,
    executionEngine: executionEngineConfig.engine, // 🆕 Codex integration
    codexMode: executionEngineConfig.codexMode,    // 🆕 Codex integration
    codexModel: executionEngineConfig.codexModel,  // 🆕 Codex integration
    geminiModel: executionEngineConfig.geminiModel,           // 🆕 Gemini integration
    geminiApprovalMode: executionEngineConfig.geminiApprovalMode, // 🆕 Gemini integration
    hasActiveSessionRef,
    activeSessionIdRef,
    unlistenRefs,
    isMountedRef,
    isListeningRef,
    queuedPromptsRef,
    setIsLoading,
    setError,
    setMessages,
    appendMessage,
    appendMessageImmediate,
    replaceLastMessage,
    setClaudeSessionId,
    setLastTranslationResult,
    setQueuedPrompts,
    setRawJsonlOutput,
    appendRawJsonlOutput,
    setExtractedSessionInfo,
    setIsFirstPrompt,
    setCodexRateLimits,
    setCancelSessionId,
    getRunElapsedSeconds: () => {
      const startedAt = executionStartedAtRef.current;
      return startedAt ? Math.max(0, Math.floor((Date.now() - startedAt) / 1000)) : null;
    },
    routingTabId: tabIdProp,
    processMessageWithTranslation
  });

  const [sessionTitles, setSessionTitles] = useState<Record<string, string>>({});

  useEffect(() => {
    let mounted = true;

    api.getSessionMeta()
      .then((meta) => {
        if (mounted) {
          setSessionTitles(meta.titles || {});
        }
      })
      .catch((error) => {
        console.warn('[ClaudeCodeSession] Failed to load session titles:', error);
      });

    const handleTitleChanged = (event: Event) => {
      const detail = (event as CustomEvent<{ sessionId?: string; title?: string }>).detail;
      const sessionId = detail?.sessionId;
      if (!sessionId) return;

      const title = detail?.title?.trim() ?? '';
      setSessionTitles((prev) => {
        const next = { ...prev };
        if (title) next[sessionId] = title;
        else delete next[sessionId];
        return next;
      });
    };

    window.addEventListener('session-title-changed', handleTitleChanged);
    return () => {
      mounted = false;
      window.removeEventListener('session-title-changed', handleTitleChanged);
    };
  }, []);

  const interactionSessionTitle = useMemo(() => {
    const sessionForTitle = effectiveSession || session || null;
    const realSessionId = sessionForTitle?.id || claudeSessionId || '';
    const customTitle = realSessionId ? sessionTitles[realSessionId]?.trim() : '';
    if (customTitle) {
      return customTitle;
    }

    if (sessionForTitle?.first_message?.trim()) {
      return getSessionDisplayTitle(sessionForTitle, sessionTitles);
    }

    const projectLabel = getProjectLabel(projectPath);
    if (projectLabel) {
      return projectLabel;
    }

    return sessionForTitle?.id || '当前会话';
  }, [claudeSessionId, effectiveSession, projectPath, session, sessionTitles]);

  const handleJumpToLatest = useCallback(() => {
    setUserScrolled(false);
    setShouldAutoScroll(true);
    // 统一交给 SessionMessages：空闲态会启动短期 settle 置底；
    // streaming 态只做虚拟列表感知的瞬时末项对齐，不再裸写 scrollTop。
    sessionMessagesRef.current?.scrollToBottom();
  }, [setShouldAutoScroll, setUserScrolled]);

  // 会话切换/进入时稳定置底：每个会话在历史加载完成后强制置底一次。
  // 仅靠 useSmartAutoScroll 的单次 performAutoScroll 无法对抗虚拟列表的渐进高度重测，
  // 会停在"离底一点点"。这里用带 followUp 校正的 scrollToBottom，并按 session.id 去重只触发一次。
  const initialScrolledSessionRef = useRef<string | null>(null);
  const initialScrollPendingSessionRef = useRef<string | null>(null);
  useEffect(() => {
    const sid = session?.id || 'new_session';
    if (isHistoryLoading) return;
    // 正在 streaming 时 useSmartAutoScroll 是唯一底部跟随源。
    // imperative settle 留给历史/空闲态，否则会和 sticky rAF 抢 scrollTop。
    if (isLoading) return;
    if (messageGroups.length === 0) return;
    if (initialScrolledSessionRef.current === sid) return;
    if (initialScrollPendingSessionRef.current === sid) return;

    initialScrollPendingSessionRef.current = sid;
    setUserScrolled(false);
    setShouldAutoScroll(true);
    // 等一帧让 messageGroups 渲染就位，再走带 followUp 校正的置底
    const rafId = requestAnimationFrame(() => {
      if (initialScrollPendingSessionRef.current !== sid) return;
      initialScrollPendingSessionRef.current = null;
      if (isLoadingRef.current) return;
      if (!sessionMessagesRef.current) return;
      sessionMessagesRef.current.scrollToBottom();
      initialScrolledSessionRef.current = sid;
    });
    return () => {
      cancelAnimationFrame(rafId);
      if (initialScrollPendingSessionRef.current === sid) {
        initialScrollPendingSessionRef.current = null;
      }
    };
  }, [session?.id, isHistoryLoading, isLoading, messageGroups.length, setShouldAutoScroll, setUserScrolled]);

  // ????????????????????????????
  const handleSendPromptWithScroll = useCallback((prompt: string, model: ModelType, maxThinkingTokens?: number) => {
    setUserScrolled(false);
    setShouldAutoScroll(true);
    if (executionEngineConfig.engine === 'claude') {
      lastSubmittedClaudeModelRef.current = model;
    }

    // 新会话首条消息：用该消息内容为标签命名（仅触发一次）。
    // 只看“是否已有用户消息”，不要被 system/init/warmup 消息挡住。
    if (wasCreatedAsNewSessionRef.current && !firstSubmittedPromptRef.current) {
      const trimmed = prompt.trim();
      if (trimmed) {
        firstSubmittedPromptRef.current = trimmed;
      }
    }

    if (
      wasCreatedAsNewSessionRef.current &&
      !firstPromptNotifiedRef.current &&
      !hasUserAuthoredMessage()
    ) {
      const trimmed = prompt.trim();
      if (trimmed) {
        firstPromptNotifiedRef.current = true;
        onFirstUserPrompt?.(trimmed);
      }
    }

    if (sendJumpTimeoutRef.current) {
      window.clearTimeout(sendJumpTimeoutRef.current);
    }
    sendJumpTimeoutRef.current = setTimeout(() => {
      sendJumpTimeoutRef.current = null;
      handleJumpToLatest();
    }, 50);

    handleSendPrompt(prompt, model, maxThinkingTokens);
  }, [executionEngineConfig.engine, handleJumpToLatest, handleSendPrompt, setUserScrolled, setShouldAutoScroll, onFirstUserPrompt, hasUserAuthoredMessage]);

  const resolveAutoContinuationModel = useCallback((): ModelType => {
    return resolveClaudeContinuationModel({
      requestedModel: 'sonnet',
      sessionModel: effectiveSession?.model || session?.model,
      messages: messagesRef.current,
      lastSubmittedModel: lastSubmittedClaudeModelRef.current,
    });
  }, [effectiveSession?.model, session?.model]);

  // 🆕 监听阻塞式"向用户提问" / "计划审批"事件。关键：用 hook 暴露的 runTabId 过滤
  // （后端事件路由用的就是这个 id），而非外层 tabIdProp——二者不同，用错会导致事件被永久挡掉、弹窗不出。
  useEffect(() => {
    let unQ: UnlistenFn | undefined;
    let unP: UnlistenFn | undefined;
    let disposed = false;
    const matchTab = (sessionId: string) => !sessionId || !runTabId || sessionId === runTabId;
    (async () => {
      try {
        unQ = await listen<{ requestId: string; sessionId: string; questions: unknown; timeoutSeconds?: number; expiresAtMs?: number }>(
          "ask-user-question",
          (event) => {
            const { requestId, sessionId, questions, timeoutSeconds, expiresAtMs } = event.payload || ({} as any);
            if (!matchTab(sessionId)) return;
            if (!requestId || !Array.isArray(questions)) return;
            triggerBridgeQuestion(requestId, sessionId || "", questions as any, { timeoutSeconds, expiresAtMs });
            void notifyUserInputNeeded("question");
          }
        );
        unP = await listen<{ requestId: string; sessionId: string; plan: unknown; timeoutSeconds?: number; expiresAtMs?: number }>(
          "ask-user-plan",
          (event) => {
            const { requestId, sessionId, plan, timeoutSeconds, expiresAtMs } = event.payload || ({} as any);
            if (!matchTab(sessionId)) return;
            if (!requestId || typeof plan !== "string") return;
            triggerBridgePlan(requestId, sessionId || "", plan, { timeoutSeconds, expiresAtMs });
            void notifyUserInputNeeded("plan");
          }
        );
        if (disposed) { unQ?.(); unP?.(); }
      } catch (e) {
        console.error("[ClaudeCodeSession] failed to listen ask-user events:", e);
      }
    })();
    return () => {
      disposed = true;
      unQ?.();
      unP?.();
    };
  }, [runTabId, triggerBridgeQuestion, triggerBridgePlan]);

  // 🆕 方案 B-1: 设置发送提示词回调，用于计划批准后自动执行
  useEffect(() => {
    // 创建一个简化的发送函数，只需要 prompt 参数；自动续聊必须继承原会话模型。
    const simpleSendPrompt = (prompt: string) => {
      handleSendPromptWithScroll(prompt, resolveAutoContinuationModel());
    };
    setSendPromptCallback(simpleSendPrompt);

    // 清理时移除回调
    return () => {
      setSendPromptCallback(null);
    };
  }, [handleSendPromptWithScroll, resolveAutoContinuationModel, setSendPromptCallback]);

  // 🆕 设置 UserQuestion 的发送消息回调，用于答案提交后自动发送
  useEffect(() => {
    const simpleSendMessage = (message: string) => {
      handleSendPromptWithScroll(message, resolveAutoContinuationModel());
    };
    setSendMessageCallback(simpleSendMessage);

    // 清理时移除回调
    return () => {
      setSendMessageCallback(null);
    };
  }, [handleSendPromptWithScroll, resolveAutoContinuationModel, setSendMessageCallback]);

  // Load recent projects when component mounts (only for new sessions)
  useEffect(() => {
    if (!session && !initialProjectPath) {
      const loadRecentProjects = async () => {
        try {
          const projects = await api.listProjects();
          setRecentProjects(prepareRecentProjects(projects));
        } catch (error) {
          console.error("Failed to load recent projects:", error);
        }
      };
      loadRecentProjects();
    }
  }, [session, initialProjectPath]);

  // Load session history if resuming
  useEffect(() => {
    if (session) {
      // 🔧 FIX: If this component was created as a new session (session prop was initially undefined),
      // do NOT auto-load history when the session prop later becomes defined.
      // This happens when TabSessionWrapper re-renders due to isActive change after the tab's
      // session was upgraded via updateTabSession. The component already has the correct
      // messages from streaming - re-loading history would overwrite them and cause the
      // "reverting to restoring latest session" bug.
      if (wasCreatedAsNewSessionRef.current) {
        // Check if this session was extracted by this component instance
        if (extractedSessionInfo && extractedSessionInfo.sessionId === session.id) {
          console.debug('[ClaudeCodeSession] Skipping session load - session was created by this instance:', session.id);
          return;
        }
        // If extractedSessionInfo doesn't match, this is a genuinely different session prop
        // (shouldn't happen in current architecture, but handle defensively)
        if (!extractedSessionInfo) {
          console.debug('[ClaudeCodeSession] Skipping session load - new session instance, no extracted info yet');
          return;
        }
      }

      // 🆕 Auto-switch execution engine based on session type
      const sessionEngine = (session as any).engine;

      if (sessionEngine === 'codex') {
        setExecutionEngineConfig(prev => ({
          ...prev,
          engine: 'codex' as const,
        }));
      } else if (sessionEngine === 'gemini') {
        setExecutionEngineConfig(prev => ({
          ...prev,
          engine: 'gemini' as const,
        }));
      } else {
        setExecutionEngineConfig(prev => ({
          ...prev,
          engine: 'claude',
        }));
      }

      // Load session history first, then check for active session
      const initializeSession = async () => {
        await loadSessionHistory();
        // After loading history, check if the session is still active
        if (isMountedRef.current) {
          await checkForActiveSession();
        }
      };

      initializeSession();
    }
  }, [session]); // Remove hasLoadedSession dependency to ensure it runs on mount

  // Load Claude settings once for all StreamMessage components
  useEffect(() => {
    const loadSettings = async () => {
      try {
        const settings = await api.getClaudeSettings();
        setClaudeSettings(settings);
      } catch (error) {
        console.error("Failed to load Claude settings:", error);
        setClaudeSettings({ 
          showSystemInitialization: true,
          hideWarmupMessages: true // Default: hide warmup messages for better UX
        }); // Default fallback
      }
    };

    loadSettings();
  }, []);

  // 检测 CLI 能力（仅 Claude 引擎相关）：决定问题/计划的交互模型
  useEffect(() => {
    let cancelled = false;
    const loadCapabilities = async () => {
      try {
        const caps = await api.getClaudeCapabilities();
        if (!cancelled) setSupportsStreamJsonInput(caps.supports_stream_json_input);
      } catch (error) {
        console.error("Failed to detect Claude capabilities:", error);
        if (!cancelled) setSupportsStreamJsonInput(false);
      }
    };
    loadCapabilities();
    return () => {
      cancelled = true;
    };
  }, []);

  // 🔧 FIX: When a tab becomes active (visible), re-verify session running state
  // Listeners persist across tab switches (DO NOT clean up on tab switch).
  // But we need to:
  // 1. Re-report the current streaming state to the parent so the tab indicator is accurate
  // 2. Re-check if the session is still running (in case events were missed while in background)
  //
  // Listeners are automatically cleaned up when:
  // - Session completes (in processComplete/processCodexComplete)
  // - Component unmounts (in the cleanup effect below)
  //
  // Multi-tab conflict is prevented by:
  // - Message deduplication (processedClaudeMessages/processedCodexMessages Set)
  // - isMountedRef check in message handlers
  // - Session-specific event channels (claude-output:{session_id})
  useEffect(() => {
    if (isActive && session) {
      // Re-report the current streaming state to ensure the tab indicator is in sync.
      // This handles the case where the state changed in the background but the
      // parent tab manager did not receive the update.
      onStreamingChange?.(isLoading, claudeSessionId);

      // 标签页从后台(display:none)切回可见：隐藏期间滚动容器 clientHeight=0，
      // 虚拟列表窗口塌缩，可能只渲染顶部几行、甚至行重叠/重复 + 下方留白。
      // 已结束会话切回会走 scrollToBottom 的 rAF 救援被动重算窗口，但 streaming 会话
      // 因 isLoading 跳过该救援（置底交给 useSmartAutoScroll，它不重算虚拟窗口），
      // 故唯独 streaming 会话复现。这里主动让虚拟列表按真实视口尺寸重算一次。
      sessionMessagesRef.current?.remeasureViewport();

      // If we are not already listening to session events, re-check whether the
      // session is still actively running. This reconnects listeners if the session
      // is alive but we lost our connection (e.g., after app restart or missed events).
      if (!isListeningRef.current) {
        checkForActiveSession();
      }
    }
  }, [isActive]); // eslint-disable-line react-hooks/exhaustive-deps

  // ✅ Keyboard shortcuts (ESC, Shift+Tab) extracted to useKeyboardShortcuts Hook

  // ✅ Smart scroll management (3 useEffect blocks) extracted to useSmartAutoScroll Hook

  // ✅ Session lifecycle functions (loadSessionHistory, checkForActiveSession, reconnectToSession)
  // are now provided by useSessionStream Hook (新架构)

  const handleSelectPath = async () => {
    try {
      const selected = await SessionHelpers.selectProjectPath();

      if (selected) {
        setProjectPath(selected);
        setError(null);
      }
    } catch (err) {
      console.error("Failed to select directory:", err);
      const errorMessage = err instanceof Error ? err.message : String(err);
      setError(errorMessage);
    }
  };

  // ✅ handleSendPrompt function is now provided by usePromptExecution Hook (line 207-234)

  // Get conversation context for prompt enhancement
  // 🔧 FIX: 保持回调引用稳定，同时通过 ref 读取最新消息。
  // 否则后台 streaming 每来一条消息都会让 FloatingPromptInput / Plan / AskUser 回调重注册。
  const getConversationContext = useCallback((): string[] => {
    return SessionHelpers.getConversationContext(messagesRef.current);
  }, []);

  const handleCancelExecution = async () => {
    if (!isLoading || !hasActiveSessionRef.current) return;
    const activeSessionId = cancelSessionId || activeSessionIdRef.current;
    if (!activeSessionId) {
      const message = '当前运行进程还在启动中，拿到会话 ID 后即可只取消当前会话。';
      setError(message);
      window.dispatchEvent(new CustomEvent('show-toast', {
        detail: { message, type: 'info' }
      }));
      return;
    }

    try {
      setIsCancellingExecution(true);
      // 🆕 先释放可能正阻塞的"向用户提问/计划审批"MCP handler：否则 CLI 卡在工具调用处，取消信号难以即时生效。
      // 后端挂起请求按 runTabId(=session_hint) 存储，必须用它取消；同时关掉前端弹窗。
      if (runTabId) {
        try { await api.cancelUserQuestions(runTabId); } catch { /* 兜底，忽略 */ }
      }
      closeQuestionDialog();
      window.dispatchEvent(new CustomEvent('show-toast', {
        detail: {
          message: `正在取消当前 ${engineDisplayNames[executionEngineConfig.engine]} 会话，其他对话不会受影响`,
          type: 'info',
        }
      }));
      // 🆕 根据执行引擎调用相应的取消方法
      if (executionEngineConfig.engine === 'codex') {
        await api.cancelCodex(activeSessionId);
      } else if (executionEngineConfig.engine === 'gemini') {
        await api.cancelGemini(activeSessionId);
      } else {
        await api.cancelClaudeExecution(activeSessionId);
      }
      
      // Clean up listeners
      unlistenRefs.current.forEach(unlisten => unlisten && typeof unlisten === 'function' && unlisten());
      unlistenRefs.current = [];
      
      // Reset states
      setIsLoading(false);
      hasActiveSessionRef.current = false;
      isListeningRef.current = false;
      activeSessionIdRef.current = null;
      setCancelSessionId(null);
      setIsCancellingExecution(false);
      setError(null);
      
      // Reset session state on cancel
      setClaudeSessionId(null);
      
      // Clear queued prompts
      setQueuedPrompts([]);
      
      // Add a message indicating the session was cancelled
      const cancelMessage: ClaudeStreamMessage = {
        type: "system",
        subtype: "execution-cancelled",
        result: `已取消当前 ${engineDisplayNames[executionEngineConfig.engine]} 会话，其他对话不会受影响。`,
        engine: executionEngineConfig.engine,
        elapsedSeconds: executionStartedAtRef.current
          ? Math.max(0, Math.floor((Date.now() - executionStartedAtRef.current) / 1000))
          : executionStatus.elapsedSeconds,
        timestamp: new Date().toISOString(),
        receivedAt: new Date().toISOString()
      };
      appendMessage(cancelMessage);
      window.dispatchEvent(new CustomEvent('show-toast', {
        detail: {
          message: `已取消当前 ${engineDisplayNames[executionEngineConfig.engine]} 会话`,
          type: 'success',
        }
      }));
    } catch (err) {
      console.error("Failed to cancel execution:", err);
      
      // Even if backend fails, we should update UI to reflect stopped state
      // Add error message but still stop the UI loading state
      const details = err instanceof Error ? err.message : 'Unknown error';
      const errorMessage: ClaudeStreamMessage = {
        type: "system",
        subtype: "execution-error",
        result: `取消当前 ${engineDisplayNames[executionEngineConfig.engine]} 会话失败。界面已停止监听，请确认后台进程状态后重试。\n\n${details}`,
        engine: executionEngineConfig.engine,
        timestamp: new Date().toISOString(),
        receivedAt: new Date().toISOString()
      };
      appendMessage(errorMessage);
      
      // Clean up listeners anyway
      unlistenRefs.current.forEach(unlisten => unlisten && typeof unlisten === 'function' && unlisten());
      unlistenRefs.current = [];
      
      // Reset states to allow user to continue
      setIsLoading(false);
      hasActiveSessionRef.current = false;
      isListeningRef.current = false;
      activeSessionIdRef.current = null;
      setCancelSessionId(null);
      setIsCancellingExecution(false);
      setError(null);
      window.dispatchEvent(new CustomEvent('show-toast', {
        detail: {
          message: `取消失败：${details}`,
          type: 'error',
        }
      }));
    }
  };

  // Handle URL detection from terminal output
  const handleLinkDetected = (url: string) => {
    const currentState: SessionHelpers.PreviewState = {
      showPreview,
      showPreviewPrompt,
      previewUrl,
      isPreviewMaximized,
      splitPosition
    };
    const newState = SessionHelpers.handleLinkDetected(url, currentState);
    if (newState.previewUrl !== currentState.previewUrl) {
      setPreviewUrl(newState.previewUrl);
    }
    if (newState.showPreviewPrompt !== currentState.showPreviewPrompt) {
      setShowPreviewPrompt(newState.showPreviewPrompt);
    }
  };

  const handleClosePreview = () => {
    const currentState: SessionHelpers.PreviewState = {
      showPreview,
      showPreviewPrompt,
      previewUrl,
      isPreviewMaximized,
      splitPosition
    };
    const newState = SessionHelpers.handleClosePreview(currentState);
    setShowPreview(newState.showPreview);
    setIsPreviewMaximized(newState.isPreviewMaximized);
  };

  const handlePreviewUrlChange = (url: string) => {
    const currentState: SessionHelpers.PreviewState = {
      showPreview,
      showPreviewPrompt,
      previewUrl,
      isPreviewMaximized,
      splitPosition
    };
    const newState = SessionHelpers.handlePreviewUrlChange(url, currentState);
    setPreviewUrl(newState.previewUrl);
  };

  const handleTogglePreviewMaximize = () => {
    const currentState: SessionHelpers.PreviewState = {
      showPreview,
      showPreviewPrompt,
      previewUrl,
      isPreviewMaximized,
      splitPosition
    };
    const newState = SessionHelpers.handleTogglePreviewMaximize(currentState);
    setIsPreviewMaximized(newState.isPreviewMaximized);
    setSplitPosition(newState.splitPosition);
  };

  // 🆕 辅助函数：计算用户消息对应的 promptIndex
  // 只计算真实用户输入，排除系统消息和工具结果
  const {
    promptIndexByMessage,
    branchPromptIndexByMessage,
    navigationPromptIndexByMessage,
  } = usePromptIndexMaps(visibleMessages);
  const getPromptIndexForMessage = useCallback((displayableIndex: number): number => {
    return getPromptIndexForDisplayableMessage(
      visibleMessages,
      displayableMessages,
      displayableIndex,
      promptIndexByMessage,
    );
  }, [visibleMessages, displayableMessages, promptIndexByMessage]);
  const getPromptNavigationIndexForMessage = useCallback((displayableIndex: number): number => {
    return getPromptNavigationIndexForDisplayableMessage(
      visibleMessages,
      displayableMessages,
      displayableIndex,
      navigationPromptIndexByMessage,
    );
  }, [visibleMessages, displayableMessages, navigationPromptIndexByMessage]);


  // 🆕 撤回处理函数 - 支持三种撤回模式
  // Handle prompt navigation - scroll to specific prompt
  // 提示词定位的时序保护：历史仍在加载时，messageGroups 不完整、虚拟列表目标 DOM 未挂载，
  // 立即定位会落空（需点多遍）。此处把目标暂存，待加载完成的 effect 再执行。
  const pendingPromptNavRef = useRef<number | null>(null);

  const handlePromptNavigation = useCallback((promptIndex: number) => {
    setShowPromptNavigator(false);
    // 用户点击历史提示词导航就是明确“查看历史”意图：
    // 必须立即关闭粘底，否则 useSmartAutoScroll / 流式高度重测会把视图重新拉回底部。
    setUserScrolled(true);
    setShouldAutoScroll(false);

    // 历史加载中（或首屏消息尚未就位）：暂存目标，等加载完成后再定位。
    if (isHistoryLoading || (isLoading && messagesRef.current.length === 0)) {
      pendingPromptNavRef.current = promptIndex;
      return;
    }

    if (sessionMessagesRef.current) {
      sessionMessagesRef.current.scrollToPrompt(promptIndex);
    }
  }, [isHistoryLoading, isLoading, setShouldAutoScroll, setUserScrolled]);

  // 历史加载完成后，若有暂存的定位目标，补执行一次定位。
  useEffect(() => {
    if (isHistoryLoading) return;
    if (pendingPromptNavRef.current === null) return;

    const target = pendingPromptNavRef.current;
    pendingPromptNavRef.current = null;
    if (pendingPromptNavRafRef.current !== null) {
      cancelAnimationFrame(pendingPromptNavRafRef.current);
      pendingPromptNavRafRef.current = null;
    }
    // 等一帧让 messageGroups 渲染就位再定位
    pendingPromptNavRafRef.current = requestAnimationFrame(() => {
      pendingPromptNavRafRef.current = null;
      setUserScrolled(true);
      setShouldAutoScroll(false);
      sessionMessagesRef.current?.scrollToPrompt(target);
    });
    return () => {
      if (pendingPromptNavRafRef.current !== null) {
        cancelAnimationFrame(pendingPromptNavRafRef.current);
        pendingPromptNavRafRef.current = null;
      }
    };
  }, [isHistoryLoading, messages.length, setShouldAutoScroll, setUserScrolled]);

  const handleRevert = useCallback(async (promptIndex: number, mode: import('@/lib/api').RewindMode = 'both') => {
    if (!effectiveSession) return;

    try {

      const sessionEngine = effectiveSession.engine || executionEngineConfig.engine || 'claude';
      const isCodex = sessionEngine === 'codex';
      const isGemini = sessionEngine === 'gemini';
      const uiEngine: 'claude' | 'codex' | 'gemini' = isCodex ? 'codex' : isGemini ? 'gemini' : 'claude';
      const withUiOnlyEvents = (historyMessages: ClaudeStreamMessage[]) => {
        // 撤回后：先按「保留历史的最大时间戳」裁剪掉晚于撤回点的 UI-only 事件
        //（如"✅ 本次执行完成，用时 X"），并写回 localStorage——否则这些独立存储的事件
        // 会被 merge 回来而残留，表现为撤回后完成提示仍挂在列表里。
        const cutoff = historyMessages.reduce((max, m) => {
          const raw = (m as any).receivedAt || (m as any).timestamp || (m as any).sentAt;
          const t = typeof raw === 'string' ? Date.parse(raw) : NaN;
          return Number.isFinite(t) && t > max ? t : max;
        }, Number.NEGATIVE_INFINITY);
        const uiOnlyParams = {
          sessionId: effectiveSession.id,
          projectPath,
          engine: uiEngine,
        };
        if (Number.isFinite(cutoff)) {
          pruneUiOnlySessionMessagesAfter(uiOnlyParams, cutoff);
        }
        return mergeUiOnlySessionMessages(
          historyMessages,
          loadUiOnlySessionMessages(uiOnlyParams),
        );
      };

      // 调用后端撤回（返回提示词文本）
      const promptText = isCodex
        ? await api.revertCodexToPrompt(
            effectiveSession.id,
            projectPath,
            promptIndex,
            mode
          )
        : isGemini
        ? await api.revertGeminiToPrompt(
            effectiveSession.id,
            projectPath,
            promptIndex,
            mode
          )
        : await api.revertToPrompt(
            effectiveSession.id,
            effectiveSession.project_id,
            projectPath,
            promptIndex,
            mode
          );

      // 重新加载消息历史（根据引擎类型使用不同的 API）
      if (isGemini) {
        // Gemini 使用专门的 API 加载历史
        const geminiDetail = await api.getGeminiSessionDetail(projectPath, effectiveSession.id);
        const convertedMessages = convertGeminiSessionDetailToClaudeMessages(geminiDetail) as ClaudeStreamMessage[];
        setMessages(withUiOnlyEvents(convertedMessages));
      } else {
        // Claude/Codex 使用原有 API
        const history = await api.loadSessionHistory(
          effectiveSession.id,
          effectiveSession.project_id,
          sessionEngine as any
        );

        if (sessionEngine === 'codex' && Array.isArray(history)) {
          // 将 Codex 事件转换为消息格式（与 useSessionStream 保持一致）
          codexConverter.reset();
          const convertedMessages: any[] = [];
          for (const event of history) {
            const msg = codexConverter.convertEventObject(event as any);
            if (msg) convertedMessages.push(msg);
          }
          setMessages(withUiOnlyEvents(convertedMessages));
        } else if (Array.isArray(history)) {
          setMessages(withUiOnlyEvents(history));
        } else if (history && typeof history === 'object' && 'messages' in history) {
          setMessages(withUiOnlyEvents((history as any).messages));
        }
      }

      // 恢复提示词到输入框（仅在对话撤回模式下）
      if ((mode === 'conversation_only' || mode === 'both') && floatingPromptRef.current && promptText) {
        floatingPromptRef.current.setPrompt(promptText);
      }

      // 清除错误
      setError('');

    } catch (error) {
      console.error('[Prompt Revert] Failed to revert:', error);
      setError('__REVERT_FAILED__:' + error);
    }
  }, [effectiveSession, projectPath, claudeSettings?.hideWarmupMessages, executionEngineConfig.engine]);

  // 🌿 计算某条消息（任意类型）可用的分支 promptIndex；-1 表示不可分支
  const getBranchPromptIndexForMessage = useCallback((displayableIndex: number): number => {
    return getBranchPromptIndexForDisplayableMessage(
      visibleMessages,
      displayableMessages,
      displayableIndex,
      branchPromptIndexByMessage,
    );
  }, [visibleMessages, displayableMessages, branchPromptIndexByMessage]);

  // 🌿 从某条消息分叉出一个新会话（真分支）：原会话保留，新会话在新 tab 打开
  const handleBranch = useCallback(async (promptIndex: number) => {
    if (!effectiveSession || promptIndex < 0) return;

    const sessionEngine = effectiveSession.engine || executionEngineConfig.engine || 'claude';
    try {
      let newSessionId: string;
      if (sessionEngine === 'codex') {
        newSessionId = await api.branchCodexAtPrompt(effectiveSession.id, projectPath, promptIndex);
      } else if (sessionEngine === 'gemini') {
        newSessionId = await api.branchGeminiAtPrompt(effectiveSession.id, projectPath, promptIndex);
      } else {
        newSessionId = await api.branchSessionAtPrompt(
          effectiveSession.id,
          effectiveSession.project_id,
          promptIndex,
        );
      }

      // 构造新分支会话对象，复用现有「打开会话到新 tab」的全局事件机制
      const branchedSession: Session = {
        ...effectiveSession,
        id: newSessionId,
        engine: sessionEngine as 'claude' | 'codex' | 'gemini',
      };

      // 在新 tab 打开分支会话（原会话 tab 保留）。
      // 直接传 Session 对象打开，不依赖侧边栏列表刷新；列表会在下次切换项目时自然扫描到新文件。
      window.dispatchEvent(new CustomEvent('claude-session-selected', {
        detail: { session: branchedSession },
      }));
      window.dispatchEvent(new CustomEvent('show-toast', {
        detail: { message: '已创建分支，在新标签打开', type: 'success' },
      }));
    } catch (error) {
      console.error('[Branch] Failed to branch session:', error);
      window.dispatchEvent(new CustomEvent('show-toast', {
        detail: { message: `创建分支失败：${error instanceof Error ? error.message : String(error)}`, type: 'error' },
      }));
    }
  }, [effectiveSession, projectPath, executionEngineConfig.engine]);
  // ⚠️ IMPORTANT: No dependencies! Only cleanup on real unmount
  // Adding dependencies like effectiveSession would cause cleanup to run
  // when session ID is extracted, clearing active listeners
  useEffect(() => {
    isMountedRef.current = true;

    return () => {
      isMountedRef.current = false;
      isListeningRef.current = false;

      // Clean up listeners
      unlistenRefs.current.forEach(unlisten => unlisten && typeof unlisten === 'function' && unlisten());
      unlistenRefs.current = [];
      if (sendJumpTimeoutRef.current) {
        window.clearTimeout(sendJumpTimeoutRef.current);
        sendJumpTimeoutRef.current = null;
      }
      if (pendingPromptNavRafRef.current !== null) {
        cancelAnimationFrame(pendingPromptNavRafRef.current);
        pendingPromptNavRafRef.current = null;
      }

      // Reset session state on unmount
      setClaudeSessionId(null);
    };
  }, []); // Empty deps - only run on mount/unmount

  // ✅ 架构优化: 使用 SessionProvider 提供会话上下文，避免 Props Drilling
  const messagesList = (
    <SessionProvider
      session={effectiveSession}
      projectPath={projectPath}
      sessionId={effectiveSession?.id || null}
      projectId={effectiveSession?.project_id || null}
      settings={claudeSettings}
      onLinkDetected={handleLinkDetected}
      onRevert={handleRevert}
      getPromptIndexForMessage={getPromptIndexForMessage}
      getPromptNavigationIndexForMessage={getPromptNavigationIndexForMessage}
      onBranch={handleBranch}
      getBranchPromptIndexForMessage={getBranchPromptIndexForMessage}
    >
      <SessionMessages
        ref={sessionMessagesRef}
        messageGroups={messageGroups}
        isLoading={isLoading}
        error={error}
        parentRef={parentRef}
        autoScrollLockedToBottom={isLoading && !userScrolled}
        executionStatus={executionStatus}
        onCancel={handleCancelExecution}
      />
    </SessionProvider>
  );

  // Determine if we're in "new session" mode (no session yet, showing project picker)
  // In this mode, the page content should be scrollable as a whole
  const isNewSessionMode = !effectiveSession && displayableMessages.length === 0;
  const showProcessingStatus = isLoading && userScrolled && displayableMessages.length > 0;

  // Show project path input only when:
  // 1. No initial session prop AND
  // 2. No extracted session info (from successful first response)
  const projectPathInput = !effectiveSession && (
    <SessionHeader
      projectPath={projectPath}
      setProjectPath={(path) => {
        setProjectPath(path);
        setError(null);
      }}
      handleSelectPath={handleSelectPath}
      recentProjects={recentProjects}
      isLoading={isLoading}
    />
  );

  // If preview is maximized, render only the WebviewPreview in full screen
  if (showPreview && isPreviewMaximized) {
    return (
      <AnimatePresence>
        <motion.div 
          className="fixed inset-0 z-50 bg-background"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
        >
          <WebviewPreview
            initialUrl={previewUrl}
            onClose={handleClosePreview}
            isMaximized={isPreviewMaximized}
            onToggleMaximize={handleTogglePreviewMaximize}
            onUrlChange={handlePreviewUrlChange}
            className="h-full"
          />
        </motion.div>
      </AnimatePresence>
    );
  }

  return (
    <div className={cn("relative flex h-full bg-background", className)}>
      {/* Main Content Area - 重构布局：使用 Flexbox 实现消息区域与输入区域的完全分离 */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* 消息展示区域容器 - flex-1 占据剩余空间，min-h-0 防止 flex 子元素溢出 */}
        {/* When in new session mode, allow the content to scroll so the user
            can reach all recent projects. In active session mode, overflow is
            hidden and the virtualised message list handles its own scrolling. */}
        <div className={cn(
          "flex-1 min-h-0 transition-all duration-300 relative",
          isNewSessionMode ? "overflow-y-auto" : "overflow-hidden"
        )}>
          {showPreview ? (
            // Split pane layout when preview is active
            <SplitPane
              left={
                <div className="h-full flex flex-col">
                  {projectPathInput}
                  <PlanModeStatusBar isPlanMode={isPlanMode} />
                  {messagesList}
                </div>
              }
              right={
                <WebviewPreview
                  initialUrl={previewUrl}
                  onClose={handleClosePreview}
                  isMaximized={isPreviewMaximized}
                  onToggleMaximize={handleTogglePreviewMaximize}
                  onUrlChange={handlePreviewUrlChange}
                />
              }
              initialSplit={splitPosition}
              onSplitChange={setSplitPosition}
              minLeftWidth={400}
              minRightWidth={400}
              className="h-full"
            />
          ) : (
            // In new session mode: min-h-full lets the container grow beyond
            // the parent when there are many recent projects, while ensuring
            // it fills the viewport when content is short.
            // In active session mode: h-full locks to parent height so the
            // virtualised message list can manage its own scroll area.
            <div className={cn(
              "flex flex-col relative",
              isNewSessionMode ? "min-h-full" : "h-full"
            )}>
              {projectPathInput}
              <PlanModeStatusBar isPlanMode={isPlanMode} />
              {messagesList}

              {(isLoading || isHistoryLoading) && messages.length === 0 && (
                <div className="flex items-center justify-center h-full">
                  <div className="flex items-center gap-3">
                    <div className="rotating-symbol text-primary" />
                    <span className="text-sm text-muted-foreground">
                      {session || isHistoryLoading ? t('claudeSession.loadingHistory') : t('claudeSession.initializingClaude')}
                    </span>
                  </div>
                </div>
              )}

              {/* ✅ 滚动控件 - 放在消息区域内，使用 absolute 定位 */}
              {displayableMessages.length > 5 && (
                <div className="absolute right-4 bottom-4 pointer-events-auto z-40">
                  <div className="flex flex-col gap-1.5">
                    {/* Prompt Navigator Button */}
                    {!showPromptNavigator && (
                      <motion.div
                        initial={{ opacity: 0, scale: 0.8 }}
                        animate={{ opacity: 1, scale: 1 }}
                        className="flex flex-col items-center gap-1 bg-background/60 backdrop-blur-md border border-border/50 rounded-xl px-1.5 py-2 cursor-pointer hover:bg-accent/80 shadow-sm"
                        onClick={() => setShowPromptNavigator(true)}
                        title={t('claudeSession.promptNav')}
                      >
                        <List className="h-4 w-4" />
                        <div className="flex flex-col items-center text-[10px] leading-tight tracking-wider">
                          <span>{t('session.promptChar1')}</span>
                          <span>{t('session.promptChar2')}</span>
                          <span>{t('session.promptChar3')}</span>
                        </div>
                      </motion.div>
                    )}

                    {/* New message indicator - only show when user scrolled away */}
                    <AnimatePresence>
                      {userScrolled && (
                        <motion.div
                          initial={{ opacity: 0, y: 20, scale: 0.8 }}
                          animate={{ opacity: 1, y: 0, scale: 1 }}
                          exit={{ opacity: 0, y: 20, scale: 0.8 }}
                          className="flex flex-col items-center gap-1 bg-background/60 backdrop-blur-md border border-border/50 rounded-xl px-1.5 py-2 cursor-pointer hover:bg-accent/80 shadow-sm"
                          onClick={handleJumpToLatest}
                          title={t('claudeSession.newMessage')}
                        >
                          <div className="w-1.5 h-1.5 bg-blue-500 rounded-full animate-pulse" />
                          <div className="flex flex-col items-center text-[10px] leading-tight tracking-wider">
                            <span>{t('session.newChar1')}</span>
                            <span>{t('session.newChar2')}</span>
                            <span>{t('session.newChar3')}</span>
                          </div>
                          <ChevronDown className="h-3 w-3" />
                        </motion.div>
                      )}
                    </AnimatePresence>

                    {/* Traditional scroll controls */}
                    <div className="flex flex-col bg-background/60 backdrop-blur-md border border-border/50 rounded-xl overflow-hidden shadow-sm">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setUserScrolled(true);
                          setShouldAutoScroll(false);
                          // 用虚拟列表感知的 scrollToTop（带 followUp 校正），
                          // 避免裸 scrollTo({top:0,smooth}) 在高度重测时被中断/顶飞。
                          sessionMessagesRef.current?.scrollToTop();
                        }}
                        className="px-1.5 py-1.5 hover:bg-accent/80 rounded-none h-auto min-h-0"
                        title={t('claudeSession.scrollToTop')}
                      >
                        <ChevronUp className="h-3.5 w-3.5" />
                      </Button>
                      <div className="h-px w-full bg-border/50" />
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={handleJumpToLatest}
                        className="px-1.5 py-1.5 hover:bg-accent/80 rounded-none h-auto min-h-0"
                        title={t('claudeSession.scrollToBottom')}
                      >
                        <ChevronDown className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>


        {/* ✅ 重构：队列提示词作为 Flex 的一部分，显示在输入框上方 */}
        <AnimatePresence>
          {queuedPrompts.length > 0 && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 20 }}
              className="flex-shrink-0 w-full max-w-3xl mx-auto px-4 pb-2"
            >
              <div className="floating-element backdrop-enhanced rounded-lg px-2.5 py-1.5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                    <List className="h-3.5 w-3.5" />
                    {t('session.queuedPrompts', { count: queuedPrompts.length })}
                    {/* 存在重启恢复项时给出整体提示：这些项需逐条手动确认，不会自动发送 */}
                    {queuedPrompts.some(p => p.restored) && (
                      <span className="text-[10px] leading-none px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-600 font-normal">
                        {t('session.queueRestoredHint')}
                      </span>
                    )}
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    onClick={() => setQueuedPromptsCollapsed(prev => !prev)}
                  >
                    {queuedPromptsCollapsed ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                  </Button>
                </div>
                {!queuedPromptsCollapsed && (
                  <div className="mt-1">
                    <SortableList
                      items={queuedPrompts}
                      onReorder={setQueuedPrompts}
                      listClassName="space-y-1"
                      customHandle
                      renderItem={(queuedPrompt, index) => (
                        <div className={cn(
                          "group flex items-center gap-1.5 rounded-md py-1 pr-1 pl-0.5 transition-colors",
                          queuedPrompt.restored
                            ? "bg-amber-500/10 hover:bg-amber-500/15 border-l-2 border-amber-500/70"
                            : "bg-muted/40 hover:bg-muted/60"
                        )}>
                          <SortableDragHandle className="h-5 w-4 flex-shrink-0 opacity-50 group-hover:opacity-100">
                            <GripVertical className="h-3.5 w-3.5" />
                          </SortableDragHandle>
                          <span className="text-[11px] font-semibold text-muted-foreground tabular-nums w-4 text-center flex-shrink-0">
                            {index + 1}
                          </span>
                          <span className="text-[10px] leading-none px-1.5 py-0.5 bg-primary/10 text-primary rounded flex-shrink-0">
                            {formatClaudeModelLabel(queuedPrompt.model)}
                          </span>
                          <p
                            className="flex-1 min-w-0 text-xs truncate"
                            title={queuedPrompt.prompt}
                          >
                            {queuedPrompt.prompt}
                          </p>
                          {/* 恢复项（来自上次会话）：始终可见的「发送」按钮，必须用户逐条确认才发；streaming 时置灰禁用 */}
                          {queuedPrompt.restored && (
                            <Button
                              variant="ghost"
                              size="icon"
                              disabled={isLoading}
                              className="h-5 w-5 flex-shrink-0 text-amber-600 hover:text-amber-700 disabled:opacity-40"
                              title={isLoading ? t('session.queueBusyWait') : t('session.queueRestoredSend')}
                              onClick={() => {
                                if (isLoading) return;
                                setQueuedPrompts(prev => prev.filter(p => p.id !== queuedPrompt.id));
                                handleSendPromptWithScroll(queuedPrompt.prompt, queuedPrompt.model);
                              }}
                            >
                              <Play className="h-3 w-3" />
                            </Button>
                          )}
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-5 w-5 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
                            title={isLoading ? t('session.sendNextPriority') : t('session.sendNow')}
                            onClick={() => {
                              if (!isLoading) {
                                // 空闲：直接移除并立即发送
                                setQueuedPrompts(prev => prev.filter(p => p.id !== queuedPrompt.id));
                                handleSendPromptWithScroll(queuedPrompt.prompt, queuedPrompt.model);
                              } else {
                                // 运行中：置顶到队首，当前轮一结束就最先执行
                                setQueuedPrompts(prev => {
                                  const target = prev.find(p => p.id === queuedPrompt.id);
                                  if (!target) return prev;
                                  return [target, ...prev.filter(p => p.id !== queuedPrompt.id)];
                                });
                              }
                            }}
                          >
                            <ArrowUp className="h-3 w-3" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-5 w-5 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
                            title={t('buttons.edit')}
                            onClick={() => {
                              // 取回到输入框编辑：append（不覆盖现有内容）后从队列移除，避免重复发送
                              floatingPromptRef.current?.appendPrompt(queuedPrompt.prompt);
                              setQueuedPrompts(prev => prev.filter(p => p.id !== queuedPrompt.id));
                            }}
                          >
                            <Pencil className="h-3 w-3" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-5 w-5 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
                            onClick={() => setQueuedPrompts(prev => prev.filter(p => p.id !== queuedPrompt.id))}
                          >
                            <X className="h-3 w-3" />
                          </Button>
                        </div>
                      )}
                    />
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Floating Prompt Input - 输入区域 */}
        <ErrorBoundary>
          {/* ✅ 重构：输入区域作为 Flex 容器的一部分，不再使用 fixed 定位 */}
          <FloatingPromptInput
            className="flex-shrink-0 transition-[left] duration-300"
            ref={floatingPromptRef}
            onSend={handleSendPromptWithScroll}
            onCancel={handleCancelExecution}
            isLoading={isLoading}
            showProcessingStatus={showProcessingStatus}
            onProcessingStatusClick={handleJumpToLatest}
            disabled={!projectPath}
            projectPath={projectPath}
            sessionId={effectiveSession?.id}         // 🆕 传递会话 ID
            projectId={effectiveSession?.project_id} // 🆕 传递项目 ID
            draftTabId={tabIdProp}                   // 🆕 新会话草稿落盘的唯一 id（=tab id）
            sessionModel={effectiveSession?.model || session?.model}
            getConversationContext={getConversationContext}
            messages={visibleMessages}               // 活跃 tab 才把完整消息交给输入区 UI，后台运行 tab 避免重复重渲染
            isPlanMode={isPlanMode}
            onTogglePlanMode={handleTogglePlanMode}
            sessionCost={formatCost(costStats.totalCost)}
            sessionStats={costStats}
            hasMessages={messages.length > 0}
            session={effectiveSession || undefined}  // 🆕 传递完整会话信息用于导出
            codexRateLimits={codexRateLimits}
            executionEngineConfig={executionEngineConfig}              // 🆕 Codex 集成
            executionStatus={executionStatus}
            onExecutionEngineConfigChange={setExecutionEngineConfig}   // 🆕 Codex 集成
          />

        </ErrorBoundary>

        {/* Revert Prompt Picker - Shows when double ESC is pressed */}
        {showRevertPicker && effectiveSession && (
          <RevertPromptPicker
            sessionId={effectiveSession.id}
            projectId={effectiveSession.project_id}
            projectPath={projectPath}
            engine={effectiveSession.engine || executionEngineConfig.engine || 'claude'}
            onSelect={handleRevert}
            onBranch={handleBranch}
            onClose={() => setShowRevertPicker(false)}
          />
        )}

        {/* Plan Approval Dialog - 方案 B-1: ExitPlanMode 触发审批 */}
        <PlanApprovalDialog
          open={showApprovalDialog}
          plan={pendingApproval?.plan || ''}
          onClose={closeApprovalDialog}
          onApprove={approvePlan}
          onReject={rejectPlan}
          continuesAsNewTurn={!supportsStreamJsonInput}
          canDefer={!pendingApproval?.requestId}
          sessionTitle={interactionSessionTitle}
          expiresAtMs={pendingApproval?.expiresAtMs}
          onDeferDecision={deferPlanDecision}
        />

        {/* 🆕 User Question Dialog - AskUserQuestion 自动触发 */}
        <AskUserQuestionDialog
          open={showQuestionDialog}
          questions={pendingQuestion?.questions || []}
          resetKey={pendingQuestion?.questionId}
          onClose={closeQuestionDialog}
          onSubmit={submitAnswers}
          continuesAsNewTurn={!supportsStreamJsonInput}
          canDefer={!pendingQuestion?.requestId}
          sessionTitle={interactionSessionTitle}
          expiresAtMs={pendingQuestion?.expiresAtMs}
          onDeferResponse={deferQuestionResponse}
        />
      </div>

      {/* Prompt Navigator - Quick navigation to any user prompt */}
      <PromptNavigator
        messages={visibleMessages}
        isOpen={showPromptNavigator}
        onClose={() => setShowPromptNavigator(false)}
        onPromptClick={handlePromptNavigation}
      />

    </div>
  );
};

export const ClaudeCodeSession: React.FC<ClaudeCodeSessionProps> = (props) => {
  const planModeStorageKey = useMemo(() => {
    if (props.planModeStorageKey) return props.planModeStorageKey;
    if (props.session?.id) return `plan-mode:session:${props.session.id}`;
    if (props.initialProjectPath) {
      return `plan-mode:path:${props.initialProjectPath.replace(/\\/g, '/').toLowerCase()}`;
    }
    return `plan-mode:instance:${safeRandomUUID()}`;
  }, [props.planModeStorageKey, props.session?.id, props.initialProjectPath]);

  return (
    <MessagesProvider
      initialFilterConfig={{ hideWarmupMessages: true }}
      deriveToolResults={props.isActive !== false}
    >
      <PlanModeProvider storageKey={planModeStorageKey}>
        <UserQuestionProvider>
          <ClaudeCodeSessionInner {...props} />
        </UserQuestionProvider>
      </PlanModeProvider>
    </MessagesProvider>
  );
};
