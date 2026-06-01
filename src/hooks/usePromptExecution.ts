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
import { listen } from '@tauri-apps/api/event';
import { api } from '@/lib/api';
import { translationMiddleware, isSlashCommand, type TranslationResult } from '@/lib/translationMiddleware';
import type { ClaudeStreamMessage } from '@/types/claude';
import type { ModelType } from '@/components/FloatingPromptInput/types';
// 🔧 FIX: 导入 CodexEventConverter 类，在每个会话中创建独立实例避免全局单例污染
import { CodexEventConverter, extractCodexRateLimitsFromEvent } from '@/lib/codexConverter';
import { sanitizeCodexModelId } from '@/lib/codexModelSupport';
import type { CodexRateLimits } from '@/types/codex';
import { cacheCodexModelFromStream, cacheModelFromInitMessage } from '@/lib/modelNameParser';
import { notifyAiExecutionComplete } from '@/lib/aiCompletionNotification';
import { resolveInitialCancelSessionId } from '@/lib/cancelChannel';
import { persistUiOnlySessionMessage } from '@/lib/uiOnlySessionEvents';
import { awaitPromptBookkeeping } from '@/hooks/usePromptExecution/bookkeeping';
import { setupGeminiPromptListeners } from '@/hooks/usePromptExecution/geminiListeners';
import type {
  ClaudeGlobalEventPayload,
  EngineGlobalEventPayload,
  PendingPromptRecord,
  QueuedPrompt,
  UsePromptExecutionConfig,
  UsePromptExecutionReturn,
} from '@/hooks/usePromptExecution/types';

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
  const randomId = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `ui-event-${randomId}`;
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
    claudeFastMode = false,     // 🆕 Claude Fast 模式
    codexMode = 'read-only',     // 🆕 Codex 默认只读模式
    codexModel,                  // 🆕 Codex 模型
    codexFastMode = false,       // 🆕 Codex Fast 模式
    codexReasoningLevel,         // 🆕 Codex 推理强度
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
    setClaudeSessionId,
    setLastTranslationResult,
    setQueuedPrompts,
    setRawJsonlOutput,
    setExtractedSessionInfo,
    setIsFirstPrompt,
    setCodexRateLimits,
    setCancelSessionId,
    getRunElapsedSeconds,
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
  // 🔒 CRITICAL FIX: 生成唯一的 tabId 用于会话隔离
  // 解决问题：新建会话并发时全局事件的消息串扰
  // ============================================================================
  const tabIdRef = useRef<string>(crypto.randomUUID());

  const codexThreadIdRef = useRef<string | null>(null);

  const cleanupRuntimeListeners = useCallback(() => {
    unlistenRefs.current.forEach((unlisten) => {
      if (unlisten && typeof unlisten === 'function') {
        unlisten();
      }
    });
    unlistenRefs.current = [];
    isListeningRef.current = false;
  }, [unlistenRefs, isListeningRef]);

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

      setMessages(prev => [...prev, message]);
    };

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
      const isCurrentRunEventTab = (eventTabId: string | null) => eventTabId === tabIdRef.current;

      const notifyCompletionIfIdle = async (
        engine: 'claude' | 'codex' | 'gemini',
        sessionId?: string | null
      ) => {
        if (hasNotifiedCompletion) {
          return;
        }

        const queuedPromptCount = queuedPromptsRef.current.length;
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
        if (queuedPromptsRef.current.length === 0) {
          return;
        }

        const [nextPrompt, ...remainingPrompts] = queuedPromptsRef.current;
        setQueuedPrompts(remainingPrompts);

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
      }

      // Translation state
      let processedPrompt = prompt;
      let userInputTranslation: TranslationResult | null = null;

      // For resuming sessions, ensure we have the session ID
      if (effectiveSession && executionEngine === 'claude' && !claudeSessionId) {
        setClaudeSessionId(effectiveSession.id);
      }

      // ========================================================================
      // 2️⃣ Event Listener Setup (Only for Active Tabs)
      // ========================================================================

      if (!isActive) {
        throw new Error('当前标签页未激活，无法安全发送');
      }

      if (!isListeningRef.current && isActive) {
        // Clean up previous listeners
        unlistenRefs.current.forEach(unlisten => unlisten && typeof unlisten === 'function' && unlisten());
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
          // 🔧 FIX: Track processed message IDs to prevent duplicates
          const processedCodexMessages = new Set<string>();
          // 🔧 FIX: Track pending prompt recording Promise to avoid race condition
          let pendingPromptRecordingPromise: Promise<void> | null = null;

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
          const processCodexOutput = async (payload: string) => {
            if (!isMountedRef.current) return;

            // 🔧 FIX: Deduplicate messages
            const messageId = getCodexMessageId(payload);
            if (processedCodexMessages.has(messageId)) {
              return;
            }
            processedCodexMessages.add(messageId);

            // 🔧 CRITICAL FIX: Parse JSONL to detect turn.completed event
            let isTurnCompleted = false;
            try {
              const event = JSON.parse(payload);
              if (event.type === 'turn.completed') {
                isTurnCompleted = true;
              }
            } catch {
              // Ignore parse errors
            }

            // 🔧 FIX: 使用会话级别的转换器实例
            const message = sessionCodexConverter.convertEvent(payload);
            if (message) {
              if (message.model) {
                cacheCodexModelFromStream(message.model);
              }
              setMessages(prev => [...prev, message]);
              setRawJsonlOutput((prev) => [...prev, payload]);

              // Extract and save Codex thread_id from thread.started for session resuming
              // NOTE: claudeSessionId is already set to the backend channel ID in codex-session-init handler
              // Here we only save the thread_id for session resuming purposes (different from channel ID)
              if (message.type === 'system' && message.subtype === 'init' && (message as LegacyAny).session_id) {
                const codexThreadId = (message as LegacyAny).session_id;  // This is the Codex thread_id
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
            const messageRateLimits = (message as LegacyAny)?.codexMetadata?.rateLimits;
            updateCodexRateLimits(messageRateLimits || converterRateLimits);

            if (isTurnCompleted) {
              // Use setTimeout to ensure message state is updated first
              setTimeout(() => {
                processCodexComplete();
              }, 100);
            }
          };

          // Helper function to process Codex completion
          const processCodexComplete = async () => {
            const completedSessionId = currentCodexSessionId || codexPendingPromptRecord?.sessionId || null;
            setIsLoading(false);
            hasActiveSessionRef.current = false;
            bindCancelSessionId(null);
            isListeningRef.current = false;

            // 🆕 Clean up listeners to prevent memory leak
            unlistenRefs.current.forEach(u => u && typeof u === 'function' && u());
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

            // 继续处理队列（与完成逻辑一致）
            runNextQueuedPrompt();
          };

          // Helper function to attach session-specific listeners
          const attachCodexSessionListeners = async (sessionId: string) => {
            const specificOutputUnlisten = await listen<string>(`codex-output:${sessionId}`, (evt) => {
              processCodexOutput(evt.payload);
            });

            const specificCompleteUnlisten = await listen<boolean>(`codex-complete:${sessionId}`, async () => {

              await processCodexComplete();
            });

            const specificErrorUnlisten = await listen<string>(`codex-error:${sessionId}`, async (evt) => {
              await processCodexError(evt.payload);
            });

            // Replace existing listeners with session-specific ones
            unlistenRefs.current.forEach((u) => u && typeof u === 'function' && u());
            unlistenRefs.current = [specificOutputUnlisten, specificCompleteUnlisten, specificErrorUnlisten];
          };

          // 🔧 FIX: Listen for session init event to get session ID for channel isolation
          const codexSessionInitUnlisten = await listen<EngineGlobalEventPayload<{ type: string; session_id: string }>>('codex-session-init', async (evt) => {
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
          });

          // 🔧 FIX: 移除全局监听器,避免跨会话串流
          // Listen for Codex JSONL output (global fallback) - REMOVED to prevent cross-session data leakage
          // 问题: 多个标签页都监听全局 'codex-output' 事件,导致消息被多个会话接收
          // 解决: 仅在会话ID未知的早期阶段处理全局事件,且必须验证会话归属
          const codexOutputUnlisten = await listen<EngineGlobalEventPayload<string>>('codex-output', (evt) => {
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
            processCodexOutput(payload);
          });

          // Listen for Codex errors
          const codexErrorUnlisten = await listen<EngineGlobalEventPayload<string>>('codex-error', async (evt) => {
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

            await processCodexError(payload);
          });

          // 🔧 FIX: 移除全局完成事件监听器,避免跨会话串流
          // Listen for Codex completion (global fallback) - FIXED to prevent cross-session interference
          const codexCompleteUnlisten = await listen<EngineGlobalEventPayload<boolean>>('codex-complete', async (evt) => {
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

            await processCodexComplete();
          });

          unlistenRefs.current = [codexSessionInitUnlisten, codexOutputUnlisten, codexErrorUnlisten, codexCompleteUnlisten];
        } else if (executionEngine === 'gemini') {
          await setupGeminiPromptListeners({
            projectPath,
            isUserInitiated,
            geminiPendingInfo: geminiPendingInfo ?? null,
            isMountedRef,
            hasActiveSessionRef,
            isListeningRef,
            unlistenRefs,
            setMessages,
            setRawJsonlOutput,
            setIsLoading,
            setError,
            setClaudeSessionId,
            setExtractedSessionInfo,
            setIsFirstPrompt,
            bindCancelSessionId,
            resetRuntimeState,
            runNextQueuedPrompt,
            notifyCompletionIfIdle: (engine, completedSessionId) => notifyCompletionIfIdle(engine, completedSessionId),
            appendExecutionSystemMessage,
            normalizeEngineGlobalPayload,
            isCurrentRunEventTab,
            getGeminiPendingPromptRecord: () => geminiPendingPromptRecord,
            setGeminiPendingPromptRecord: (record) => {
              geminiPendingPromptRecord = record;
            },
          });
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

        // 🔧 FIX: Track processed message IDs to prevent duplicates from global and session-specific channels
        const processedClaudeMessages = new Set<string>();

        // 🔧 FIX: Track pending prompt recording Promise to avoid race condition
        let pendingClaudePromptRecordingPromise: Promise<void> | null = null;
        let hasProcessedClaudeComplete = false;

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
          // 🔧 FIX: Mark that we've attached session-specific listeners
          hasAttachedSessionListeners = true;

          const specificOutputUnlisten = await listen<string>(`claude-output:${sid}`, async (evt) => {
            handleStreamMessage(evt.payload, userInputTranslation || undefined);

            // Handle user message recording in session-specific listener
            try {
              const msg = JSON.parse(evt.payload) as ClaudeStreamMessage;

              // 在收到第一条 user 消息后记录
              if (msg.type === 'user' && !hasRecordedPrompt && isUserInitiated) {
                // 检查这是否是我们发送的那条消息（通过内容匹配）
                let isOurMessage = false;
                const msgContent: LegacyAny = msg.message?.content;

                if (msgContent) {
                  if (typeof msgContent === 'string') {
                    const contentStr = msgContent as string;
                    isOurMessage = contentStr.includes(prompt) || prompt.includes(contentStr);
                  } else if (Array.isArray(msgContent)) {
                    const textContent = msgContent
                      .filter((item: LegacyAny) => item.type === 'text')
                      .map((item: LegacyAny) => item.text)
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

          const specificErrorUnlisten = await listen<string>(`claude-error:${sid}`, (evt) => {
            processClaudeError(evt.payload);
          });

          const specificCompleteUnlisten = await listen<boolean>(`claude-complete:${sid}`, () => {

            processComplete();
          });

          // Replace existing unlisten refs with these new ones (after cleaning up)
          unlistenRefs.current.forEach((u) => u && typeof u === 'function' && u());
          unlistenRefs.current = [specificOutputUnlisten, specificErrorUnlisten, specificCompleteUnlisten];
        };

        // ====================================================================
        // Helper: Process Stream Message
        // ====================================================================
        async function handleStreamMessage(payload: string, currentTranslationResult?: TranslationResult) {
          try {
            // Don't process if component unmounted
            if (!isMountedRef.current) return;

            // 🔧 FIX: Deduplicate messages to prevent duplicate processing
            // This can happen when both global and session-specific listeners receive the same message
            const messageId = getClaudeMessageId(payload);
            if (processedClaudeMessages.has(messageId)) {
              return;
            }
            processedClaudeMessages.add(messageId);

            // Store raw JSONL
            setRawJsonlOutput((prev) => [...prev, payload]);

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
          if (hasProcessedClaudeComplete) {
            return;
          }
          hasProcessedClaudeComplete = true;

          const completedSessionId = currentSessionId || effectiveSession?.id || claudeSessionId || null;
          const sessionIdForCompletionRecord = currentSessionId || effectiveSession?.id || claudeSessionId || undefined;

          // 先解除 UI 阻塞，再做 prompt 记录/完成提醒等收尾 I/O。
          // 旧逻辑先 await recordPromptSent，遇到慢磁盘/索引卡住时会表现为“消息已返回但界面一直执行中”。
          setIsLoading(false);
          hasActiveSessionRef.current = false;
          bindCancelSessionId(null);
          isListeningRef.current = false;

          // 🆕 Clean up listeners to prevent memory leak
          unlistenRefs.current.forEach(u => u && typeof u === 'function' && u());
          unlistenRefs.current = [];

          // Reset currentSessionId to allow detection of new session_id
          currentSessionId = null;

          // 🔧 FIX: Wait for pending prompt recording to complete (race condition fix)
          const promptRecordingPromise = pendingClaudePromptRecordingPromise;
          pendingClaudePromptRecordingPromise = null;
          if (promptRecordingPromise) {
            await awaitPromptBookkeeping(promptRecordingPromise, 'Claude prompt recording');
          }

          // Mark prompt as completed (record Git state after completion)
          if (recordedPromptIndex >= 0) {
            // Use currentSessionId and extractedSessionInfo for new sessions
            // 优先使用本轮运行里最新拿到的 session_id。
            // Claude 在 plan/continue/resume 场景下可能返回新的会话 ID，
            // 如果这里继续使用旧的 effectiveSession.id，会导致记录写到旧会话里。
            const sessionId = sessionIdForCompletionRecord;
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

          await notifyCompletionIfIdle('claude', completedSessionId);
          // Process queued prompts after completion
          runNextQueuedPrompt();
        };

        const processClaudeError = (payload: string) => {
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
          runNextQueuedPrompt();
        };

        // Track if we've recorded the prompt for new sessions
        let hasRecordedPrompt = recordedPromptIndex >= 0;

        // ====================================================================
        // Generic Listeners (Catch-all) - FIXED to prevent cross-session data leakage
        // ====================================================================
        // 🔒 CRITICAL FIX: 全局事件现在格式为 { tab_id: string | null, payload: string }
        const genericOutputUnlisten = await listen<ClaudeGlobalEventPayload<string>>('claude-output', async (event) => {
          // 🔧 CRITICAL FIX: 只在尚未收到会话ID时处理全局事件
          if (!hasActiveSessionRef.current) return;

          // 🔒 CRITICAL FIX: 使用 tab_id 过滤消息，这是最可靠的会话隔离方式
          const { tabId: eventTabId, payload: messagePayload } = normalizeClaudeGlobalPayload(event.payload);

          // 当前 run 发起后，global 事件必须带匹配的 tab_id；缺失 tab_id 的旧式广播不再进入新会话。
          if (!isCurrentRunEventTab(eventTabId)) {
            // 消息来自不同标签页或缺少当前 run 的 tab_id，忽略
            return;
          }

          // 🔒 CRITICAL FIX: Session Isolation - 严格隔离全局事件处理
          // 问题: 多个标签页都监听全局 'claude-output',导致消息被多个会话接收
          // 解决: 只在会话ID未知的早期阶段处理全局事件
          if (hasAttachedSessionListeners) {
             try {
                const msg = JSON.parse(messagePayload) as ClaudeStreamMessage;
                // 只处理新会话的 init 消息(session_id 不同)
                if (msg.type === 'system' && msg.subtype === 'init' && msg.session_id && msg.session_id !== currentSessionId) {
                   // Fall through to processing below
                } else {
                   // ⚠️ 忽略所有其他消息 - 应该由会话特定监听器处理

                   return;
                }
             } catch {
                return;
             }
          }

          // Attempt to extract session_id on the fly (for the very first init)
          try {
            const msg = JSON.parse(messagePayload) as ClaudeStreamMessage;

            // 🔒 CRITICAL FIX #1: 使用 session_id 验证消息是否属于当前会话
            // 这是最重要的检查：如果消息包含 session_id，且我们已经有 claudeSessionId，
            // 则只处理匹配的消息（解决同一项目下多个会话的串扰问题）
            if (msg.session_id && claudeSessionId && msg.session_id !== claudeSessionId) {
              // 消息来自不同会话，忽略
              return;
            }

            // 🔒 CRITICAL FIX #2: 使用 cwd 字段作为备选验证（不同项目的情况）
            // 多会话并发时，不同项目的消息会通过全局事件广播
            // 通过检查 cwd 确保只处理属于当前项目的消息
            if (typeof msg.cwd === 'string' && msg.cwd && !claudeSessionId) {
              // 只有在还没有 session_id 时才使用 cwd 检查
              const normalizePath = (p: unknown) => typeof p === 'string'
                ? p.replace(/\\/g, '/').toLowerCase().replace(/\/+$/, '')
                : '';
              const msgCwd = normalizePath(msg.cwd);
              const currentPath = normalizePath(projectPath);

              if (msgCwd !== currentPath) {
                // 消息来自不同项目，忽略
                return;
              }
            }

            // Always process the message if we haven't established a session yet
            // Or if it is the init message
            handleStreamMessage(messagePayload, userInputTranslation || undefined);

            if (msg.type === 'system' && msg.subtype === 'init' && msg.session_id) {
              // Cache model display name from init message for dynamic model selector
              if (msg.model) {
                cacheModelFromInitMessage(msg.model);
              }

              if (!currentSessionId || currentSessionId !== msg.session_id) {
                currentSessionId = msg.session_id;
                bindCancelSessionId(msg.session_id);
                setClaudeSessionId(msg.session_id);

                // Claude 在 plan/continue/resume 场景下可能切换到新的 session_id。
                // 这里不能只在“首次为空”时写入，否则标签页和本地持久化会保留旧会话，
                // 随后切换页面或重开应用时就会表现为“会话丢失”。
                const projectId = extractedSessionInfo?.projectId || projectPath.replace(/[^a-zA-Z0-9]/g, '-');
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
              const msgContent: LegacyAny = msg.message?.content;

              if (msgContent) {
                if (typeof msgContent === 'string') {
                  const contentStr = msgContent as string;
                  isOurMessage = contentStr.includes(prompt) || prompt.includes(contentStr);
                } else if (Array.isArray(msgContent)) {
                  const textContent = msgContent
                    .filter((item: LegacyAny) => item.type === 'text')
                    .map((item: LegacyAny) => item.text)
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
        });

        // 🔒 CRITICAL FIX: 全局事件现在格式为 { tab_id: string | null, payload: string }
        const genericErrorUnlisten = await listen<ClaudeGlobalEventPayload<string>>('claude-error', (evt) => {
          // 🔧 FIX: Only process if this tab has an active session
          if (!hasActiveSessionRef.current) return;

          // 🔒 CRITICAL FIX: 使用 tab_id 过滤消息
          const { tabId: eventTabId, payload: errorPayload } = normalizeClaudeGlobalPayload(evt.payload);
          if (!isCurrentRunEventTab(eventTabId)) {
            return;
          }

          processClaudeError(errorPayload);
        });

        // 🔒 CRITICAL FIX: 全局事件现在格式为 { tab_id: string | null, payload: boolean }
        const genericCompleteUnlisten = await listen<ClaudeGlobalEventPayload<boolean>>('claude-complete', (evt) => {
          // 🔧 FIX: Only process if this tab has an active session
          if (!hasActiveSessionRef.current) return;

          // 🔒 CRITICAL FIX: 使用 tab_id 过滤消息
          const { tabId: eventTabId } = normalizeClaudeGlobalPayload(evt.payload);
          if (!isCurrentRunEventTab(eventTabId)) {
            return;
          }

          processComplete();
        });

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
          setMessages(prev => [...prev, commandMessage]);
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
          setMessages(prev => [...prev, userMessage]);
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

        const selectedCodexModel = codexModel || model;
        const effectiveCodexModel = sanitizeCodexModelId(
          codexFastMode && selectedCodexModel.includes('gpt-5.5')
            ? 'gpt-5.5-fast'
            : selectedCodexModel
        );

        if (effectiveSession && !isFirstPrompt) {
          // Resume existing Codex session
          try {
            await api.resumeCodex(effectiveSession.id, {
              projectPath,
              prompt: processedPrompt,
              mode: codexMode || 'read-only',
              model: effectiveCodexModel,
              fastMode: codexFastMode,
              reasoningEffort: codexReasoningLevel,
              json: true,
              skipGitRepoCheck: true,
              tabId: tabIdRef.current
            });
          } catch {
            // Fallback to resume last if specific resume fails
            await api.resumeLastCodex({
              projectPath,
              prompt: processedPrompt,
              mode: codexMode || 'read-only',
              model: effectiveCodexModel,
              fastMode: codexFastMode,
              reasoningEffort: codexReasoningLevel,
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
            model: effectiveCodexModel,
            fastMode: codexFastMode,
            reasoningEffort: codexReasoningLevel,
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



        if (!resumingSession) {
          setIsFirstPrompt(false);
        }

          await api.executeGemini({
            projectPath,
            prompt: processedPrompt,
            model: geminiModel || 'auto-gemini-3',
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
        if (effectiveSession && !isFirstPrompt) {
          // Resume existing session
          try {
            await api.resumeClaudeCode(projectPath, effectiveSession.id, processedPrompt, model, currentPlanMode, maxThinkingTokens, tabId, claudeFastMode);
          } catch (resumeError) {
            console.warn('[usePromptExecution] Resume failed, falling back to continue mode:', resumeError);
            // Fallback to continue mode if resume fails
            await api.continueClaudeCode(projectPath, processedPrompt, model, currentPlanMode, maxThinkingTokens, tabId, claudeFastMode);
          }
        } else {
          // Start new session
          setIsFirstPrompt(false);
          await api.executeClaudeCode(projectPath, processedPrompt, model, currentPlanMode, maxThinkingTokens, tabId, claudeFastMode);
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
      resetRuntimeState();
    }
  }, [
    projectPath,
    isLoading,
    claudeSessionId,
    effectiveSession,
    isActive,
    isFirstPrompt,
    extractedSessionInfo,
    executionEngine,  // 🆕 Codex/Gemini integration
    claudeFastMode,   // 🆕 Claude integration
    codexMode,        // 🆕 Codex integration
    codexModel,       // 🆕 Codex integration
    codexFastMode,    // 🆕 Codex integration
    codexReasoningLevel, // 🆕 Codex integration
    geminiModel,      // 🆕 Gemini integration
    geminiApprovalMode, // 🆕 Gemini integration
    hasActiveSessionRef,
    activeSessionIdRef,
    bindCancelSessionId,
    unlistenRefs,
    isMountedRef,
    isListeningRef,
    queuedPromptsRef,
    setIsLoading,
    setError,
    setMessages,
    setClaudeSessionId,
    setLastTranslationResult,
    setQueuedPrompts,
    setRawJsonlOutput,
    setExtractedSessionInfo,
    setIsFirstPrompt,
    processMessageWithTranslation,
    refreshCodexRateLimitsFromHistory,
    updateCodexRateLimits,
    resetRuntimeState,
    getRunElapsedSeconds
  ]);

  // ============================================================================
  // Return Hook Interface
  // ============================================================================

  return {
    handleSendPrompt
  };
}
