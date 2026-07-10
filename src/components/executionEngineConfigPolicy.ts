import type { CodexExecutionMode } from '@/types/codex';
import { DEFAULT_CODEX_MODEL_ID, sanitizeCodexModelId } from '@/lib/codexModelSupport';
import type { ExecutionEngine, ExecutionEngineConfig } from './ExecutionEngineSelector';

const DEFAULT_ENGINE_CONFIG: ExecutionEngineConfig = {
  engine: 'claude',
  codexMode: 'read-only',
  codexModel: DEFAULT_CODEX_MODEL_ID,
  geminiModel: 'gemini-3-flash',
};

const VALID_ENGINES = new Set<ExecutionEngine>(['claude', 'codex', 'gemini']);
const VALID_CODEX_MODES = new Set<CodexExecutionMode>(['read-only', 'full-auto', 'danger-full-access']);
const VALID_CODEX_REASONING_LEVELS = new Set(['low', 'medium', 'high', 'xhigh']);
const VALID_GEMINI_APPROVAL_MODES = new Set(['auto_edit', 'yolo', 'default']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function isExecutionEngine(value: unknown): value is ExecutionEngine {
  return typeof value === 'string' && VALID_ENGINES.has(value as ExecutionEngine);
}

function pickCodexMode(value: unknown): CodexExecutionMode {
  return typeof value === 'string' && VALID_CODEX_MODES.has(value as CodexExecutionMode)
    ? value as CodexExecutionMode
    : DEFAULT_ENGINE_CONFIG.codexMode!;
}

function pickCodexReasoningLevel(value: unknown): ExecutionEngineConfig['codexReasoningLevel'] {
  return typeof value === 'string' && VALID_CODEX_REASONING_LEVELS.has(value)
    ? value as ExecutionEngineConfig['codexReasoningLevel']
    : undefined;
}

function pickGeminiApprovalMode(value: unknown): ExecutionEngineConfig['geminiApprovalMode'] {
  return typeof value === 'string' && VALID_GEMINI_APPROVAL_MODES.has(value)
    ? value as ExecutionEngineConfig['geminiApprovalMode']
    : undefined;
}

function pickString(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value : fallback;
}

export function resolveInitialExecutionEngineConfig({
  storedConfig,
  sessionEngine,
}: {
  storedConfig?: unknown;
  sessionEngine?: unknown;
}): ExecutionEngineConfig {
  const stored = isRecord(storedConfig) ? storedConfig : {};
  const resolvedEngine = isExecutionEngine(sessionEngine) ? sessionEngine : 'claude';
  const sanitizedCodexModel = sanitizeCodexModelId(pickString(stored.codexModel, DEFAULT_CODEX_MODEL_ID));

  return {
    engine: resolvedEngine,
    codexMode: pickCodexMode(stored.codexMode),
    codexModel: sanitizedCodexModel || DEFAULT_CODEX_MODEL_ID,
    codexReasoningLevel: pickCodexReasoningLevel(stored.codexReasoningLevel),
    geminiModel: pickString(stored.geminiModel, DEFAULT_ENGINE_CONFIG.geminiModel!),
    geminiApprovalMode: pickGeminiApprovalMode(stored.geminiApprovalMode),
  };
}

