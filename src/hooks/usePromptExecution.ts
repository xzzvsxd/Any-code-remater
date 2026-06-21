/**
 * usePromptExecution Hook
 *
 * Manages Claude Code prompt execution including:
 * - Input validation and queueing
 * - Event listener setup (generic and session-specific)
 * - Translation processing
 * - Thinking instruction handling
 * - API execution (new session, resume, continue)
 * - Error handling and state management
 *
 * Extracted from ClaudeCodeSession component (296 lines)
 */

import { useCallback, useRef, useEffect } from 'react';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { api, type Session } from '@/lib/api';
import { translationMiddleware, isSlashCommand, type TranslationResult } from '@/lib/translationMiddleware';
import type { ClaudeStreamMessage } from '@/types/claude';
import type { ModelType } from '@/components/FloatingPromptInput/types';
// 🔧 FIX: 导入 CodexEventConverter 类，在每个会话中创建独立实例避免全局单例污染
import { CodexEventConverter, extractCodexRateLimitsFromEvent } from '@/lib/codexConverter';
import { sanitizeCodexModelId } from '@/lib/codexModelSupport';
import type { CodexExecutionMode, CodexRateLimits } from '@/types/codex';
import { cacheCodexModelFromStream, cacheModelFromInitMessage } from '@/lib/modelNameParser';
import { notifyAiExecutionComplete } from '@/lib/aiCompletionNotification';
import { resolveInitialCancelSessionId } from '@/lib/cancelChannel';
import { persistUiOnlySessionMessage } from '@/lib/uiOnlySessionEvents';
import { normalizeStreamLines, AsyncQueue, consumeYielding } from '@/lib/stream';
import { safeRandomUUID } from '@/lib/browserCompat';
import { resolveClaudeExecutionMode, shouldAcceptClaudeGlobalMessage, shouldAttachClaudeSessionListeners } from '@/lib/claudeExecutionRouting';
import { resolveExecutionRunTabId } from '@/lib/executionRunTabId';
import { createTerminalEventGate } from '@/lib/terminalEventGate';
import { createCrossChannelDuplicateGuard } from '@/lib/stream/crossChannelDuplicateGuard';

// ============================================================================
// Type Definitions
// ============================================================================

export interface QueuedPrompt {
  id: string;
  prompt: string;
  model: ModelType;
  /**
   * 来自上次会话、经持久化恢复且尚未确认的队列项。
   * restored 项不会被 runNextQueuedPrompt 自动抽取发送，必须用户在队列面板逐条点「发送」确认。
   */
  restored?: boolean;
}

interface PendingPromptRecord {
  sessionId: string;
  projectPath: string;
  promptIndex: number;
  promptText: string;
}

interface UsePromptExecutionConfig {
  // State
  projectPath: string;
  isLoading: boolean;
  claudeSessionId: string | null;
  effectiveSession: Session | null;
  isPlanMode: boolean;
  isActive: boolean;
  isFirstPrompt: boolean;
  extractedSessionInfo: { sessionId: string; projectId: string } | null;

  // 🆕 Execution Engine Integration (Claude/Codex/Gemini)
  executionEngine?: 'claude' | 'codex' | 'gemini'; // 执行引擎选择 (默认: 'claude')
  codexMode?: CodexExecutionMode;       // Codex 执行模式
  codexModel?: string;                  // Codex 模型 (e.g., 'gpt-5.2')
  geminiModel?: string;                 // Gemini 模型 (e.g., 'gemini-3-flash')
  geminiApprovalMode?: 'auto_edit' | 'yolo' | 'default'; // Gemini 审批模式

  // Refs
  hasActiveSessionRef: React.MutableRefObject<boolean>;
  activeSessionIdRef?: React.MutableRefObject<string | null>;
  unlistenRefs: React.MutableRefObject<UnlistenFn[]>;
  isMountedRef: React.MutableRefObject<boolean>;
  isListeningRef: React.MutableRefObject<boolean>;
  queuedPromptsRef: React.MutableRefObject<QueuedPrompt[]>;

  // State Setters
  setIsLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  setMessages: React.Dispatch<React.SetStateAction<ClaudeStreamMessage[]>>;
  appendMessage: (message: ClaudeStreamMessage) => void;
  appendMessageImmediate: (message: ClaudeStreamMessage) => void;
  replaceLastMessage: (
    updater: (lastMessage: ClaudeStreamMessage | undefined) => { type: 'replace' | 'append'; item: ClaudeStreamMessage } | { type: 'none' }
  ) => void;
  setClaudeSessionId: (id: string | null) => void;
  setLastTranslationResult: (result: TranslationResult | null) => void;
  setQueuedPrompts: React.Dispatch<React.SetStateAction<QueuedPrompt[]>>;
  setRawJsonlOutput: React.Dispatch<React.SetStateAction<string[]>>;
  appendRawJsonlOutput: (payload: string) => void;
  setExtractedSessionInfo: React.Dispatch<React.SetStateAction<{ sessionId: string; projectId: string; engine?: 'claude' | 'codex' | 'gemini' } | null>>;
  setIsFirstPrompt: (isFirst: boolean) => void;
  setCodexRateLimits?: React.Dispatch<React.SetStateAction<CodexRateLimits | null>>;
  setCancelSessionId?: (id: string | null) => void;
  getRunElapsedSeconds?: () => number | null;
  /**
   * Stable UI tab/window id used for backend event routing.
   * Detached windows are labeled `session-window-${routingTabId}`, so the
   * backend must receive this exact id for targeted stream output to arrive.
   */
  routingTabId?: string | null;

  // External Hook Functions
  processMessageWithTranslation: (message: ClaudeStreamMessage, payload: string, currentTranslationResult?: TranslationResult) => Promise<void>;
}

interface UsePromptExecutionReturn {
  handleSendPrompt: (prompt: string, model: ModelType, maxThinkingTokens?: number) => Promise<void>;
  /** 本 hook 内部生成、真正传给后端并用于所有事件路由的 tabId（ask-user/plan 事件按此过滤）。 */
  runTabId: string;
}

type ClaudeGlobalEventPayload<T> = { tab_id?: string | null; payload: T } | T;
type EngineGlobalEventPayload<T> = { tab_id?: string | null; payload: T } | T;

const stringifyPromptExecutionError = (error: unknown): string => {
  if (typeof error === 'string') return error;
  if (error instanceof Error) {
    return error.stack || error.message;
  }

  try {
    return JSON.stringify(error, null, 2);
  } catch {
    return String(error);
  }
};

const createUiEventId = () => {
  return `ui-event-${safeRandomUUID()}`;
};

const normalizeClaudeGlobalPayload = <T,>(payload: ClaudeGlobalEventPayload<T>) => {
  if (payload && typeof payload === 'object' && 'payload' in payload) {
    const typedPayload = payload as { tab_id?: string | null; payload: T };
    return { tabId: typedPayload.tab_id ?? null, payload: typedPayload.payload };
  }
  return { tabId: null, payload: payload as T };
};

const normalizeEngineGlobalPayload = <T,>(payload: EngineGlobalEventPayload<T>) => {
  if (payload && typeof payload === 'object' && 'payload' in payload) {
    const typedPayload = payload as { tab_id?: string | null; payload: T };
    return { tabId: typedPayload.tab_id ?? null, payload: typedPayload.payload };
  }
  return { tabId: null, payload: payload as T };
};

// ============================================================================
// Hook Implementation
// ============================================================================

export function usePromptExecution(config: UsePromptExecutionConfig): UsePromptExecutionReturn {
  const {
    projectPath,
    isLoading,
    claudeSessionId,
    effectiveSession,
    isPlanMode,
    isActive,
    isFirstPrompt,
    extractedSessionInfo,
    executionEngine = 'claude', // 🆕 默认使用 Claude Code
    codexMode = 'read-only',     // 🆕 Codex 默认只读模式
    codexModel,                  // 🆕 Codex 模型
    geminiModel,                 // 🆕 Gemini 模型
    geminiApprovalMode,          // 🆕 Gemini 审批模式
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
    getRunElapsedSeconds,
    routingTabId,
    processMessageWithTranslation
  } = config;

  // ============================================================================
  // 🔧 Fix: 使用 ref 存储 isPlanMode，确保异步回调获取最新值
  // 解决问题：批准计划后自动发送的提示词仍带 --plan 标志
  // ============================================================================
  const isPlanModeRef = useRef(isPlanMode);
  useEffect(() => {
    isPlanModeRef.current = isPlanMode;
  }, [isPlanMode]);

  // ============================================================================
  // 🔒 CRITICAL FIX: 使用稳定 UI tab/window id 作为后端事件路由 id。
  // 主窗口标签页：`session-window-${tabId}` 不存在，后端自动回退到 main；
  // 独立窗口：真实窗口 label 正是 `session-window-${tabId}`，高频 stream 才能投递到当前窗口。
  // 没有外层 tabId 的旧挂载路径才退回随机 id。
  // ============================================================================
  const tabIdRef = useRef<string>(resolveExecutionRunTabId(routingTabId, safeRandomUUID));

  const codexThreadIdRef = useRef<string | null>(null);
  const latestClaudeExecutionStateRef = useRef({
    effectiveSessionId: effectiveSession?.id ?? null,
    extractedSessionId: extractedSessionInfo?.sessionId ?? null,
    claudeSessionId,
    isFirstPrompt,
  });

  const safeRuntimeUnlisten = useCallback((unlisten: UnlistenFn) => {
    if (!unlisten || typeof unlisten !== 'function') {
      return;
    }

    try {
      unlisten();
    } catch (error) {
      console.warn('[usePromptExecution] Failed to remove runtime listener:', error);
    }
  }, []);

  const cleanupRuntimeListeners = useCallback(() => {
    unlistenRefs.current.forEach(safeRuntimeUnlisten);
    unlistenRefs.current = [];
    isListeningRef.current = false;
  }, [unlistenRefs, isListeningRef, safeRuntimeUnlisten]);

  const registerRuntimeUnlisten = useCallback((unlisten: UnlistenFn) => {
    unlistenRefs.current.push(unlisten);
    return unlisten;
  }, [unlistenRefs]);

  const bindCancelSessionId = useCallback((sessionId: string | null) => {
    const safeSessionId = sessionId?.trim() || null;
    if (activeSessionIdRef) {
      activeSessionIdRef.current = safeSessionId;
    }
    setCancelSessionId?.(safeSessionId);
  }, [activeSessionIdRef, setCancelSessionId]);

  const resetRuntimeState = useCallback(() => {
    setIsLoading(false);
    hasActiveSessionRef.current = false;
    bindCancelSessionId(null);
    cleanupRuntimeListeners();
  }, [setIsLoading, hasActiveSessionRef, bindCancelSessionId, cleanupRuntimeListeners]);

  useEffect(() => {
    if (executionEngine !== 'codex') {
      return;
    }

    const sessionId = extractedSessionInfo?.sessionId || effectiveSession?.id;
    if (sessionId) {
      codexThreadIdRef.current = sessionId;
    }
  }, [executionEngine, extractedSessionInfo?.sessionId, effectiveSession?.id]);

  useEffect(() => {
    latestClaudeExecutionStateRef.current = {
      effectiveSessionId: effectiveSession?.id ?? null,
      extractedSessionId: extractedSessionInfo?.sessionId ?? null,
      claudeSessionId,
      isFirstPrompt,
    };
  }, [effectiveSession?.id, extractedSessionInfo?.sessionId, claudeSessionId, isFirstPrompt]);

  const updateCodexRateLimits = useCallback((incoming?: CodexRateLimits | null) => {
    if (!incoming || !setCodexRateLimits) {
      return;
    }

    setCodexRateLimits((prev) => {
      if (!prev) {
        return incoming;
      }

      if (!incoming.updatedAt) {
        return prev.updatedAt ? prev : incoming;
      }

      if (!prev.updatedAt) {
        return incoming;
      }

      const prevTime = Date.parse(prev.updatedAt);
      const nextTime = Date.parse(incoming.updatedAt);

      if (Number.isFinite(prevTime) && Number.isFinite(nextTime) && nextTime < prevTime) {
        return prev;
      }

      return incoming;
    });
  }, [setCodexRateLimits]);

  const refreshCodexRateLimitsFromHistory = useCallback(async () => {
    if (!setCodexRateLimits) {
      return;
    }

    const sessionId = codexThreadIdRef.current || extractedSessionInfo?.sessionId || effectiveSession?.id;
    if (!sessionId) {
      return;
    }

    try {
      const history = await api.loadCodexSessionHistory(sessionId);
      for (let i = history.length - 1; i >= 0; i -= 1) {
        const rateLimits = extractCodexRateLimitsFromEvent(history[i]);
        if (rateLimits) {
          updateCodexRateLimits(rateLimits);
          break;
        }
      }
    } catch (err) {
      console.warn('[usePromptExecution] Failed to refresh Codex rate limits:', err);
    }
  }, [effectiveSession?.id, extractedSessionInfo?.sessionId, setCodexRateLimits, updateCodexRateLimits]);

  // ============================================================================
  // Main Prompt Execution Function
  // ============================================================================

  const handleSendPrompt = useCallback(async (
    prompt: string,
    model: ModelType,
    maxThinkingTokens?: number
  ) => {
    // ========================================================================
    // 1️⃣ Validation & Queueing
    // ========================================================================

    if (!projectPath) {
      setError("请先选择项目目录");
      return;
    }

    // Check if this is a slash command
    const isSlashCommandInput = isSlashCommand(prompt);

    // If already loading, queue the prompt
    if (isLoading) {
      const newPrompt: QueuedPrompt = {
        id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        prompt,
        model
      };
      setQueuedPrompts(prev => [...prev, newPrompt]);
      return;
    }

    let hasAppendedTerminalMessage = false;
    const engineNames: Record<'claude' | 'codex' | 'gemini', string> = {
      claude: 'Claude',
      codex: 'Codex',
      gemini: 'Gemini',
    };
    const formatElapsed = (seconds?: number | null) => {
      if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < 1) {
        return '';
      }
      const wholeSeconds = Math.floor(seconds);
      if (wholeSeconds < 60) {
        return `${wholeSeconds} 秒`;
      }
      const minutes = Math.floor(wholeSeconds / 60);
      const remainingSeconds = wholeSeconds % 60;
      return remainingSeconds > 0 ? `${minutes} 分 ${remainingSeconds} 秒` : `${minutes} 分钟`;
    };
    const appendExecutionSystemMessage = (
      subtype: 'execution-complete' | 'execution-error',
      engine: 'claude' | 'codex' | 'gemini',
      text: string,
      details?: string,
      sessionIdOverride?: string | null
    ) => {
      if (hasAppendedTerminalMessage) {
        return;
      }
      hasAppendedTerminalMessage = true;
      const elapsedSeconds = getRunElapsedSeconds?.() ?? null;
      const suffix = subtype === 'execution-complete' && elapsedSeconds
        ? `，用时 ${formatElapsed(elapsedSeconds)}`
        : '';
      const now = new Date().toISOString();
      const message: ClaudeStreamMessage = {
        type: 'system',
        subtype,
        result: `${text}${suffix}${details ? `\n\n${details}` : ''}`,
        engine,
        elapsedSeconds,
        projectPath,
        timestamp: now,
        receivedAt: now,
        uiOnly: true,
        uiEventId: createUiEventId(),
        excludeFromAiContext: true,
      };

      persistUiOnlySessionMessage({
        sessionId: sessionIdOverride
          || activeSessionIdRef?.current
          || effectiveSession?.id
          || extractedSessionInfo?.sessionId
          || claudeSessionId
          || null,
        projectPath,
        engine,
        message,
      });

      appendMessage(message);
    };

    const activeTaskQueues: Array<{ done: () => void }> = [];

    try {
      setIsLoading(true);
      setError(null);
      hasActiveSessionRef.current = true;
      bindCancelSessionId(resolveInitialCancelSessionId({
        engine: executionEngine,
        effectiveSession,
        claudeSessionId,
        extractedSessionInfo,
      }));

      // Record prompt sent (save Git state before sending)
      // Only record real user input, exclude auto Warmup and Skills messages
      let recordedPromptIndex = -1;
      const isUserInitiated = !prompt.includes('Warmup')
        && !prompt.includes('<command-name>')
        && !prompt.includes('Launching skill:');
      const codexPendingInfo = executionEngine === 'codex' ? {
        sessionId: effectiveSession?.id || null,
        projectPath,
        promptText: prompt,
        promptIndex: undefined as number | undefined,
      } : undefined;
      const geminiPendingInfo = executionEngine === 'gemini' ? {
        sessionId: effectiveSession?.id || null,
        projectPath,
        promptText: prompt,
        promptIndex: undefined as number | undefined,
      } : undefined;
      let codexPendingPromptRecord: PendingPromptRecord | null = null;
      let geminiPendingPromptRecord: PendingPromptRecord | null = null;
      let hasNotifiedCompletion = false;
      const terminalEventGate = createTerminalEventGate();
      const isCurrentRunEventTab = (eventTabId: string | null) => eventTabId === tabIdRef.current;

      const notifyCompletionIfIdle = async (
        engine: 'claude' | 'codex' | 'gemini',
        sessionId?: string | null
      ) => {
        if (hasNotifiedCompletion) {
          return;
        }

        // restored 队列项是“重启恢复、需用户手动确认”的待办，不属于本轮自动续跑队列。
        // 不能让它们阻塞“本次执行完成”提醒，否则用户手动保留恢复项时当前对话会一直像没结束。
        const queuedPromptCount = queuedPromptsRef.current.filter(p => !p.restored).length;
        if (queuedPromptCount > 0) {
          return;
        }

        appendExecutionSystemMessage(
          'execution-complete',
          engine,
          `✅ 本次 ${engineNames[engine]} 执行完成`,
          undefined,
          sessionId ?? null
        );
        hasNotifiedCompletion = true;
        await notifyAiExecutionComplete({
          engine,
          queuedPromptCount,
          sessionId: sessionId ?? activeSessionIdRef?.current ?? null,
          runId: tabIdRef.current,
          elapsedSeconds: getRunElapsedSeconds?.() ?? null,
          projectPath,
        });
      };
      const runNextQueuedPrompt = () => {
        // 仅自动抽取「本次会话内新加入」的队列项；跳过 restored（重启恢复且未确认）的项，
        // 后者必须由用户在队列面板逐条点「发送」手动确认，避免重启后队列被自动抽干造成乱套。
        const queue = queuedPromptsRef.current;
        const nextIndex = queue.findIndex(p => !p.restored);
        if (nextIndex === -1) {
          return;
        }

        const nextPrompt = queue[nextIndex];
        setQueuedPrompts(queue.filter((_, i) => i !== nextIndex));

        setTimeout(() => {
          handleSendPrompt(nextPrompt.prompt, nextPrompt.model);
        }, 100);
      };

      // 对于已有会话，立即记录；对于新会话，在收到 session_id 后记录
      if (effectiveSession && isUserInitiated) {
        try {
          if (executionEngine === 'codex') {
            // ✅ Codex 使用专用的记录 API（写入 ~/.codex/git-records/）
            recordedPromptIndex = await api.recordCodexPromptSent(
              effectiveSession.id,
              projectPath,
              prompt
            );

            if (codexPendingInfo) {
              codexPendingInfo.promptIndex = recordedPromptIndex;
              codexPendingInfo.sessionId = effectiveSession.id;
            }
          } else if (executionEngine === 'gemini') {
            // 🔧 FIX: Gemini must wait for real CLI session ID from init event
            // Don't record here even for existing sessions - Gemini CLI may generate new session ID
            // geminiPendingInfo will be used in the init event handler
          } else {
            // Claude Code 使用原有的记录 API（写入 .claude-sessions/）
            recordedPromptIndex = await api.recordPromptSent(
              effectiveSession.id,
              effectiveSession.project_id,
              projectPath,
              prompt
            );

          }
        } catch (err) {
          console.error('[Prompt Revert] [ERROR] Failed to record prompt:', err);
        }
      } else if (isUserInitiated) {

      }

      // Translation state
      let processedPrompt = prompt;
      let userInputTranslation: TranslationResult | null = null;

      // For resuming sessions, ensure we have the session ID
      if (effectiveSession && executionEngine === 'claude' && !claudeSessionId) {
        setClaudeSessionId(effectiveSession.id);
        latestClaudeExecutionStateRef.current = {
          ...latestClaudeExecutionStateRef.current,
          effectiveSessionId: effectiveSession.id,
          claudeSessionId: effectiveSession.id,
        };
      }

      // ========================================================================
      // 2️⃣ Event Listener Setup (Only for Active Tabs)
      // ========================================================================

      if (!isActive) {
        throw new Error('当前标签页未激活，无法安全发送');
      }

      if (!isListeningRef.current && isActive) {
        // Clean up previous listeners
        unlistenRefs.current.forEach(safeRuntimeUnlisten);
        unlistenRefs.current = [];

        // Mark as setting up listeners
        isListeningRef.current = true;

        // ====================================================================
        // 🆕 Codex Event Listeners (with session isolation support)
        // ====================================================================
        if (executionEngine === 'codex') {
          // 🔧 CRITICAL FIX: 创建会话级别的转换器实例,避免全局单例污染
          // 问题: 全局 codexConverter 单例会在多个标签页间共享状态(threadId, itemMap, toolResults)
          // 解决: 每个会话创建独立的转换器实例
          const sessionCodexConverter = new CodexEventConverter({
            // codex exec --json 的事件不包含 model 信息；这里用用户选择/会话记录作为默认模型
            defaultModel: effectiveSession?.model || codexModel || null,
          });

          // 🔧 FIX: Track current Codex session ID for channel isolation
          let currentCodexSessionId: string | null = null;
          // 🔧 FIX: Drop global/session overlap duplicates without dropping repeated deltas from one channel.
          const codexDuplicateGuard = createCrossChannelDuplicateGuard<'global' | 'session'>();
          // 🔧 FIX: Track pending prompt recording Promise to avoid race condition
          let pendingPromptRecordingPromise: Promise<void> | null = null;

          // 🚀 修复 Linux/WebKit「前端卡死、后端仍在跑」（Codex 主发送路径）：见 Claude 路径同款注释。
          // 回调只把处理逻辑包成 thunk 入队（同步瞬时返回），消费循环串行 await，不阻塞 event loop。
          const codexTaskQueue = new AsyncQueue<() => Promise<void>>();
          activeTaskQueues.push(codexTaskQueue);
          (async () => {
            try {
              await consumeYielding(
                codexTaskQueue,
                (task) => task(),
                () => isMountedRef.current,
              );
            } catch (err) {
              console.error('[usePromptExecution] Codex 消息消费循环异常:', err);
            }
          })();

          // Helper function to generate message ID for deduplication
          const getCodexMessageId = (payload: string): string => {
            // Use payload hash as ID since Codex doesn't provide unique message IDs
            let hash = 0;
            for (let i = 0; i < payload.length; i++) {
              const char = payload.charCodeAt(i);
              hash = ((hash << 5) - hash) + char;
              hash = hash & hash;
            }
            return `codex-${hash}`;
          };

          // Helper function to process Codex output
          const processCodexOutputLine = async (payload: string, source: 'global' | 'session') => {
            if (!isMountedRef.current) return;

            // 🔧 FIX: Deduplicate only global/session overlap; identical same-channel deltas are valid.
            const messageId = getCodexMessageId(payload);
            if (!codexDuplicateGuard.shouldProcess(messageId, source)) {
              return;
            }

            // 🔧 CRITICAL FIX: Parse JSONL to detect turn.completed event
            let isTurnCompleted = false;
            try {
              const event = JSON.parse(payload);
              if (event.type === 'turn.completed') {
                isTurnCompleted = true;
              }
            } catch (e) {
              // Ignore parse errors
            }

            // 🔧 FIX: 使用会话级别的转换器实例
            const message = sessionCodexConverter.convertEvent(payload);
            if (message) {
              if (message.model) {
                cacheCodexModelFromStream(message.model);
              }
              appendMessage(message);
              appendRawJsonlOutput(payload);

              // Extract and save Codex thread_id from thread.started for session resuming
              // NOTE: claudeSessionId is already set to the backend channel ID in codex-session-init handler
              // Here we only save the thread_id for session resuming purposes (different from channel ID)
              if (message.type === 'system' && message.subtype === 'init' && (message as any).session_id) {
                const codexThreadId = (message as any).session_id;  // This is the Codex thread_id
                codexThreadIdRef.current = codexThreadId;
                // 🔧 FIX: Don't override claudeSessionId here - it's already set to backend channel ID
                // setClaudeSessionId(codexThreadId);  // REMOVED - would break event channel subscription

                // Save session info for resuming (uses thread_id, not channel ID)
                const projectId = projectPath.replace(/[^a-zA-Z0-9]/g, '-');
                setExtractedSessionInfo({ sessionId: codexThreadId, projectId, engine: 'codex' });

                // Mark as not first prompt anymore
                setIsFirstPrompt(false);

                // If this is a new Codex session and prompt not yet recorded, record now
                if (isUserInitiated && codexPendingInfo && codexPendingInfo.promptIndex === undefined) {
                  // 🔧 FIX: Store Promise to allow processCodexComplete to wait for it
                  pendingPromptRecordingPromise = api.recordCodexPromptSent(codexThreadId, projectPath, codexPendingInfo.promptText)
                    .then((idx) => {
                      codexPendingInfo.promptIndex = idx;
                      codexPendingInfo.sessionId = codexThreadId;
                      codexPendingPromptRecord = {
                        sessionId: codexThreadId,
                        projectPath,
                        promptIndex: idx,
                        promptText: codexPendingInfo.promptText
                      };
                    })
                    .catch(err => {
                      console.warn('[usePromptExecution] Failed to record Codex prompt after init:', err);
                    });
                } else if (codexPendingInfo && codexPendingInfo.promptIndex !== undefined) {
                  // Update pending sessionId for completion handler
                  codexPendingPromptRecord = {
                    sessionId: codexThreadId,
                    projectPath,
                    promptIndex: codexPendingInfo.promptIndex,
                    promptText: codexPendingInfo.promptText
                  };
                }
              }
            }

            // 🔧 CRITICAL FIX: Auto-complete session when turn.completed is received
            // Don't wait for codex-complete event from backend, as it may be delayed or not sent
            const converterRateLimits = sessionCodexConverter.getRateLimits();
            const messageRateLimits = (message as any)?.codexMetadata?.rateLimits;
            updateCodexRateLimits(messageRateLimits || converterRateLimits);

            if (isTurnCompleted) {
              // 入队 complete：排在当前 output thunk 之后执行，确保消息已处理完再收尾（替代原 setTimeout）。
              codexTaskQueue.enqueue(() => processCodexComplete());
            }
          };

          // 批量协议适配：后端可能把多行 JSONL 合并为 string[] 一次 emit。
          // 拆行后逐行入队（瞬时返回），由消费循环串行处理，不在事件回调里 await。
          const processCodexOutput = (payload: string | string[], source: 'global' | 'session') => {
            for (const line of normalizeStreamLines(payload)) {
              codexTaskQueue.enqueue(() => processCodexOutputLine(line, source));
            }
          };

          // Helper function to process Codex completion
          const processCodexComplete = async () => {
            if (!terminalEventGate.tryStart('complete')) return;
            const completedSessionId = currentCodexSessionId || codexPendingPromptRecord?.sessionId || null;
            setIsLoading(false);
            hasActiveSessionRef.current = false;
            bindCancelSessionId(null);
            isListeningRef.current = false;

            // 🆕 Clean up listeners to prevent memory leak
            unlistenRefs.current.forEach(safeRuntimeUnlisten);
            unlistenRefs.current = [];

            // 🔧 FIX: Wait for pending prompt recording to complete (race condition fix)
            if (pendingPromptRecordingPromise) {
              await pendingPromptRecordingPromise;
              pendingPromptRecordingPromise = null;
            }

            // 🆕 Record prompt completion for rewind support
            if (codexPendingPromptRecord) {
              const pendingPrompt = codexPendingPromptRecord;
              try {
                await api.recordCodexPromptCompleted(
                  pendingPrompt.sessionId,
                  pendingPrompt.projectPath,
                  pendingPrompt.promptIndex,
                  pendingPrompt.promptText
                );
              } catch (err) {
                console.warn('[usePromptExecution] Failed to record Codex prompt completion:', err);
              }
              codexPendingPromptRecord = null;
            }

            await refreshCodexRateLimitsFromHistory();
            await notifyCompletionIfIdle('codex', completedSessionId);

            // 结束消息消费循环
            codexTaskQueue.done();
            // Process queued prompts
            runNextQueuedPrompt();
          };

          const parseCodexErrorPayload = (payload: string): { sessionId?: string; message: string } => {
            try {
              const data = JSON.parse(payload);
              const sessionId = data?.session_id || data?.sessionId;
              const message = data?.error?.message || data?.message || payload;
              const detail = data?.error?.detail || data?.detail;
              if (detail && typeof detail === 'string' && detail.trim().length > 0) {
                return { sessionId, message: `${message}\n${detail}` };
              }
              return { sessionId, message };
            } catch {
              return { message: payload };
            }
          };

          // Helper function to process Codex errors (确保退出加载态并清理监听，避免前端“无反应”)
          const processCodexError = async (payload: string) => {
            if (!terminalEventGate.tryStart('error')) return;
            const parsed = parseCodexErrorPayload(payload);
            setError(parsed.message);
            appendExecutionSystemMessage(
              'execution-error',
              'codex',
              '⚠️ Codex 执行失败，已停止监听。你可以检查错误详情后重新发送。',
              parsed.message
            );
            resetRuntimeState();

            // 启动失败时不应保留 pending prompt
            codexPendingPromptRecord = null;

            // 结束消息消费循环
            codexTaskQueue.done();
            // 继续处理队列（与完成逻辑一致）
            runNextQueuedPrompt();
          };

          // Helper function to attach session-specific listeners
          const attachCodexSessionListeners = async (sessionId: string) => {
            const createdSessionUnlisteners: UnlistenFn[] = [];
            const registerSessionUnlisten = (unlisten: UnlistenFn) => {
              createdSessionUnlisteners.push(unlisten);
              return unlisten;
            };

            try {
              const specificOutputUnlisten = registerSessionUnlisten(await listen<string | string[]>(`codex-output:${sessionId}`, (evt) => {
                processCodexOutput(evt.payload, 'session');
              }));

              const specificCompleteUnlisten = registerSessionUnlisten(await listen<boolean>(`codex-complete:${sessionId}`, () => {
                // 入队：排在已入队 output 之后收尾。
                codexTaskQueue.enqueue(() => processCodexComplete());
              }));

              const specificErrorUnlisten = registerSessionUnlisten(await listen<string>(`codex-error:${sessionId}`, (evt) => {
                // 入队：排在已入队 output 之后处理错误。
                codexTaskQueue.enqueue(() => processCodexError(evt.payload));
              }));

              // Replace existing listeners with session-specific ones
              unlistenRefs.current.forEach(safeRuntimeUnlisten);
              unlistenRefs.current = [specificOutputUnlisten, specificCompleteUnlisten, specificErrorUnlisten];
            } catch (error) {
              createdSessionUnlisteners.forEach(safeRuntimeUnlisten);
              throw error;
            }
          };

          // 🔧 FIX: Listen for session init event to get session ID for channel isolation
          const codexSessionInitUnlisten = registerRuntimeUnlisten(await listen<EngineGlobalEventPayload<{ type: string; session_id: string }>>('codex-session-init', async (evt) => {
            // 🔧 FIX: Only process if this tab has an active session
            if (!hasActiveSessionRef.current) return;
            const { tabId: eventTabId, payload } = normalizeEngineGlobalPayload(evt.payload);
            if (!isCurrentRunEventTab(eventTabId)) {
              return;
            }
            if (payload.session_id && !currentCodexSessionId) {
              currentCodexSessionId = payload.session_id;
              bindCancelSessionId(currentCodexSessionId);
              // 🔧 FIX: Set claudeSessionId to the backend channel ID for reconnection and cancellation
              // This is different from the Codex thread_id which is used for resuming sessions
              setClaudeSessionId(currentCodexSessionId);
              // Switch to session-specific listeners
              await attachCodexSessionListeners(currentCodexSessionId);
            }
          }));

          // 🔧 FIX: 移除全局监听器,避免跨会话串流
          // Listen for Codex JSONL output (global fallback) - REMOVED to prevent cross-session data leakage
          // 问题: 多个标签页都监听全局 'codex-output' 事件,导致消息被多个会话接收
          // 解决: 仅在会话ID未知的早期阶段处理全局事件,且必须验证会话归属
          const codexOutputUnlisten = registerRuntimeUnlisten(await listen<EngineGlobalEventPayload<string | string[]>>('codex-output', (evt) => {
            // 🔧 CRITICAL FIX: 只在尚未收到会话ID时处理全局事件
            if (!hasActiveSessionRef.current) return;
            const { tabId: eventTabId, payload } = normalizeEngineGlobalPayload(evt.payload);
            if (!isCurrentRunEventTab(eventTabId)) {
              return;
            }
            if (currentCodexSessionId) {
              // 已经有会话ID,不再处理全局事件(应该由会话特定监听器处理)

              return;
            }
            // 只在会话ID未知的早期阶段处理
            processCodexOutput(payload, 'global');
          }));

          // Listen for Codex errors
          const codexErrorUnlisten = registerRuntimeUnlisten(await listen<EngineGlobalEventPayload<string>>('codex-error', async (evt) => {
            // 🔧 FIX: Only process if this tab has an active session
            if (!hasActiveSessionRef.current) return;

            const { tabId: eventTabId, payload } = normalizeEngineGlobalPayload(evt.payload);
            if (!isCurrentRunEventTab(eventTabId)) {
              return;
            }

            const parsed = parseCodexErrorPayload(payload);

            // 🔒 Session Isolation：如果已确定会话 ID，则忽略其他会话的错误
            if (parsed.sessionId && currentCodexSessionId && parsed.sessionId !== currentCodexSessionId) {
              return;
            }

            // 如果尚未拿到 session_init，但错误里包含 session_id，也用于绑定会话（用于隔离与 UI 展示）
            if (!currentCodexSessionId && parsed.sessionId) {
              currentCodexSessionId = parsed.sessionId;
              bindCancelSessionId(currentCodexSessionId);
              setClaudeSessionId(currentCodexSessionId);
            }

            // 入队：排在已入队 output 之后处理错误。
            codexTaskQueue.enqueue(() => processCodexError(payload));
          }));

          // 🔧 FIX: 移除全局完成事件监听器,避免跨会话串流
          // Listen for Codex completion (global fallback) - FIXED to prevent cross-session interference
          const codexCompleteUnlisten = registerRuntimeUnlisten(await listen<EngineGlobalEventPayload<boolean>>('codex-complete', async (evt) => {
            // 🔧 CRITICAL FIX: 只在尚未收到会话ID时处理全局事件
            if (!hasActiveSessionRef.current) return;
            const { tabId: eventTabId } = normalizeEngineGlobalPayload(evt.payload);
            if (!isCurrentRunEventTab(eventTabId)) {
              return;
            }
            if (currentCodexSessionId) {
              // 已经有会话ID,不再处理全局完成事件(应该由会话特定监听器处理)

              return;
            }

            // 入队：排在已入队 output 之后收尾。
            codexTaskQueue.enqueue(() => processCodexComplete());
          }));

          unlistenRefs.current = [codexSessionInitUnlisten, codexOutputUnlisten, codexErrorUnlisten, codexCompleteUnlisten];
        } else if (executionEngine === 'gemini') {
          // ====================================================================
          // 🆕 Gemini Event Listeners
          // ====================================================================

          // 🔧 Track current Gemini session ID for channel isolation
          let currentGeminiSessionId: string | null = null;
          // 🔧 Drop global/session overlap duplicates without dropping repeated deltas from one channel.
          const geminiDuplicateGuard = createCrossChannelDuplicateGuard<'global' | 'session'>();
          // 🔧 FIX: Track pending prompt recording Promise to avoid race condition
          let pendingGeminiPromptRecordingPromise: Promise<void> | null = null;

          // 🚀 修复 Linux/WebKit「前端卡死、后端仍在跑」（Gemini 主发送路径）：见 Claude 路径同款注释。
          // processGeminiOutputLine 虽是同步函数，但 delta 合并逻辑重；回调只入队（瞬时返回），
          // 消费循环串行执行，避免高频事件在回调里连续重活淹没 event loop。
          const geminiTaskQueue = new AsyncQueue<() => Promise<void>>();
          activeTaskQueues.push(geminiTaskQueue);
          (async () => {
            try {
              await consumeYielding(
                geminiTaskQueue,
                (task) => task(),
                () => isMountedRef.current,
              );
            } catch (err) {
              console.error('[usePromptExecution] Gemini 消息消费循环异常:', err);
            }
          })();

          // Helper function to generate message ID for deduplication
          const getGeminiMessageId = (payload: string): string => {
            let hash = 0;
            for (let i = 0; i < payload.length; i++) {
              const char = payload.charCodeAt(i);
              hash = ((hash << 5) - hash) + char;
              hash = hash & hash;
            }
            return `gemini-${hash}`;
          };

          // Helper function to convert Gemini unified message to ClaudeStreamMessage
          const convertGeminiToClaudeMessage = (data: any): ClaudeStreamMessage | null => {
            try {
              // The backend already converts to unified format, we just need to ensure type compatibility
              // Note: geminiMetadata is already included in data from backend conversion

              if (data.type === 'system' && data.subtype === 'init') {
                return {
                  type: 'system',
                  subtype: 'init',
                  session_id: data.session_id,
                  model: data.model,
                  timestamp: data.timestamp,
                  engine: 'gemini' as const
                };
              }

              if (data.type === 'assistant' || data.type === 'user') {
                // 🔧 FIX: 对于 user 类型的 tool_result 消息，提取 Gemini functionResponse 格式的实际输出
                let message = data.message;

                if (data.type === 'user' && message?.content) {
                  const content = Array.isArray(message.content) ? message.content : [message.content];
                  const processedContent = content.map((item: any) => {
                    // 检查是否是 tool_result
                    if (item.type === 'tool_result') {
                      let resultContent = item.content;

                      // 尝试提取 Gemini functionResponse 格式: [{functionResponse: {response: {output: "..."}}}]
                      if (Array.isArray(item.content)) {
                        const firstResult = item.content[0];
                        if (firstResult?.functionResponse?.response?.output !== undefined) {
                          resultContent = firstResult.functionResponse.response.output;
                        }
                      }

                      return {
                        ...item,
                        content: resultContent
                      };
                    }
                    return item;
                  });

                  message = {
                    ...message,
                    content: processedContent
                  };
                }

                return {
                  type: data.type,
                  message,
                  timestamp: data.timestamp,
                  engine: 'gemini' as const
                };
              }

              if (data.type === 'result') {
                return {
                  type: 'result',
                  subtype: data.subtype || 'success',
                  usage: data.usage,
                  timestamp: data.timestamp,
                  engine: 'gemini' as const,
                  model: data.model,
                  geminiMetadata: data.geminiMetadata,
                };
              }

              if (data.type === 'system' && data.subtype === 'error') {
                return {
                  type: 'system',
                  subtype: 'error',
                  error: data.error,
                  timestamp: data.timestamp,
                  engine: 'gemini' as const
                };
              }

              // Fallback for unknown types
              return {
                type: 'system',
                subtype: 'raw',
                message: { content: [{ type: 'text', text: JSON.stringify(data) }] },
                engine: 'gemini' as const
              };
            } catch (err) {
              console.error('[usePromptExecution] Failed to convert Gemini message:', err);
              return null;
            }
          };

          // Helper function to process Gemini output
          const processGeminiOutputLine = (payload: string, source: 'global' | 'session') => {
            if (!isMountedRef.current) return;

            // 🔧 FIX: Deduplicate only global/session overlap; identical same-channel deltas are valid.
            const messageId = getGeminiMessageId(payload);
            if (!geminiDuplicateGuard.shouldProcess(messageId, source)) {
              return;
            }

            try {
              const data = JSON.parse(payload);

              // 🔧 FIX: Skip user messages from Gemini - already added by frontend
              // Gemini CLI echoes back user messages, but we already display them
              const hasToolResult = data.message?.content?.some((c: any) => c.type === 'tool_result');
              if (data.type === 'user' && !hasToolResult) {

                return;
              }

              // 🔧 FIX: Skip Gemini CLI stderr messages (debug info, metrics, startup logs)
              // These are system messages with eventType: "stderr" that should not be shown to users
              if (data.type === 'system' && data.geminiMetadata?.eventType === 'stderr') {
                return;
              }

              // 🔧 FIX: Handle delta messages - merge with last message of same type
              const isDelta = data.geminiMetadata?.delta || data.delta;
              const msgType = data.type;

              if (isDelta && msgType === 'assistant') {
                // Delta message - merge with last assistant message
                replaceLastMessage((lastMsg) => {
                  // Check if last message is assistant and can be merged
                  if (lastMsg && lastMsg.type === 'assistant') {
                    const lastContent = lastMsg.message?.content;
                    const newContent = data.message?.content;

                    if (Array.isArray(lastContent) && Array.isArray(newContent)) {
                      let updatedContent = [...lastContent];
                      let merged = false;

                      // Process each item in new content
                      for (const newItem of newContent) {
                        if (newItem.type === 'text') {
                          // Merge text with existing text block
                          const lastTextIdx = updatedContent.findIndex((c: any) => c.type === 'text');
                          if (lastTextIdx >= 0 && newItem.text) {
                            updatedContent[lastTextIdx] = {
                              ...updatedContent[lastTextIdx],
                              text: (updatedContent[lastTextIdx].text || '') + newItem.text
                            };
                            merged = true;
                          }
                        } else if (newItem.type === 'tool_use') {
                          // 🔧 FIX: Handle tool_use delta - merge with existing tool_use if same ID
                          // Gemini streaming often sends tool_use in chunks or duplicates
                          const lastContentIdx = updatedContent.length - 1;
                          const lastContentItem = updatedContent[lastContentIdx];

                          // Check if we can merge with the last item (same type and ID)
                          if (lastContentItem && lastContentItem.type === 'tool_use' &&
                              (lastContentItem.id === newItem.id || (!lastContentItem.id && !newItem.id))) {

                            // Merge input (assuming it's accumulating properties or complete update)
                            // For safety, we merge objects
                            const mergedInput = { ...(lastContentItem.input || {}), ...(newItem.input || {}) };

                            updatedContent[lastContentIdx] = {
                              ...lastContentItem,
                              ...newItem, // Update other fields like name
                              input: mergedInput
                            };
                            //
                          } else {
                            // New tool call
                            updatedContent.push(newItem);
                            //
                          }
                          merged = true;
                        } else {
                          // Append non-text items (thinking, etc.)
                          updatedContent.push(newItem);
                          merged = true;
                        }
                      }

                      if (merged) {
                        // 🐛 DEBUG: Log final merged content structure
                        const toolUseCount = updatedContent.filter((c: any) => c.type === 'tool_use').length;
                        if (toolUseCount > 0) {

                        }

                        const updatedMsg = {
                          ...lastMsg,
                          message: {
                            ...lastMsg.message,
                            content: updatedContent
                          }
                        };

                        return { type: 'replace', item: updatedMsg };
                      }
                    }
                  }

                  // Cannot merge, add as new message
                  const message = convertGeminiToClaudeMessage(data);
                  return message ? { type: 'append', item: message } : { type: 'none' };
                });
                appendRawJsonlOutput(payload);
                return;
              }

              // Non-delta message - add normally
              const message = convertGeminiToClaudeMessage(data);

              if (message) {
                appendMessage(message);
                appendRawJsonlOutput(payload);

                // 🔧 NOTE: Session ID handling moved to gemini-cli-session-id event listener
                // The init message from gemini-output may contain backend's temporary ID (gemini-{uuid})
                // We now use the dedicated gemini-cli-session-id event which provides the REAL CLI session ID
              }
            } catch (err) {
              console.error('[usePromptExecution] Failed to process Gemini output:', err, payload);
            }
          };

          // 批量协议适配：后端可能把多行合并为 string[] 一次 emit。
          // 拆行后逐行入队（瞬时返回），由消费循环串行执行，不在事件回调里连续干重活。
          const processGeminiOutput = (payload: string | string[], source: 'global' | 'session') => {
            for (const line of normalizeStreamLines(payload)) {
              geminiTaskQueue.enqueue(async () => processGeminiOutputLine(line, source));
            }
          };

          // Helper function to process Gemini completion
          const processGeminiComplete = async () => {
            if (!terminalEventGate.tryStart('complete')) return;
            const completedSessionId = currentGeminiSessionId || geminiPendingPromptRecord?.sessionId || null;
            setIsLoading(false);
            hasActiveSessionRef.current = false;
            bindCancelSessionId(null);
            isListeningRef.current = false;

            // Clean up listeners
            unlistenRefs.current.forEach(safeRuntimeUnlisten);
            unlistenRefs.current = [];

            // 🔧 FIX: Wait for pending prompt recording to complete (race condition fix)
            if (pendingGeminiPromptRecordingPromise) {
              await pendingGeminiPromptRecordingPromise;
              pendingGeminiPromptRecordingPromise = null;
            }

            // 🆕 Record prompt completion for rewind support
            if (geminiPendingPromptRecord) {
              const pendingPrompt = geminiPendingPromptRecord;
              try {
                await api.recordGeminiPromptCompleted(
                  pendingPrompt.sessionId,
                  pendingPrompt.projectPath,
                  pendingPrompt.promptIndex,
                  pendingPrompt.promptText
                );
              } catch (err) {
                console.warn('[usePromptExecution] Failed to record Gemini prompt completion:', err);
              }
              geminiPendingPromptRecord = null;
            }

            // Clear pending session
            await notifyCompletionIfIdle('gemini', completedSessionId);

            // 结束消息消费循环
            geminiTaskQueue.done();
            // Process queued prompts
            runNextQueuedPrompt();
          };

          const processGeminiError = (payload: string) => {
            if (!terminalEventGate.tryStart('error')) return;
            console.error('[usePromptExecution] Gemini error:', payload);
            let errorMessage = payload;
            try {
              const data = JSON.parse(payload);
              errorMessage = data.error?.message || payload;
              setError(errorMessage);
            } catch {
              setError(errorMessage);
            }
            appendExecutionSystemMessage(
              'execution-error',
              'gemini',
              '⚠️ Gemini 执行失败，已停止监听。你可以检查错误详情后重新发送。',
              errorMessage
            );
            resetRuntimeState();
            geminiPendingPromptRecord = null;
            pendingGeminiPromptRecordingPromise = null;
            // 结束消息消费循环
            geminiTaskQueue.done();
          };

          // Helper function to attach session-specific listeners
          const attachGeminiSessionListeners = async (sessionId: string) => {
            const createdSessionUnlisteners: UnlistenFn[] = [];
            const registerSessionUnlisten = (unlisten: UnlistenFn) => {
              createdSessionUnlisteners.push(unlisten);
              return unlisten;
            };

            try {
              registerSessionUnlisten(await listen<string | string[]>(`gemini-output:${sessionId}`, (evt) => {
                processGeminiOutput(evt.payload, 'session');
              }));

              registerSessionUnlisten(await listen<boolean>(`gemini-complete:${sessionId}`, () => {
                // 入队：排在已入队 output 之后收尾。
                geminiTaskQueue.enqueue(() => processGeminiComplete());
              }));

              registerSessionUnlisten(await listen<string>(`gemini-error:${sessionId}`, (evt) => {
                // 入队：排在已入队 output 之后处理错误。
                geminiTaskQueue.enqueue(async () => processGeminiError(evt.payload));
              }));

              // 🔧 FIX: Append session-specific listeners instead of replacing all
              // This preserves global listeners like geminiCliSessionIdUnlisten
              unlistenRefs.current.push(...createdSessionUnlisteners);
            } catch (error) {
              createdSessionUnlisteners.forEach(safeRuntimeUnlisten);
              throw error;
            }
          };

          // Listen for session init event (backend emits this with backend channel ID)
          const geminiSessionInitUnlisten = registerRuntimeUnlisten(await listen<EngineGlobalEventPayload<any>>('gemini-session-init', async (evt) => {
            if (!hasActiveSessionRef.current) return;
            // 🔧 FIX: evt.payload is already an object, no need to JSON.parse
            const { tabId: eventTabId, payload: data } = normalizeEngineGlobalPayload(evt.payload);
            if (!isCurrentRunEventTab(eventTabId)) {
              return;
            }
            if (data.session_id && !currentGeminiSessionId) {
              const backendSessionId = data.session_id as string; // e.g., gemini-{uuid}
              currentGeminiSessionId = backendSessionId;
              bindCancelSessionId(backendSessionId);
              // Keep claudeSessionId bound to the backend runtime while the process
              // is active.  The real Gemini CLI session id is stored in
              // extractedSessionInfo for history/prompt tracking.
              setClaudeSessionId(backendSessionId);

              // Switch to session-specific listeners
              await attachGeminiSessionListeners(backendSessionId);
            }
          }));

          // 🔧 FIX: Listen for real Gemini CLI session ID (emitted when CLI returns init event)
          // This is the REAL session ID that should be used for prompt recording
          const geminiCliSessionIdUnlisten = registerRuntimeUnlisten(await listen<EngineGlobalEventPayload<{ backend_session_id: string; cli_session_id: string }>>('gemini-cli-session-id', async (evt) => {
            if (!hasActiveSessionRef.current) return;
            const { tabId: eventTabId, payload } = normalizeEngineGlobalPayload(evt.payload);
            if (!isCurrentRunEventTab(eventTabId)) {
              return;
            }
            const { backend_session_id: backendSessionId, cli_session_id: realCliSessionId } = payload;
            if (!realCliSessionId) return;
            if (currentGeminiSessionId && backendSessionId && backendSessionId !== currentGeminiSessionId) {
              return;
            }
            if (!currentGeminiSessionId && backendSessionId) {
              currentGeminiSessionId = backendSessionId;
              bindCancelSessionId(backendSessionId);
              setClaudeSessionId(backendSessionId);
              await attachGeminiSessionListeners(backendSessionId);
            }

            const projectId = projectPath.replace(/[^a-zA-Z0-9]/g, '-');
            setExtractedSessionInfo({ sessionId: realCliSessionId, projectId, engine: 'gemini' });
            setIsFirstPrompt(false);

            // 🔧 FIX: Record prompt sent using REAL Gemini CLI session ID
            if (isUserInitiated && geminiPendingInfo && geminiPendingInfo.promptIndex === undefined) {
              pendingGeminiPromptRecordingPromise = api.recordGeminiPromptSent(realCliSessionId, projectPath, geminiPendingInfo.promptText)
                .then((idx) => {
                  geminiPendingInfo.promptIndex = idx;
                  geminiPendingInfo.sessionId = realCliSessionId;
                  geminiPendingPromptRecord = {
                    sessionId: realCliSessionId,
                    projectPath,
                    promptIndex: idx,
                    promptText: geminiPendingInfo.promptText
                  };
                })
                .catch(err => {
                  console.warn('[Gemini Revert] Failed to record prompt with real CLI session ID:', err);
                });
            }

            // Store pending session info with real CLI session ID
            if (geminiPendingInfo) {
              geminiPendingInfo.sessionId = realCliSessionId;
            }
          }));

          // 🔧 FIX: 移除全局监听器,避免跨会话串流
          // Listen for Gemini output (global fallback) - FIXED to prevent cross-session data leakage
          const geminiOutputUnlisten = registerRuntimeUnlisten(await listen<EngineGlobalEventPayload<string | string[]>>('gemini-output', (evt) => {
            // 🔧 CRITICAL FIX: 只在尚未收到会话ID时处理全局事件
            if (!hasActiveSessionRef.current) return;
            const { tabId: eventTabId, payload } = normalizeEngineGlobalPayload(evt.payload);
            if (!isCurrentRunEventTab(eventTabId)) {
              return;
            }
            if (currentGeminiSessionId) {
              // 已经有会话ID,不再处理全局事件(应该由会话特定监听器处理)

              return;
            }
            // 只在会话ID未知的早期阶段处理
            processGeminiOutput(payload, 'global');
          }));

          // Listen for Gemini errors
          const geminiErrorUnlisten = registerRuntimeUnlisten(await listen<EngineGlobalEventPayload<string>>('gemini-error', (evt) => {
            if (!hasActiveSessionRef.current) return;
            const { tabId: eventTabId, payload } = normalizeEngineGlobalPayload(evt.payload);
            if (!isCurrentRunEventTab(eventTabId)) {
              return;
            }
            // 入队：排在已入队 output 之后处理错误。
            geminiTaskQueue.enqueue(async () => processGeminiError(payload));
          }));

          // 🔧 FIX: 移除全局完成事件监听器,避免跨会话串流
          // Listen for Gemini completion (global fallback) - FIXED to prevent cross-session interference
          const geminiCompleteUnlisten = registerRuntimeUnlisten(await listen<EngineGlobalEventPayload<boolean>>('gemini-complete', async (evt) => {
            // 🔧 CRITICAL FIX: 只在尚未收到会话ID时处理全局事件
            if (!hasActiveSessionRef.current) return;
            const { tabId: eventTabId } = normalizeEngineGlobalPayload(evt.payload);
            if (!isCurrentRunEventTab(eventTabId)) {
              return;
            }
            if (currentGeminiSessionId) {
              // 已经有会话ID,不再处理全局完成事件(应该由会话特定监听器处理)

              return;
            }

            // 入队：排在已入队 output 之后收尾。
            geminiTaskQueue.enqueue(() => processGeminiComplete());
          }));

          unlistenRefs.current = [geminiSessionInitUnlisten, geminiCliSessionIdUnlisten, geminiOutputUnlisten, geminiErrorUnlisten, geminiCompleteUnlisten];
        } else {
          // --------------------------------------------------------------------
          // Claude Code Event Listener Setup Strategy
          // --------------------------------------------------------------------
          // Claude Code may emit a *new* session_id even when we pass --resume.
          // If we listen only on the old session-scoped channel we will miss the
          // stream until the user navigates away & back. To avoid this we:
          //   • Always start with GENERIC listeners (no suffix) so we catch the
          //     very first "system:init" message regardless of the session id.
          //   • Once that init message provides the *actual* session_id, we
          //     dynamically switch to session-scoped listeners and stop the
          //     generic ones to prevent duplicate handling.
          // --------------------------------------------------------------------

        let currentSessionId: string | null = claudeSessionId || effectiveSession?.id || null;

        // 🔧 FIX: Track whether we've switched to session-specific listeners
        // Only ignore generic messages AFTER we've attached session-specific listeners
        let hasAttachedSessionListeners = false;

        // 🔧 FIX: Drop global/session overlap duplicates without dropping repeated deltas from one channel.
        const claudeDuplicateGuard = createCrossChannelDuplicateGuard<'global' | 'session'>();

        // 🔧 FIX: Track pending prompt recording Promise to avoid race condition
        let pendingClaudePromptRecordingPromise: Promise<void> | null = null;

        // 🚀 修复 Linux/WebKit「前端卡死、后端仍在跑」（主发送路径）：
        // 过去 output 回调在 Tauri 事件回调体里直接 JSON.parse + await 翻译 + setState 处理每条消息，
        // 而 Tauri 事件回调是串行投递的——前一条没让出主线程，后续事件全堆在 event loop，
        // 大块输出（几 MB 单行）同步 parse 多遍时主线程被淹没，UI/输入完全无响应。
        // 现改为：回调只把「处理逻辑」包成 thunk 入队（同步、瞬时返回），真正的处理放到下面独立的
        // 消费循环里串行 await（保序但不阻塞 event loop）。与 useSessionStream 的修复同构。
        const claudeTaskQueue = new AsyncQueue<() => Promise<void>>();
        activeTaskQueues.push(claudeTaskQueue);
        (async () => {
          try {
            await consumeYielding(
              claudeTaskQueue,
              (task) => task(),
              () => isMountedRef.current,
            );
          } catch (err) {
            console.error('[usePromptExecution] Claude 消息消费循环异常:', err);
          }
        })();

        // Helper function to generate message ID for deduplication
        const getClaudeMessageId = (payload: string): string => {
          try {
            const msg = JSON.parse(payload) as ClaudeStreamMessage;
            // Use message ID if available, otherwise use payload hash
            if (msg.id) return `claude-${msg.id}`;
            if (msg.timestamp) return `claude-${msg.timestamp}-${msg.type}`;
          } catch {
            // Fall through to hash-based ID
          }
          // Fallback: use payload hash
          let hash = 0;
          for (let i = 0; i < payload.length; i++) {
            const char = payload.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash;
          }
          return `claude-${hash}`;
        };

        // ====================================================================
        // Helper: Attach Session-Specific Listeners
        // ====================================================================
        const attachSessionSpecificListeners = async (sid: string) => {
          const createdSessionUnlisteners: UnlistenFn[] = [];
          const registerSessionUnlisten = (unlisten: UnlistenFn) => {
            createdSessionUnlisteners.push(unlisten);
            return unlisten;
          };

          try {
          const specificOutputUnlisten = registerSessionUnlisten(await listen<string | string[]>(`claude-output:${sid}`, (evt) => {
            // 批量协议适配：payload 可能是 string（单行）或 string[]（后端节流合并多行）。
            // 回调只逐行入队（同步、瞬时返回），真正处理放到消费循环里，不阻塞 event loop。
            for (const line of normalizeStreamLines(evt.payload)) {
              claudeTaskQueue.enqueue(async () => {
                await handleStreamMessage(line, 'session', userInputTranslation || undefined);

                // Handle user message recording in session-specific listener
                try {
                  const msg = JSON.parse(line) as ClaudeStreamMessage;

                  // 在收到第一条 user 消息后记录
                  if (msg.type === 'user' && !hasRecordedPrompt && isUserInitiated) {
                    // 检查这是否是我们发送的那条消息（通过内容匹配）
                    let isOurMessage = false;
                    const msgContent: any = msg.message?.content;

                    if (msgContent) {
                      if (typeof msgContent === 'string') {
                        const contentStr = msgContent as string;
                        isOurMessage = contentStr.includes(prompt) || prompt.includes(contentStr);
                      } else if (Array.isArray(msgContent)) {
                        const textContent = msgContent
                          .filter((item: any) => item.type === 'text')
                          .map((item: any) => item.text)
                          .join('');
                        isOurMessage = textContent.includes(prompt) || prompt.includes(textContent);
                      }
                    }

                    if (isOurMessage) {
                      const projectId = extractedSessionInfo?.projectId || projectPath.replace(/[^a-zA-Z0-9]/g, '-');
                      // 🔧 FIX: Store Promise to allow processComplete to wait for it
                      pendingClaudePromptRecordingPromise = (async () => {
                        try {
                          // 添加延迟以确保文件写入完成
                          await new Promise(resolve => setTimeout(resolve, 100));

                          recordedPromptIndex = await api.recordPromptSent(
                            sid,
                            projectId,
                            projectPath,
                            prompt
                          );
                          hasRecordedPrompt = true;

                        } catch (err) {
                          console.error('[Prompt Revert] [ERROR] Failed to record prompt:', err);
                        }
                      })();
                    }
                  }
                } catch {
                  /* ignore parse errors */
                }
              });
            }
          }));

          const specificErrorUnlisten = registerSessionUnlisten(await listen<string>(`claude-error:${sid}`, (evt) => {
            // 入队：排在已入队的 output thunk 之后执行，保证错误处理不抢在未处理消息前面。
            claudeTaskQueue.enqueue(async () => {
              processClaudeError(evt.payload);
            });
          }));

          const specificCompleteUnlisten = registerSessionUnlisten(await listen<boolean>(`claude-complete:${sid}`, () => {
            // 入队：complete 排在所有已入队 output 之后，确保收尾前消息全部处理完。
            claudeTaskQueue.enqueue(async () => {
              await processComplete();
            });
          }));

          // 只有三个 session-specific 监听器都真正注册成功后，才能停止接收 global fallback。
          // 后端 stream_batcher 在 system:init 后只保留很短的 global grace window；
          // 过早置 true 会让 Linux/WebKit 上 init 后紧跟的输出既没赶上 session listener，
          // 又被 global listener 自己过滤，表现为“后台在跑、complete 到了，但中间消息为空”。
          hasAttachedSessionListeners = true;

          // Replace existing unlisten refs with these new ones (after cleaning up)
          unlistenRefs.current.forEach(safeRuntimeUnlisten);
          unlistenRefs.current = [specificOutputUnlisten, specificErrorUnlisten, specificCompleteUnlisten];
          } catch (error) {
            createdSessionUnlisteners.forEach(safeRuntimeUnlisten);
            throw error;
          }
        };

        // ====================================================================
        // Helper: Process Stream Message
        // ====================================================================
        async function handleStreamMessage(
          payload: string,
          source: 'global' | 'session',
          currentTranslationResult?: TranslationResult,
        ) {
          try {
            // Don't process if component unmounted
            if (!isMountedRef.current) return;

            // 🔧 FIX: Deduplicate only global/session overlap; identical same-channel deltas are valid.
            const messageId = getClaudeMessageId(payload);
            if (!claudeDuplicateGuard.shouldProcess(messageId, source)) {
              return;
            }

            // Store raw JSONL
            appendRawJsonlOutput(payload);

            const message = JSON.parse(payload) as ClaudeStreamMessage;

            // Use the shared translation function for consistency
            await processMessageWithTranslation(message, payload, currentTranslationResult);

          } catch (err) {
            console.error('Failed to parse message:', err, payload);
          }
        }

        // ====================================================================
        // Helper: Process Completion
        // ====================================================================
        const processComplete = async () => {
          if (!terminalEventGate.tryStart('complete')) return;
          const completedSessionId = currentSessionId || effectiveSession?.id || claudeSessionId || null;


          // 🔧 FIX: Wait for pending prompt recording to complete (race condition fix)
          if (pendingClaudePromptRecordingPromise) {
            await pendingClaudePromptRecordingPromise;
            pendingClaudePromptRecordingPromise = null;
          }

          // Mark prompt as completed (record Git state after completion)
          if (recordedPromptIndex >= 0) {
            // Use currentSessionId and extractedSessionInfo for new sessions
            // 优先使用本轮运行里最新拿到的 session_id。
            // Claude 在 plan/continue/resume 场景下可能返回新的会话 ID，
            // 如果这里继续使用旧的 effectiveSession.id，会导致记录写到旧会话里。
            const sessionId = currentSessionId || effectiveSession?.id;
            const projectId = effectiveSession?.project_id || extractedSessionInfo?.projectId || projectPath.replace(/[^a-zA-Z0-9]/g, '-');

            if (sessionId && projectId) {
              api.markPromptCompleted(
                sessionId,
                projectId,
                projectPath,
                recordedPromptIndex,
                prompt
              ).then(() => {
              }).catch(err => {
                console.error('[Prompt Revert] Failed to mark completed:', err);
              });
            } else {
              console.warn('[Prompt Revert] Cannot mark completed: missing sessionId or projectId');
            }
          }

          setIsLoading(false);
          hasActiveSessionRef.current = false;
          bindCancelSessionId(null);
          isListeningRef.current = false;

          // 🆕 Clean up listeners to prevent memory leak
          unlistenRefs.current.forEach(safeRuntimeUnlisten);
          unlistenRefs.current = [];

          // Reset currentSessionId to allow detection of new session_id
          currentSessionId = null;
          await notifyCompletionIfIdle('claude', completedSessionId);
          // 结束消息消费循环（已入队的消息会被消费完后自然退出）
          claudeTaskQueue.done();
          // Process queued prompts after completion
          runNextQueuedPrompt();
        };

        const processClaudeError = (payload: string) => {
          if (!terminalEventGate.tryStart('error')) return;
          console.error('Claude error:', payload);
          setError(payload);
          appendExecutionSystemMessage(
            'execution-error',
            'claude',
            '⚠️ Claude 执行失败，已停止监听。你可以检查错误详情后重新发送。',
            payload
          );
          resetRuntimeState();
          pendingClaudePromptRecordingPromise = null;
          // 结束消息消费循环
          claudeTaskQueue.done();
          runNextQueuedPrompt();
        };

        // Track if we've recorded the prompt for new sessions
        let hasRecordedPrompt = recordedPromptIndex >= 0;

        // ====================================================================
        // Generic Listeners (Catch-all) - FIXED to prevent cross-session data leakage
        // ====================================================================
        // 🔒 CRITICAL FIX: 全局事件现在格式为 { tab_id: string | null, payload: string }
        const genericOutputUnlisten = registerRuntimeUnlisten(await listen<ClaudeGlobalEventPayload<string | string[]>>('claude-output', async (event) => {
          // 🔧 CRITICAL FIX: 只在尚未收到会话ID时处理全局事件
          if (!hasActiveSessionRef.current) return;

          // 🔒 CRITICAL FIX: 使用 tab_id 过滤消息，这是最可靠的会话隔离方式
          const { tabId: eventTabId, payload: rawPayload } = normalizeClaudeGlobalPayload(event.payload);

          // 当前 run 发起后，global 事件必须带匹配的 tab_id；缺失 tab_id 的旧式广播不再进入新会话。
          if (!isCurrentRunEventTab(eventTabId)) {
            // 消息来自不同标签页或缺少当前 run 的 tab_id，忽略
            return;
          }

          // 批量协议适配：payload 可能是 string（单行）或 string[]（后端节流合并多行），
          // 逐行执行原有的早期 init/session 隔离逻辑。
          // 回调只逐行入队（瞬时返回），处理放到消费循环里；thunk 内 continue 改 return（跳过当前行，语义等价）。
          for (const messagePayload of normalizeStreamLines(rawPayload)) {
            // 这个 global event 是否属于“session listener attach 前的 fallback”必须按接收时判断。
            // 否则 WebKit/Linux 下事件先入 AsyncQueue、稍后才消费；消费时 session listener 可能已经挂好，
            // 早期 fallback 行会被 shouldAcceptClaudeGlobalMessage 误判为应丢弃，造成中间输出空白。
            const hadAttachedSessionListenersAtReceive = hasAttachedSessionListeners;
            claudeTaskQueue.enqueue(async () => {
              // Attempt to extract session_id on the fly (for the very first init)
              try {
                const msg = JSON.parse(messagePayload) as ClaudeStreamMessage;

                if (!shouldAcceptClaudeGlobalMessage({
                  currentTabId: tabIdRef.current,
                  eventTabId,
                  hasAttachedSessionListeners: hadAttachedSessionListenersAtReceive,
                  currentSessionId,
                  message: msg,
                })) {
                  return;
                }

                // Always process the message if we haven't established a session yet
                // Or if it is the init message
                await handleStreamMessage(messagePayload, 'global', userInputTranslation || undefined);

                if (msg.type === 'system' && msg.subtype === 'init' && msg.session_id) {
                  // Cache model display name from init message for dynamic model selector
                  if (msg.model) {
                    cacheModelFromInitMessage(msg.model);
                  }

                  if (shouldAttachClaudeSessionListeners({
                    currentSessionId,
                    incomingSessionId: msg.session_id,
                    hasAttachedSessionListeners,
                  })) {
                    currentSessionId = msg.session_id;
                    bindCancelSessionId(msg.session_id);
                    setClaudeSessionId(msg.session_id);

                    // Claude 在 plan/continue/resume 场景下可能切换到新的 session_id。
                    // 这里不能只在“首次为空”时写入，否则标签页和本地持久化会保留旧会话，
                    // 随后切换页面或重开应用时就会表现为“会话丢失”。
                    const projectId = extractedSessionInfo?.projectId || projectPath.replace(/[^a-zA-Z0-9]/g, '-');
                    latestClaudeExecutionStateRef.current = {
                      ...latestClaudeExecutionStateRef.current,
                      extractedSessionId: msg.session_id,
                      claudeSessionId: msg.session_id,
                      isFirstPrompt: false,
                    };
                    if (!extractedSessionInfo || extractedSessionInfo.sessionId !== msg.session_id) {
                      setExtractedSessionInfo({ sessionId: msg.session_id, projectId, engine: 'claude' });
                    }

                    // Record prompt after system:init (user message already written to JSONL)
                    if (!hasRecordedPrompt && isUserInitiated) {
                      const projectId = projectPath.replace(/[^a-zA-Z0-9]/g, '-');
                      // 🔧 FIX: Store Promise to allow processComplete to wait for it
                      pendingClaudePromptRecordingPromise = (async () => {
                        try {
                          // Delay 200ms to ensure file is written
                          await new Promise(resolve => setTimeout(resolve, 200));

                          recordedPromptIndex = await api.recordPromptSent(
                            msg.session_id,
                            projectId,
                            projectPath,
                            prompt
                          );
                          hasRecordedPrompt = true;

                        } catch (err) {
                          console.error('[Prompt Revert] [ERROR] Failed to record prompt:', err);
                        }
                      })();
                    }

                    // Switch to session-specific listeners
                    await attachSessionSpecificListeners(msg.session_id);
                  }
                }

                // Record after first user message (user message already written to JSONL)
                // This ensures backend can correctly read and calculate index
                if (msg.type === 'user' && !hasRecordedPrompt && isUserInitiated && currentSessionId) {
                  // 检查这是否是我们发送的那条消息（通过内容匹配）
                  let isOurMessage = false;
                  const msgContent: any = msg.message?.content;

                  if (msgContent) {
                    if (typeof msgContent === 'string') {
                      const contentStr = msgContent as string;
                      isOurMessage = contentStr.includes(prompt) || prompt.includes(contentStr);
                    } else if (Array.isArray(msgContent)) {
                      const textContent = msgContent
                        .filter((item: any) => item.type === 'text')
                        .map((item: any) => item.text)
                        .join('');
                      isOurMessage = textContent.includes(prompt) || prompt.includes(textContent);
                    }
                  }

                  if (isOurMessage) {
                    const projectId = extractedSessionInfo?.projectId || projectPath.replace(/[^a-zA-Z0-9]/g, '-');
                    // 🔧 FIX: Store Promise to allow processComplete to wait for it
                    pendingClaudePromptRecordingPromise = (async () => {
                      try {
                        // 添加延迟以确保文件写入完成
                        await new Promise(resolve => setTimeout(resolve, 100));

                        recordedPromptIndex = await api.recordPromptSent(
                          currentSessionId,
                          projectId,
                          projectPath,
                          prompt
                        );
                        hasRecordedPrompt = true;

                      } catch (err) {
                        console.error('[Prompt Revert] [ERROR] Failed to record prompt:', err);
                      }
                    })();
                  }
                }
              } catch {
                /* ignore parse errors */
              }
            }); // enqueue thunk
          }
        }));

        // 🔒 CRITICAL FIX: 全局事件现在格式为 { tab_id: string | null, payload: string }
        const genericErrorUnlisten = registerRuntimeUnlisten(await listen<ClaudeGlobalEventPayload<string>>('claude-error', (evt) => {
          // 🔧 FIX: Only process if this tab has an active session
          if (!hasActiveSessionRef.current) return;

          // 🔒 CRITICAL FIX: 使用 tab_id 过滤消息
          const { tabId: eventTabId, payload: errorPayload } = normalizeClaudeGlobalPayload(evt.payload);
          if (!isCurrentRunEventTab(eventTabId)) {
            return;
          }

          // 入队：排在已入队 output thunk 之后，保证错误处理不抢在未处理消息前面。
          claudeTaskQueue.enqueue(async () => {
            processClaudeError(errorPayload);
          });
        }));

        // 🔒 CRITICAL FIX: 全局事件现在格式为 { tab_id: string | null, payload: boolean }
        const genericCompleteUnlisten = registerRuntimeUnlisten(await listen<ClaudeGlobalEventPayload<boolean>>('claude-complete', (evt) => {
          // 🔧 FIX: Only process if this tab has an active session
          if (!hasActiveSessionRef.current) return;

          // 🔒 CRITICAL FIX: 使用 tab_id 过滤消息
          const { tabId: eventTabId } = normalizeClaudeGlobalPayload(evt.payload);
          if (!isCurrentRunEventTab(eventTabId)) {
            return;
          }

          // 入队：complete 排在所有已入队 output 之后，确保收尾前消息全部处理完。
          claudeTaskQueue.enqueue(async () => {
            await processComplete();
          });
        }));

        // Store the generic unlisteners for now; they may be replaced later.
        unlistenRefs.current = [genericOutputUnlisten, genericErrorUnlisten, genericCompleteUnlisten];

        } // End of Claude Code event listener setup

        // ========================================================================
        // 3️⃣ Translation Processing
        // ========================================================================

        // Skip translation entirely for slash commands
        if (!isSlashCommandInput) {
          try {
            const isEnabled = await translationMiddleware.isEnabled();
            if (isEnabled) {
              userInputTranslation = await translationMiddleware.translateUserInput(prompt);
              processedPrompt = userInputTranslation.translatedText;

              if (userInputTranslation.wasTranslated) {
              }
            }
          } catch (translationError) {
            console.error('[usePromptExecution] Translation failed, using original prompt:', translationError);
            // Continue with original prompt if translation fails
          }
        }

        // Store the translation result AFTER all processing for response translation
        if (userInputTranslation) {
          setLastTranslationResult(userInputTranslation);
        }

        // ========================================================================
        // 4️⃣ maxThinkingTokens Processing (No longer modifying prompt)
        // ========================================================================

        // maxThinkingTokens is now passed as API parameter, not added to prompt
        if (maxThinkingTokens) {
        }

        // ========================================================================
        // 5️⃣ Add User Message to UI
        // ========================================================================

        // 🆕 检测斜杠命令 - 斜杠命令显示为"执行命令"系统消息，而不是用户消息
        const isSlashCmd = isSlashCommand(prompt);

        if (isSlashCmd) {
          // 斜杠命令显示为 command-meta 系统消息
          const commandMessage: ClaudeStreamMessage = {
            type: "system",
            subtype: "command-meta",
            message: {
              content: [
                {
                  type: "text",
                  text: `<command-name>${prompt.trim()}</command-name>`
                }
              ]
            },
            timestamp: new Date().toISOString(),
            ...(executionEngine === 'codex' ? { engine: 'codex' as const } : {}),
            ...(executionEngine === 'gemini' ? { engine: 'gemini' as const } : {})
          };
          appendMessageImmediate(commandMessage);
        } else {
          // 普通用户消息
          const userMessage: ClaudeStreamMessage = {
            type: "user",
            message: {
              content: [
                {
                  type: "text",
                  text: prompt // Always show original user input
                }
              ]
            },
            sentAt: new Date().toISOString(),
            ...(executionEngine === 'codex' ? { engine: 'codex' as const } : {}),
            ...(executionEngine === 'gemini' ? { engine: 'gemini' as const } : {}),
            // Add translation metadata for debugging/info
            translationMeta: userInputTranslation ? {
              wasTranslated: userInputTranslation.wasTranslated,
              detectedLanguage: userInputTranslation.detectedLanguage,
              translatedText: userInputTranslation.translatedText
            } : undefined
          };
          appendMessageImmediate(userMessage);
        }
      }

      // ========================================================================
      // 6️⃣ API Execution
      // ========================================================================

      // Execute the appropriate command based on execution engine
      // Use processedPrompt (potentially translated) for API calls
      if (executionEngine === 'codex') {
        // ====================================================================
        // 🆕 Codex Execution Branch
        // ====================================================================

        // 📝 Git 记录逻辑说明：
        // - 已有会话：已在前面第 201-230 行通过 recordCodexPromptSent 记录
        // - 新会话：在事件监听器 codex-output 收到 thread.started 后记录
        // 此处仅设置 pendingPrompt 供 completion 使用

        if (effectiveSession && !isFirstPrompt) {
          // Resume existing Codex session
          try {
            await api.resumeCodex(effectiveSession.id, {
              projectPath,
              prompt: processedPrompt,
              mode: codexMode || 'read-only',
              model: sanitizeCodexModelId(codexModel || model),
              json: true,
              skipGitRepoCheck: true,
              tabId: tabIdRef.current
            });
          } catch (resumeError) {
            // Fallback to resume last if specific resume fails
            await api.resumeLastCodex({
              projectPath,
              prompt: processedPrompt,
              mode: codexMode || 'read-only',
              model: sanitizeCodexModelId(codexModel || model),
              json: true,
              skipGitRepoCheck: true,
              tabId: tabIdRef.current
            });
          }
        } else {
          // Start new Codex session
          setIsFirstPrompt(false);
          await api.executeCodex({
            projectPath,
            prompt: processedPrompt,
            mode: codexMode || 'read-only',
            model: sanitizeCodexModelId(codexModel || model),
            json: true,
            skipGitRepoCheck: true,
            tabId: tabIdRef.current
          });
        }

        // 🆕 Store pending prompt info for completion recording
        // 已有会话: recordedPromptIndex 已在前面设置
        // 新会话: codexPendingInfo.promptIndex 将在 thread.started 事件后设置
        const pendingIndex = recordedPromptIndex >= 0 ? recordedPromptIndex : codexPendingInfo?.promptIndex;
        const pendingSessionId = effectiveSession?.id || codexPendingInfo?.sessionId || null;
        if (pendingIndex !== undefined && pendingSessionId) {
          codexPendingPromptRecord = {
            sessionId: pendingSessionId,
            projectPath,
            promptIndex: pendingIndex,
            promptText: prompt
          };
        }
      } else if (executionEngine === 'gemini') {
        // ====================================================================
        // 🆕 Gemini Execution Branch
        // ====================================================================
        // Note: geminiModel and geminiApprovalMode come from hook parameters

        // Determine if we're resuming a session
        const resumingSession = effectiveSession && !isFirstPrompt;
        const sessionId = resumingSession ? effectiveSession.id : undefined;



        if (resumingSession) {
        } else {
          setIsFirstPrompt(false);
        }

          await api.executeGemini({
            projectPath,
            prompt: processedPrompt,
            model: geminiModel || 'gemini-3-flash',
            approvalMode: geminiApprovalMode || 'auto_edit',
            sessionId: sessionId,  // 🔑 Pass session ID for resumption
            debug: false,
            tabId: tabIdRef.current
          });

        // 🆕 Store pending prompt info for completion recording
        // 已有会话: recordedPromptIndex 已在前面设置
        // 新会话: geminiPendingInfo.promptIndex 将在 gemini-session-init 事件后设置
        const pendingIndex = recordedPromptIndex >= 0 ? recordedPromptIndex : geminiPendingInfo?.promptIndex;
        const pendingSessionId = effectiveSession?.id || geminiPendingInfo?.sessionId || null;
        if (pendingIndex !== undefined && pendingSessionId) {
          geminiPendingPromptRecord = {
            sessionId: pendingSessionId,
            projectPath,
            promptIndex: pendingIndex,
            promptText: prompt
          };
        }

      } else {
        // ====================================================================
        // Claude Code Execution Branch
        // ====================================================================
        // 🔧 Fix: 使用 isPlanModeRef.current 获取最新值，确保批准计划后不带 --plan
        const currentPlanMode = isPlanModeRef.current;
        // 🔒 CRITICAL FIX: 传递 tabId 用于全局事件过滤
        const tabId = tabIdRef.current;
        const claudeExecutionMode = resolveClaudeExecutionMode(latestClaudeExecutionStateRef.current);
        if (claudeExecutionMode.mode === 'resume') {
          // Resume existing session
          try {
            await api.resumeClaudeCode(projectPath, claudeExecutionMode.sessionId, processedPrompt, model, currentPlanMode, maxThinkingTokens, tabId);
          } catch (resumeError) {
            console.warn('[usePromptExecution] Resume failed, falling back to continue mode:', resumeError);
            // Fallback to continue mode if resume fails
            await api.continueClaudeCode(projectPath, processedPrompt, model, currentPlanMode, maxThinkingTokens, tabId);
          }
        } else {
          // Start new session
          setIsFirstPrompt(false);
          latestClaudeExecutionStateRef.current = {
            ...latestClaudeExecutionStateRef.current,
            isFirstPrompt: false,
          };
          await api.executeClaudeCode(projectPath, processedPrompt, model, currentPlanMode, maxThinkingTokens, tabId);
        }
      }

    } catch (err) {
      // ========================================================================
      // 7️⃣ Error Handling
      // ========================================================================
      console.error("Failed to send prompt:", err);
      const errorMessage = stringifyPromptExecutionError(err) || '未知错误';
      setError(errorMessage);
      appendExecutionSystemMessage(
        'execution-error',
        executionEngine,
        `⚠️ ${engineNames[executionEngine]} 上游返回错误，本次运行已停止监听。错误详情只展示在前端并保存为 UI 事件，不会带入下一次对话上下文。`,
        errorMessage
      );
      activeTaskQueues.forEach(queue => queue.done());
      resetRuntimeState();
    }
  }, [
    projectPath,
    isLoading,
    claudeSessionId,
    effectiveSession,
    isPlanMode,
    isActive,
    isFirstPrompt,
    extractedSessionInfo,
    executionEngine,  // 🆕 Codex/Gemini integration
    codexMode,        // 🆕 Codex integration
    codexModel,       // 🆕 Codex integration
    geminiModel,      // 🆕 Gemini integration
    geminiApprovalMode, // 🆕 Gemini integration
    hasActiveSessionRef,
    activeSessionIdRef,
    bindCancelSessionId,
    registerRuntimeUnlisten,
    safeRuntimeUnlisten,
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
    setCancelSessionId,
    processMessageWithTranslation,
    refreshCodexRateLimitsFromHistory,
    updateCodexRateLimits,
    resetRuntimeState
  ]);

  // ============================================================================
  // Return Hook Interface
  // ============================================================================

  return {
    handleSendPrompt,
    // 暴露本 hook 内部生成、真正传给后端并用于所有事件路由的 tabId。
    // ask-user / plan 事件按此 id 路由，监听方必须用它过滤（而非外层 tabIdProp，二者不同）。
    runTabId: tabIdRef.current,
  };
}
