/**
 * 队列提示词的 localStorage 持久化
 *
 * 队列原为纯内存 state，重启软件或切换到非会话视图（ViewRouter 卸载 TabManager）都会丢失。
 * 这里提供按「会话身份键」隔离的读写工具，使队列跨重启 / 跨视图保活，且不同会话互不串味。
 *
 * 安全约定：恢复出的项一律标记 restored=true，由消费方阻止其自动发送（必须用户逐条确认）。
 */

import type { QueuedPrompt } from '@/hooks/usePromptExecution';
import type { ModelType } from '@/components/FloatingPromptInput/types';

const KEY_PREFIX = 'queued-prompts:';

/**
 * 计算队列持久化存储键。复用 TabSessionWrapper 中 planModeStorageKey 的同款隔离策略：
 * 优先会话 id（最稳，重启后精确恢复到对应会话），其次项目路径，最后退回 tabId。
 */
export function buildQueueStorageKey(args: {
  sessionId?: string | null;
  projectPath?: string | null;
  tabId: string;
}): string {
  const { sessionId, projectPath, tabId } = args;
  if (sessionId) return `${KEY_PREFIX}session:${sessionId}`;
  if (projectPath) return `${KEY_PREFIX}path:${projectPath.replace(/\\/g, '/').toLowerCase()}`;
  return `${KEY_PREFIX}tab:${tabId}`;
}

/**
 * 校验单条记录结构，过滤脏数据（参照 useTabs 恢复时的校验风格），避免污染数据导致渲染崩溃。
 */
function isValidRecord(item: unknown): item is { id: string; prompt: string; model: ModelType } {
  if (!item || typeof item !== 'object') return false;
  const rec = item as Record<string, unknown>;
  return typeof rec.id === 'string'
    && typeof rec.prompt === 'string'
    && typeof rec.model === 'string'
    && rec.prompt.trim().length > 0;
}

/**
 * 读取并恢复队列。恢复项统一打上 restored=true（标识"来自上次会话、尚未确认"）。
 * 任何解析 / 校验失败都静默降级为空队列，绝不阻断会话初始化。
 */
export function loadQueuedPrompts(storageKey: string): QueuedPrompt[] {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return [];

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    return parsed
      .filter(isValidRecord)
      .map(item => ({
        id: item.id,
        prompt: item.prompt,
        model: item.model,
        restored: true,
      }));
  } catch (error) {
    console.warn('[queuedPromptsStore] Failed to load queued prompts:', error);
    return [];
  }
}

/**
 * 写回队列。空队列时清理对应 key，避免残留脏数据。
 * 仅持久化序列化所需字段（不含 restored —— 下次读取时由 loadQueuedPrompts 重新统一置位）。
 */
export function saveQueuedPrompts(storageKey: string, prompts: QueuedPrompt[]): void {
  try {
    if (prompts.length === 0) {
      localStorage.removeItem(storageKey);
      return;
    }
    const serializable = prompts.map(({ id, prompt, model }) => ({ id, prompt, model }));
    localStorage.setItem(storageKey, JSON.stringify(serializable));
  } catch (error) {
    console.warn('[queuedPromptsStore] Failed to save queued prompts:', error);
  }
}
