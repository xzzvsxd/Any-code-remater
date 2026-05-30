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
  /** 问题 ID（用于追踪） */
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

  /** 触发问答对话框（当检测到 AskUserQuestion 工具调用时） */
  triggerQuestionDialog: (questions: Question[]) => void;
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

function getAnsweredQuestionStorageKey(): string {
  return 'answered_question_ids';
}

interface UserQuestionProviderProps {
  children: ReactNode;
}

/**
 * 生成问题的唯一 ID（基于问题内容的简单 hash）
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
 * 从 sessionStorage 加载已回答问题 ID 集合
 */
function loadAnsweredQuestionIds(key: string): Set<string> {
  try {
    const stored = sessionStorage.getItem(key);
    if (stored) {
      return new Set(JSON.parse(stored));
    }
  } catch (error) {
    console.warn(`[UserQuestion] Failed to load ${key}:`, error);
  }
  return new Set();
}

/**
 * 保存已回答问题 ID 集合到 sessionStorage
 */
function saveAnsweredQuestionIds(key: string, ids: Set<string>): void {
  try {
    sessionStorage.setItem(key, JSON.stringify(Array.from(ids)));
  } catch (error) {
    console.warn(`[UserQuestion] Failed to save ${key}:`, error);
  }
}

/**
 * UserQuestion Context Provider
 */
export function UserQuestionProvider({ children }: UserQuestionProviderProps) {
  const [pendingQuestion, setPendingQuestion] = useState<PendingQuestion | null>(null);
  const [showQuestionDialog, setShowQuestionDialog] = useState(false);
  const [answeredQuestionIds, setAnsweredQuestionIds] = useState<Set<string>>(() =>
    loadAnsweredQuestionIds(getAnsweredQuestionStorageKey())
  );

  // 发送消息的回调引用
  const sendMessageCallbackRef = useRef<((message: string) => void) | null>(null);

  // 检查问题是否已回答
  const isQuestionAnswered = useCallback((questionId: string): boolean => {
    return answeredQuestionIds.has(questionId);
  }, [answeredQuestionIds]);

  // 触发问答对话框
  const triggerQuestionDialog = useCallback((questions: Question[]) => {
    const safeQuestions = normalizeQuestions(questions);
    const questionId = generateQuestionId(safeQuestions);

    // 如果已回答，不再弹窗
    if (answeredQuestionIds.has(questionId)) {
      return;
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
  const formatAnswersAsMessage = useCallback((answers: UserAnswers, questions: Question[]): string => {
    const lines: string[] = ["我的回答："];

    normalizeQuestions(questions).forEach((q) => {
      const key = getQuestionKey(q);
      const answer = answers[key];

      if (answer) {
        const answerText = Array.isArray(answer) ? answer.join("、") : answer;
        lines.push(`- ${q.header || "问题"}: ${answerText}`);
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

    // 标记为已回答
    setAnsweredQuestionIds(prev => {
      const newSet = new Set(prev);
      newSet.add(questionId);
      saveAnsweredQuestionIds(getAnsweredQuestionStorageKey(), newSet);
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
