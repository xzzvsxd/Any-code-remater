import { useState, useCallback, useRef, useContext, createContext, ReactNode, useEffect, useMemo } from 'react';
import type { Session } from '@/lib/api';
import { createSessionWindow, emitWindowSyncEvent, onWindowSyncEvent, isSessionWindow } from '@/lib/windowManager';
import { normalizePersistedWorkbenchTab } from '@/lib/tabPersistence';
import { createIdlePersistScheduler, type IdlePersistScheduler } from '@/lib/tabPersistenceScheduler';

/**
 * ✨ REFACTORED: Simplified Tab interface (Phase 1 optimization)
 * - Single interface (no dual TabSessionData/TabSession)
 * - Simplified state enum (merged streamingStatus into state)
 * - Flattened error structure
 * - isActive computed on-the-fly from activeTabId
 */
export interface Tab {
  id: string;
  title: string;
  type: 'session' | 'new';
  
  // Session data
  projectPath?: string;
  session?: Session;
  engine?: 'claude' | 'codex' | 'gemini';
  
  // State management (simplified)
  state: 'idle' | 'streaming' | 'error';
  errorMessage?: string; // Flattened from error object
  hasUnsavedChanges: boolean;
  
  // Metadata
  createdAt: number;
  lastActiveAt: number;
}

// Backward compatibility: Keep old interfaces as type aliases
/** @deprecated Use Tab instead */
export type TabSessionData = Tab;
/** @deprecated Use Tab instead */
export type TabSession = Tab & { isActive: boolean };

/**
 * ✨ REFACTORED: Context value interface (Phase 1 optimization)
 * - Updated method signatures to use simplified Tab interface
 * - Simplified updateTabState (merged streaming/error updates)
 */
interface TabContextValue {
  tabs: TabSession[];
  activeTabId: string | null;
  createNewTab: (session?: Session, projectPath?: string, activate?: boolean, forcedTabId?: string) => string;
  switchToTab: (tabId: string) => void;
  closeTab: (tabId: string, force?: boolean) => Promise<{ needsConfirmation?: boolean; tabId?: string } | void>;
  updateTabState: (tabId: string, state: Tab['state'], errorMessage?: string) => void;
  updateTabChanges: (tabId: string, hasChanges: boolean) => void;
  updateTabTitle: (tabId: string, title: string) => void;
  updateTabEngine: (tabId: string, engine: 'claude' | 'codex' | 'gemini') => void;
  /** 更新未落盘新会话的项目路径，用于发送前侧栏归类和运行中指示 */
  updateTabProjectPath: (tabId: string, projectPath: string) => void;
  /** 🔧 FIX: 更新标签页的 session 信息（用于新建会话获取到 sessionId 后持久化） */
  updateTabSession: (tabId: string, sessionInfo: { sessionId: string; projectId: string; projectPath: string; engine?: 'claude' | 'codex' | 'gemini' }) => void;
  getTabById: (tabId: string) => TabSession | undefined;
  getActiveTab: () => TabSession | undefined;
  openSessionInBackground: (session: Session) => { tabId: string; isNew: boolean };
  getTabStats: () => { total: number; active: number; hasChanges: number };
  registerTabCleanup: (tabId: string, cleanup: () => Promise<void> | void) => void;
  canCloseTab: (tabId: string) => { canClose: boolean; hasUnsavedChanges: boolean };
  forceCloseTab: (tabId: string) => Promise<void>;
  reorderTabs: (fromIndex: number, toIndex: number) => void;

  // Multi-window support
  detachTab: (tabId: string) => Promise<string | null>;
  isTabDetached: (tabId: string) => boolean;
  getDetachedTabs: () => string[];
  createNewTabAsWindow: (session?: Session, projectPath?: string) => Promise<string | null>;

  // Backward compatibility aliases
  /** @deprecated Use updateTabState instead */
  updateTabStreamingStatus: (tabId: string, isStreaming: boolean, sessionId: string | null) => void;
  /** @deprecated Use updateTabState instead */
  clearTabError: (tabId: string) => void;
}

const TabContext = createContext<TabContextValue | null>(null);

interface PersistedTabsState {
  tabs: Tab[];
  activeTabId: string | null;
}

interface TabProviderProps {
  children: ReactNode;
}

/**
 * ✨ REFACTORED: TabProvider - Simplified state management (Phase 1)
 * - Removed Map cache (direct array operations)
 * - Single Tab[] state (no dual data structures)
 * - Cleaner persistence logic
 */
export const TabProvider: React.FC<TabProviderProps> = ({ children }) => {
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const nextTabId = useRef(1);
  
  // Cleanup callbacks stored separately (not in state)
  const cleanupCallbacksRef = useRef<Map<string, () => Promise<void> | void>>(new Map());
  const persistTabsSchedulerRef = useRef<IdlePersistScheduler<PersistedTabsState> | null>(null);

  const STORAGE_KEY = 'claude-workbench-tabs-state';

  if (!persistTabsSchedulerRef.current) {
    persistTabsSchedulerRef.current = createIdlePersistScheduler<PersistedTabsState>((state) => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      } catch (error) {
        console.error('[useTabs] Failed to persist tabs:', error);
      }
    });
  }

  // ✨ REFACTORED: Load persisted state on mount (simplified)
  useEffect(() => {
    try {
      const persistedState = localStorage.getItem(STORAGE_KEY);
      if (!persistedState) return;
      
      const { tabs: savedTabs, activeTabId: savedActiveTabId } = JSON.parse(persistedState);
      
      if (!Array.isArray(savedTabs)) return;
      
      // Validate and filter tabs
      const validTabs = savedTabs.filter((tab: any) => {
        if (!tab.id || !tab.title) {
          console.warn('[useTabs] Skipping invalid tab:', tab);
          return false;
        }
        return true;
      }).map((tab: any) => normalizePersistedWorkbenchTab(tab));
      
      // Validate activeTabId
      const validActiveTabId = validTabs.find(t => t.id === savedActiveTabId)
        ? savedActiveTabId
        : (validTabs[0]?.id || null);
      
      setTabs(validTabs);
      setActiveTabId(validActiveTabId);
    } catch (error) {
      console.error('[useTabs] Failed to restore tabs:', error);
      localStorage.removeItem(STORAGE_KEY);
    }
  }, []);

  // Persist state when it changes, but keep synchronous localStorage writes out
  // of the render/effect hot path.  New sessions update tab metadata in short
  // bursts (project path → session id → auto title); the idle scheduler keeps
  // only the latest snapshot and flushes on unmount so the final state is not lost.
  useEffect(() => {
    persistTabsSchedulerRef.current?.schedule({ tabs, activeTabId });
  }, [tabs, activeTabId]);

  useEffect(() => {
    return () => {
      persistTabsSchedulerRef.current?.flush();
      persistTabsSchedulerRef.current?.dispose();
      persistTabsSchedulerRef.current = null;
    };
  }, []);

  useEffect(() => {
    const handleSessionTitleChanged = (event: Event) => {
      const detail = (event as CustomEvent<{ sessionId?: string; title?: string }>).detail;
      const sessionId = detail?.sessionId?.trim();
      if (!sessionId) return;

      const title = detail?.title?.trim();
      if (!title) return;

      setTabs(prev => {
        let changed = false;
        const next = prev.map(tab => {
          if (tab.session?.id !== sessionId || tab.title === title) return tab;
          changed = true;
          return { ...tab, title };
        });
        return changed ? next : prev;
      });
    };

    window.addEventListener('session-title-changed', handleSessionTitleChanged);
    return () => window.removeEventListener('session-title-changed', handleSessionTitleChanged);
  }, []);

  // ✨ REFACTORED: Compute TabSession with isActive (simplified)
  const tabsWithActive: TabSession[] = useMemo(
    () => tabs.map(tab => ({
      ...tab,
      isActive: tab.id === activeTabId,
    })),
    [tabs, activeTabId],
  );

  // Generate unique tab ID
  const generateTabId = useCallback(() => {
    return `tab-${Date.now()}-${nextTabId.current++}`;
  }, []);

  // 生成标签标题：标签语义是「会话名」而非项目名。
  // - 已有会话：优先取首条用户消息作为标题；无则回退到短会话 ID。
  // - 新建会话（尚无首条消息）：统一显示「新对话」，待发出首条消息后再由发送链路改名。
  const generateTabTitle = useCallback((session?: Session, _projectPath?: string) => {
    if (session) {
      const first = session.first_message?.trim();
      if (first) {
        const firstLine = first.split('\n')[0] || first;
        return firstLine.length > 40 ? firstLine.slice(0, 37) + '...' : firstLine;
      }
      return session.id ? session.id.slice(0, 8) : '新对话';
    }
    return '新对话';
  }, []);

  // ✨ REFACTORED: Create new tab (simplified)
  // forcedTabId：指定新 tab 的 id 而非自动生成。用于「从侧栏草稿恢复」——草稿身份=tab id，
  // 复用原 id 才能让草稿载体连续（继续编辑落到同一份草稿，而非凭空新建一份）。
  const createNewTab = useCallback((session?: Session, projectPath?: string, activate: boolean = true, forcedTabId?: string): string => {
    const newTabId = forcedTabId || generateTabId();
    const newTab: Tab = {
      id: newTabId,
      title: generateTabTitle(session, projectPath),
      type: session ? 'session' : 'new',
      projectPath: projectPath || session?.project_path,
      session,
      engine: session?.engine,
      state: 'idle',
      hasUnsavedChanges: false,
      createdAt: Date.now(),
      lastActiveAt: Date.now(),
    };

    // 指定 id 且该 tab 已存在：直接复用，不重复插入（幂等），避免同一草稿被打开成两个 tab。
    setTabs(prev => (prev.some(t => t.id === newTabId) ? prev : [...prev, newTab]));

    if (activate) {
      setActiveTabId(newTabId);
    }

    return newTabId;
  }, [generateTabId, generateTabTitle]);

  // ✨ REFACTORED: Switch to tab (functional setState)
  const switchToTab = useCallback((tabId: string) => {
    setTabs(prev =>
      prev.map(tab =>
        tab.id === tabId
          ? { ...tab, lastActiveAt: Date.now() }
          : tab
      )
    );
    setActiveTabId(tabId);
  }, []);

  // Check if tab can be closed
  const canCloseTab = useCallback((tabId: string) => {
    const tab = tabs.find(t => t.id === tabId);
    return {
      canClose: !tab?.hasUnsavedChanges,
      hasUnsavedChanges: Boolean(tab?.hasUnsavedChanges),
    };
  }, [tabs]);

  // ✨ REFACTORED: Force close tab (use cleanup callbacks ref)
  const forceCloseTab = useCallback(async (tabId: string) => {
    // Execute cleanup callback if present
    const cleanup = cleanupCallbacksRef.current.get(tabId);
    if (cleanup) {
      try {
        await cleanup();
      } catch (error) {
        console.error(`[useTabs] Cleanup failed for tab ${tabId}:`, error);
        // Continue closing anyway
      }
      cleanupCallbacksRef.current.delete(tabId);
    }

    setTabs(prev => {
      const remaining = prev.filter(t => t.id !== tabId);

      // Switch to another tab if closing active tab
      if (activeTabId === tabId && remaining.length > 0) {
        const lastActiveTab = remaining.reduce((latest, current) =>
          current.lastActiveAt > latest.lastActiveAt ? current : latest
        );
        setActiveTabId(lastActiveTab.id);
      } else if (remaining.length === 0) {
        setActiveTabId(null);
      }

      return remaining;
    });
  }, [activeTabId]);

  // Close tab with UI confirmation
  const closeTab = useCallback(async (tabId: string, force = false): Promise<{ needsConfirmation?: boolean; tabId?: string } | void> => {
    if (force) {
      return forceCloseTab(tabId);
    }

    const { canClose, hasUnsavedChanges } = canCloseTab(tabId);

    if (!canClose && hasUnsavedChanges) {
      return { needsConfirmation: true, tabId };
    }

    return forceCloseTab(tabId);
  }, [canCloseTab, forceCloseTab]);

  // ✨ NEW: Unified state update method
  const updateTabState = useCallback((tabId: string, state: Tab['state'], errorMessage?: string) => {
    setTabs(prev => {
      let changed = false;
      const next = prev.map(tab => {
        if (tab.id !== tabId) return tab;
        if (tab.state === state && tab.errorMessage === errorMessage) return tab;
        changed = true;
        return { ...tab, state, errorMessage, lastActiveAt: Date.now() };
      });
      return changed ? next : prev;
    });
  }, []);

  // Update tab changes
  const updateTabChanges = useCallback((tabId: string, hasChanges: boolean) => {
    setTabs(prev =>
      prev.map(tab =>
        tab.id === tabId ? { ...tab, hasUnsavedChanges: hasChanges } : tab
      )
    );
  }, []);

  // Update tab title
  const updateTabTitle = useCallback((tabId: string, title: string) => {
    setTabs(prev =>
      prev.map(tab =>
        tab.id === tabId ? { ...tab, title } : tab
      )
    );
  }, []);

  // 🆕 Update tab engine - 更新标签页的执行引擎
  const updateTabEngine = useCallback((tabId: string, engine: 'claude' | 'codex' | 'gemini') => {
    setTabs(prev =>
      prev.map(tab => {
        if (tab.id !== tabId) return tab;
        const updatedSession = tab.session ? { ...tab.session, engine } : tab.session;
        return { ...tab, engine, session: updatedSession };
      })
    );
  }, []);

  const updateTabProjectPath = useCallback((tabId: string, projectPath: string) => {
    const trimmedPath = projectPath.trim();
    if (!trimmedPath) return;

    setTabs(prev => {
      let changed = false;
      const next = prev.map(tab => {
        if (tab.id !== tabId) return tab;
        if (tab.projectPath === trimmedPath) return tab;

        changed = true;
        const updatedSession = tab.session
          ? { ...tab.session, project_path: trimmedPath }
          : tab.session;
        return {
          ...tab,
          projectPath: trimmedPath,
          session: updatedSession,
          lastActiveAt: Date.now(),
        };
      });

      return changed ? next : prev;
    });
  }, []);

  // 🔧 FIX: Update tab session - 更新标签页的会话信息
  // 用于新建会话在获取到 sessionId 后持久化，解决页面切换后消息丢失问题
  const updateTabSession = useCallback((
    tabId: string,
    sessionInfo: { sessionId: string; projectId: string; projectPath: string; engine?: 'claude' | 'codex' | 'gemini' }
  ) => {
    setTabs(prev =>
      prev.map(tab => {
        if (tab.id !== tabId) return tab;

        // 如果已经有 session 且 id 相同，不需要更新
        if (tab.session?.id === sessionInfo.sessionId) return tab;

        // 构建完整的 Session 对象
        const newSession: Session = {
          id: sessionInfo.sessionId,
          project_id: sessionInfo.projectId,
          project_path: sessionInfo.projectPath,
          created_at: Math.floor(tab.createdAt / 1000),
          engine: sessionInfo.engine || tab.engine,
        };

        console.debug('[useTabs] Updating tab session:', { tabId, sessionInfo });

        return {
          ...tab,
          type: 'session' as const,
          session: newSession,
          projectPath: sessionInfo.projectPath,
          engine: sessionInfo.engine || tab.engine,
          lastActiveAt: Date.now(),
        };
      })
    );
  }, []);

  // Get tab by ID
  const getTabById = useCallback((tabId: string): TabSession | undefined => {
    const tab = tabs.find(t => t.id === tabId);
    if (!tab) return undefined;

    return {
      ...tab,
      isActive: tab.id === activeTabId,
    };
  }, [tabs, activeTabId]);

  // Get active tab
  const getActiveTab = useCallback((): TabSession | undefined => {
    if (!activeTabId) return undefined;
    return getTabById(activeTabId);
  }, [activeTabId, getTabById]);

  // Open session in background
  const openSessionInBackground = useCallback((session: Session): { tabId: string; isNew: boolean } => {
    const existingTab = tabs.find(tab => tab.session?.id === session.id);
    if (existingTab) {
      return { tabId: existingTab.id, isNew: false };
    }

    const newTabId = createNewTab(session, undefined, false);
    return { tabId: newTabId, isNew: true };
  }, [tabs, createNewTab]);

  // Get tab stats
  const getTabStats = useCallback(() => {
    return {
      total: tabs.length,
      active: tabs.filter(tab => tab.state === 'streaming').length,
      hasChanges: tabs.filter(tab => tab.hasUnsavedChanges).length,
    };
  }, [tabs]);

  // Register cleanup callback
  const registerTabCleanup = useCallback((tabId: string, cleanup: () => Promise<void> | void) => {
    cleanupCallbacksRef.current.set(tabId, cleanup);
  }, []);

  // Reorder tabs (drag & drop)
  const reorderTabs = useCallback((fromIndex: number, toIndex: number) => {
    if (fromIndex === toIndex) return;

    setTabs(prev => {
      const newTabs = [...prev];
      const [removed] = newTabs.splice(fromIndex, 1);
      newTabs.splice(toIndex, 0, removed);
      return newTabs;
    });
  }, []);

  // Track detached tabs (tabs that have been opened in separate windows)
  const detachedTabsRef = useRef<Set<string>>(new Set());

  // Listen for window sync events (for tab_attached from detached windows)
  useEffect(() => {
    // Skip if this is a session window (not main window)
    if (isSessionWindow()) return;

    let unlisten: (() => void) | null = null;

    const setupListener = async () => {
      unlisten = await onWindowSyncEvent((event) => {
        if (event.type === 'tab_attached') {
          // A detached window wants to merge back to main window
          // Remove from detached set
          detachedTabsRef.current.delete(event.tabId);

          // Create new tab with the session data
          const session = event.data?.session as Session | undefined;
          const projectPath = event.projectPath;

          if (session) {
            // Create tab with existing session
            setTabs(prev => {
              // Check if tab already exists
              if (prev.some(t => t.session?.id === session.id)) {
                return prev;
              }

              const newTab: Tab = {
                id: `tab-${Date.now()}-attached`,
                title: projectPath?.split(/[/\\]/).pop() || session.id.slice(0, 8),
                type: 'session',
                projectPath: projectPath || session.project_path,
                session,
                state: 'idle',
                hasUnsavedChanges: false,
                createdAt: Date.now(),
                lastActiveAt: Date.now(),
              };

              return [...prev, newTab];
            });

            // Activate the new tab
            setActiveTabId(`tab-${Date.now()}-attached`);
          } else if (projectPath) {
            // Create new tab with project path only
            setTabs(prev => {
              const newTab: Tab = {
                id: `tab-${Date.now()}-attached`,
                title: projectPath.split(/[/\\]/).pop() || '新会话',
                type: 'new',
                projectPath,
                state: 'idle',
                hasUnsavedChanges: false,
                createdAt: Date.now(),
                lastActiveAt: Date.now(),
              };

              return [...prev, newTab];
            });

            setActiveTabId(`tab-${Date.now()}-attached`);
          }
        }
      });
    };

    setupListener();

    return () => {
      if (unlisten) unlisten();
    };
  }, []);

  // Detach tab into a new window
  const detachTab = useCallback(async (tabId: string): Promise<string | null> => {
    const tab = tabs.find(t => t.id === tabId);
    if (!tab) {
      console.error('[useTabs] Cannot detach: tab not found:', tabId);
      return null;
    }

    // Check if already detached
    if (detachedTabsRef.current.has(tabId)) {
      console.warn('[useTabs] Tab already detached:', tabId);
      return null;
    }

    try {
      // Create new window
      const windowLabel = await createSessionWindow({
        tabId: tab.id,
        sessionId: tab.session?.id,
        projectPath: tab.projectPath,
        title: `${tab.title} - Any Code`,
        engine: tab.session?.engine,
      });

      // Mark as detached
      detachedTabsRef.current.add(tabId);

      // Emit sync event
      await emitWindowSyncEvent({
        type: 'tab_detached',
        tabId,
        sessionId: tab.session?.id,
        projectPath: tab.projectPath,
      });

      // Close the tab in main window (force close since it's now in a separate window)
      await forceCloseTab(tabId);
      return windowLabel;
    } catch (error) {
      console.error('[useTabs] Failed to detach tab:', error);
      return null;
    }
  }, [tabs, forceCloseTab]);

  // Check if a tab is detached
  const isTabDetached = useCallback((tabId: string): boolean => {
    return detachedTabsRef.current.has(tabId);
  }, []);

  // Get all detached tab IDs
  const getDetachedTabs = useCallback((): string[] => {
    return Array.from(detachedTabsRef.current);
  }, []);

  // Create a new session directly as an independent window
  const createNewTabAsWindow = useCallback(async (session?: Session, projectPath?: string): Promise<string | null> => {
    try {
      const newTabId = generateTabId();
      const title = session
        ? (projectPath?.split(/[/\\]/).pop() || session.project_path?.split(/[/\\]/).pop() || '新会话')
        : (projectPath?.split(/[/\\]/).pop() || '新会话');

      // Create the window directly without creating a tab first
      const windowLabel = await createSessionWindow({
        tabId: newTabId,
        sessionId: session?.id,
        projectPath: projectPath || session?.project_path,
        title: `${title} - Any Code`,
        engine: session?.engine,
      });

      // Mark as detached
      detachedTabsRef.current.add(newTabId);

      // Emit sync event
      await emitWindowSyncEvent({
        type: 'tab_detached',
        tabId: newTabId,
        sessionId: session?.id,
        projectPath: projectPath || session?.project_path,
      });
      return windowLabel;
    } catch (error) {
      console.error('[useTabs] Failed to create new session as window:', error);
      return null;
    }
  }, [generateTabId]);

  // ✨ REFACTORED: Backward compatibility aliases
  const updateTabStreamingStatus = useCallback((tabId: string, isStreaming: boolean, _sessionId: string | null) => {
    updateTabState(tabId, isStreaming ? 'streaming' : 'idle');
  }, [updateTabState]);

  const clearTabError = useCallback((tabId: string) => {
    updateTabState(tabId, 'idle');
  }, [updateTabState]);

  const contextValue: TabContextValue = useMemo(() => ({
    tabs: tabsWithActive,
    activeTabId,
    createNewTab,
    switchToTab,
    closeTab,
    updateTabState,
    updateTabChanges,
    updateTabTitle,
    updateTabEngine,
    updateTabProjectPath,
    updateTabSession,
    getTabById,
    getActiveTab,
    openSessionInBackground,
    getTabStats,
    registerTabCleanup,
    canCloseTab,
    forceCloseTab,
    reorderTabs,
    // Multi-window support
    detachTab,
    isTabDetached,
    getDetachedTabs,
    createNewTabAsWindow,
    // Backward compatibility
    updateTabStreamingStatus,
    clearTabError,
  }), [
    tabsWithActive,
    activeTabId,
    createNewTab,
    switchToTab,
    closeTab,
    updateTabState,
    updateTabChanges,
    updateTabTitle,
    updateTabEngine,
    updateTabProjectPath,
    updateTabSession,
    getTabById,
    getActiveTab,
    openSessionInBackground,
    getTabStats,
    registerTabCleanup,
    canCloseTab,
    forceCloseTab,
    reorderTabs,
    detachTab,
    isTabDetached,
    getDetachedTabs,
    createNewTabAsWindow,
    updateTabStreamingStatus,
    clearTabError,
  ]);

  return (
    <TabContext.Provider value={contextValue}>
      {children}
    </TabContext.Provider>
  );
};

/**
 * useTabs - 使用标签页状态管理
 */
export const useTabs = (): TabContextValue => {
  const context = useContext(TabContext);
  if (!context) {
    throw new Error('useTabs must be used within a TabProvider');
  }
  return context;
};

/**
 * useActiveTab - 获取当前活跃标签页
 */
export const useActiveTab = (): TabSession | undefined => {
  const { getActiveTab } = useTabs();
  return getActiveTab();
};

/**
 * useTabSession - 获取特定标签页的会话管理钩子
 */
export const useTabSession = (tabId: string) => {
  const { getTabById, updateTabChanges, updateTabStreamingStatus, updateTabTitle, updateTabEngine, updateTabProjectPath, updateTabSession, registerTabCleanup } = useTabs();

  const tab = getTabById(tabId);

  const markAsChanged = useCallback(() => {
    updateTabChanges(tabId, true);
  }, [tabId, updateTabChanges]);

  const markAsUnchanged = useCallback(() => {
    updateTabChanges(tabId, false);
  }, [tabId, updateTabChanges]);

  const updateTitle = useCallback((title: string) => {
    updateTabTitle(tabId, title);
  }, [tabId, updateTabTitle]);

  const updateStreaming = useCallback((isStreaming: boolean, sessionId: string | null) => {
    updateTabStreamingStatus(tabId, isStreaming, sessionId);
  }, [tabId, updateTabStreamingStatus]);

  // 🆕 Update engine - 更新执行引擎
  const updateEngine = useCallback((engine: 'claude' | 'codex' | 'gemini') => {
    updateTabEngine(tabId, engine);
  }, [tabId, updateTabEngine]);

  const updateProjectPath = useCallback((projectPath: string) => {
    updateTabProjectPath(tabId, projectPath);
  }, [tabId, updateTabProjectPath]);

  // 🔧 FIX: Update session - 更新会话信息（用于新建会话持久化）
  const updateSession = useCallback((sessionInfo: { sessionId: string; projectId: string; projectPath: string; engine?: 'claude' | 'codex' | 'gemini' }) => {
    updateTabSession(tabId, sessionInfo);
  }, [tabId, updateTabSession]);

  // 🔧 NEW: Register cleanup callback
  const setCleanup = useCallback((cleanup: () => Promise<void> | void) => {
    registerTabCleanup(tabId, cleanup);
  }, [tabId, registerTabCleanup]);

  return {
    tab,
    markAsChanged,
    markAsUnchanged,
    updateTitle,
    updateStreaming,
    updateEngine,
    updateProjectPath,
    updateSession,
    setCleanup,
  };
};
