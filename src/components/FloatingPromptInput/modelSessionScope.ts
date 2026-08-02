import { decodeClaudeModel, encodeClaudeModel } from './constants';
import type { ModelType } from './types';

const SCOPED_MODEL_STORAGE_KEY = 'floating_prompt_input_scoped_models_v1';
const LAST_SELECTED_MODEL_STORAGE_KEY = 'floating_prompt_input_last_selected_model_v1';

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

export function readPromptInputLastSelectedModel(): ModelType | null {
  try {
    return parseSessionModelForPromptInput(localStorage.getItem(LAST_SELECTED_MODEL_STORAGE_KEY));
  } catch {
    return null;
  }
}

export function writePromptInputLastSelectedModel(model: ModelType | null | undefined): void {
  const parsedModel = parseSessionModelForPromptInput(model);
  try {
    if (parsedModel) {
      localStorage.setItem(LAST_SELECTED_MODEL_STORAGE_KEY, parsedModel);
    } else {
      localStorage.removeItem(LAST_SELECTED_MODEL_STORAGE_KEY);
    }
  } catch {
    // localStorage may be unavailable in privacy/test contexts; model selection still works in memory.
  }
}

export function doesSessionModelOnlyDropOneMillion(currentModel?: string | null, sessionModel?: string | null): boolean {
  const current = decodeClaudeModel(currentModel);
  const incoming = decodeClaudeModel(sessionModel);
  if (!current || !incoming) return false;

  return current.versionId === incoming.versionId
    && current.oneMillion
    && !incoming.oneMillion;
}

export function isOneMillionClaudeModel(model?: string | null): boolean {
  return decodeClaudeModel(model)?.oneMillion === true;
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

  if (
    nextScopeKey.startsWith('draft:')
    && nextModel === currentModel
    && isOneMillionClaudeModel(currentModel)
  ) {
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

export function resolveInitialPromptInputModel({
  scopeKey,
  scopedModel,
  sessionModel,
  lastSelectedModel,
  userDefaultModel,
  defaultModel,
}: {
  scopeKey: string;
  scopedModel?: string | null;
  sessionModel?: string | null;
  lastSelectedModel?: string | null;
  userDefaultModel?: ModelType | null;
  defaultModel: ModelType;
}): ModelType {
  const parsedScopedModel = parseSessionModelForPromptInput(scopedModel);
  if (parsedScopedModel) {
    return parsedScopedModel;
  }

  const parsedSessionModel = parseSessionModelForPromptInput(sessionModel);
  if (parsedSessionModel) {
    return parsedSessionModel;
  }

  // 新 tab 会挂载全新的 FloatingPromptInput 实例，无法通过 previousScopeKey
  // 知道它来自哪个会话。把“最近一次 UI 选中的 1M 意图”作为 sticky preference，
  // 可防止新会话初始化时被裸 userDefaultModel（如 claude-opus-4-8）清掉 1M。
  // 非 1M 模型仍交给“新会话默认模型”控制，保留星标默认模型的语义。
  const parsedLastSelectedModel = parseSessionModelForPromptInput(lastSelectedModel);
  if (
    (scopeKey === 'new' || scopeKey.startsWith('draft:') || scopeKey.startsWith('project:'))
    && parsedLastSelectedModel
    && isOneMillionClaudeModel(parsedLastSelectedModel)
  ) {
    return parsedLastSelectedModel;
  }

  return parseSessionModelForPromptInput(userDefaultModel) || defaultModel;
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

  // “开启新会话”会从已有 session 切到新的 draft scope；如果当前 UI 已显式开启
  // 1M，不能在 draft 初始化时退回裸 userDefaultModel/defaultModel。
  if (
    nextScopeKey.startsWith('draft:')
    && isOneMillionClaudeModel(currentModel)
    && !parseSessionModelForPromptInput(sessionModel)
  ) {
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
