/**
 * useSessionStream Hook
 *
 * 新架构的会话流管理 Hook
 * 使用 AsyncQueue + SessionConnection + SessionStore
 *
 * 特点：
 * - 流式消息处理通过 AsyncQueue
 * - 连接管理通过 SessionConnection
 * - 状态管理通过 SessionStore
 * - 支持多引擎（Claude、Codex、Gemini）
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { api, type Session } from '@/lib/api';
import type { ClaudeStreamMessage } from '@/types/claude';
import type { CodexRateLimits } from '@/types/codex';
import {
  AsyncQueue,
  converterRegistry,
  type EngineType,
} from '@/lib/stream';
import { codexConverter } from '@/lib/codexConverter';
import { convertGeminiSessionDetailToClaudeMessages } from '@/lib/geminiConverter';
import {
  cacheModelFromInitMessage,
  cacheCodexModelFromStream,
  cacheGeminiModelFromStream,
} from '@/lib/modelNameParser';
import { notifyAiExecutionComplete } from '@/lib/aiCompletionNotification';
import {
  loadUiOnlySessionMessages,
  mergeUiOnlySessionMessages,
} from '@/lib/uiOnlySessionEvents';
import {
  mergeOlderHistoryMessages,
  normalizeLoadedHistoryMessages,
} from '@/lib/sessionHistoryPaging';

const SESSION_HISTORY_PAGE_SIZE = 300;

/**
 * Hook 配置
 * 与 useSessionLifecycle 完全兼容
 */
interface UseSessionStreamConfig {
  /**
   * 当前会话
   */
  session: Session | undefined;

  /**
   * 组件挂载状态 ref
   */
  isMountedRef: React.MutableRefObject<boolean>;

  /**
   * 监听状态 ref（外部管理，用于其他 hooks）
   */
  isListeningRef: React.MutableRefObject<boolean>;

  /**
   * 活跃会话状态 ref（外部管理，用于其他 hooks）
   */
  hasActiveSessionRef: React.MutableRefObject<boolean>;

  /**
   * 取消监听函数列表 ref（外部管理，用于清理）
   */
  unlistenRefs: React.MutableRefObject<UnlistenFn[]>;

  /**
   * 状态更新回调
   */
  setIsLoading: (loading: boolean) => void;
  setIsHistoryLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  setMessages: React.Dispatch<React.SetStateAction<ClaudeStreamMessage[]>>;
  setRawJsonlOutput: React.Dispatch<React.SetStateAction<string[]>>;
  setClaudeSessionId: (sessionId: string) => void;
  setCancelSessionId?: (sessionId: string | null) => void;
  setCodexRateLimits?: React.Dispatch<React.SetStateAction<CodexRateLimits | null>>;

  /**
   * 翻译初始化（兼容 useSessionLifecycle，当前禁用）
   */
  initializeProgressiveTranslation?: (messages: ClaudeStreamMessage[]) => Promise<void>;

  /**
   * 翻译处理
   */
  processMessageWithTranslation: (message: ClaudeStreamMessage, payload: string) => Promise<void>;

  /**
   * 会话不存在时的回调
   */
  onSessionNotFound?: () => void;

  /**
   * 🔧 FIX: Whether this is a new session instance (started without a session prop).
   * When true, loadSessionHistory and checkForActiveSession will be no-ops
   * even if session becomes defined later (e.g., from session prop upgrade).
   * This prevents the "reverting to latest session" bug.
   */
  isNewSessionInstance?: boolean;

  /**
   * 返回当前重连/运行任务的已运行秒数，用于完成提醒。
   */
  getRunElapsedSeconds?: () => number | null;
}

/**
 * Hook 返回值
 */
interface UseSessionStreamReturn {
  /**
   * 加载会话历史
   */
  loadSessionHistory: () => Promise<void>;

  /**
   * 按需加载更早历史
   */
  loadOlderSessionHistory: () => Promise<void>;

  /**
   * 是否还有更早历史
   */
  hasMoreHistoryBefore: boolean;

  /**
   * 是否正在加载更早历史
   */
  isLoadingOlderHistory: boolean;

  /**
   * 检查活跃会话
   */
  checkForActiveSession: () => Promise<void>;

  /**
   * 重新连接到会话
   */
  reconnectToSession: (sessionId: string) => Promise<void>;

  /**
   * 消息队列
   */
  messageQueue: React.MutableRefObject<AsyncQueue<ClaudeStreamMessage> | null>;
}

/**
 * useSessionStream Hook
 */
export function useSessionStream(config: UseSessionStreamConfig): UseSessionStreamReturn {
  const {
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
    setClaudeSessionId,
    setCancelSessionId,
    setCodexRateLimits,
    processMessageWithTranslation,
    onSessionNotFound,
    isNewSessionInstance,
    getRunElapsedSeconds,
  } = config;

  // Internal refs
  const messageQueueRef = useRef<AsyncQueue<ClaudeStreamMessage> | null>(null);
  const loadingSessionIdRef = useRef<string | null>(null);
  const historyOffsetRef = useRef(0);
  const hasMoreHistoryBeforeRef = useRef(false);
  const [hasMoreHistoryBefore, setHasMoreHistoryBeforeState] = useState(false);
  const [isLoadingOlderHistory, setIsLoadingOlderHistory] = useState(false);

  const setHasMoreHistoryBefore = useCallback((value: boolean) => {
    hasMoreHistoryBeforeRef.current = value;
    setHasMoreHistoryBeforeState(value);
  }, []);

  /**
   * 获取引擎类型
   */
  const getEngine = useCallback((): EngineType => {
    const engine = (session as LegacyAny)?.engine;
    if (engine === 'codex') return 'codex';
    if (engine === 'gemini') return 'gemini';
    return 'claude';
  }, [session]);

  const convertAndNormalizeHistory = useCallback((
    history: ClaudeStreamMessage[],
    engine: EngineType
  ): ClaudeStreamMessage[] => {
    let convertedHistory = history;

    if (engine === 'codex') {
      codexConverter.reset();
      const converted: ClaudeStreamMessage[] = [];
      for (const event of history) {
        const msg = codexConverter.convertEventObject(event as LegacyAny);
        if (msg) converted.push(msg);
      }
      convertedHistory = converted;

      if (setCodexRateLimits) {
        setCodexRateLimits(codexConverter.getRateLimits());
      }
    }

    const warnedTypes = new Set<string>();
    return normalizeLoadedHistoryMessages(convertedHistory, type => {
      if (!warnedTypes.has(type)) {
        warnedTypes.add(type);
        console.debug('[useSessionStream] Filtering out message type:', type);
      }
    });
  }, [setCodexRateLimits]);

  /**
   * 处理消息
   */
  const processMessage = useCallback(async (
    message: ClaudeStreamMessage,
    rawPayload: string
  ) => {
    if (!isMountedRef.current) return;

    // 存储原始 JSONL
    setRawJsonlOutput(prev => [...prev, rawPayload]);

    // 通过翻译中间件处理
    await processMessageWithTranslation(message, rawPayload);
  }, [isMountedRef, setRawJsonlOutput, processMessageWithTranslation]);

  /**
   * 加载会话历史
   */
  const loadSessionHistory = useCallback(async () => {
    if (!session) return;

    // 🔧 FIX: Do not load session history if this is a new session instance.
    // The component manages its own messages through streaming; loading history
    // would overwrite in-flight or already-displayed messages.
    if (isNewSessionInstance) {
      console.debug('[useSessionStream] Skipping loadSessionHistory - new session instance');
      return;
    }

    const currentSessionId = session.id;
    loadingSessionIdRef.current = currentSessionId;
    historyOffsetRef.current = 0;
    setHasMoreHistoryBefore(false);

    try {
      setIsHistoryLoading(true);
      setError(null);

      const engine = getEngine();
      let history: ClaudeStreamMessage[] = [];

      // 根据引擎类型加载历史
      if (engine === 'gemini') {
        try {
          const geminiDetail = await api.getGeminiSessionDetail(session.project_path, session.id);
          history = convertGeminiSessionDetailToClaudeMessages(geminiDetail);
          setHasMoreHistoryBefore(false);
        } catch (err) {
          console.error('[useSessionStream] Failed to load Gemini session:', err);
          throw err;
        }
      } else {
        // Claude/Codex 首屏只加载最近一页；更早历史通过 loadOlderSessionHistory 按需加载。
        const page = await api.loadSessionHistoryPage(
          session.id,
          session.project_id,
          engine,
          { offset: 0, limit: SESSION_HISTORY_PAGE_SIZE }
        );
        history = page.messages as ClaudeStreamMessage[];
        historyOffsetRef.current = page.nextOffset ?? history.length;
        setHasMoreHistoryBefore(Boolean(page.hasMoreBefore));
      }

      const processedMessages = convertAndNormalizeHistory(history, engine);

      // Extract model display names from init messages in history
      for (const msg of processedMessages) {
        if (msg.type === 'system' && msg.subtype === 'init' && msg.model) {
          if (engine === 'codex') {
            cacheCodexModelFromStream(msg.model);
          } else if (engine === 'gemini') {
            cacheGeminiModelFromStream(msg.model);
          } else {
            cacheModelFromInitMessage(msg.model);
          }
          break; // Only need the first init message
        }
      }

      // 竞态条件检查
      if (loadingSessionIdRef.current !== currentSessionId) {
        console.debug('[useSessionStream] Session changed during loading, discarding results');
        return;
      }

      if (!isMountedRef.current) {
        console.debug('[useSessionStream] Component unmounted during loading');
        return;
      }

      const uiOnlyMessages = loadUiOnlySessionMessages({
        sessionId: session.id,
        projectPath: session.project_path,
        engine,
      });

      // 更新状态。上游错误/完成提醒是前端 UI-only 事件：历史里可见，但不写入原生 JSONL，
      // 避免 Claude/Codex/Gemini resume 时把错误详情带回下一次模型上下文。
      setMessages(mergeUiOnlySessionMessages(processedMessages, uiOnlyMessages));
      setRawJsonlOutput(history.map(h => JSON.stringify(h)));
      setIsHistoryLoading(false);

    } catch (err) {
      console.error('[useSessionStream] Failed to load session history:', err);

      if (loadingSessionIdRef.current !== currentSessionId) return;
      if (!isMountedRef.current) return;

      const errorMessage = err instanceof Error ? err.message : String(err);
      const isSessionNotFound = errorMessage.includes('Session file not found') ||
        errorMessage.includes('not found') ||
        errorMessage.includes('Session ID not found');

      if (isSessionNotFound) {
        console.debug('[useSessionStream] Session not found (new session), continuing');
        onSessionNotFound?.();
        setIsHistoryLoading(false);
        return;
      }

      setError('加载会话历史记录失败');
      setIsHistoryLoading(false);
    }
  }, [
    session,
    isNewSessionInstance,
    isMountedRef,
    getEngine,
    convertAndNormalizeHistory,
    setIsHistoryLoading,
    setError,
    setMessages,
    setRawJsonlOutput,
    setHasMoreHistoryBefore,
    onSessionNotFound,
  ]);

  /**
   * 按需加载更早历史。只 prepend 一页旧消息，不再为了翻阅历史而把整个
   * JSONL 重新灌进 React，避免长会话打开/上翻时卡死。
   */
  const loadOlderSessionHistory = useCallback(async () => {
    if (!session) return;
    if (isNewSessionInstance) return;
    if (isLoadingOlderHistory) return;
    if (!hasMoreHistoryBeforeRef.current) return;

    const engine = getEngine();
    if (engine === 'gemini') {
      setHasMoreHistoryBefore(false);
      return;
    }

    const currentSessionId = session.id;
    const offset = historyOffsetRef.current;

    try {
      setIsLoadingOlderHistory(true);

      const page = await api.loadSessionHistoryPage(
        session.id,
        session.project_id,
        engine,
        { offset, limit: SESSION_HISTORY_PAGE_SIZE }
      );

      if (loadingSessionIdRef.current !== currentSessionId) {
        console.debug('[useSessionStream] Session changed while loading older history, discarding results');
        return;
      }

      if (!isMountedRef.current) {
        return;
      }

      const rawPageMessages = page.messages as ClaudeStreamMessage[];
      const processedMessages = convertAndNormalizeHistory(rawPageMessages, engine);

      setMessages(prev => mergeOlderHistoryMessages(prev, processedMessages));
      setRawJsonlOutput(prev => [
        ...rawPageMessages.map(message => JSON.stringify(message)),
        ...prev,
      ]);
      historyOffsetRef.current = page.nextOffset ?? offset;
      setHasMoreHistoryBefore(Boolean(page.hasMoreBefore));
    } catch (err) {
      console.error('[useSessionStream] Failed to load older session history:', err);
      if (isMountedRef.current) {
        setError('加载更早会话历史失败');
      }
    } finally {
      if (isMountedRef.current) {
        setIsLoadingOlderHistory(false);
      }
    }
  }, [
    session,
    isNewSessionInstance,
    isLoadingOlderHistory,
    getEngine,
    isMountedRef,
    convertAndNormalizeHistory,
    setMessages,
    setRawJsonlOutput,
    setHasMoreHistoryBefore,
    setError,
  ]);

  /**
   * 重新连接到会话
   */
  const reconnectToSession = useCallback(async (sessionId: string) => {
    // 防止重复监听
    if (isListeningRef.current) return;

    // 清理之前的监听器
    unlistenRefs.current.forEach(u => u && typeof u === 'function' && u());
    unlistenRefs.current = [];

    // 设置会话 ID
    setCancelSessionId?.(sessionId);
    setClaudeSessionId(sessionId);

    // 标记监听状态
    isListeningRef.current = true;

    const engine = getEngine();
    const eventPrefix = engine === 'codex' ? 'codex' : engine === 'gemini' ? 'gemini' : 'claude';
    const notificationEngine = engine === 'codex' ? 'codex' : engine === 'gemini' ? 'gemini' : 'claude';

    // 创建消息队列（新架构核心）
    messageQueueRef.current = new AsyncQueue<ClaudeStreamMessage>();

    // 监听输出（使用新的 Converter 注册中心）
    const outputUnlisten = await listen<string>(
      `${eventPrefix}-output:${sessionId}`,
      async (event) => {
        try {
          if (!isMountedRef.current) return;

          // 使用统一的转换器注册中心
          const result = converterRegistry.convertLine(event.payload, engine);
          if (result.message) {
            // Cache model display name from init messages (engine-specific)
            if (result.message.type === 'system' && result.message.subtype === 'init' && result.message.model) {
              if (engine === 'codex') {
                cacheCodexModelFromStream(result.message.model);
              } else if (engine === 'gemini') {
                cacheGeminiModelFromStream(result.message.model);
              } else {
                cacheModelFromInitMessage(result.message.model);
              }
            }
            // 加入消息队列
            messageQueueRef.current?.enqueue(result.message);
            // 处理消息（含翻译）
            await processMessage(result.message, event.payload);
          }
        } catch (err) {
          console.error('[useSessionStream] Failed to parse message:', err);
        }
      }
    );
    unlistenRefs.current.push(outputUnlisten);

    // 监听错误
    const errorUnlisten = await listen<string>(
      `${eventPrefix}-error:${sessionId}`,
      (event) => {
        console.error('[useSessionStream] Error:', event.payload);
        if (isMountedRef.current) {
          setError(event.payload);
          setIsLoading(false);
          messageQueueRef.current?.done();
          hasActiveSessionRef.current = false;
          setCancelSessionId?.(null);
          isListeningRef.current = false;
          unlistenRefs.current.forEach(u => u && typeof u === 'function' && u());
          unlistenRefs.current = [];
        }
      }
    );
    unlistenRefs.current.push(errorUnlisten);

    // 监听完成
    const completeUnlisten = await listen<boolean>(
      `${eventPrefix}-complete:${sessionId}`,
      async () => {
        if (isMountedRef.current) {
          setIsLoading(false);
          // 结束消息队列
          messageQueueRef.current?.done();
          // 重置状态
          hasActiveSessionRef.current = false;
          setCancelSessionId?.(null);
          isListeningRef.current = false;
          // 清理监听器
          unlistenRefs.current.forEach(u => u && typeof u === 'function' && u());
          unlistenRefs.current = [];
          await notifyAiExecutionComplete({
            engine: notificationEngine,
            sessionId,
            runId: sessionId,
            elapsedSeconds: getRunElapsedSeconds?.() ?? null,
            projectPath: session?.project_path ?? null,
          });
        }
      }
    );
    unlistenRefs.current.push(completeUnlisten);

    // 更新状态
    setIsLoading(true);
    hasActiveSessionRef.current = true;
    setCancelSessionId?.(sessionId);
  }, [isMountedRef, isListeningRef, hasActiveSessionRef, unlistenRefs, getEngine, setCancelSessionId, setClaudeSessionId, setError, setIsLoading, processMessage, getRunElapsedSeconds, session?.project_path]);

  /**
   * 检查活跃会话
   */
  const checkForActiveSession = useCallback(async () => {
    if (!session) return;

    // 🔧 FIX: Do not check for active sessions if this is a new session instance.
    // Reconnecting would set up duplicate event listeners and show stale state.
    if (isNewSessionInstance) {
      console.debug('[useSessionStream] Skipping checkForActiveSession - new session instance');
      return;
    }

    const engine = getEngine();
    if (engine === 'codex' || engine === 'gemini') return;

    const currentSessionId = session.id;

    try {
      const activeSessions = await api.listRunningClaudeSessions();

      if (loadingSessionIdRef.current !== currentSessionId) return;

      const activeSession = activeSessions.find((s: LegacyAny) => {
        if ('process_type' in s && s.process_type && 'ClaudeSession' in s.process_type) {
          return (s.process_type as LegacyAny).ClaudeSession.session_id === session.id;
        }
        return false;
      });

      if (activeSession) {
        hasActiveSessionRef.current = true;
        setCancelSessionId?.(session.id);
        setClaudeSessionId(session.id);
        await reconnectToSession(session.id);
      }
    } catch (err) {
      console.error('[useSessionStream] Failed to check active sessions:', err);
    }
  }, [
    session,
    isNewSessionInstance,
    getEngine,
    setCancelSessionId,
    setClaudeSessionId,
    hasActiveSessionRef,
    reconnectToSession,
  ]);

  // 清理（组件卸载时）
  useEffect(() => {
    return () => {
      messageQueueRef.current?.done();
      // 不在这里清理监听器，由组件自己清理
      // 因为 unlistenRefs 是外部传入的
    };
  }, []);

  return {
    loadSessionHistory,
    loadOlderSessionHistory,
    hasMoreHistoryBefore,
    isLoadingOlderHistory,
    checkForActiveSession,
    reconnectToSession,
    messageQueue: messageQueueRef,
  };
}
