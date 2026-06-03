import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useTranslation } from '@/hooks/useTranslation';
import {
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  X,
  Loader2,
  Zap,
  Bot,
  Sparkles,
  ChevronRight,
  FolderOpen,
  MessageSquare,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useTabs } from '@/hooks/useTabs';
import { useProject } from '@/contexts/ProjectContext';
import { useNavigation } from '@/contexts/NavigationContext';
import type { Project, Session } from '@/lib/api';
import { truncateText, getFirstLine } from '@/lib/date-utils';

const WIDTH_KEY = 'workbench_sidebar_width';
const COLLAPSED_KEY = 'workbench_sidebar_collapsed';
const MIN_WIDTH = 200;
const MAX_WIDTH = 480;
const DEFAULT_WIDTH = 280;
const RECENT_SESSION_COUNT = 5;

/** 引擎对应的图标与色调 */
const EngineDot: React.FC<{ engine?: string; active?: boolean }> = ({ engine, active }) => {
  const e = engine || 'claude';
  if (e === 'codex') return <Bot className={cn('h-3.5 w-3.5', active ? 'text-green-500' : 'text-green-500/70')} />;
  if (e === 'gemini') return <Sparkles className={cn('h-3.5 w-3.5', active ? 'text-blue-500' : 'text-blue-500/70')} />;
  return <Zap className={cn('h-3.5 w-3.5', active ? 'text-amber-500' : 'text-amber-500/70')} />;
};

/**
 * VS Code 式工作台侧栏：上段「打开的标签」+ 下段「项目资源管理器」。
 * 可拖拽调宽、可折叠，宽度/折叠状态持久化到 localStorage。
 */
export const WorkbenchSidebar: React.FC = () => {
  const { t } = useTranslation();
  const { tabs, switchToTab, closeTab, createNewTab, openSessionInBackground } = useTabs();
  const { projects, selectedProject, sessions, selectProject } = useProject();
  const { navigateTo } = useNavigation();

  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try { return localStorage.getItem(COLLAPSED_KEY) === 'true'; } catch { return false; }
  });
  const [width, setWidth] = useState<number>(() => {
    try {
      const v = parseInt(localStorage.getItem(WIDTH_KEY) || '', 10);
      return Number.isFinite(v) && v >= MIN_WIDTH && v <= MAX_WIDTH ? v : DEFAULT_WIDTH;
    } catch { return DEFAULT_WIDTH; }
  });
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(new Set());
  const [tabToClose, setTabToClose] = useState<string | null>(null);

  const draggingRef = useRef(false);

  useEffect(() => {
    try { localStorage.setItem(COLLAPSED_KEY, String(collapsed)); } catch { /* ignore */ }
  }, [collapsed]);
  useEffect(() => {
    try { localStorage.setItem(WIDTH_KEY, String(width)); } catch { /* ignore */ }
  }, [width]);

  // 当前选中项目默认展开
  useEffect(() => {
    if (selectedProject) {
      setExpandedProjects((prev) => {
        if (prev.has(selectedProject.id)) return prev;
        const next = new Set(prev);
        next.add(selectedProject.id);
        return next;
      });
    }
  }, [selectedProject]);

  // 拖拽调宽
  const onDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    draggingRef.current = true;
    const startX = e.clientX;
    const startW = width;
    const onMove = (ev: MouseEvent) => {
      if (!draggingRef.current) return;
      const next = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, startW + (ev.clientX - startX)));
      setWidth(next);
    };
    const onUp = () => {
      draggingRef.current = false;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [width]);

  const toggleProject = useCallback(async (project: Project) => {
    const willExpand = !expandedProjects.has(project.id);
    setExpandedProjects((prev) => {
      const next = new Set(prev);
      if (willExpand) next.add(project.id); else next.delete(project.id);
      return next;
    });
    // 展开时若不是当前选中项目，加载其会话（selectProject 会把 sessions 填充到全局）
    if (willExpand && selectedProject?.id !== project.id) {
      try { await selectProject(project); } catch { /* ignore */ }
    }
  }, [expandedProjects, selectedProject, selectProject]);

  const openSession = useCallback((session: Session) => {
    const result = openSessionInBackground(session);
    switchToTab(result.tabId);
    navigateTo('claude-tab-manager');
  }, [openSessionInBackground, switchToTab, navigateTo]);

  const handleCloseTab = useCallback(async (tabId: string, force = false) => {
    const result = await closeTab(tabId, force);
    if (result && typeof result === 'object' && result.needsConfirmation) {
      setTabToClose(result.tabId || tabId);
    }
  }, [closeTab]);

  const confirmCloseTab = useCallback(async () => {
    if (!tabToClose) return;
    await closeTab(tabToClose, true);
    setTabToClose(null);
  }, [closeTab, tabToClose]);

  // 折叠态：只留一个细把手
  if (collapsed) {
    return (
      <div className="flex-shrink-0 h-full border-r border-border bg-muted/20 flex flex-col items-center py-3">
        <button
          onClick={() => setCollapsed(false)}
          className="h-8 w-8 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          title={t('workbench.expand')}
        >
          <PanelLeftOpen className="h-4 w-4" />
        </button>
      </div>
    );
  }

  return (
    <div
      className="flex-shrink-0 h-full border-r border-border bg-muted/20 flex flex-col relative"
      style={{ width }}
    >
      {/* 头部：标题 + 折叠按钮 */}
      <div className="flex items-center justify-between px-3 h-11 flex-shrink-0 border-b border-border/60">
        <span className="text-xs font-semibold text-muted-foreground tracking-wide uppercase">
          {t('workbench.title')}
        </span>
        <button
          onClick={() => setCollapsed(true)}
          className="h-7 w-7 rounded-md flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          title={t('workbench.collapse')}
        >
          <PanelLeftClose className="h-4 w-4" />
        </button>
      </div>

      {/* 上段：打开的标签 */}
      <WorkbenchTabsSection
        tabs={tabs}
        onSwitch={switchToTab}
        onClose={handleCloseTab}
        onNew={() => { createNewTab(); navigateTo('claude-tab-manager'); }}
      />

      {/* 下段：项目资源管理器 */}
      <WorkbenchProjectTree
        projects={projects}
        selectedProjectId={selectedProject?.id ?? null}
        sessions={sessions}
        expandedProjects={expandedProjects}
        activeSessionId={tabs.find((tb) => tb.isActive)?.session?.id ?? null}
        onToggleProject={toggleProject}
        onOpenSession={openSession}
      />

      {/* 拖拽调宽把手 */}
      <div
        onMouseDown={onDragStart}
        className="absolute top-0 right-0 h-full w-1 cursor-col-resize hover:bg-primary/40 active:bg-primary/60 transition-colors"
      />
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
    </div>
  );
};

export default WorkbenchSidebar;

// ============================================================================
// 上段：打开的标签
// ============================================================================
interface TabsSectionProps {
  tabs: ReturnType<typeof useTabs>['tabs'];
  onSwitch: (id: string) => void;
  onClose: (id: string) => void | Promise<void>;
  onNew: () => void;
}
const WorkbenchTabsSection: React.FC<TabsSectionProps> = ({ tabs, onSwitch, onClose, onNew }) => {
  const { t } = useTranslation();
  return (
    <div className="flex-shrink-0 max-h-[40%] flex flex-col border-b border-border/60">
      <div className="flex items-center justify-between px-3 py-1.5">
        <span className="text-[11px] font-medium text-muted-foreground">
          {t('workbench.openTabs')} ({tabs.length})
        </span>
        <button
          onClick={onNew}
          className="h-6 w-6 rounded flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          title={t('tabs.newSession')}
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="overflow-y-auto px-1.5 pb-1.5 space-y-0.5">
        {tabs.length === 0 ? (
          <div className="px-2 py-3 text-[11px] text-muted-foreground/70 text-center">
            {t('workbench.noTabs')}
          </div>
        ) : tabs.map((tab) => {
          const engine = tab.session?.engine ?? tab.engine ?? 'claude';
          return (
            <div
              key={tab.id}
              onClick={() => onSwitch(tab.id)}
              className={cn(
                'group relative flex items-center gap-2 pl-2.5 pr-1.5 py-1.5 rounded-md cursor-pointer transition-colors',
                tab.isActive
                  ? 'bg-primary/10 text-foreground'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted/60'
              )}
            >
              {tab.isActive && <div className="absolute left-0 top-1 bottom-1 w-0.5 rounded-full bg-primary" />}
              <EngineDot engine={engine} active={tab.isActive} />
              {tab.state === 'streaming' ? (
                <Loader2 className="h-3 w-3 text-green-500 animate-spin flex-shrink-0" />
              ) : tab.hasUnsavedChanges ? (
                <div className="h-1.5 w-1.5 rounded-full bg-amber-500 flex-shrink-0" />
              ) : null}
              <span className={cn('flex-1 truncate text-xs', tab.isActive && 'font-medium')}>
                {tab.title}
              </span>
              <button
                onClick={(e) => { e.stopPropagation(); onClose(tab.id); }}
                className="flex-shrink-0 h-5 w-5 rounded flex items-center justify-center opacity-0 group-hover:opacity-100 hover:bg-muted-foreground/20 transition-opacity"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
};

// ============================================================================
// 下段：项目资源管理器（折叠树）
// ============================================================================
interface ProjectTreeProps {
  projects: Project[];
  selectedProjectId: string | null;
  sessions: Session[];
  expandedProjects: Set<string>;
  activeSessionId: string | null;
  onToggleProject: (project: Project) => void;
  onOpenSession: (session: Session) => void;
}
const WorkbenchProjectTree: React.FC<ProjectTreeProps> = ({
  projects, selectedProjectId, sessions, expandedProjects, activeSessionId, onToggleProject, onOpenSession,
}) => {
  const { t } = useTranslation();
  const [showAll, setShowAll] = useState<Set<string>>(new Set());

  const projectName = (p: Project) => {
    const norm = p.path.replace(/\\/g, '/').replace(/\/+$/, '');
    return norm.split('/').pop() || norm;
  };

  return (
    <div className="flex-1 min-h-0 overflow-y-auto py-1.5">
      <div className="px-3 py-1 text-[11px] font-medium text-muted-foreground">
        {t('workbench.projects')} ({projects.length})
      </div>
      {projects.map((project) => {
        const isExpanded = expandedProjects.has(project.id);
        const isCurrent = selectedProjectId === project.id;
        // 仅当前选中项目能拿到已加载的 sessions；其它项目展开时会触发加载并成为当前项目。
        const projectSessions = isCurrent ? sessions : [];
        const expandedAll = showAll.has(project.id);
        const visible = expandedAll ? projectSessions : projectSessions.slice(0, RECENT_SESSION_COUNT);

        return (
          <div key={project.id} className="px-1.5">
            <button
              onClick={() => onToggleProject(project)}
              className="w-full flex items-center gap-1.5 px-1.5 py-1.5 rounded-md text-xs text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
            >
              <ChevronRight className={cn('h-3.5 w-3.5 flex-shrink-0 transition-transform', isExpanded && 'rotate-90')} />
              <FolderOpen className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
              <span className="flex-1 truncate text-left font-medium">{projectName(project)}</span>
              {project.sessions.length > 0 && (
                <span className="text-[10px] text-muted-foreground/60 tabular-nums">{project.sessions.length}</span>
              )}
            </button>

            {isExpanded && (
              <div className="ml-3 pl-2 border-l border-border/50 space-y-0.5 mb-1">
                {projectSessions.length === 0 ? (
                  <div className="px-2 py-1.5 text-[11px] text-muted-foreground/60">
                    {isCurrent ? t('workbench.noSessions') : t('workbench.loadingSessions')}
                  </div>
                ) : (
                  <>
                    {visible.map((session) => {
                      const isActive = activeSessionId === session.id;
                      const preview = session.first_message
                        ? truncateText(getFirstLine(session.first_message), 40)
                        : session.id.slice(0, 8);
                      return (
                        <div
                          key={session.id}
                          onClick={() => onOpenSession(session)}
                          className={cn(
                            'group flex items-center gap-1.5 px-1.5 py-1 rounded-md cursor-pointer transition-colors',
                            isActive ? 'bg-primary/10 text-foreground' : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
                          )}
                        >
                          <EngineDot engine={session.engine} active={isActive} />
                          <span className={cn('flex-1 truncate text-[11px]', isActive && 'font-medium')}>{preview}</span>
                        </div>
                      );
                    })}
                    {projectSessions.length > RECENT_SESSION_COUNT && (
                      <button
                        onClick={() => setShowAll((prev) => {
                          const next = new Set(prev);
                          if (expandedAll) next.delete(project.id); else next.add(project.id);
                          return next;
                        })}
                        className="w-full flex items-center gap-1 px-1.5 py-1 text-[11px] text-primary/80 hover:text-primary transition-colors"
                      >
                        <MessageSquare className="h-3 w-3" />
                        {expandedAll
                          ? t('workbench.collapseSessions')
                          : t('workbench.showAllSessions', { count: projectSessions.length })}
                      </button>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};
