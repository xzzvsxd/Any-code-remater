import React, { useState, useCallback, useRef, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Plus, MoreHorizontal, MessageSquare, ArrowLeft, ExternalLink, ChevronDown, ChevronRight, FolderOpen, Check, Zap, Bot, Sparkles, Loader2, Pencil } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useTranslation } from '@/hooks/useTranslation';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';

import {
  TooltipProvider,
} from '@/components/ui/tooltip';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { TabSessionWrapper } from './TabSessionWrapper';
import { useTabs } from '@/hooks/useTabs';
import { useProject } from '@/contexts/ProjectContext';
import { useSessionSync } from '@/hooks/useSessionSync'; // 🔧 NEW: 会话状态同步
import { selectProjectPath } from '@/lib/sessionHelpers';
import { truncateText, getFirstLine } from '@/lib/date-utils';
import { api, type Project, type Session } from '@/lib/api';

interface TabManagerProps {
  onBack: () => void;
  className?: string;
  /**
   * 初始会话信息 - 从 SessionList 跳转时使用
   */
  initialSession?: Session;
  /**
   * 初始项目路径 - 创建新会话时使用
   */
  initialProjectPath?: string;
}

/**
 * TabManager - 多标签页会话管理器
 * 支持多个 Claude Code 会话同时运行，后台保持状态
 */
export const TabManager: React.FC<TabManagerProps> = ({
  onBack,
  className,
  initialSession,
  initialProjectPath,
}) => {
  const { t } = useTranslation();
  const {
    tabs,
    createNewTab,
    switchToTab,
    closeTab,
    updateTabStreamingStatus,
    updateTabTitle,
    openSessionInBackground,
    createNewTabAsWindow, // 🆕 直接创建为独立窗口
  } = useTabs();
  const { projects, selectedProject, sessions, selectProject } = useProject();

  // 🔧 NEW: 启用会话状态同步
  useSessionSync();

  const [tabToClose, setTabToClose] = useState<string | null>(null); // 待关闭的标签页ID（需要确认）
  const [renameTargetTabId, setRenameTargetTabId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const activeTabForMenu = tabs.find((tb) => tb.isActive);

  // ✨ Phase 3: Simple initialization flag (no complex state machine)
  const initializedRef = useRef(false);

  // 🔧 确认关闭标签页
  const confirmCloseTab = useCallback(async () => {
    if (tabToClose) {
      await closeTab(tabToClose, true);
      setTabToClose(null);
    }
  }, [tabToClose, closeTab]);

  // 创建新会话并直接打开为独立窗口
  const handleCreateNewTabAsWindow = useCallback(async () => {
    try {
      const selectedPath = await selectProjectPath();
      if (!selectedPath) {
        return;
      }
      await createNewTabAsWindow(undefined, selectedPath);
    } catch (error) {
      console.error('[TabManager] Failed to create new session window:', error);
    }
  }, [createNewTabAsWindow]);

  const renameTabTitle = useCallback((tabId: string, title: string) => {
    const tab = tabs.find((tb) => tb.id === tabId);
    const trimmed = title.trim();
    if (!tab || !trimmed || trimmed === tab.title) return;

    updateTabTitle(tab.id, trimmed);
    if (tab.session?.id) {
      api.setSessionTitle(tab.session.id, trimmed)
        .then(() => {
          window.dispatchEvent(new CustomEvent('session-title-changed', {
            detail: { sessionId: tab.session!.id, title: trimmed },
          }));
        })
        .catch((err) => {
          console.error('[TabManager] failed to persist session title:', err);
        });
    }
  }, [tabs, updateTabTitle]);

  const startRenameActiveSessionFromMenu = useCallback(() => {
    if (!activeTabForMenu) return;
    setRenameTargetTabId(activeTabForMenu.id);
    setRenameDraft(activeTabForMenu.title);
  }, [activeTabForMenu]);

  const cancelRenameSession = useCallback(() => {
    setRenameTargetTabId(null);
    setRenameDraft('');
  }, []);

  const confirmRenameSession = useCallback(() => {
    if (!renameTargetTabId) return;
    const title = renameDraft.trim();
    if (!title) return;

    renameTabTitle(renameTargetTabId, title);
    cancelRenameSession();
  }, [cancelRenameSession, renameDraft, renameTabTitle, renameTargetTabId]);

  // ✨ Phase 3: Simplified initialization (single responsibility, no race conditions)
  // 🔧 FIX: 使用 initialSession/initialProjectPath 的引用作为依赖，避免重复创建标签页
  const initialSessionIdRef = useRef<string | undefined>(initialSession?.id);
  const initialProjectPathRef = useRef<string | undefined>(initialProjectPath);

  useEffect(() => {
    // Only run once per unique initial session/path combination
    if (initializedRef.current) {
      // 检查是否是相同的初始参数（防止组件重新挂载时重复创建）
      const isSameSession = initialSession?.id === initialSessionIdRef.current;
      const isSamePath = initialProjectPath === initialProjectPathRef.current;
      if (isSameSession && isSamePath) {
        return;
      }
      // 参数变化了，更新引用但不创建新标签页（用户可能只是返回查看）
      initialSessionIdRef.current = initialSession?.id;
      initialProjectPathRef.current = initialProjectPath;
      return;
    }
    initializedRef.current = true;
    initialSessionIdRef.current = initialSession?.id;
    initialProjectPathRef.current = initialProjectPath;

    // Helper: 标准化路径用于比较
    const normalizePath = (p: string) => p?.replace(/\\/g, '/').toLowerCase().replace(/\/+$/, '') || '';

    // Priority 1: Initial session provided (highest priority)
    if (initialSession) {
      // 🔧 FIX: 检查是否已有相同 session 的标签页
      const existingTab = tabs.find(t => t.session?.id === initialSession.id);
      if (existingTab) {
        switchToTab(existingTab.id);
        return;
      }
      createNewTab(initialSession);
      return;
    }

    // Priority 2: Initial project path provided (user wants a NEW session)
    if (initialProjectPath) {
      // 🔧 FIX: Only reuse tabs that are type 'new' (no session assigned yet)
      // Do NOT reuse tabs that already have a session - the user explicitly wants a fresh new session.
      // Previously this matched ANY tab with the same path, which caused the bug where
      // clicking "New Session" would switch to an existing session tab and resume it
      // instead of starting fresh.
      const normalizedInitPath = normalizePath(initialProjectPath);
      const existingTab = tabs.find(t => {
        // Only match 'new' type tabs (no session) with the same project path
        if (t.type !== 'new' || t.session) return false;
        const tabPath = t.projectPath;
        return tabPath && normalizePath(tabPath) === normalizedInitPath;
      });
      if (existingTab) {
        switchToTab(existingTab.id);
        return;
      }
      createNewTab(undefined, initialProjectPath);
      return;
    }

    // Priority 3: Tabs restored from localStorage - do nothing, tabs are already there
    // Priority 4: No initial data - show empty state
  }, []); // Empty deps - only run once on mount

  return (
    <TooltipProvider>
      <div className={cn("h-full flex flex-col bg-background", className)}>
        {/* 极简操作条：标签已移至左侧工作台侧栏，这里仅保留返回与全局菜单 */}
        <div className="flex-shrink-0 border-b border-border bg-background">
          <div className="flex items-center h-11 px-4 gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={onBack}
              className="text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="h-4 w-4 mr-1.5" />
              <span>{t('tabs.back')}</span>
            </Button>

            <div className="flex-1 min-w-0 flex justify-center">
              <WorkspaceBreadcrumb
                projects={projects}
                selectedProject={selectedProject}
                sessions={sessions}
                activeTab={tabs.find((tb) => tb.isActive)}
                onSelectProject={(p) => selectProject(p)}
                onOpenSession={(s) => {
                  const r = openSessionInBackground(s);
                  switchToTab(r.tabId);
                }}
                onRenameActiveTab={(title) => {
                  const active = activeTabForMenu;
                  if (!active) return;
                  renameTabTitle(active.id, title);
                }}
                onNewSession={() => createNewTab()}
              />
            </div>

            {/* 新会话快捷按钮：标签栏右侧常驻，一键新建 */}
            <button
              onClick={() => createNewTab()}
              title={t('tabs.newSession')}
              aria-label={t('tabs.newSession')}
              className="h-7 w-7 rounded flex items-center justify-center text-muted-foreground hover:text-primary hover:bg-primary/10 transition-all duration-150 active:scale-90"
            >
              <Plus className="h-4 w-4" />
            </button>

            {/* 标签页菜单 */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="h-7 w-7 rounded flex items-center justify-center hover:bg-muted transition-colors">
                  <MoreHorizontal className="h-4 w-4" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => createNewTab()}>
                  <Plus className="h-4 w-4 mr-2" />
                  {t('tabs.newSession')}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={handleCreateNewTabAsWindow}>
                  <ExternalLink className="h-4 w-4 mr-2" />
                  {t('tabs.newSessionWindow')}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={startRenameActiveSessionFromMenu} disabled={!activeTabForMenu}>
                  <Pencil className="h-4 w-4 mr-2" />
                  {t('tabs.renameSession')}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={() => tabs.forEach(tab => closeTab(tab.id, true))}
                  disabled={tabs.length === 0}
                >
                  {t('tabs.closeAllTabs')}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => tabs.filter(tab => !tab.isActive).forEach(tab => closeTab(tab.id, true))}
                  disabled={tabs.length <= 1}
                >
                  {t('tabs.closeOtherTabs')}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {/* 标签页内容区域 */}
        <div className="flex-1 relative overflow-hidden">
          {/* 🔧 STATE PRESERVATION: 渲染所有标签页但隐藏非活跃标签页 */}
          {/* 这样可以保持组件状态（包括输入框内容），避免切换标签页时状态丢失 */}
          {tabs.map((tab) => {
            return (
              <div
                key={tab.id}
                className={cn(
                  "absolute inset-0",
                  !tab.isActive && "hidden"
                )}
              >
                <TabSessionWrapper
                  tabId={tab.id}
                  session={tab.session}
                  initialProjectPath={tab.projectPath}
                  initialEngine={tab.engine}
                  isActive={tab.isActive}
                  onStreamingChange={(isStreaming, sessionId) =>
                    updateTabStreamingStatus(tab.id, isStreaming, sessionId)
                  }
                />
              </div>
            );
          })}

          {/* 🎨 现代化空状态设计 */}
          {tabs.length === 0 && (
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.3 }}
              className="flex items-center justify-center h-full"
            >
              <div className="text-center max-w-md px-8">
                {/* 图标 */}
                <motion.div
                  initial={{ y: -20 }}
                  animate={{ y: 0 }}
                  transition={{ 
                    type: "spring",
                    stiffness: 200,
                    damping: 20,
                    delay: 0.1
                  }}
                  className="mb-6"
                >
                  <div className="inline-flex p-6 rounded-2xl bg-muted/50 border border-border/50">
                    <MessageSquare className="h-16 w-16 text-muted-foreground/70" strokeWidth={1.5} />
                  </div>
                </motion.div>

                {/* 标题和描述 */}
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.2 }}
                  className="mb-8"
                >
                  <h3 className="text-2xl font-bold mb-3 text-foreground">
                    {t('tabs.noActiveSessions')}
                  </h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    {t('tabs.allTabsClosed')}
                  </p>
                </motion.div>

                {/* 操作按钮 */}
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.3 }}
                  className="flex flex-col gap-3"
                >
                  <Button
                    size="lg"
                    onClick={() => createNewTab()}
                    className="w-full shadow-md hover:shadow-lg"
                  >
                    <Plus className="h-5 w-5 mr-2" />
                    {t('tabs.createNewSession')}
                  </Button>
                  <Button
                    size="lg"
                    variant="outline"
                    onClick={onBack}
                    className="w-full"
                  >
                    <ArrowLeft className="h-5 w-5 mr-2" />
                    {t('tabs.backToMain')}
                  </Button>
                </motion.div>
              </div>
            </motion.div>
          )}
        </div>

        {/* 🔧 自定义关闭确认Dialog */}
        <Dialog open={tabToClose !== null} onOpenChange={(open) => !open && setTabToClose(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t('tabs.confirmCloseTab')}</DialogTitle>
              <DialogDescription>
                {t('tabs.unsavedChangesWarning')}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setTabToClose(null)}>
                {t('buttons.cancel')}
              </Button>
              <Button variant="destructive" onClick={confirmCloseTab}>
                {t('tabs.confirmClose')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={renameTargetTabId !== null} onOpenChange={(open) => !open && cancelRenameSession()}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t('tabs.renameSession')}</DialogTitle>
              <DialogDescription>
                {t('tabs.renameSessionDescription')}
              </DialogDescription>
            </DialogHeader>
            <input
              autoFocus
              value={renameDraft}
              aria-label={t('tabs.renameSession')}
              onChange={(e) => setRenameDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') confirmRenameSession();
                else if (e.key === 'Escape') cancelRenameSession();
              }}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
            />
            <DialogFooter>
              <Button variant="outline" onClick={cancelRenameSession}>
                {t('buttons.cancel')}
              </Button>
              <Button onClick={confirmRenameSession} disabled={!renameDraft.trim()}>
                {t('buttons.save')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </TooltipProvider>
  );
};

// ============================================================================
// 工作区面包屑：项目 › 会话（顶栏中部）
// ============================================================================
const BcEngineDot: React.FC<{ engine?: string }> = ({ engine }) => {
  const e = engine || 'claude';
  if (e === 'codex') return <Bot className="h-3.5 w-3.5 text-green-500" />;
  if (e === 'gemini') return <Sparkles className="h-3.5 w-3.5 text-blue-500" />;
  return <Zap className="h-3.5 w-3.5 text-amber-500" />;
};

interface WorkspaceBreadcrumbProps {
  projects: Project[];
  selectedProject: Project | null;
  sessions: Session[];
  activeTab?: { id: string; title: string; session?: Session; projectPath?: string; engine?: 'claude' | 'codex' | 'gemini'; state?: string };
  onSelectProject: (project: Project) => void;
  onOpenSession: (session: Session) => void;
  onRenameActiveTab: (title: string) => void;
  onNewSession: () => void;
}

const WorkspaceBreadcrumb: React.FC<WorkspaceBreadcrumbProps> = ({
  projects, selectedProject, sessions, activeTab,
  onSelectProject, onOpenSession, onRenameActiveTab, onNewSession,
}) => {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const projectName = (p: Project) => {
    const norm = p.path.replace(/\\/g, '/').replace(/\/+$/, '');
    return norm.split('/').pop() || norm;
  };

  // 从路径字符串提取项目名（与 projectName 同款逻辑，供活跃标签页路径直接推导）
  const projectNameFromPath = (path: string) => {
    const norm = path.replace(/\\/g, '/').replace(/\/+$/, '');
    return norm.split('/').pop() || norm;
  };

  // 面包屑项目名优先跟随「当前活跃标签页」，使切换不同项目的会话时即刻同步；
  // 全局 selectedProject 仅在用户主动从面包屑下拉选择项目时才更新，会滞后于会话切换。
  const activeTabProjectPath = activeTab?.session?.project_path ?? activeTab?.projectPath ?? null;
  const displayedProjectName = activeTabProjectPath
    ? projectNameFromPath(activeTabProjectPath)
    : (selectedProject ? projectName(selectedProject) : t('tabs.workspace.noProjectSelected'));

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  const activeEngine = activeTab?.session?.engine ?? activeTab?.engine ?? 'claude';
  const activeSessionId = activeTab?.session?.id ?? null;
  const isStreaming = activeTab?.state === 'streaming';

  const startRename = () => {
    if (!activeTab) return;
    setDraft(activeTab.title);
    setEditing(true);
  };
  const commitRename = () => {
    const v = draft.trim();
    if (v && v !== activeTab?.title) onRenameActiveTab(v);
    setEditing(false);
  };

  return (
    <div className="flex items-center gap-1 max-w-[60%] text-sm">
      {/* 项目段 */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button className="flex items-center gap-1.5 px-2 py-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors max-w-[180px]">
            <FolderOpen className="h-3.5 w-3.5 flex-shrink-0 text-primary/70" />
            <span className="truncate font-medium">
              {displayedProjectName}
            </span>
            <ChevronDown className="h-3 w-3 flex-shrink-0 opacity-60" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-60 max-h-80 overflow-y-auto">
          {projects.length === 0 ? (
            <DropdownMenuItem disabled>{t('tabs.workspace.noProjects')}</DropdownMenuItem>
          ) : projects.map((p) => (
            <DropdownMenuItem key={p.id} onClick={() => onSelectProject(p)}>
              <FolderOpen className="h-4 w-4 mr-2 text-muted-foreground" />
              <span className="flex-1 truncate">{projectName(p)}</span>
              {selectedProject?.id === p.id && <Check className="h-4 w-4 ml-2 text-primary" />}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      <ChevronRight className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground/40" />

      {/* 会话段 */}
      {!activeTab ? (
        <button
          onClick={onNewSession}
          className="flex items-center gap-1.5 px-2 py-1 rounded-md text-muted-foreground/70 hover:text-foreground hover:bg-muted transition-colors"
        >
          <Plus className="h-3.5 w-3.5" />
          <span className="text-xs">{t('tabs.workspace.noActiveSession')}</span>
        </button>
      ) : editing ? (
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitRename}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commitRename();
            else if (e.key === 'Escape') setEditing(false);
          }}
          className="px-2 py-1 rounded-md bg-background border border-primary/50 text-sm outline-none w-[200px]"
        />
      ) : (
        <div className="flex items-center">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                onDoubleClick={startRename}
                title={t('tabs.workspace.renameHint')}
                className="flex items-center gap-1.5 px-2 py-1 rounded-md text-foreground hover:bg-muted transition-colors max-w-[260px]"
              >
                <BcEngineDot engine={activeEngine} />
                {isStreaming && <Loader2 className="h-3 w-3 text-green-500 animate-spin flex-shrink-0" />}
                <span className="truncate font-medium">{activeTab.title}</span>
                <ChevronDown className="h-3 w-3 flex-shrink-0 opacity-60" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-64 max-h-80 overflow-y-auto">
              {sessions.length === 0 ? (
                <DropdownMenuItem disabled>{t('tabs.workspace.noSessions')}</DropdownMenuItem>
              ) : sessions.slice(0, 12).map((s) => {
                const preview = s.first_message ? truncateText(getFirstLine(s.first_message), 36) : s.id.slice(0, 8);
                return (
                  <DropdownMenuItem key={s.id} onClick={() => onOpenSession(s)}>
                    <BcEngineDot engine={s.engine} />
                    <span className="flex-1 truncate ml-2 text-xs">{preview}</span>
                    {activeSessionId === s.id && <Check className="h-4 w-4 ml-2 text-primary" />}
                  </DropdownMenuItem>
                );
              })}
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={startRename}>
                <Pencil className="h-4 w-4 mr-2" />{t('tabs.workspace.rename')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}
    </div>
  );
};
