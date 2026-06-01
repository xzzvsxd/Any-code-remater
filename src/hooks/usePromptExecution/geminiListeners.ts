import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { api } from '@/lib/api';
import type { ClaudeStreamMessage } from '@/types/claude';

type EngineGlobalEventPayload<T> = { tab_id?: string | null; payload: T } | T;

interface PendingPromptRecord {
  sessionId: string;
  projectPath: string;
  promptIndex: number;
  promptText: string;
}

interface PendingPromptInfo {
  sessionId?: string | null;
  projectPath: string;
  promptIndex?: number;
  promptText: string;
}

interface GeminiPromptListenerContext {
  projectPath: string;
  isUserInitiated: boolean;
  geminiPendingInfo: PendingPromptInfo | null;
  isMountedRef: React.MutableRefObject<boolean>;
  hasActiveSessionRef: React.MutableRefObject<boolean>;
  isListeningRef: React.MutableRefObject<boolean>;
  unlistenRefs: React.MutableRefObject<UnlistenFn[]>;
  setMessages: React.Dispatch<React.SetStateAction<ClaudeStreamMessage[]>>;
  setRawJsonlOutput: React.Dispatch<React.SetStateAction<string[]>>;
  setIsLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  setClaudeSessionId: (id: string | null) => void;
  setExtractedSessionInfo: React.Dispatch<React.SetStateAction<{ sessionId: string; projectId: string; engine?: 'claude' | 'codex' | 'gemini' } | null>>;
  setIsFirstPrompt: (isFirst: boolean) => void;
  bindCancelSessionId: (sessionId: string | null) => void;
  resetRuntimeState: () => void;
  runNextQueuedPrompt: () => void;
  notifyCompletionIfIdle: (engine: 'gemini', completedSessionId: string | null) => Promise<void>;
  appendExecutionSystemMessage: (kind: 'execution-error', engine: 'gemini', title: string, detail: string) => void;
  normalizeEngineGlobalPayload: <T>(payload: EngineGlobalEventPayload<T>) => { tabId: string | null; payload: T };
  isCurrentRunEventTab: (eventTabId: string | null) => boolean;
  getGeminiPendingPromptRecord: () => PendingPromptRecord | null;
  setGeminiPendingPromptRecord: (record: PendingPromptRecord | null) => void;
}

export async function setupGeminiPromptListeners(context: GeminiPromptListenerContext): Promise<void> {
  const {
    projectPath,
    isUserInitiated,
    geminiPendingInfo,
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
    notifyCompletionIfIdle,
    appendExecutionSystemMessage,
    normalizeEngineGlobalPayload,
    isCurrentRunEventTab,
    getGeminiPendingPromptRecord,
    setGeminiPendingPromptRecord,
  } = context;

  // ====================================================================
  // 🆕 Gemini Event Listeners
  // ====================================================================

  // 🔧 Track current Gemini session ID for channel isolation
  let currentGeminiSessionId: string | null = null;
  // 🔧 Track processed message IDs to prevent duplicates
  const processedGeminiMessages = new Set<string>();
  // 🔧 FIX: Track pending prompt recording Promise to avoid race condition
  let pendingGeminiPromptRecordingPromise: Promise<void> | null = null;

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
  const convertGeminiToClaudeMessage = (data: LegacyAny): ClaudeStreamMessage | null => {
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
          const processedContent = content.map((item: LegacyAny) => {
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
  const processGeminiOutput = (payload: string) => {
    if (!isMountedRef.current) return;

    // 🔧 FIX: Deduplicate messages
    const messageId = getGeminiMessageId(payload);
    if (processedGeminiMessages.has(messageId)) {
      return;
    }
    processedGeminiMessages.add(messageId);

    try {
      const data = JSON.parse(payload);

      // 🔧 FIX: Skip user messages from Gemini - already added by frontend
      // Gemini CLI echoes back user messages, but we already display them
      const hasToolResult = data.message?.content?.some((c: LegacyAny) => c.type === 'tool_result');
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
        setMessages(prev => {
          const lastIdx = prev.length - 1;
          const lastMsg = prev[lastIdx];

          // Check if last message is assistant and can be merged
          if (lastMsg && lastMsg.type === 'assistant') {
            const lastContent = lastMsg.message?.content;
            const newContent = data.message?.content;

            if (Array.isArray(lastContent) && Array.isArray(newContent)) {
              const updatedContent = [...lastContent];
              let merged = false;

              // Process each item in new content
              for (const newItem of newContent) {
                if (newItem.type === 'text') {
                  // Merge text with existing text block
                  const lastTextIdx = updatedContent.findIndex((c: LegacyAny) => c.type === 'text');
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
                const updatedMsg = {
                  ...lastMsg,
                  message: {
                    ...lastMsg.message,
                    content: updatedContent
                  }
                };

                return [...prev.slice(0, lastIdx), updatedMsg];
              }
            }
          }

          // Cannot merge, add as new message
          const message = convertGeminiToClaudeMessage(data);
          return message ? [...prev, message] : prev;
        });
        setRawJsonlOutput((prev) => [...prev, payload]);
        return;
      }

      // Non-delta message - add normally
      const message = convertGeminiToClaudeMessage(data);

      if (message) {
        setMessages(prev => [...prev, message]);
        setRawJsonlOutput((prev) => [...prev, payload]);

        // 🔧 NOTE: Session ID handling moved to gemini-cli-session-id event listener
        // The init message from gemini-output may contain backend's temporary ID (gemini-{uuid})
        // We now use the dedicated gemini-cli-session-id event which provides the REAL CLI session ID
      }
    } catch (err) {
      console.error('[usePromptExecution] Failed to process Gemini output:', err, payload);
    }
  };

  // Helper function to process Gemini completion
  const processGeminiComplete = async () => {
    const completedSessionId = currentGeminiSessionId || getGeminiPendingPromptRecord()?.sessionId || null;
    setIsLoading(false);
    hasActiveSessionRef.current = false;
    bindCancelSessionId(null);
    isListeningRef.current = false;

    // Clean up listeners
    unlistenRefs.current.forEach(u => u && typeof u === 'function' && u());
    unlistenRefs.current = [];

    // 🔧 FIX: Wait for pending prompt recording to complete (race condition fix)
    if (pendingGeminiPromptRecordingPromise) {
      await pendingGeminiPromptRecordingPromise;
      pendingGeminiPromptRecordingPromise = null;
    }

    // 🆕 Record prompt completion for rewind support
    const pendingPrompt = getGeminiPendingPromptRecord();
      if (pendingPrompt) {
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
      setGeminiPendingPromptRecord(null);
    }

    // Clear pending session
    await notifyCompletionIfIdle('gemini', completedSessionId);

    // Process queued prompts
    runNextQueuedPrompt();
  };

  const processGeminiError = (payload: string) => {
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
    setGeminiPendingPromptRecord(null);
    pendingGeminiPromptRecordingPromise = null;
  };

  // Helper function to attach session-specific listeners
  const attachGeminiSessionListeners = async (sessionId: string) => {
    const specificOutputUnlisten = await listen<string>(`gemini-output:${sessionId}`, (evt) => {
      processGeminiOutput(evt.payload);
    });

    const specificCompleteUnlisten = await listen<boolean>(`gemini-complete:${sessionId}`, async () => {

      await processGeminiComplete();
    });

    const specificErrorUnlisten = await listen<string>(`gemini-error:${sessionId}`, (evt) => {
      processGeminiError(evt.payload);
    });

    // 🔧 FIX: Append session-specific listeners instead of replacing all
    // This preserves global listeners like geminiCliSessionIdUnlisten
    unlistenRefs.current.push(specificOutputUnlisten, specificCompleteUnlisten, specificErrorUnlisten);
  };

  // Listen for session init event (backend emits this with backend channel ID)
  const geminiSessionInitUnlisten = await listen<EngineGlobalEventPayload<LegacyAny>>('gemini-session-init', async (evt) => {
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
  });

  // 🔧 FIX: Listen for real Gemini CLI session ID (emitted when CLI returns init event)
  // This is the REAL session ID that should be used for prompt recording
  const geminiCliSessionIdUnlisten = await listen<EngineGlobalEventPayload<{ backend_session_id: string; cli_session_id: string }>>('gemini-cli-session-id', async (evt) => {
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
          setGeminiPendingPromptRecord({
            sessionId: realCliSessionId,
            projectPath,
            promptIndex: idx,
            promptText: geminiPendingInfo.promptText
          });
        })
        .catch(err => {
          console.warn('[Gemini Revert] Failed to record prompt with real CLI session ID:', err);
        });
    }

    // Store pending session info with real CLI session ID
    if (geminiPendingInfo) {
      geminiPendingInfo.sessionId = realCliSessionId;
    }
  });

  // 🔧 FIX: 移除全局监听器,避免跨会话串流
  // Listen for Gemini output (global fallback) - FIXED to prevent cross-session data leakage
  const geminiOutputUnlisten = await listen<EngineGlobalEventPayload<string>>('gemini-output', (evt) => {
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
    processGeminiOutput(payload);
  });

  // Listen for Gemini errors
  const geminiErrorUnlisten = await listen<EngineGlobalEventPayload<string>>('gemini-error', (evt) => {
    if (!hasActiveSessionRef.current) return;
    const { tabId: eventTabId, payload } = normalizeEngineGlobalPayload(evt.payload);
    if (!isCurrentRunEventTab(eventTabId)) {
      return;
    }
    processGeminiError(payload);
  });

  // 🔧 FIX: 移除全局完成事件监听器,避免跨会话串流
  // Listen for Gemini completion (global fallback) - FIXED to prevent cross-session interference
  const geminiCompleteUnlisten = await listen<EngineGlobalEventPayload<boolean>>('gemini-complete', async (evt) => {
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

    await processGeminiComplete();
  });

  unlistenRefs.current = [geminiSessionInitUnlisten, geminiCliSessionIdUnlisten, geminiOutputUnlisten, geminiErrorUnlisten, geminiCompleteUnlisten];
}
