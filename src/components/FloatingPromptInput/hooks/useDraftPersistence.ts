import { useEffect, useCallback, useRef } from 'react';
import { api } from '@/lib/api';

export const DRAFT_KEY_PREFIX = 'prompt_draft_';
const DRAFT_DEBOUNCE_MS = 300;

/**
 * 计算草稿在 localStorage 的存储 key。规则：已有会话用 sessionId 隔离；新会话用 draftId(tab id)
 * 隔离多草稿；都没有则回退 global。提取为纯函数供外部（如侧栏判断 tab 是否承载未发送草稿）复用，
 * 避免 key 规则在多处各写一遍而漂移。
 */
export function getDraftStorageKey(opts: { sessionId?: string; draftId?: string }): string {
  if (opts.sessionId) return `${DRAFT_KEY_PREFIX}${opts.sessionId}`;
  if (opts.draftId) return `${DRAFT_KEY_PREFIX}${opts.draftId}`;
  return `${DRAFT_KEY_PREFIX}global`;
}

interface UseDraftPersistenceOptions {
  sessionId?: string;
  onRestore?: (draft: string) => void;
  /** 承载该输入框的 tab id：新会话(无 sessionId)时用作后端草稿的唯一 id，支持多草稿互不覆盖。 */
  draftId?: string;
  /** 草稿所属项目（用于侧栏归类显示）。 */
  projectId?: string;
  projectPath?: string;
  engine?: string;
}

/**
 * 草稿持久化 Hook
 * 使用 localStorage 保存和恢复输入框草稿，支持按会话隔离。
 *
 * 多草稿 + 后端落盘：新会话(无 sessionId)时，localStorage key 用 draftId(tab id) 而非
 * 共享的 'global'，避免多个新会话互相覆盖；同时把草稿落盘到后端 ~/.claude/draft-sessions.json，
 * 使其显示在侧栏对应项目下（红色草稿条目）。发送/清空时删除后端草稿。
 */
export function useDraftPersistence({
  sessionId,
  onRestore,
  draftId,
  projectId,
  projectPath,
  engine,
}: UseDraftPersistenceOptions) {
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const hasRestoredRef = useRef(false);
  // 后端草稿操作串行化队列：save/delete 都是后端「读-改-写同一文件」的无锁操作，
  // 并发时存在写后写竞态——发送时 clearDraft 的 delete 可能先执行、in-flight 的 save 后落盘，
  // 导致草稿残留（已发出仍显示草稿）。用 promise 链强制按调用顺序串行，根除竞态。
  const backendQueueRef = useRef<Promise<unknown>>(Promise.resolve());

  // 把一个后端草稿操作排进串行队列；前一个完成后才执行下一个，无论成败都不阻塞后续。
  const enqueueBackendOp = useCallback((op: () => Promise<unknown>) => {
    backendQueueRef.current = backendQueueRef.current.then(op, op);
    return backendQueueRef.current;
  }, []);

  // 是否走后端草稿落盘：新会话(无 sessionId)且有 draftId + 项目路径时。
  const useBackendDraft = !sessionId && !!draftId && !!projectPath;

  // 生成存储 key：新会话用 draftId 隔离（多草稿互不覆盖），回退 global；已有会话用 sessionId。
  const getStorageKey = useCallback(
    () => getDraftStorageKey({ sessionId, draftId }),
    [sessionId, draftId],
  );

  // 通知侧栏草稿列表刷新
  const notifyDraftsChanged = useCallback(() => {
    try { window.dispatchEvent(new CustomEvent('drafts-changed')); } catch { /* ignore */ }
  }, []);

  // 保存草稿到 localStorage（带防抖）；新会话同时落盘到后端。
  const saveDraft = useCallback((content: string) => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    debounceTimerRef.current = setTimeout(() => {
      try {
        const key = getStorageKey();
        if (content.trim()) {
          localStorage.setItem(key, content);
        } else {
          // 如果内容为空，删除草稿
          localStorage.removeItem(key);
        }
      } catch (error) {
        console.warn('[DraftPersistence] Failed to save draft:', error);
      }

      // 后端草稿落盘：content 为空时后端会删除该草稿（见 save_draft_session）。
      // 走串行队列，保证与 clearDraft 的 delete 不发生写后写竞态。
      if (useBackendDraft && draftId) {
        const now = Math.floor(Date.now() / 1000);
        enqueueBackendOp(() => api.saveDraftSession({
          id: draftId,
          project_id: projectId || '',
          project_path: projectPath || '',
          content,
          engine: engine || 'claude',
          created_at: now,
          updated_at: now,
        })).then(notifyDraftsChanged).catch((e) => {
          console.warn('[DraftPersistence] Failed to persist backend draft:', e);
        });
      }
    }, DRAFT_DEBOUNCE_MS);
  }, [getStorageKey, useBackendDraft, draftId, projectId, projectPath, engine, notifyDraftsChanged, enqueueBackendOp]);

  // 清除草稿（发送成功/丢弃时）。新会话同时删除后端草稿。
  const clearDraft = useCallback(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    try {
      const key = getStorageKey();
      localStorage.removeItem(key);
    } catch (error) {
      console.warn('[DraftPersistence] Failed to clear draft:', error);
    }

    if (useBackendDraft && draftId) {
      enqueueBackendOp(() => api.deleteDraftSession(draftId)).then(notifyDraftsChanged).catch((e) => {
        console.warn('[DraftPersistence] Failed to delete backend draft:', e);
      });
    }
  }, [getStorageKey, useBackendDraft, draftId, notifyDraftsChanged, enqueueBackendOp]);

  // 恢复草稿
  const restoreDraft = useCallback((): string | null => {
    try {
      const key = getStorageKey();
      return localStorage.getItem(key);
    } catch (error) {
      console.warn('[DraftPersistence] Failed to restore draft:', error);
      return null;
    }
  }, [getStorageKey]);

  // 组件挂载时恢复草稿
  useEffect(() => {
    // 只在首次挂载时恢复，避免 sessionId 变化时重复恢复
    if (hasRestoredRef.current) {
      return;
    }

    const draft = restoreDraft();
    if (draft && onRestore) {
      onRestore(draft);
      hasRestoredRef.current = true;
    }
  }, [restoreDraft, onRestore]);

  // sessionId 变化时重置恢复标记并尝试恢复新会话的草稿
  useEffect(() => {
    hasRestoredRef.current = false;
    const draft = restoreDraft();
    if (draft && onRestore) {
      onRestore(draft);
      hasRestoredRef.current = true;
    }
  }, [sessionId, restoreDraft, onRestore]);

  // 清理定时器
  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, []);

  return {
    saveDraft,
    clearDraft,
    restoreDraft,
  };
}
