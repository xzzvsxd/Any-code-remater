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
  /** 提交答案 - 格式化并发送给 Claude */
  submitAnswers: (answers: UserAnswers) => boolean;
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
  // 已回答集合仅存内存：刷新/重开会话应允许重新询问，避免「相同问题被永久吞掉」导致 CLI 卡死。
  const [answeredQuestionIds, setAnsweredQuestionIds] = useState<Set<string>>(() => new Set());

  // 发送消息的回调引用
  const sendMessageCallbackRef = useRef<((message: string) => void) | null>(null);

  // 「已自动弹出过」的问题去重集合。
  // 关键：用 ref 而非组件内 state，使其与 widget 生命周期解耦——
  // 列表滚动导致 widget 卸载/重挂载时，该记录仍存活于 Provider（会话级单例），
  // 从而保证同一问题「只自动弹一次」，滚回来不再自动弹（用户可手动点按钮再弹）。
  const autoTriggeredIdsRef = useRef<Set<string>>(new Set());

  // 检查问题是否已回答
  const isQuestionAnswered = useCallback((questionId: string): boolean => {
    return answeredQuestionIds.has(questionId);
  }, [answeredQuestionIds]);

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

    setPendingQuestion({
      questions: safeQuestions,
      questionId,
      timestamp: Date.now(),
    });
    setShowQuestionDialog(true);
  }, [answeredQuestionIds]);

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

  // 提交答案 - 格式化并发送给 Claude
  const submitAnswers = useCallback((answers: UserAnswers) => {
    if (!pendingQuestion) return false;

    if (!sendMessageCallbackRef.current) {
      console.warn("[UserQuestion] Cannot submit answers: send callback is not available");
      setShowQuestionDialog(true);
      return false;
    }

    const sendMessage = sendMessageCallbackRef.current;

    const { questionId, questions } = pendingQuestion;
    const message = formatAnswersAsMessage(answers, questions);

    // 标记为已回答（去重键已在 trigger 时确定，优先 toolId）
    setAnsweredQuestionIds(prev => {
      const newSet = new Set(prev);
      newSet.add(questionId);
      return newSet;
    });

    // 关闭对话框
    setPendingQuestion(null);
    setShowQuestionDialog(false);

    // 延迟发送，确保状态已更新；捕获当前 callback，避免切 tab/卸载时答案静默丢失。
    setTimeout(() => {
      sendMessage(message);
    }, 100);

    return true;
  }, [pendingQuestion, formatAnswersAsMessage]);

  // 关闭问答对话框（不提交答案）
  const closeQuestionDialog = useCallback(() => {
    setShowQuestionDialog(false);
    // 注意：不标记为已回答，用户可以稍后再次触发
  }, []);

  const value: UserQuestionContextValue = {
    pendingQuestion,
    showQuestionDialog,
    triggerQuestionDialog,
    submitAnswers,
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
