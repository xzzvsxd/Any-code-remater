import React from "react";
import type { ClaudeStreamMessage } from "@/types/claude";
import {
  createBatchedAppendUpdater,
  createBatchedTailUpdater,
  createBatchedUpdater,
  type TailUpdateResult,
} from "@/lib/stream/batchedStateUpdater";
import { normalizeMessageContentShape, normalizeMessagesContentShape } from '@/lib/messageContentAccess';
import { preserveAssistantThinkingOnTailReplace } from '@/lib/assistantThinkingPreservation';

export interface ToolResultEntry {
  toolUseId: string;
  content?: any;
  isError?: boolean;
  sourceMessage?: ClaudeStreamMessage;
}

export interface MessageFilterConfig {
  hideWarmupMessages: boolean;
}

// ✅ 性能优化: 拆分为数据和操作两个 Context
// 这样只使用操作函数的组件不会因数据更新而重渲染

interface MessagesDataContextValue {
  messages: ClaudeStreamMessage[];
  isStreaming: boolean;
  filterConfig: MessageFilterConfig;
  toolResults: Map<string, ToolResultEntry>;
  taskSubjectLookup: Map<string, string>;
}

interface MessagesActionsContextValue {
  setMessages: React.Dispatch<React.SetStateAction<ClaudeStreamMessage[]>>;
  appendMessage: (message: ClaudeStreamMessage) => void;
  appendMessageImmediate: (message: ClaudeStreamMessage) => void;
  appendMessages: (messages: ClaudeStreamMessage[]) => void;
  replaceLastMessage: (
    updater: (lastMessage: ClaudeStreamMessage | undefined) => TailUpdateResult<ClaudeStreamMessage>
  ) => void;
  setIsStreaming: React.Dispatch<React.SetStateAction<boolean>>;
  setFilterConfig: React.Dispatch<React.SetStateAction<MessageFilterConfig>>;
}

const MessagesDataContext = React.createContext<MessagesDataContextValue | undefined>(undefined);
const MessagesActionsContext = React.createContext<MessagesActionsContextValue | undefined>(undefined);
const MessagesToolResultsContext = React.createContext<Map<string, ToolResultEntry> | undefined>(undefined);
const MessagesTaskLookupContext = React.createContext<Map<string, string> | undefined>(undefined);
const EMPTY_TOOL_RESULTS = new Map<string, ToolResultEntry>();
const EMPTY_TASK_SUBJECT_LOOKUP = new Map<string, string>();

const hasToolResultContent = (msg: ClaudeStreamMessage): boolean => {
  const content = msg.message?.content;
  return Array.isArray(content) && content.some((item: any) => item?.type === "tool_result" && item.tool_use_id);
};

const appendToolResultsFromMessage = (
  results: Map<string, ToolResultEntry>,
  msg: ClaudeStreamMessage,
): string[] => {
  const content = msg.message?.content;
  if (!Array.isArray(content)) return [];

  const ids: string[] = [];
  content.forEach((item: any) => {
    if (item && item.type === "tool_result" && item.tool_use_id) {
      ids.push(item.tool_use_id);
      results.set(item.tool_use_id, {
        toolUseId: item.tool_use_id,
        content: item.content ?? item.result ?? item,
        isError: Boolean(item.is_error),
        sourceMessage: msg,
      });
    }
  });
  return ids;
};

const buildToolResultMap = (
  messages: ClaudeStreamMessage[],
): {
  results: Map<string, ToolResultEntry>;
  lastToolResultIds: string[];
} => {
  const results = new Map<string, ToolResultEntry>();
  let lastToolResultIds: string[] = [];
  messages.forEach((msg, index) => {
    const ids = appendToolResultsFromMessage(results, msg);
    if (index === messages.length - 1) {
      lastToolResultIds = ids;
    }
  });
  return { results, lastToolResultIds };
};

interface ToolResultMapCache {
  messages: ClaudeStreamMessage[];
  processedLength: number;
  firstMessage?: ClaudeStreamMessage;
  secondLastProcessedMessage?: ClaudeStreamMessage;
  lastProcessedMessage?: ClaudeStreamMessage;
  lastToolResultIds: string[];
  results: Map<string, ToolResultEntry>;
}

const TASK_CREATE_TOOL_RE = /^TaskCreate$/i;

const getMessageContentBlocks = (msg: ClaudeStreamMessage): any[] | null => {
  const content = msg.message?.content;
  return Array.isArray(content) ? content : null;
};

const hasTaskLookupContent = (msg: ClaudeStreamMessage): boolean => {
  const content = getMessageContentBlocks(msg);
  if (!content) return false;

  return content.some((block: any) => {
    if (!block || typeof block !== "object") return false;
    if (block.type === "tool_use" && TASK_CREATE_TOOL_RE.test(block.name) && block.input?.subject) {
      return true;
    }
    return block.type === "tool_result" && Boolean(block.tool_use_id);
  });
};

const extractTaskIdFromResultBlock = (block: any, msg: ClaudeStreamMessage): string | null => {
  const contentStr = typeof block.content === "string" ? block.content : "";
  const match = contentStr.match(/#(\d+)/);
  if (match) {
    return match[1];
  }

  const taskId = (msg as any).toolUseResult?.task?.id;
  return taskId == null ? null : String(taskId);
};

const appendTaskSubjectLookupFromMessage = (
  toolUseSubjects: Map<string, string>,
  taskSubjectLookup: Map<string, string>,
  msg: ClaudeStreamMessage,
): void => {
  const content = getMessageContentBlocks(msg);
  if (!content) return;

  for (const block of content) {
    if (!block || typeof block !== "object") continue;

    if (block.type === "tool_use" && TASK_CREATE_TOOL_RE.test(block.name) && block.id) {
      const subject = block.input?.subject;
      if (subject) {
        toolUseSubjects.set(block.id, String(subject));
      }
      continue;
    }

    if (block.type === "tool_result" && block.tool_use_id) {
      const subject = toolUseSubjects.get(block.tool_use_id);
      if (!subject) continue;

      const taskId = extractTaskIdFromResultBlock(block, msg);
      if (taskId) {
        taskSubjectLookup.set(taskId, subject);
      }
    }
  }
};

const buildTaskSubjectLookupMap = (
  messages: ClaudeStreamMessage[],
): {
  taskSubjectLookup: Map<string, string>;
  toolUseSubjects: Map<string, string>;
  lastTaskLookupTouched: boolean;
} => {
  const taskSubjectLookup = new Map<string, string>();
  const toolUseSubjects = new Map<string, string>();
  let lastTaskLookupTouched = false;

  messages.forEach((msg, index) => {
    const touched = hasTaskLookupContent(msg);
    if (touched) {
      appendTaskSubjectLookupFromMessage(toolUseSubjects, taskSubjectLookup, msg);
    }
    if (index === messages.length - 1) {
      lastTaskLookupTouched = touched;
    }
  });

  return { taskSubjectLookup, toolUseSubjects, lastTaskLookupTouched };
};

interface TaskSubjectLookupCache {
  messages: ClaudeStreamMessage[];
  processedLength: number;
  firstMessage?: ClaudeStreamMessage;
  secondLastProcessedMessage?: ClaudeStreamMessage;
  lastProcessedMessage?: ClaudeStreamMessage;
  lastTaskLookupTouched: boolean;
  toolUseSubjects: Map<string, string>;
  taskSubjectLookup: Map<string, string>;
}

interface MessagesProviderProps {
  initialMessages?: ClaudeStreamMessage[];
  initialIsStreaming?: boolean;
  initialFilterConfig?: Partial<MessageFilterConfig>;
  deriveToolResults?: boolean;
  children: React.ReactNode;
}

const defaultFilterConfig: MessageFilterConfig = {
  hideWarmupMessages: true,
};

export const MessagesProvider: React.FC<MessagesProviderProps> = ({
  initialMessages = [],
  initialIsStreaming = false,
  initialFilterConfig,
  deriveToolResults = true,
  children,
}) => {
  const [messages, setMessages] = React.useState<ClaudeStreamMessage[]>(() =>
    normalizeMessagesContentShape(initialMessages),
  );
  const [isStreaming, setIsStreaming] = React.useState<boolean>(initialIsStreaming);
  const [filterConfig, setFilterConfig] = React.useState<MessageFilterConfig>({
    hideWarmupMessages:
      initialFilterConfig?.hideWarmupMessages !== undefined
        ? initialFilterConfig.hideWarmupMessages
        : defaultFilterConfig.hideWarmupMessages,
  });

  const toolResultCacheRef = React.useRef<ToolResultMapCache | null>(null);
  const toolResults = React.useMemo(() => {
    if (!deriveToolResults) {
      return EMPTY_TOOL_RESULTS;
    }

    const cache = toolResultCacheRef.current;
    const canReplaceLastMessageOnly =
      cache !== null &&
      messages.length === cache.processedLength &&
      messages.length > 0 &&
      (messages.length === 1 || messages[messages.length - 2] === cache.secondLastProcessedMessage) &&
      (messages.length === 1 || cache.firstMessage === undefined || messages[0] === cache.firstMessage) &&
      messages[messages.length - 1] !== cache.lastProcessedMessage;

    if (canReplaceLastMessageOnly) {
      let nextResults = cache.results;
      let lastToolResultIds: string[] = [];
      if (cache.lastToolResultIds.length > 0 || hasToolResultContent(messages[messages.length - 1])) {
        nextResults = new Map(cache.results);
        for (const id of cache.lastToolResultIds) {
          nextResults.delete(id);
        }
        lastToolResultIds = appendToolResultsFromMessage(nextResults, messages[messages.length - 1]);
      }
      cache.messages = messages;
      cache.processedLength = messages.length;
      cache.firstMessage = messages[0];
      cache.secondLastProcessedMessage = messages.length >= 2 ? messages[messages.length - 2] : undefined;
      cache.lastProcessedMessage = messages[messages.length - 1];
      cache.lastToolResultIds = lastToolResultIds;
      cache.results = nextResults;
      return cache.results;
    }

    const canExtendAppendOnly =
      cache !== null &&
      messages.length >= cache.processedLength &&
      (cache.processedLength === 0 ||
        messages[cache.processedLength - 1] === cache.lastProcessedMessage) &&
      (cache.firstMessage === undefined || messages[0] === cache.firstMessage);

    if (canExtendAppendOnly) {
      let lastToolResultIds = cache.lastToolResultIds;
      let nextResults = cache.results;
      for (let index = cache.processedLength; index < messages.length; index++) {
        let ids: string[] = [];
        if (hasToolResultContent(messages[index])) {
          if (nextResults === cache.results) {
            nextResults = new Map(cache.results);
          }
          ids = appendToolResultsFromMessage(nextResults, messages[index]);
        }
        if (index === messages.length - 1) {
          lastToolResultIds = ids;
        }
      }
      cache.messages = messages;
      cache.processedLength = messages.length;
      cache.firstMessage = messages[0];
      cache.secondLastProcessedMessage = messages.length >= 2 ? messages[messages.length - 2] : undefined;
      cache.lastProcessedMessage = messages[messages.length - 1];
      cache.lastToolResultIds = lastToolResultIds;
      cache.results = nextResults;
      return cache.results;
    }

    const rebuilt = buildToolResultMap(messages);
    toolResultCacheRef.current = {
      messages,
      processedLength: messages.length,
      firstMessage: messages[0],
      secondLastProcessedMessage: messages.length >= 2 ? messages[messages.length - 2] : undefined,
      lastProcessedMessage: messages[messages.length - 1],
      lastToolResultIds: rebuilt.lastToolResultIds,
      results: rebuilt.results,
    };
    return rebuilt.results;
  }, [deriveToolResults, messages]);

  const taskSubjectLookupCacheRef = React.useRef<TaskSubjectLookupCache | null>(null);
  const taskSubjectLookup = React.useMemo(() => {
    if (!deriveToolResults) {
      return EMPTY_TASK_SUBJECT_LOOKUP;
    }

    const cache = taskSubjectLookupCacheRef.current;
    const canReplaceLastMessageOnly =
      cache !== null &&
      messages.length === cache.processedLength &&
      messages.length > 0 &&
      (messages.length === 1 || messages[messages.length - 2] === cache.secondLastProcessedMessage) &&
      (messages.length === 1 || cache.firstMessage === undefined || messages[0] === cache.firstMessage) &&
      messages[messages.length - 1] !== cache.lastProcessedMessage;

    if (canReplaceLastMessageOnly) {
      const newLastTouched = hasTaskLookupContent(messages[messages.length - 1]);
      if (!cache.lastTaskLookupTouched && !newLastTouched) {
        cache.messages = messages;
        cache.processedLength = messages.length;
        cache.firstMessage = messages[0];
        cache.secondLastProcessedMessage = messages.length >= 2 ? messages[messages.length - 2] : undefined;
        cache.lastProcessedMessage = messages[messages.length - 1];
        cache.lastTaskLookupTouched = false;
        return cache.taskSubjectLookup;
      }

      // TaskCreate/TaskResult can mutate both toolUseId→subject and taskId→subject maps.
      // Tail replacement involving those blocks is rare; rebuild narrowly here to avoid
      // keeping stale task IDs/subjects while preserving the hot no-task streaming path.
      const rebuilt = buildTaskSubjectLookupMap(messages);
      taskSubjectLookupCacheRef.current = {
        messages,
        processedLength: messages.length,
        firstMessage: messages[0],
        secondLastProcessedMessage: messages.length >= 2 ? messages[messages.length - 2] : undefined,
        lastProcessedMessage: messages[messages.length - 1],
        lastTaskLookupTouched: rebuilt.lastTaskLookupTouched,
        toolUseSubjects: rebuilt.toolUseSubjects,
        taskSubjectLookup: rebuilt.taskSubjectLookup,
      };
      return rebuilt.taskSubjectLookup;
    }

    const canExtendAppendOnly =
      cache !== null &&
      messages.length >= cache.processedLength &&
      (cache.processedLength === 0 ||
        messages[cache.processedLength - 1] === cache.lastProcessedMessage) &&
      (cache.firstMessage === undefined || messages[0] === cache.firstMessage);

    if (canExtendAppendOnly) {
      let nextToolUseSubjects = cache.toolUseSubjects;
      let nextTaskSubjectLookup = cache.taskSubjectLookup;
      let lastTaskLookupTouched = cache.lastTaskLookupTouched;

      for (let index = cache.processedLength; index < messages.length; index++) {
        const touched = hasTaskLookupContent(messages[index]);
        if (touched) {
          if (nextTaskSubjectLookup === cache.taskSubjectLookup) {
            nextTaskSubjectLookup = new Map(cache.taskSubjectLookup);
            nextToolUseSubjects = new Map(cache.toolUseSubjects);
          }
          appendTaskSubjectLookupFromMessage(nextToolUseSubjects, nextTaskSubjectLookup, messages[index]);
        }
        if (index === messages.length - 1) {
          lastTaskLookupTouched = touched;
        }
      }

      cache.messages = messages;
      cache.processedLength = messages.length;
      cache.firstMessage = messages[0];
      cache.secondLastProcessedMessage = messages.length >= 2 ? messages[messages.length - 2] : undefined;
      cache.lastProcessedMessage = messages[messages.length - 1];
      cache.lastTaskLookupTouched = lastTaskLookupTouched;
      cache.toolUseSubjects = nextToolUseSubjects;
      cache.taskSubjectLookup = nextTaskSubjectLookup;
      return cache.taskSubjectLookup;
    }

    const rebuilt = buildTaskSubjectLookupMap(messages);
    taskSubjectLookupCacheRef.current = {
      messages,
      processedLength: messages.length,
      firstMessage: messages[0],
      secondLastProcessedMessage: messages.length >= 2 ? messages[messages.length - 2] : undefined,
      lastProcessedMessage: messages[messages.length - 1],
      lastTaskLookupTouched: rebuilt.lastTaskLookupTouched,
      toolUseSubjects: rebuilt.toolUseSubjects,
      taskSubjectLookup: rebuilt.taskSubjectLookup,
    };
    return rebuilt.taskSubjectLookup;
  }, [deriveToolResults, messages]);

  // 🚀 性能（修复 Linux/WebKit streaming 渲染风暴）：streaming 期间每条消息一次 setMessages
  // → 全量重渲染 + 虚拟列表重测，高频时主线程被打满。这里把对外暴露的 setMessages 包一层
  // rAF 批量合并器：一帧内的多次「函数式更新」折叠成一次 setState（N 条消息 → 1 次渲染）。
  // - 函数式更新器(prev => next)：入队，下一帧合并 flush。
  // - 直接赋值/数组(重置、历史加载)：先排空挂起队列再同步应用，避免与待应用增量乱序。
  const rawSetMessagesRef = React.useRef(setMessages);
  rawSetMessagesRef.current = setMessages;
  const batchedRef = React.useRef<ReturnType<typeof createBatchedUpdater<ClaudeStreamMessage[]>>>();
  if (!batchedRef.current) {
    batchedRef.current = createBatchedUpdater<ClaudeStreamMessage[]>((updater) =>
      rawSetMessagesRef.current(updater),
    );
  }
  const appendBatchedRef = React.useRef<ReturnType<typeof createBatchedAppendUpdater<ClaudeStreamMessage>>>();
  if (!appendBatchedRef.current) {
    appendBatchedRef.current = createBatchedAppendUpdater<ClaudeStreamMessage>((updater) =>
      rawSetMessagesRef.current(updater),
    );
  }
  const tailBatchedRef = React.useRef<ReturnType<typeof createBatchedTailUpdater<ClaudeStreamMessage>>>();
  if (!tailBatchedRef.current) {
    tailBatchedRef.current = createBatchedTailUpdater<ClaudeStreamMessage>((updater) =>
      rawSetMessagesRef.current(updater),
    );
  }
  React.useEffect(() => () => {
    batchedRef.current?.dispose();
    appendBatchedRef.current?.dispose();
    tailBatchedRef.current?.dispose();
  }, []);

  const batchedSetMessages = React.useCallback<
    React.Dispatch<React.SetStateAction<ClaudeStreamMessage[]>>
  >((action) => {
    const batched = batchedRef.current!;
    const appendBatched = appendBatchedRef.current!;
    const tailBatched = tailBatchedRef.current!;
    if (typeof action === "function") {
      // 通用函数式更新可能依赖当前完整数组；先排空 append-only / tail 队列，保持调用顺序。
      appendBatched.flushNow();
      tailBatched.flushNow();
      batched.enqueue((prev) =>
        normalizeMessagesContentShape((action as (prev: ClaudeStreamMessage[]) => ClaudeStreamMessage[])(prev)),
      );
    } else {
      // 直接赋值（重置/历史加载/清空）：先 flush 挂起的增量，再同步覆盖，保证最终状态正确。
      batched.flushNow();
      appendBatched.flushNow();
      tailBatched.flushNow();
      rawSetMessagesRef.current(normalizeMessagesContentShape(action));
    }
  }, []);

  const appendMessage = React.useCallback((message: ClaudeStreamMessage) => {
    const normalizedMessage = normalizeMessageContentShape(message);
    // append-only 更新排在任何已入队通用/tail 更新之后，避免流式 delta/merge 与 append 乱序。
    batchedRef.current!.flushNow();
    tailBatchedRef.current!.flushNow();
    appendBatchedRef.current!.enqueue(normalizedMessage);
  }, []);

  const appendMessageImmediate = React.useCallback((message: ClaudeStreamMessage) => {
    const normalizedMessage = normalizeMessageContentShape(message);
    // 用户刚提交的 prompt 必须同步进入 UI。若继续走 rAF append 队列，极端时序下后续
    // history/reset 直接 setMessages 可能覆盖尚未 flush 的 optimistic user message，
    // 表现为“prompt 已发送但偶发不显示”。streaming 输出仍走 appendMessage 批处理。
    batchedRef.current!.flushNow();
    appendBatchedRef.current!.flushNow();
    tailBatchedRef.current!.flushNow();
    rawSetMessagesRef.current((prev) => prev.concat(normalizedMessage));
  }, []);

  const appendMessages = React.useCallback((messages: ClaudeStreamMessage[]) => {
    if (messages.length === 0) return;
    const normalizedMessages = normalizeMessagesContentShape(messages);
    batchedRef.current!.flushNow();
    tailBatchedRef.current!.flushNow();
    appendBatchedRef.current!.enqueueAll(normalizedMessages);
  }, []);

  const replaceLastMessage = React.useCallback((
    updater: (lastMessage: ClaudeStreamMessage | undefined) => TailUpdateResult<ClaudeStreamMessage>,
  ) => {
    // tail replacement 专用于同长度流式 delta。先排空通用/append 队列，确保 updater 看到最新末项；
    // 后续同帧多个 tail updater 则由 createBatchedTailUpdater 合并为一次数组拷贝。
    batchedRef.current!.flushNow();
    appendBatchedRef.current!.flushNow();
    tailBatchedRef.current!.enqueue((lastMessage) => {
      const result = updater(lastMessage);
      if (!result || result.type === 'none') {
        return { type: 'none' };
      }
      const normalizedItem = normalizeMessageContentShape(result.item);
      return {
        ...result,
        item: result.type === 'replace'
          ? preserveAssistantThinkingOnTailReplace(lastMessage, normalizedItem)
          : normalizedItem,
      };
    });
  }, []);

  // ✅ 性能优化: 操作函数独立缓存，确保引用稳定
  const actionsValue = React.useMemo<MessagesActionsContextValue>(
    () => ({
      setMessages: batchedSetMessages,
      appendMessage,
      appendMessageImmediate,
      appendMessages,
      replaceLastMessage,
      setIsStreaming,
      setFilterConfig,
    }),
    [batchedSetMessages, appendMessage, appendMessageImmediate, appendMessages, replaceLastMessage, setIsStreaming, setFilterConfig]
  );

  // ✅ 性能优化: 数据独立缓存
  const dataValue = React.useMemo<MessagesDataContextValue>(
    () => ({
      messages,
      isStreaming,
      filterConfig,
      toolResults,
      taskSubjectLookup,
    }),
    [messages, isStreaming, filterConfig, toolResults, taskSubjectLookup]
  );

  return (
    <MessagesActionsContext.Provider value={actionsValue}>
      <MessagesToolResultsContext.Provider value={toolResults}>
        <MessagesTaskLookupContext.Provider value={taskSubjectLookup}>
          <MessagesDataContext.Provider value={dataValue}>
            {children}
          </MessagesDataContext.Provider>
        </MessagesTaskLookupContext.Provider>
      </MessagesToolResultsContext.Provider>
    </MessagesActionsContext.Provider>
  );
};

// ✅ 性能优化: 只获取数据的 Hook（数据更新时会重渲染）
export const useMessagesData = (): MessagesDataContextValue => {
  const context = React.useContext(MessagesDataContext);
  if (!context) {
    throw new Error("useMessagesData must be used within a MessagesProvider");
  }
  return context;
};

// ✅ 性能优化: 只获取操作函数的 Hook（数据更新时不会重渲染）
export const useMessagesActions = (): MessagesActionsContextValue => {
  const context = React.useContext(MessagesActionsContext);
  if (!context) {
    throw new Error("useMessagesActions must be used within a MessagesProvider");
  }
  return context;
};

// ✅ 性能优化: 工具结果独立 Context，避免 ToolCallsGroup 随每条 streaming message append 重渲染
export const useMessagesToolResults = (): Map<string, ToolResultEntry> => {
  const context = React.useContext(MessagesToolResultsContext);
  if (!context) {
    throw new Error("useMessagesToolResults must be used within a MessagesProvider");
  }
  return context;
};

// ✅ 性能优化: Task 管理 widget 只订阅 taskId→subject 查找表，避免每帧扫描完整 messages
export const useTaskSubjectLookup = (): Map<string, string> => {
  const context = React.useContext(MessagesTaskLookupContext);
  if (!context) {
    throw new Error("useTaskSubjectLookup must be used within a MessagesProvider");
  }
  return context;
};

// ✅ 兼容性: 保留原有 API，同时获取数据和操作
// 建议新代码使用 useMessagesData 或 useMessagesActions
export const useMessagesContext = () => {
  const data = useMessagesData();
  const actions = useMessagesActions();
  return { ...data, ...actions };
};

MessagesProvider.displayName = "MessagesProvider";


