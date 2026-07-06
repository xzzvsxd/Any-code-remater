import { decodeClaudeModel, encodeClaudeModel } from './constants';
import type { ModelType } from './types';

export function parseSessionModelForPromptInput(modelStr?: string | null): ModelType | null {
  if (!modelStr) return null;
  const raw = modelStr.trim();
  if (!raw) return null;

  if (/^claude-/i.test(raw)) return raw;

  const decoded = decodeClaudeModel(raw);
  if (decoded) return encodeClaudeModel(decoded.versionId, decoded.oneMillion);

  return null;
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
  sessionModel,
  userDefaultModel,
  defaultModel,
}: {
  previousScopeKey: string;
  nextScopeKey: string;
  currentModel: ModelType;
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

  return parseSessionModelForPromptInput(sessionModel) || userDefaultModel || defaultModel;
}
