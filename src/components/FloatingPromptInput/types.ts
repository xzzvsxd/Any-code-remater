import { ReactNode } from "react";

/**
 * Model type definition
 */
export type ModelType = "fable" | "sonnet" | "opus" | "sonnet1m" | "opus1m" | "custom";

/**
 * Thinking mode type definition
 * Claude 4.6 Adaptive Thinking with effort levels
 */
export type ThinkingMode = "off" | "adaptive";

/**
 * Thinking effort level (Claude Code effortLevel)
 */
export type ThinkingEffort = "low" | "medium" | "high" | "xhigh";

/**
 * Model configuration
 */
export interface ModelConfig {
  id: ModelType;
  name: string;
  description: string;
  icon: ReactNode;
}

/**
 * Thinking mode configuration
 */
export interface ThinkingModeConfig {
  id: ThinkingMode;
  effort?: ThinkingEffort; // Effort level for adaptive thinking
  name: string;
  description: string;
  level: number; // 0-4 for visual indicator
}

/**
 * Image attachment interface
 */
export interface ImageAttachment {
  id: string;
  filePath: string;
  previewUrl: string;
  width: number;
  height: number;
}

/**
 * Execution engine configuration (re-export from ExecutionEngineSelector)
 */
export type ExecutionEngineConfig = import('@/components/ExecutionEngineSelector').ExecutionEngineConfig;

/**
 * 人性化执行状态信息。
 *
 * 只包含 UI 需要展示的轻量状态，避免把底层进程对象、完整路径或敏感参数透出到输入框组件。
 */
export interface ExecutionStatusInfo {
  /** 当前执行引擎 */
  engine: 'claude' | 'codex' | 'gemini';
  /** 适合展示给用户的引擎名 */
  engineName: string;
  /** 是否有正在运行的 AI 任务 */
  isRunning: boolean;
  /** 当前是否已经建立安全取消通道 */
  canCancel: boolean;
  /** 是否正在请求取消 */
  isCancelling?: boolean;
  /** 当前运行开始时间（ms timestamp） */
  startedAt?: number | null;
  /** 最近一次收到输出的时间（ms timestamp） */
  lastOutputAt?: number | null;
  /** 已运行秒数 */
  elapsedSeconds: number;
  /** 距离上次输出的秒数 */
  idleSeconds: number;
  /** 当前运行通道 ID，仅用于 UI 判断，不展示完整值 */
  activeSessionId?: string | null;
  /** 项目短名，不包含完整路径 */
  projectLabel?: string;
  /** 主状态文案 */
  statusLabel?: string;
  /** 次级提示文案 */
  statusHint?: string;
}

/**
 * Floating prompt input props
 */
export interface FloatingPromptInputProps {
  /**
   * Callback when prompt is sent - includes maxThinkingTokens separately
   */
  onSend: (prompt: string, model: ModelType, maxThinkingTokens?: number) => void;
  /**
   * Whether the input is loading
   */
  isLoading?: boolean;
  /**
   * 是否显示处理中的状态条
   */
  showProcessingStatus?: boolean;
  /**
   * 点击处理状态时回到最新消息
   */
  onProcessingStatusClick?: () => void;
  /**
   * Whether the input is disabled
   */
  disabled?: boolean;
  /**
   * Default model to select
   */
  defaultModel?: ModelType;
  /**
   * Model from session (for restoring model selection on page reload)
   */
  sessionModel?: string;
  /**
   * Project path for file picker
   */
  projectPath?: string;
  /**
   * 🆕 Session ID (for history-aware context search)
   */
  sessionId?: string;
  /**
   * 🆕 Project ID (for history-aware context search)
   */
  projectId?: string;
  /**
   * 🆕 承载本输入框的 tab id：新会话(无 sessionId)时用作后端草稿的唯一 id，支持多草稿互不覆盖。
   */
  draftTabId?: string;
  /**
   * Optional className for styling
   */
  className?: string;
  /**
   * Callback when cancel is clicked (only during loading)
   */
  onCancel?: () => void;
  /**
   * Optional function to get conversation context for prompt enhancement
   */
  getConversationContext?: () => string[];
  /**
   * 🆕 Complete message list (for dual API context extraction)
   */
  messages?: import("@/types/claude").ClaudeStreamMessage[];
  /**
   * Whether Plan Mode is enabled
   */
  isPlanMode?: boolean;
  /**
   * Callback when Plan Mode is toggled
   */
  onTogglePlanMode?: () => void;
  /**
   * Session cost for display (formatted string like "$0.05")
   */
  sessionCost?: string;
  /**
   * Detailed session statistics (optional)
   */
  sessionStats?: {
    totalTokens: number;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
    durationSeconds: number;
    apiDurationSeconds: number;
  };
  /**
   * Whether there are messages (to show cost display)
   */
  hasMessages?: boolean;
  /**
   * 🆕 Complete session information (for export)
   */
  session?: import("@/lib/api").Session;
  /**
   * ?? Codex rate limits (for live badge updates)
   */
  codexRateLimits?: import("@/types/codex").CodexRateLimits | null;
  /**
   * 🆕 Execution engine configuration (optional, for Codex integration)
   */
  executionEngineConfig?: ExecutionEngineConfig;
  /**
   * 🆕 人性化执行状态（耗时、取消通道、无输出提示等）
   */
  executionStatus?: ExecutionStatusInfo;
  /**
   * 🆕 Callback when execution engine config changes
   */
  onExecutionEngineConfigChange?: (config: ExecutionEngineConfig) => void;
}

/**
 * Floating prompt input ref interface
 */
export interface FloatingPromptInputRef {
  addImage: (imagePath: string) => void;
  setPrompt: (text: string) => void;
  /** 追加文本到输入框（不覆盖现有内容），用于从队列取回提示词编辑 */
  appendPrompt: (text: string) => void;
}
