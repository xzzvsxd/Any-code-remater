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

import { useCallback, useEffect, useRef } from 'react';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { api, type Session } from '@/lib/api';
import { normalizeUsageData } from '@/lib/utils';
import type { ClaudeStreamMessage } from '@/types/claude';
import type { CodexRateLimits } from '@/types/codex';
import {
  AsyncQueue,
  consumeYielding,
  converterRegistry,
  normalizeStreamLines,
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
  mergePendingLocalSubmittedPrompts,
  mergeUiOnlySessionMessages,
} from '@/lib/uiOnlySessionEvents';

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
  appendRawJsonlOutput: (payload: string) => void;
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
    appendRawJsonlOutput,
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
  // 重连收尾去重 + 看门狗：防止专属 complete / 全局 complete / 存活轮询三路重复收尾，
  // 并在错过 complete 事件时靠轮询进程存活兜底复位 loading（根治「切回运行中会话后卡在思考中」）。
  const reconnectFinalizedRef = useRef<string | null>(null);
  const reconnectWatchdogRef = useRef<ReturnType<typeof setInterval> | null>(null);

  /**
   * 获取引擎类型
   */
  const getEngine = useCallback((): EngineType => {
    const engine = (session as any)?.engine;
    if (engine === 'codex') return 'codex';
    if (engine === 'gemini') return 'gemini';
    return 'claude';
  }, [session]);

  /**
   * 处理消息
   */
  const processMessage = useCallback(async (
    message: ClaudeStreamMessage,
    rawPayload: string
  ) => {
    if (!isMountedRef.current) return;

    // 存储原始 JSONL
    appendRawJsonlOutput(rawPayload);

    // 通过翻译中间件处理
    await processMessageWithTranslation(message, rawPayload);
  }, [isMountedRef, appendRawJsonlOutput, processMessageWithTranslation]);

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
        } catch (err) {
          console.error('[useSessionStream] Failed to load Gemini session:', err);
          throw err;
        }
      } else {
        // Claude/Codex
        history = await api.loadSessionHistory(session.id, session.project_id, engine);

        // Codex 消息需要转换
        if (engine === 'codex') {
          codexConverter.reset();
          const converted: ClaudeStreamMessage[] = [];
          for (const event of history) {
            const msg = codexConverter.convertEventObject(event);
            if (msg) converted.push(msg);
          }
          history = converted;

          if (setCodexRateLimits) {
            setCodexRateLimits(codexConverter.getRateLimits());
          }
        }
      }

      // 过滤无效消息类型
      const validTypes = ['user', 'assistant', 'system', 'result', 'summary', 'thinking', 'tool_use'];
      const warnedTypes = new Set<string>();

      const loadedMessages: ClaudeStreamMessage[] = history
        .filter(entry => {
          const type = entry.type;
          if (type && !validTypes.includes(type)) {
            if (!warnedTypes.has(type)) {
              warnedTypes.add(type);
              console.debug('[useSessionStream] Filtering out message type:', type);
            }
            return false;
          }
          return true;
        })
        .map(entry => ({
          ...entry,
          type: entry.type || 'assistant',
        }));

      // 规范化 usage 数据
      const processedMessages = loadedMessages.map(msg => {
        if (msg.message?.usage) {
          msg.message.usage = normalizeUsageData(msg.message.usage);
        }
        if (msg.usage) {
          msg.usage = normalizeUsageData(msg.usage);
        }
        if ((msg as any).codexMetadata?.usage) {
          (msg as any).codexMetadata.usage = normalizeUsageData((msg as any).codexMetadata.usage);
        }

        // 将斜杠命令相关消息重新分类为 system
        if (msg.type === 'user') {
          const content = msg.message?.content;
          let textContent = '';

          if (typeof content === 'string') {
            textContent = content;
          } else if (Array.isArray(content)) {
            textContent = content
              .filter((item: any) => item?.type === 'text')
              .map((item: any) => item?.text || '')
              .join('\n');
          }

          const isCommandOutput = textContent.includes('<local-command-stdout>');
          const isCommandMeta = textContent.includes('<command-name>') || textContent.includes('<command-message>');
          const isCommandError = textContent.includes('Unknown slash command:');

          if (isCommandOutput || isCommandMeta || isCommandError) {
            return {
              ...msg,
              type: 'system' as const,
              subtype: isCommandOutput ? 'command-output' : isCommandError ? 'command-error' : 'command-meta',
            };
          }
        }

        return msg;
      });

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
      // 原始 JSONL 已由后端会话文件持久化；前端不再 stringify 整段 history 保留第二份副本。
      const loadedWithUiEvents = mergeUiOnlySessionMessages(processedMessages, uiOnlyMessages);
      setMessages((currentMessages) => mergePendingLocalSubmittedPrompts(loadedWithUiEvents, currentMessages));
      setRawJsonlOutput([]);
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
    setIsHistoryLoading,
    setError,
    setMessages,
    setRawJsonlOutput,
    setCodexRateLimits,
    onSessionNotFound,
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

    // 重置本次重连的收尾去重标记与看门狗（允许对同一会话再次重连后正常收尾）。
    reconnectFinalizedRef.current = null;
    if (reconnectWatchdogRef.current) {
      clearInterval(reconnectWatchdogRef.current);
      reconnectWatchdogRef.current = null;
    }

    // 设置会话 ID
    setCancelSessionId?.(sessionId);
    setClaudeSessionId(sessionId);

    // 标记监听状态
    isListeningRef.current = true;

    const engine = getEngine();
    const eventPrefix = engine === 'codex' ? 'codex' : engine === 'gemini' ? 'gemini' : 'claude';
    const notificationEngine = engine === 'codex' ? 'codex' : engine === 'gemini' ? 'gemini' : 'claude';

    // 创建消息队列（新架构核心）
    // 关键（修复 Linux/WebKit「前端卡死、后端仍在跑」）：listen 回调过去在回调体里
    // 直接 `await processMessage(...)` 同步串行处理每条消息，而 Tauri 事件回调是串行投递的
    // —— 前一条 await 未完，后续事件全堆在 event loop 里，后端「来一行 emit 一行」高频时
    // 主线程被淹没，UI/输入完全无响应。现改为：回调只做「转换 + 入队」（同步、瞬时返回），
    // 真正的处理放到下面独立的消费循环里跑，彻底解耦事件接收与消息处理/渲染。
    const queue = new AsyncQueue<ClaudeStreamMessage>();
    messageQueueRef.current = queue;

    // 队列消费循环：串行 for await 取出消息处理（保序），但不再阻塞 listen 回调。
    // 队列 done() 后循环自然结束；组件卸载时 isMountedRef 兜底跳出。
    (async () => {
      try {
        await consumeYielding(
          queue,
          (message) => processMessage(message, (message as any).__rawPayload ?? ''),
          () => isMountedRef.current,
        );
      } catch (err) {
        console.error('[useSessionStream] 消息消费循环异常:', err);
      }
    })();

    // 监听输出（使用新的 Converter 注册中心）
    // payload 协议：string（单行，旧格式）或 string[]（批量多行，后端节流合并）。
    const outputUnlisten = await listen<string | string[]>(
      `${eventPrefix}-output:${sessionId}`,
      (event) => {
        try {
          if (!isMountedRef.current) return;

          // 规整为行数组后逐行转换入队：批量到达也只是循环 enqueue（同步、瞬时），不阻塞回调。
          for (const rawLine of normalizeStreamLines(event.payload)) {
            const result = converterRegistry.convertLine(rawLine, engine);
            if (!result.message) continue;
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
            // 把原始单行 payload 挂到消息上，供消费循环存 rawJsonl（避免再开一条并行队列）。
            (result.message as any).__rawPayload = rawLine;
            // 仅入队，瞬时返回，不在回调里做任何耗时处理 —— 这是不卡死的关键。
            queue.enqueue(result.message);
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
          // 出错即视为本次重连已收尾：置去重标记并停看门狗，避免存活轮询重复触发。
          reconnectFinalizedRef.current = sessionId;
          if (reconnectWatchdogRef.current) {
            clearInterval(reconnectWatchdogRef.current);
            reconnectWatchdogRef.current = null;
          }
          unlistenRefs.current.forEach(u => u && typeof u === 'function' && u());
          unlistenRefs.current = [];
        }
      }
    );
    unlistenRefs.current.push(errorUnlisten);

    // 统一收尾：三路触发（会话专属 complete / 全局 complete 兜底 / 存活轮询看门狗）共用，
    // 用 reconnectFinalizedRef 按 sessionId 去重，保证只收尾一次。
    const finalizeReconnect = async () => {
      if (!isMountedRef.current) return;
      if (reconnectFinalizedRef.current === sessionId) return; // 已收尾
      reconnectFinalizedRef.current = sessionId;

      // 停掉看门狗
      if (reconnectWatchdogRef.current) {
        clearInterval(reconnectWatchdogRef.current);
        reconnectWatchdogRef.current = null;
      }

      setIsLoading(false);
      messageQueueRef.current?.done();
      hasActiveSessionRef.current = false;
      setCancelSessionId?.(null);
      isListeningRef.current = false;
      unlistenRefs.current.forEach(u => u && typeof u === 'function' && u());
      unlistenRefs.current = [];
      await notifyAiExecutionComplete({
        engine: notificationEngine,
        sessionId,
        runId: sessionId,
        elapsedSeconds: getRunElapsedSeconds?.() ?? null,
        projectPath: session?.project_path ?? null,
      });
    };

    // 校验该会话是否仍在后端运行列表中。查询失败返回 null（未知，调用方不据此收尾）。
    const isSessionStillRunning = async (): Promise<boolean | null> => {
      try {
        const running = await api.listRunningClaudeSessions();
        return running.some((s: any) =>
          'process_type' in s && s.process_type && 'ClaudeSession' in s.process_type &&
          (s.process_type as any).ClaudeSession.session_id === sessionId
        );
      } catch {
        return null;
      }
    };

    // 监听完成（会话专属，主路径）
    const completeUnlisten = await listen<boolean>(
      `${eventPrefix}-complete:${sessionId}`,
      () => { void finalizeReconnect(); }
    );
    unlistenRefs.current.push(completeUnlisten);

    // 🔧 兜底1：全局 complete 事件。切回「后台运行中」会话时，若会话专属 complete 在
    // 重连监听器 attach 之前就已发出（错过），前端会永久卡在「思考中」。后端在每次 complete
    // 同时 emit 全局 `${engine}-complete`（payload 形如 { tab_id, payload }）。reconnect 场景
    // 拿不到本次 run 的 tab_id，无法按 tab 精确匹配，因此这里收到全局 complete 后不直接收尾，
    // 而是校验「该会话是否已从运行列表消失」——消失才收尾，避免误杀其它会话/其它轮次。
    const globalCompleteUnlisten = await listen<{ tab_id?: string | null; payload?: boolean } | boolean>(
      `${eventPrefix}-complete`,
      async () => {
        if (!isMountedRef.current || reconnectFinalizedRef.current === sessionId) return;
        if ((await isSessionStillRunning()) === false) {
          await finalizeReconnect();
        }
      }
    );
    unlistenRefs.current.push(globalCompleteUnlisten);

    // 🔧 兜底2：进程存活看门狗。即便两路 complete 事件都错过（id 漂移 / 事件丢失），
    // 也能靠周期性校验运行列表发现「后端已结束」并主动收尾。每 5s 一次，开销可忽略。
    if (reconnectWatchdogRef.current) {
      clearInterval(reconnectWatchdogRef.current);
    }
    reconnectWatchdogRef.current = setInterval(async () => {
      if (!isMountedRef.current || reconnectFinalizedRef.current === sessionId) {
        if (reconnectWatchdogRef.current) {
          clearInterval(reconnectWatchdogRef.current);
          reconnectWatchdogRef.current = null;
        }
        return;
      }
      if ((await isSessionStillRunning()) === false) {
        await finalizeReconnect();
      }
    }, 5000);

    // 更新状态
    setIsLoading(true);
    hasActiveSessionRef.current = true;
    setCancelSessionId?.(sessionId);
  }, [
    isMountedRef,
    isListeningRef,
    hasActiveSessionRef,
    unlistenRefs,
    getEngine,
    setCancelSessionId,
    setClaudeSessionId,
    setError,
    setIsLoading,
    setIsHistoryLoading,
    processMessage,
    getRunElapsedSeconds,
    session?.project_path,
  ]);

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

      const activeSession = activeSessions.find((s: any) => {
        if ('process_type' in s && s.process_type && 'ClaudeSession' in s.process_type) {
          return (s.process_type as any).ClaudeSession.session_id === session.id;
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
      // 卸载时停掉重连存活看门狗，避免定时器泄漏与卸载后误触发。
      if (reconnectWatchdogRef.current) {
        clearInterval(reconnectWatchdogRef.current);
        reconnectWatchdogRef.current = null;
      }
      // 不在这里清理监听器，由组件自己清理
      // 因为 unlistenRefs 是外部传入的
    };
  }, []);

  return {
    loadSessionHistory,
    checkForActiveSession,
    reconnectToSession,
    messageQueue: messageQueueRef,
  };
}
