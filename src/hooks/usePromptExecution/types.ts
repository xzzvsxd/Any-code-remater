import type { UnlistenFn } from '@tauri-apps/api/event';
import type { Session } from '@/lib/api';
import type { TranslationResult } from '@/lib/translationMiddleware';
import type { ClaudeStreamMessage } from '@/types/claude';
import type { ModelType } from '@/components/FloatingPromptInput/types';
import type { CodexExecutionMode, CodexRateLimits } from '@/types/codex';

export interface QueuedPrompt {
  id: string;
  prompt: string;
  model: ModelType;
}

export interface PendingPromptRecord {
  sessionId: string;
  projectPath: string;
  promptIndex: number;
  promptText: string;
}

export interface UsePromptExecutionConfig {
  projectPath: string;
  isLoading: boolean;
  claudeSessionId: string | null;
  effectiveSession: Session | null;
  isPlanMode: boolean;
  isActive: boolean;
  isFirstPrompt: boolean;
  extractedSessionInfo: { sessionId: string; projectId: string } | null;

  executionEngine?: 'claude' | 'codex' | 'gemini';
  claudeFastMode?: boolean;
  codexMode?: CodexExecutionMode;
  codexModel?: string;
  codexFastMode?: boolean;
  codexReasoningLevel?: 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
  geminiModel?: string;
  geminiApprovalMode?: 'auto_edit' | 'yolo' | 'default';

  hasActiveSessionRef: React.MutableRefObject<boolean>;
  activeSessionIdRef?: React.MutableRefObject<string | null>;
  unlistenRefs: React.MutableRefObject<UnlistenFn[]>;
  isMountedRef: React.MutableRefObject<boolean>;
  isListeningRef: React.MutableRefObject<boolean>;
  queuedPromptsRef: React.MutableRefObject<QueuedPrompt[]>;

  setIsLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  setMessages: React.Dispatch<React.SetStateAction<ClaudeStreamMessage[]>>;
  setClaudeSessionId: (id: string | null) => void;
  setLastTranslationResult: (result: TranslationResult | null) => void;
  setQueuedPrompts: React.Dispatch<React.SetStateAction<QueuedPrompt[]>>;
  setRawJsonlOutput: React.Dispatch<React.SetStateAction<string[]>>;
  setExtractedSessionInfo: React.Dispatch<React.SetStateAction<{ sessionId: string; projectId: string; engine?: 'claude' | 'codex' | 'gemini' } | null>>;
  setIsFirstPrompt: (isFirst: boolean) => void;
  setCodexRateLimits?: React.Dispatch<React.SetStateAction<CodexRateLimits | null>>;
  setCancelSessionId?: (id: string | null) => void;
  getRunElapsedSeconds?: () => number | null;

  processMessageWithTranslation: (message: ClaudeStreamMessage, payload: string, currentTranslationResult?: TranslationResult) => Promise<void>;
}

export interface UsePromptExecutionReturn {
  handleSendPrompt: (prompt: string, model: ModelType, maxThinkingTokens?: number) => Promise<void>;
}

export type ClaudeGlobalEventPayload<T> = { tab_id?: string | null; payload: T } | T;
export type EngineGlobalEventPayload<T> = { tab_id?: string | null; payload: T } | T;
