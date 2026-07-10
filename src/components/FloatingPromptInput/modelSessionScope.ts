import { decodeClaudeModel, encodeClaudeModel } from './constants';
import type { ModelType } from './types';

const SCOPED_MODEL_STORAGE_KEY = 'floating_prompt_input_scoped_models_v1';

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function readScopedModelRecord(): Record<string, string> {
  try {
    const raw = localStorage.getItem(SCOPED_MODEL_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!isObjectRecord(parsed)) return {};

    const record: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === 'string') {
        record[key] = value;
      }
    }
    return record;
  } catch {
    return {};
  }
}

function writeScopedModelRecord(record: Record<string, string>): void {
  try {
    const entries = Object.entries(record).filter(([key, value]) => key.trim() && value.trim());
    if (entries.length === 0) {
      localStorage.removeItem(SCOPED_MODEL_STORAGE_KEY);
      return;
    }
    localStorage.setItem(SCOPED_MODEL_STORAGE_KEY, JSON.stringify(Object.fromEntries(entries)));
  } catch {
    // localStorage may be unavailable in privacy/test contexts; model selection still works in memory.
  }
}

export function parseSessionModelForPromptInput(modelStr?: string | null): ModelType | null {
  if (!modelStr) return null;
  const raw = modelStr.trim();
  if (!raw) return null;

  if (/^claude-/i.test(raw)) return raw;

  const decoded = decodeClaudeModel(raw);
  if (decoded) return encodeClaudeModel(decoded.versionId, decoded.oneMillion);

  return null;
}

export function readPromptInputScopedModel(scopeKey?: string | null): ModelType | null {
  const key = scopeKey?.trim();
  if (!key) return null;
  return parseSessionModelForPromptInput(readScopedModelRecord()[key]);
}

export function writePromptInputScopedModel(scopeKey: string | null | undefined, model: ModelType | null | undefined): void {
  const key = scopeKey?.trim();
  if (!key) return;

  const parsedModel = parseSessionModelForPromptInput(model);
  const record = readScopedModelRecord();

  if (parsedModel) {
    record[key] = parsedModel;
  } else {
    delete record[key];
  }

  writeScopedModelRecord(record);
}

export function doesSessionModelOnlyDropOneMillion(currentModel?: string | null, sessionModel?: string | null): boolean {
  const current = decodeClaudeModel(currentModel);
  const incoming = decodeClaudeModel(sessionModel);
  if (!current || !incoming) return false;

  return current.versionId === incoming.versionId
    && current.oneMillion
    && !incoming.oneMillion;
}

export function isPromptInputDraftToSessionPromotion(previousScopeKey: string, nextScopeKey: string): boolean {
  return previousScopeKey.startsWith('draft:') && nextScopeKey.startsWith('session:');
}

export function shouldPersistPromptInputModelForScopeTransition({
  previousScopeKey,
  nextScopeKey,
  currentModel,
  sessionModel,
  nextModel,
}: {
  previousScopeKey: string;
  nextScopeKey: string;
  currentModel: ModelType;
  sessionModel?: string | null;
  nextModel: ModelType;
}): boolean {
  if (isPromptInputDraftToSessionPromotion(previousScopeKey, nextScopeKey)) {
    return true;
  }

  return nextScopeKey.startsWith('session:')
    && nextModel === currentModel
    && doesSessionModelOnlyDropOneMillion(currentModel, sessionModel);
}

export function buildPromptInputModelScopeKey({
  sessionId,
  draftTabId,
  projectPath,
}: {
  sessionId?: string | null;
  draftTabId?: string | null;
  projectPath?: string | null;
}): string {
  const sid = sessionId?.trim();
  if (sid) return `session:${sid}`;

  const draftId = draftTabId?.trim();
  if (draftId) return `draft:${draftId}`;

  const path = projectPath?.trim();
  if (path) return `project:${path.replace(/\\/g, '/').toLowerCase()}`;

  return 'new';
}

export function resolvePromptInputModelForScopeChange({
  previousScopeKey,
  nextScopeKey,
  currentModel,
  scopedModel,
  sessionModel,
  userDefaultModel,
  defaultModel,
}: {
  previousScopeKey: string;
  nextScopeKey: string;
  currentModel: ModelType;
  scopedModel?: string | null;
  sessionModel?: string | null;
  userDefaultModel?: ModelType | null;
  defaultModel: ModelType;
}): ModelType {
  // session.model 可能在同一个会话运行中异步回填为“运行时裸模型 ID”
  // （例如 claude-opus-4-8），它不能覆盖用户已经选中的 UI 意图
  // （例如 claude-opus-4-8[1m]）。只有真正切换到另一个会话/草稿作用域时，
  // 才用目标会话的 model 或新会话默认值重置输入框模型。
  if (previousScopeKey === nextScopeKey) {
    return currentModel;
  }

  const parsedScopedModel = parseSessionModelForPromptInput(scopedModel);
  if (parsedScopedModel) {
    return parsedScopedModel;
  }

  // 新会话发送首条消息后，作用域会从 draft:<tabId> 升级为 session:<realId>。
  // 这是同一个逻辑会话的身份升级，不是用户切换到了另一个会话；必须保留当前 UI
  // 选择（尤其是 claude-*- [1m]），否则真实 sessionId 回填瞬间会把 1M 按钮打掉。
  if (isPromptInputDraftToSessionPromotion(previousScopeKey, nextScopeKey)) {
    return currentModel;
  }

  // 切换到另一个会话时，session.model 常来自 Claude runtime 回填，通常只记录裸模型
  // （如 claude-opus-4-8），不会带 Any Code UI 的 [1m] 意图。若目标会话模型与当前
  // UI 模型只差 [1m] 后缀，说明这是“运行时裸模型覆盖 UI 意图”的同类问题，保留当前
  // 显式 1M 选择，并由调用方写入目标 session scope，保证下次恢复不再丢。
  if (
    nextScopeKey.startsWith('session:')
    && doesSessionModelOnlyDropOneMillion(currentModel, sessionModel)
  ) {
    return currentModel;
  }

  return parseSessionModelForPromptInput(sessionModel) || userDefaultModel || defaultModel;
}
