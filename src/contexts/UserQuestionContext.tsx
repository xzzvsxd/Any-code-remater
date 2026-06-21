/**
 * UserQuestionContext - 用户问答状态管理
 *
 * 管理 AskUserQuestion 工具的交互式问答流程
 * 当检测到 AskUserQuestion 工具调用时触发对话框
 *
 * 功能：
 * - 管理待回答的问题队列
 * - 触发问答对话框
 * - 提交答案并发送给 Claude
 * - 追踪已回答的问题，避免重复弹窗
 *
 * 参考：PlanModeContext 的实现模式
 */

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useRef,
  type ReactNode,
} from "react";
import { getQuestionIdContent, getQuestionKey, normalizeQuestions } from "@/lib/askUserQuestionUtils";
import { api } from "@/lib/api";
import {
  enqueuePendingInteraction,
  shiftPendingInteraction,
} from "@/lib/pendingInteractionQueue";

/**
 * 问题选项接口
 */
export interface QuestionOption {
  label: string;
  description?: string;
}

/**
 * 问题接口
 */
export interface Question {
  question: string;
  header?: string;
  options?: QuestionOption[];
  multiSelect?: boolean;
}

/**
 * 待回答的问题
 */
export interface PendingQuestion {
  /** 问题列表 */
  questions: Question[];
  /** 去重键（优先使用工具调用唯一 toolId，回退到内容哈希） */
  questionId: string;
  /** 时间戳 */
  timestamp: number;
  /**
   * 阻塞式 MCP 提问的桥接请求 id。存在时，提交答案走「回灌唤醒挂起的 MCP handler」
   * （api.answerUserQuestion），CLI 在同一轮继续；不存在时退化为旧的「发新一轮消息」。
   */
  requestId?: string;
  /** 关联会话 id（MCP 提问携带），用于必要时按会话取消。 */
  sessionId?: string;
  /** 后端等待用户响应的超时时长（秒）。 */
  timeoutSeconds?: number;
  /** 后端等待用户响应的截止时间（毫秒时间戳）。 */
  expiresAtMs?: number;
}

/**
 * 用户选择的答案
 */
export type UserAnswers = Record<string, string | string[]>;

interface UserQuestionContextValue {
  /** 待回答的问题 */
  pendingQuestion: PendingQuestion | null;
  /** 是否显示问答对话框 */
  showQuestionDialog: boolean;

  /** 触发问答对话框（当检测到 AskUserQuestion 工具调用时）；toolId 为工具调用唯一 ID，优先用作去重键。
   *  auto=true 表示「自动弹出」，同一问题仅允许自动弹一次；用户手动点击触发（auto=false/省略）则始终放行。 */
  triggerQuestionDialog: (questions: Question[], toolId?: string, auto?: boolean) => void;
  /**
   * 触发一次「阻塞式 MCP 提问」对话框：由后端 ask-user-question 事件驱动。
   * 与 triggerQuestionDialog 不同，它必然弹出（每个 MCP 调用唯一、且 CLI 正阻塞等待），
   * 并携带 requestId/sessionId 供提交时回灌唤醒。
   */
  triggerBridgeQuestion: (
    requestId: string,
    sessionId: string,
    questions: Question[],
    metadata?: { timeoutSeconds?: number; expiresAtMs?: number }
  ) => void;
  /** 提交答案 - 格式化并发送给 Claude */
  submitAnswers: (answers: UserAnswers) => boolean;
  /** 暂时不回答；bridge 请求会回灌给 Claude，避免后端一直悬挂。 */
  deferQuestionResponse: () => boolean;
  /** 关闭问答对话框 */
  closeQuestionDialog: () => void;

  /** 检查问题是否已回答 */
  isQuestionAnswered: (questionId: string) => boolean;
  /** 已回答的问题 ID 集合 */
  answeredQuestionIds: Set<string>;

  /** 设置发送消息的回调（由 ClaudeCodeSession 设置） */
  setSendMessageCallback: (callback: ((message: string) => void) | null) => void;
}

const UserQuestionContext = createContext<UserQuestionContextValue | undefined>(
  undefined
);

interface UserQuestionProviderProps {
  children: ReactNode;
}

/**
 * 生成问题的唯一 ID（基于问题内容的简单 hash）
 * 仅作为无 toolId 时的回退方案。
 */
function generateQuestionId(questions: Question[]): string {
  const content = getQuestionIdContent(questions);
  let hash = 0;
  for (let i = 0; i < content.length; i++) {
    const char = content.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return `question_${Math.abs(hash)}_${questions.length}`;
}

/**
 * 解析去重键：优先使用工具调用唯一 toolId（每次调用唯一，可避免「相同内容问题第二次问」被误吞），
 * 无 toolId 时回退到内容哈希。
 */
function resolveDedupeKey(questions: Question[], toolId?: string): string {
  return toolId ? `tool_${toolId}` : generateQuestionId(questions);
}

/**
 * UserQuestion Context Provider
 */
export function UserQuestionProvider({ children }: UserQuestionProviderProps) {
  const [pendingQuestion, setPendingQuestion] = useState<PendingQuestion | null>(null);
  const [showQuestionDialog, setShowQuestionDialog] = useState(false);
  const pendingQuestionRef = useRef<PendingQuestion | null>(null);
  const showQuestionDialogRef = useRef(false);
  const questionQueueRef = useRef<PendingQuestion[]>([]);
  // 已回答集合仅存内存：刷新/重开会话应允许重新询问，避免「相同问题被永久吞掉」导致 CLI 卡死。
  const [answeredQuestionIds, setAnsweredQuestionIds] = useState<Set<string>>(() => new Set());

  // 发送消息的回调引用
  const sendMessageCallbackRef = useRef<((message: string) => void) | null>(null);

  const setActiveQuestion = useCallback((question: PendingQuestion | null, visible: boolean) => {
    pendingQuestionRef.current = question;
    showQuestionDialogRef.current = visible;
    setPendingQuestion(question);
    setShowQuestionDialog(visible);
  }, []);

  // 「已自动弹出过」的问题去重集合。
  // 关键：用 ref 而非组件内 state，使其与 widget 生命周期解耦——
  // 列表滚动导致 widget 卸载/重挂载时，该记录仍存活于 Provider（会话级单例），
  // 从而保证同一问题「只自动弹一次」，滚回来不再自动弹（用户可手动点按钮再弹）。
  const autoTriggeredIdsRef = useRef<Set<string>>(new Set());

  // 检查问题是否已回答
  const isQuestionAnswered = useCallback((questionId: string): boolean => {
    return answeredQuestionIds.has(questionId);
  }, [answeredQuestionIds]);

  const activateOrQueueQuestion = useCallback((nextQuestion: PendingQuestion) => {
    // 当前已有可见弹窗时，不覆盖它；后续问题排队，避免第一个 bridge 请求被覆盖后永远挂起。
    const activeQuestion = pendingQuestionRef.current;
    if (activeQuestion && showQuestionDialogRef.current) {
      questionQueueRef.current = enqueuePendingInteraction(
        questionQueueRef.current,
        activeQuestion,
        nextQuestion,
        q => q.questionId,
      );
      return;
    }

    setActiveQuestion(nextQuestion, true);
  }, [setActiveQuestion]);

  const showNextQueuedQuestion = useCallback(() => {
    const { next, rest } = shiftPendingInteraction(questionQueueRef.current);
    questionQueueRef.current = rest;
    setActiveQuestion(next, Boolean(next));
  }, [setActiveQuestion]);

  // 触发问答对话框
  const triggerQuestionDialog = useCallback((questions: Question[], toolId?: string, auto: boolean = false) => {
    const safeQuestions = normalizeQuestions(questions);
    const questionId = resolveDedupeKey(safeQuestions, toolId);

    // 如果已回答，不再弹窗
    if (answeredQuestionIds.has(questionId)) {
      return;
    }

    // 自动弹出仅允许首次：同一问题自动弹过一次后，用户若未答而继续往下，
    // 之后即使滚回该 widget 也不再自动弹，只能手动点「回答问题」按钮触发。
    if (auto) {
      if (autoTriggeredIdsRef.current.has(questionId)) {
        return;
      }
      autoTriggeredIdsRef.current.add(questionId);
    }

    activateOrQueueQuestion({
      questions: safeQuestions,
      questionId,
      timestamp: Date.now(),
    });
  }, [answeredQuestionIds, activateOrQueueQuestion]);

  // 触发阻塞式 MCP 提问：由后端 ask-user-question 事件驱动，必然弹出并携带 requestId。
  // 不走 answeredQuestionIds / autoTriggered 去重——每个 MCP 调用唯一，且 CLI 正阻塞等待，必须弹。
  const triggerBridgeQuestion = useCallback(
    (
      requestId: string,
      sessionId: string,
      questions: Question[],
      metadata?: { timeoutSeconds?: number; expiresAtMs?: number },
    ) => {
      const safeQuestions = normalizeQuestions(questions);
      activateOrQueueQuestion({
        questions: safeQuestions,
        questionId: `bridge_${requestId}`,
        timestamp: Date.now(),
        requestId,
        sessionId,
        timeoutSeconds: metadata?.timeoutSeconds,
        expiresAtMs: metadata?.expiresAtMs,
      });
    },
    [activateOrQueueQuestion],
  );

  // 设置发送消息回调
  const setSendMessageCallback = useCallback((callback: ((message: string) => void) | null) => {
    sendMessageCallbackRef.current = callback;
  }, []);

  // 格式化答案为自然语言
  // 关键：必须带上「完整问题文本」一起回传。表单提交后只有答案回灌给 Claude，
  // 原始提问不会自动随附；若跨会话或上下文被压缩，Claude 将看不到问题，
  // 无法把答案与问题配对（曾导致「看不到提问上下文」的反馈）。
  const formatAnswersAsMessage = useCallback((answers: UserAnswers, questions: Question[]): string => {
    const lines: string[] = ["以下是我对上述问题的回答："];

    normalizeQuestions(questions).forEach((q, index) => {
      const key = getQuestionKey(q);
      const answer = answers[key];

      if (answer) {
        const answerText = Array.isArray(answer) ? answer.join("、") : answer;
        // 优先完整问题文本，回退到简称，再回退到序号占位，确保回答自包含
        const questionText = q.question || q.header || `问题 ${index + 1}`;
        lines.push("");
        lines.push(`问题：${questionText}`);
        lines.push(`回答：${answerText}`);
      }
    });

    return lines.join("\n");
  }, []);

  // 提交答案 - 格式化后交给 Claude
  // 两条路径：
  //  ① 阻塞式 MCP 提问（pendingQuestion.requestId 存在）：调 api.answerUserQuestion 回灌唤醒
  //     被阻塞的工具 handler，CLI 在【同一轮】拿到答案继续——这是真正的"等用户回答再继续"。
  //  ② 旧路径（无 requestId，如历史会话里内置 AskUserQuestion 的 widget）：退化为发新一轮消息。
  const submitAnswers = useCallback((answers: UserAnswers) => {
    if (!pendingQuestion) return false;

    const { questionId, questions, requestId } = pendingQuestion;
    const message = formatAnswersAsMessage(answers, questions);

    // 路径①：阻塞式 MCP 回灌
    if (requestId) {
      // 标记已回答 + 关闭对话框
      setAnsweredQuestionIds(prev => {
        const newSet = new Set(prev);
        newSet.add(questionId);
        return newSet;
      });
      showNextQueuedQuestion();

      // 回灌唤醒挂起的 handler。失败（已超时/取消）则降级为发新一轮，避免答案丢失。
      api.answerUserQuestion(requestId, message)
        .then((hit) => {
          if (!hit && sendMessageCallbackRef.current) {
            console.warn("[UserQuestion] bridge miss, fallback to new turn");
            sendMessageCallbackRef.current(message);
          }
        })
        .catch((e) => {
          console.error("[UserQuestion] answerUserQuestion failed:", e);
          if (sendMessageCallbackRef.current) sendMessageCallbackRef.current(message);
        });

      return true;
    }

    // 路径②：旧的"发新一轮"
    if (!sendMessageCallbackRef.current) {
      console.warn("[UserQuestion] Cannot submit answers: send callback is not available");
      setShowQuestionDialog(true);
      return false;
    }
    const sendMessage = sendMessageCallbackRef.current;

    setAnsweredQuestionIds(prev => {
      const newSet = new Set(prev);
      newSet.add(questionId);
      return newSet;
    });
    showNextQueuedQuestion();

    // 延迟发送，确保状态已更新；捕获当前 callback，避免切 tab/卸载时答案静默丢失。
    setTimeout(() => {
      sendMessage(message);
    }, 100);

    return true;
  }, [pendingQuestion, formatAnswersAsMessage, showNextQueuedQuestion]);

  const deferQuestionResponse = useCallback(() => {
    const activeQuestion = pendingQuestionRef.current;
    if (!activeQuestion) {
      return false;
    }

    const { questionId, requestId } = activeQuestion;

    if (requestId) {
      const text = "用户暂时没想好，暂时不回答。请不要替用户选择；如果可以继续处理不依赖该答案的部分就继续，否则暂停等待用户后续说明。";

      setAnsweredQuestionIds(prev => {
        const newSet = new Set(prev);
        newSet.add(questionId);
        return newSet;
      });
      showNextQueuedQuestion();

      api.answerUserQuestion(requestId, text).catch((e) => {
        console.error("[UserQuestion] defer answerUserQuestion failed:", e);
      });
      return true;
    }

    if (questionQueueRef.current.length > 0) {
      showNextQueuedQuestion();
      return true;
    }

    showQuestionDialogRef.current = false;
    setShowQuestionDialog(false);
    return true;
  }, [showNextQueuedQuestion]);

  // 关闭问答对话框（不提交答案）
  const closeQuestionDialog = useCallback(() => {
    // 阻塞式 bridge 请求不能被隐藏，否则后端 handler 会一直等待。
    if (pendingQuestionRef.current?.requestId) {
      return;
    }

    // 如果关闭的是可延后回答的旧 widget 问题，而队列里已有后续阻塞式请求，
    // 立即切到下一项，避免“稍后回答”把后续 request_user_input 永久压在队列里。
    if (questionQueueRef.current.length > 0) {
      showNextQueuedQuestion();
      return;
    }

    showQuestionDialogRef.current = false;
    setShowQuestionDialog(false);
    // 注意：不标记为已回答，用户可以稍后再次触发
  }, [showNextQueuedQuestion]);

  const value: UserQuestionContextValue = {
    pendingQuestion,
    showQuestionDialog,
    triggerQuestionDialog,
    triggerBridgeQuestion,
    submitAnswers,
    deferQuestionResponse,
    closeQuestionDialog,
    isQuestionAnswered,
    answeredQuestionIds,
    setSendMessageCallback,
  };

  return (
    <UserQuestionContext.Provider value={value}>
      {children}
    </UserQuestionContext.Provider>
  );
}

/**
 * Hook to use UserQuestion context
 */
export function useUserQuestion() {
  const context = useContext(UserQuestionContext);
  if (!context) {
    throw new Error("useUserQuestion must be used within UserQuestionProvider");
  }
  return context;
}

/**
 * Optional hook for widgets that may render outside UserQuestionProvider.
 */
export function useOptionalUserQuestion() {
  return useContext(UserQuestionContext);
}

/**
 * 生成问题 ID 的公共方法（供 Widget 使用）
 */
export function getQuestionId(questions: Question[]): string {
  return generateQuestionId(questions);
}
