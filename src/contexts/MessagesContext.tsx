import React from "react";
import type { ClaudeStreamMessage } from "@/types/claude";
import { createBatchedAppendUpdater, createBatchedUpdater } from "@/lib/stream/batchedStateUpdater";

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
}

interface MessagesActionsContextValue {
  setMessages: React.Dispatch<React.SetStateAction<ClaudeStreamMessage[]>>;
  appendMessage: (message: ClaudeStreamMessage) => void;
  appendMessages: (messages: ClaudeStreamMessage[]) => void;
  setIsStreaming: React.Dispatch<React.SetStateAction<boolean>>;
  setFilterConfig: React.Dispatch<React.SetStateAction<MessageFilterConfig>>;
}

const MessagesDataContext = React.createContext<MessagesDataContextValue | undefined>(undefined);
const MessagesActionsContext = React.createContext<MessagesActionsContextValue | undefined>(undefined);

const buildToolResultMap = (messages: ClaudeStreamMessage[]): Map<string, ToolResultEntry> => {
  const results = new Map<string, ToolResultEntry>();

  messages.forEach((msg) => {
    const content = msg.message?.content;

    if (Array.isArray(content)) {
      content.forEach((item: any) => {
        if (item && item.type === "tool_result" && item.tool_use_id) {
          results.set(item.tool_use_id, {
            toolUseId: item.tool_use_id,
            content: item.content ?? item.result ?? item,
            isError: Boolean(item.is_error),
            sourceMessage: msg,
          });
        }
      });
    }
  });

  return results;
};

interface MessagesProviderProps {
  initialMessages?: ClaudeStreamMessage[];
  initialIsStreaming?: boolean;
  initialFilterConfig?: Partial<MessageFilterConfig>;
  children: React.ReactNode;
}

const defaultFilterConfig: MessageFilterConfig = {
  hideWarmupMessages: true,
};

export const MessagesProvider: React.FC<MessagesProviderProps> = ({
  initialMessages = [],
  initialIsStreaming = false,
  initialFilterConfig,
  children,
}) => {
  const [messages, setMessages] = React.useState<ClaudeStreamMessage[]>(initialMessages);
  const [isStreaming, setIsStreaming] = React.useState<boolean>(initialIsStreaming);
  const [filterConfig, setFilterConfig] = React.useState<MessageFilterConfig>({
    hideWarmupMessages:
      initialFilterConfig?.hideWarmupMessages !== undefined
        ? initialFilterConfig.hideWarmupMessages
        : defaultFilterConfig.hideWarmupMessages,
  });

  const toolResults = React.useMemo(() => buildToolResultMap(messages), [messages]);

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
  React.useEffect(() => () => {
    batchedRef.current?.dispose();
    appendBatchedRef.current?.dispose();
  }, []);

  const batchedSetMessages = React.useCallback<
    React.Dispatch<React.SetStateAction<ClaudeStreamMessage[]>>
  >((action) => {
    const batched = batchedRef.current!;
    const appendBatched = appendBatchedRef.current!;
    if (typeof action === "function") {
      // 通用函数式更新可能依赖当前完整数组；先排空 append-only 队列，保持调用顺序。
      appendBatched.flushNow();
      batched.enqueue(action as (prev: ClaudeStreamMessage[]) => ClaudeStreamMessage[]);
    } else {
      // 直接赋值（重置/历史加载/清空）：先 flush 挂起的增量，再同步覆盖，保证最终状态正确。
      batched.flushNow();
      appendBatched.flushNow();
      rawSetMessagesRef.current(action);
    }
  }, []);

  const appendMessage = React.useCallback((message: ClaudeStreamMessage) => {
    // append-only 更新排在任何已入队通用更新之后，避免流式 delta/merge 与 append 乱序。
    batchedRef.current!.flushNow();
    appendBatchedRef.current!.enqueue(message);
  }, []);

  const appendMessages = React.useCallback((messages: ClaudeStreamMessage[]) => {
    if (messages.length === 0) return;
    batchedRef.current!.flushNow();
    appendBatchedRef.current!.enqueueAll(messages);
  }, []);

  // ✅ 性能优化: 操作函数独立缓存，确保引用稳定
  const actionsValue = React.useMemo<MessagesActionsContextValue>(
    () => ({
      setMessages: batchedSetMessages,
      appendMessage,
      appendMessages,
      setIsStreaming,
      setFilterConfig,
    }),
    [batchedSetMessages, appendMessage, appendMessages, setIsStreaming, setFilterConfig]
  );

  // ✅ 性能优化: 数据独立缓存
  const dataValue = React.useMemo<MessagesDataContextValue>(
    () => ({
      messages,
      isStreaming,
      filterConfig,
      toolResults,
    }),
    [messages, isStreaming, filterConfig, toolResults]
  );

  return (
    <MessagesActionsContext.Provider value={actionsValue}>
      <MessagesDataContext.Provider value={dataValue}>
        {children}
      </MessagesDataContext.Provider>
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

// ✅ 兼容性: 保留原有 API，同时获取数据和操作
// 建议新代码使用 useMessagesData 或 useMessagesActions
export const useMessagesContext = () => {
  const data = useMessagesData();
  const actions = useMessagesActions();
  return { ...data, ...actions };
};

MessagesProvider.displayName = "MessagesProvider";


