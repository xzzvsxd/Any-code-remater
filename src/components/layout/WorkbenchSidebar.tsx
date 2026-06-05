import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useTranslation } from '@/hooks/useTranslation';
import {
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Zap,
  Bot,
  Sparkles,
  ChevronRight,
  FolderOpen,
  MessageSquare,
  Terminal,
  BarChart2,
  Layers,
  Package,
  Settings,
  HelpCircle,
  FileText,
  MoreHorizontal,
  Trash2,
  FolderInput,
  Copy,
  RefreshCw,
  ExternalLink,
  X,
  Files,
  Download,
  Pencil,
  GripVertical,
  Loader2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { api } from '@/lib/api';
import { exportSession, type ExportFormat } from '@/lib/sessionExport';
import { codexConverter } from '@/lib/codexConverter';
import { convertGeminiSessionDetailToClaudeMessages } from '@/lib/geminiConverter';
import type { ClaudeStreamMessage } from '@/types/claude';
import { SortableList, SortableDragHandle } from '@/components/ui/sortable-list';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { ThemeToggle } from '@/components/ui/theme-toggle';
import { UnifiedEngineStatus } from '@/components/UnifiedEngineStatus';
import { useTabs } from '@/hooks/useTabs';
import { useProject } from '@/contexts/ProjectContext';
import { useNavigation } from '@/contexts/NavigationContext';
import type { View } from '@/types/navigation';
import type { Project, Session } from '@/lib/api';
import { truncateText, getFirstLine } from '@/lib/date-utils';

interface WorkbenchSidebarProps {
  /** 打开"关于"对话框 */
  onAboutClick?: () => void;
}

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
 * 项目行的分引擎会话数徽章：⚡Claude 🤖Codex ✨Gemini，仅显示 count>0 的引擎。
 * 数据来自后端统一计算的 session_counts；缺省时回退到 sessions.length（仅 Claude）。
 */
const EngineCountBadges: React.FC<{ project: Project; isCurrent: boolean }> = ({ project, isCurrent }) => {
  const { t } = useTranslation();
  const counts = project.session_counts ?? { claude: project.sessions.length, codex: 0, gemini: 0 };
  const total = counts.claude + counts.codex + counts.gemini;
  if (total === 0) return null;

  const items: Array<{ key: string; n: number; Icon: React.ElementType; color: string }> = [
    { key: 'claude', n: counts.claude, Icon: Zap, color: 'text-amber-500' },
    { key: 'codex', n: counts.codex, Icon: Bot, color: 'text-green-500' },
    { key: 'gemini', n: counts.gemini, Icon: Sparkles, color: 'text-blue-500' },
  ].filter((it) => it.n > 0);

  return (
    <span
      className="flex items-center gap-1 tabular-nums"
      title={t('workbench.sessionsTotalTip', { total, claude: counts.claude, codex: counts.codex, gemini: counts.gemini })}
    >
      {items.map(({ key, n, Icon, color }) => (
        <span key={key} className={cn('flex items-center gap-0.5 text-[10px]', isCurrent ? color : `${color}/70`)}>
          <Icon className="h-3 w-3" />
          {n}
        </span>
      ))}
    </span>
  );
};

/**
 * VS Code 式单一工作台侧栏：项目资源管理器为主体 + 底部导航 dock。
 * 合并了原最左侧图标导航栏：导航/设置/关于/主题等收进底部 dock。
 * 可拖拽调宽、可折叠，状态持久化到 localStorage。
 */
export const WorkbenchSidebar: React.FC<WorkbenchSidebarProps> = ({ onAboutClick }) => {
  const { t } = useTranslation();
  const { tabs, switchToTab, createNewTab, openSessionInBackground, closeTab } = useTabs();
  const { projects, selectedProject, sessions, sessionsByProject, sessionsLoading, selectProject, deleteProject, refreshSessions, loadProjectSessions } = useProject();
  const { currentView, navigateTo } = useNavigation();

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
  // 待确认的危险操作：删除会话 / 移除项目 / 永久删除项目
  const [confirm, setConfirm] = useState<
    | { kind: 'deleteSession'; session: Session }
    | { kind: 'removeProject'; project: Project }
    | { kind: 'purgeProject'; project: Project }
    | null
  >(null);
  const [busy, setBusy] = useState(false);
  // 会话自定义标题映射（{session_id: title}），用于覆盖首条消息派生的默认名
  const [sessionTitles, setSessionTitles] = useState<Record<string, string>>({});
  // 会话自定义排序（{ "engine:project_id": [session_id...] }）
  const [sessionOrder, setSessionOrder] = useState<Record<string, string[]>>({});
  // 项目手动拖拽顺序（项目 id 列表）；非空即"用户已手动排序"，锁定顺序、不再自动置顶。
  const [projectOrder, setProjectOrder] = useState<string[]>([]);
  // 项目最近触发请求的时间戳（项目 id -> ts），用于"活跃项目自动置顶"（仅无手动顺序时生效）。
  const [projectActivityTs, setProjectActivityTs] = useState<Record<string, number>>({});

  const reloadMeta = useCallback(async () => {
    try {
      const meta = await api.getSessionMeta();
      setSessionTitles(meta.titles || {});
      setSessionOrder(meta.order || {});
      setProjectOrder(meta.project_order || []);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { reloadMeta(); }, [reloadMeta]);

  // 项目拖拽排序：写入手动顺序并持久化。一旦有手动顺序，排序即锁定（自动置顶让位）。
  const reorderProjects = useCallback(async (orderedIds: string[]) => {
    setProjectOrder(orderedIds);
    try {
      await api.setProjectOrder(orderedIds);
    } catch (e) {
      console.error('[Workbench] reorder projects failed:', e);
    }
  }, []);

  const renameSession = useCallback(async (session: Session, title: string) => {
    try {
      await api.setSessionTitle(session.id, title);
      setSessionTitles((prev) => {
        const next = { ...prev };
        const v = title.trim();
        if (v) next[session.id] = v; else delete next[session.id];
        return next;
      });
    } catch (e) {
      console.error('[Workbench] rename failed:', e);
    }
  }, []);

  const reorderSessions = useCallback(async (engine: string, projectId: string, orderedIds: string[]) => {
    const key = `${engine}:${projectId}`;
    setSessionOrder((prev) => ({ ...prev, [key]: orderedIds }));
    try {
      await api.setSessionOrder(engine, projectId, orderedIds);
    } catch (e) {
      console.error('[Workbench] reorder failed:', e);
    }
  }, []);

  const draggingRef = useRef(false);

  // 运行中的会话集合：取自已打开标签页的 streaming 状态，供工作台树实时高亮。
  const runningSessionIds = React.useMemo(
    () => new Set(tabs.filter((tb) => tb.state === 'streaming' && tb.session?.id).map((tb) => tb.session!.id)),
    [tabs],
  );
  // 已在标签页打开的会话（含尚未落盘的新建会话）：实时合并进项目树，
  // 无需等待 AI 完成事件与磁盘刷新，新会话拿到 sessionId 即刻可见。
  // 落盘前 session 无 first_message，用标签页标题兜底，避免显示成裸 id。
  const openTabSessions = React.useMemo(
    () => tabs
      .filter((tb) => tb.session?.id)
      .map((tb) => (tb.session!.first_message ? tb.session! : { ...tb.session!, first_message: tb.title })),
    [tabs],
  );

  // 活跃置顶时间戳：有标签进入 streaming 时，给其所属项目打当前时间戳，供"活跃项目自动置顶"。
  // 仅在用户未手动排序（projectOrder 为空）时参与排序；手动排序后锁定，不再被打乱。
  useEffect(() => {
    const runningProjectIds = tabs
      .filter((tb) => tb.state === 'streaming' && tb.session?.project_id)
      .map((tb) => tb.session!.project_id);
    if (runningProjectIds.length === 0) return;
    setProjectActivityTs((prev) => {
      const now = Date.now();
      let changed = false;
      const next = { ...prev };
      runningProjectIds.forEach((pid) => {
        if (pid) { next[pid] = now; changed = true; }
      });
      return changed ? next : prev;
    });
  }, [tabs]);

  useEffect(() => {
    try { localStorage.setItem(COLLAPSED_KEY, String(collapsed)); } catch { /* ignore */ }
  }, [collapsed]);
  useEffect(() => {
    try { localStorage.setItem(WIDTH_KEY, String(width)); } catch { /* ignore */ }
  }, [width]);

  // 项目显示顺序：① 有手动顺序(projectOrder 非空) → 按它排，未列入的按活跃时间补末尾、锁定不被置顶打乱；
  // ② 无手动顺序 → 按活跃时间降序(取项目自身活跃时间与 projectActivityTs 的较大值)，触发新请求的项目自动置顶。
  const orderedProjects = React.useMemo(() => {
    const activityOf = (p: Project) => Math.max(p.created_at * 1000 || 0, projectActivityTs[p.id] ?? 0);
    if (projectOrder.length > 0) {
      const indexOf = (id: string) => {
        const i = projectOrder.indexOf(id);
        return i === -1 ? Number.MAX_SAFE_INTEGER : i;
      };
      return [...projects].sort((a, b) => {
        const ia = indexOf(a.id);
        const ib = indexOf(b.id);
        if (ia !== ib) return ia - ib;        // 手动顺序优先
        return activityOf(b) - activityOf(a); // 都未列入时按活跃时间补在末尾
      });
    }
    return [...projects].sort((a, b) => activityOf(b) - activityOf(a));
  }, [projects, projectOrder, projectActivityTs]);

  // 当前选中项目默认展开（多项目展开：仅把选中项加入展开集合，不收起其它项目）
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

  // 聚焦时只刷新「已展开的项目」：窗口重新可见且聚焦时，遍历展开集合各自静默刷新会话。
  // 用 ref 持有最新值，effect 仅挂载一次；不引入定时轮询，避免 Linux 上的高频扫描卡顿。
  const focusRefreshRef = useRef<{ expanded: Set<string>; projects: Project[]; load: typeof loadProjectSessions }>({
    expanded: expandedProjects,
    projects,
    load: loadProjectSessions,
  });
  useEffect(() => {
    focusRefreshRef.current = { expanded: expandedProjects, projects, load: loadProjectSessions };
  }, [expandedProjects, projects, loadProjectSessions]);

  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState !== 'visible' || !document.hasFocus()) return;
      const { expanded, projects: projs, load } = focusRefreshRef.current;
      projs.forEach((p) => {
        if (expanded.has(p.id)) {
          load(p, { silent: true }).catch(() => { /* ignore */ });
        }
      });
    };

    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('focus', handleVisibility);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('focus', handleVisibility);
    };
  }, []);
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
    // 多项目展开：增量展开/收起，不再收起其它项目（数据层已按项目缓存会话，互不抢占）。
    setExpandedProjects((prev) => {
      const next = new Set(prev);
      if (willExpand) next.add(project.id); else next.delete(project.id);
      return next;
    });
    if (willExpand) {
      // 加载该项目会话到按项目缓存（不强制改 selectedProject，其它展开项目不受影响）。
      loadProjectSessions(project).catch(() => { /* ignore */ });
      // 同时把它设为"当前选中"用于高亮（selectProject 不再破坏其它展开项目）。
      if (selectedProject?.id !== project.id) {
        try { await selectProject(project); } catch { /* ignore */ }
      }
    }
  }, [expandedProjects, selectedProject, selectProject, loadProjectSessions]);

  const openSession = useCallback((session: Session) => {
    const result = openSessionInBackground(session);
    switchToTab(result.tabId);
    navigateTo('claude-tab-manager');
  }, [openSessionInBackground, switchToTab, navigateTo]);

  const onNewSession = useCallback(() => {
    createNewTab();
    navigateTo('claude-tab-manager');
  }, [createNewTab, navigateTo]);

  // 在指定项目下新建会话：createNewTab 第二参数接受项目路径，新标签即落在该项目目录。
  const onNewSessionInProject = useCallback((project: Project) => {
    createNewTab(undefined, project.path);
    navigateTo('claude-tab-manager');
  }, [createNewTab, navigateTo]);

  // ---- 右键菜单操作 ----
  const toast = (message: string, type: 'success' | 'error' | 'info' = 'success') => {
    window.dispatchEvent(new CustomEvent('show-toast', { detail: { message, type } }));
  };

  const copyText = useCallback(async (text: string, label: string) => {
    try {
      await api.writeToClipboard(text);
      toast(label);
    } catch {
      toast(t('workbench.ctx.copyFailed'), 'error');
    }
  }, [t]);

  const openInExplorer = useCallback(async (path: string) => {
    try {
      await api.openDirectoryInExplorer(path);
    } catch {
      toast(t('workbench.ctx.openFailed'), 'error');
    }
  }, [t]);

  const duplicateSession = useCallback(async (session: Session) => {
    try {
      const engine = (session.engine || 'claude') as 'claude' | 'codex' | 'gemini';
      await api.duplicateSession(engine, session.id, session.project_id, session.project_path);
      toast(t('workbench.ctx.sessionDuplicated'));
      if (selectedProject?.id === session.project_id) await refreshSessions();
    } catch (e) {
      toast(t('workbench.ctx.actionFailed'), 'error');
      console.error('[Workbench] duplicate failed:', e);
    }
  }, [t, selectedProject, refreshSessions]);

  const exportSessionAs = useCallback(async (session: Session, format: ExportFormat) => {
    try {
      const engine = (session.engine || 'claude') as 'claude' | 'codex' | 'gemini';
      // 工作台树未加载会话内容，先按引擎加载历史再导出。
      let messages: ClaudeStreamMessage[];
      if (engine === 'gemini') {
        const detail = await api.getGeminiSessionDetail(session.project_path, session.id);
        messages = convertGeminiSessionDetailToClaudeMessages(detail) as ClaudeStreamMessage[];
      } else {
        const history = await api.loadSessionHistory(session.id, session.project_id, engine as any);
        if (engine === 'codex' && Array.isArray(history)) {
          codexConverter.reset();
          messages = [];
          for (const ev of history) {
            const m = codexConverter.convertEventObject(ev as any);
            if (m) messages.push(m);
          }
        } else {
          messages = Array.isArray(history) ? history : (history as any)?.messages || [];
        }
      }
      const saved = await exportSession(messages, format, session);
      if (saved) toast(t('workbench.ctx.exported'));
    } catch (e) {
      toast(t('workbench.ctx.exportFailed'), 'error');
      console.error('[Workbench] export failed:', e);
    }
  }, [t]);

  const runConfirm = useCallback(async () => {
    if (!confirm) return;
    setBusy(true);
    try {
      if (confirm.kind === 'deleteSession') {
        const s = confirm.session;
        const engine = s.engine || 'claude';
        if (engine === 'codex') await api.deleteCodexSession(s.id);
        else if (engine === 'gemini') await api.deleteGeminiSession(s.project_path, s.id);
        else await api.deleteSession(s.id, s.project_id);
        toast(t('workbench.ctx.sessionDeleted'));
        // 会话树由「落盘列表 + 已打开标签页(openTabSessions)」合并而成：若被删会话仍有标签页打开，
        // 仅刷新落盘列表它会被标签页重新注入树而“删不掉”。用户已确认删除，强制关闭其标签页。
        const openTabs = tabs
          .filter((tb) => tb.session?.id === s.id)
          // 先关非活跃标签，最后关活跃标签：useTabs.forceCloseTab 会在关闭活跃标签时自动切换。
          // 如果先关活跃标签、再关同会话的另一个重复标签，旧 activeTabId 闭包可能把 activeTabId
          // 留在已删除标签上；把活跃标签放最后可避免这个边界。
          .sort((a, b) => Number(a.isActive) - Number(b.isActive));
        for (const tb of openTabs) {
          await closeTab(tb.id, true);
        }
        if (selectedProject?.id === s.project_id) await refreshSessions();
      } else if (confirm.kind === 'removeProject') {
        await deleteProject(confirm.project);
        toast(t('workbench.ctx.projectRemoved'));
      } else if (confirm.kind === 'purgeProject') {
        await api.deleteProjectPermanently(confirm.project.id);
        toast(t('workbench.ctx.projectPurged'));
        await refreshSessions();
      }
    } catch (e) {
      toast(t('workbench.ctx.actionFailed'), 'error');
      console.error('[Workbench] action failed:', e);
    } finally {
      setBusy(false);
      setConfirm(null);
    }
  }, [confirm, selectedProject, refreshSessions, deleteProject, tabs, closeTab, t]);

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
      className="flex-shrink-0 h-full border-r border-border/60 bg-gradient-to-b from-muted/30 to-muted/10 backdrop-blur-sm flex flex-col relative"
      style={{ width }}
    >
      {/* 头部：标题 + 新建会话 + 折叠按钮 */}
      <div className="flex items-center justify-between pl-3.5 pr-2 h-11 flex-shrink-0 border-b border-border/50">
        <span className="text-[11px] font-bold text-foreground/70 tracking-[0.08em] uppercase">
          {t('workbench.title')}
        </span>
        <div className="flex items-center gap-0.5">
          <button
            onClick={onNewSession}
            className="h-7 w-7 rounded-lg flex items-center justify-center text-muted-foreground hover:text-primary hover:bg-primary/10 transition-all duration-150 active:scale-90"
            title={t('tabs.newSession')}
          >
            <Plus className="h-4 w-4" />
          </button>
          <button
            onClick={() => setCollapsed(true)}
            className="h-7 w-7 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-all duration-150 active:scale-90"
            title={t('workbench.collapse')}
          >
            <PanelLeftClose className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* 主体：项目资源管理器（打开中的会话在树里高亮，无需单独标签列表） */}
      <WorkbenchProjectTree
        projects={orderedProjects}
        selectedProjectId={selectedProject?.id ?? null}
        sessions={sessions}
        sessionsByProject={sessionsByProject}
        sessionsLoading={sessionsLoading}
        expandedProjects={expandedProjects}
        activeSessionId={tabs.find((tb) => tb.isActive)?.session?.id ?? null}
        runningSessionIds={runningSessionIds}
        openTabSessions={openTabSessions}
        onToggleProject={toggleProject}
        onOpenSession={openSession}
        onNewSession={onNewSession}
        onNewSessionInProject={onNewSessionInProject}
        onRefreshProject={(p) => selectProject(p)}
        onOpenInExplorer={openInExplorer}
        onCopyText={copyText}
        onDuplicateSession={duplicateSession}
        onExportSession={exportSessionAs}
        sessionTitles={sessionTitles}
        onRenameSession={renameSession}
        sessionOrder={sessionOrder}
        onReorderSessions={reorderSessions}
        onReorderProjects={reorderProjects}
        onRequestDeleteSession={(s) => setConfirm({ kind: 'deleteSession', session: s })}
        onRequestRemoveProject={(p) => setConfirm({ kind: 'removeProject', project: p })}
        onRequestPurgeProject={(p) => setConfirm({ kind: 'purgeProject', project: p })}
      />

      {/* 底部导航 dock：合并自原图标侧栏 */}
      <WorkbenchNavDock
        currentView={currentView}
        onNavigate={navigateTo}
        onAboutClick={onAboutClick}
      />

      {/* 拖拽调宽把手 */}
      <div
        onMouseDown={onDragStart}
        className="absolute top-0 right-0 h-full w-1 cursor-col-resize hover:bg-primary/40 active:bg-primary/60 transition-colors"
      />

      {/* 危险操作确认对话框 */}
      <Dialog open={confirm !== null} onOpenChange={(open) => !open && !busy && setConfirm(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {confirm?.kind === 'deleteSession' && t('workbench.ctx.confirmDeleteSessionTitle')}
              {confirm?.kind === 'removeProject' && t('workbench.ctx.confirmRemoveProjectTitle')}
              {confirm?.kind === 'purgeProject' && t('workbench.ctx.confirmPurgeProjectTitle')}
            </DialogTitle>
            <DialogDescription>
              {confirm?.kind === 'deleteSession' && t('workbench.ctx.confirmDeleteSessionDesc')}
              {confirm?.kind === 'removeProject' && t('workbench.ctx.confirmRemoveProjectDesc')}
              {confirm?.kind === 'purgeProject' && t('workbench.ctx.confirmPurgeProjectDesc')}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" disabled={busy} onClick={() => setConfirm(null)}>
              {t('buttons.cancel')}
            </Button>
            <Button variant="destructive" disabled={busy} onClick={runConfirm}>
              {busy ? t('workbench.ctx.processing') : t('workbench.ctx.confirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default WorkbenchSidebar;

// ============================================================================
// 底部导航 dock（合并自原最左侧图标侧栏）
// ============================================================================
interface NavDockProps {
  currentView: View;
  onNavigate: (view: View) => void;
  onAboutClick?: () => void;
}

/** 提示词编辑器三选一（Claude / Codex / Gemini 合并为一个入口） */
const PROMPT_EDITORS: Array<{ view: View; labelKey: string; icon: React.ElementType }> = [
  { view: 'editor', labelKey: 'sidebar.claudePrompts', icon: Zap },
  { view: 'codex-editor', labelKey: 'sidebar.codexPrompts', icon: Bot },
  { view: 'gemini-editor', labelKey: 'sidebar.geminiPrompts', icon: Sparkles },
];

const WorkbenchNavDock: React.FC<NavDockProps> = ({ currentView, onNavigate, onAboutClick }) => {
  const { t } = useTranslation();

  const isPromptView = currentView === 'editor' || currentView === 'codex-editor' || currentView === 'gemini-editor';

  // 主导航项：图标 + 文字并排的网格按钮，避免纯图标靠 hover 猜功能。
  const NavItem: React.FC<{
    active?: boolean;
    label: string;
    icon: React.ElementType;
    onClick: () => void;
  }> = ({ active, label, icon: Icon, onClick }) => (
    <button
      onClick={onClick}
      className={cn(
        'flex items-center gap-2 px-2.5 py-2 rounded-lg text-xs font-medium transition-all duration-150 active:scale-[0.97] min-w-0',
        active
          ? 'bg-primary/15 text-primary shadow-sm shadow-primary/10'
          : 'text-muted-foreground hover:text-foreground hover:bg-muted'
      )}
    >
      <Icon className="h-4 w-4 flex-shrink-0" />
      <span className="truncate">{label}</span>
    </button>
  );

  // 系统类：底部紧凑图标行（主题/关于/更新/设置）。
  const IconButton: React.FC<{
    active?: boolean;
    label: string;
    onClick: () => void;
    children: React.ReactNode;
  }> = ({ active, label, onClick, children }) => (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          onClick={onClick}
          aria-label={label}
          className={cn(
            'h-8 w-8 rounded-lg flex items-center justify-center transition-all duration-150 active:scale-90',
            active
              ? 'bg-primary/15 text-primary shadow-sm shadow-primary/10'
              : 'text-muted-foreground hover:text-foreground hover:bg-muted'
          )}
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent side="top">{label}</TooltipContent>
    </Tooltip>
  );

  return (
    <div className="flex-shrink-0 border-t border-border/50 bg-muted/20">
      {/* 引擎状态（紧凑） */}
      <div className="px-3 pt-2.5 flex justify-center">
        <UnifiedEngineStatus compact />
      </div>

      <TooltipProvider delayDuration={0}>
        {/* 主导航：2 列文字网格 */}
        <div className="grid grid-cols-2 gap-1 px-2 pt-2.5">
          <NavItem
            active={currentView === 'projects'}
            label={t('common.ccProjectsTitle')}
            icon={FolderOpen}
            onClick={() => onNavigate('projects')}
          />
          <NavItem
            active={currentView === 'claude-tab-manager'}
            label={t('sidebar.sessionManagement')}
            icon={Terminal}
            onClick={() => onNavigate('claude-tab-manager')}
          />
          <NavItem
            active={currentView === 'usage-dashboard'}
            label={t('sidebar.usageStats')}
            icon={BarChart2}
            onClick={() => onNavigate('usage-dashboard')}
          />

          {/* 提示词三合一：下拉选择 Claude / Codex / Gemini */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                className={cn(
                  'flex items-center gap-2 px-2.5 py-2 rounded-lg text-xs font-medium transition-all duration-150 active:scale-[0.97] min-w-0',
                  isPromptView
                    ? 'bg-primary/15 text-primary shadow-sm shadow-primary/10'
                    : 'text-muted-foreground hover:text-foreground hover:bg-muted'
                )}
              >
                <FileText className="h-4 w-4 flex-shrink-0" />
                <span className="truncate flex-1 text-left">{t('sidebar.prompts')}</span>
                <ChevronRight className="h-3 w-3 flex-shrink-0 opacity-50" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="center" side="top">
              {PROMPT_EDITORS.map((p) => (
                <DropdownMenuItem key={p.view} onClick={() => onNavigate(p.view)}>
                  <p.icon className="h-4 w-4 mr-2" />
                  {t(p.labelKey)}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          <NavItem
            active={currentView === 'mcp'}
            label={t('sidebar.mcpTools')}
            icon={Layers}
            onClick={() => onNavigate('mcp')}
          />
          <NavItem
            active={currentView === 'claude-extensions'}
            label={t('sidebar.extensions')}
            icon={Package}
            onClick={() => onNavigate('claude-extensions')}
          />
        </div>

        {/* 系统行：主题 / 关于 / 设置 */}
        <div className="flex items-center justify-center gap-1 px-2 py-2 mt-1 border-t border-border/40">
          <ThemeToggle size="sm" className="w-8 h-8" />
          {onAboutClick && (
            <IconButton label={t('sidebar.about')} onClick={onAboutClick}>
              <HelpCircle className="h-4 w-4" />
            </IconButton>
          )}
          <IconButton
            active={currentView === 'settings'}
            label={t('navigation.settings')}
            onClick={() => onNavigate('settings')}
          >
            <Settings className="h-4 w-4" />
          </IconButton>
        </div>
      </TooltipProvider>
    </div>
  );
};

// ============================================================================
// 项目资源管理器（折叠树）
// ============================================================================
interface ProjectTreeProps {
  projects: Project[];
  selectedProjectId: string | null;
  sessions: Session[];
  /** 按项目 id 缓存的会话，支持多项目同时展开各显各的会话 */
  sessionsByProject: Record<string, Session[]>;
  /** 当前选中项目的会话是否正在加载，用于空状态文案区分「加载中 / 暂无会话」 */
  sessionsLoading: boolean;
  expandedProjects: Set<string>;
  activeSessionId: string | null;
  /** 运行中的会话 id 集合（来自标签页 streaming 状态），用于实时高亮 */
  runningSessionIds: Set<string>;
  /** 已在标签页打开的会话（含未落盘的新建会话），实时合并进树 */
  openTabSessions: Session[];
  onToggleProject: (project: Project) => void;
  onOpenSession: (session: Session) => void;
  onNewSession: () => void;
  onNewSessionInProject: (project: Project) => void;
  onRefreshProject: (project: Project) => void;
  onOpenInExplorer: (path: string) => void;
  onCopyText: (text: string, label: string) => void;
  onDuplicateSession: (session: Session) => void;
  onExportSession: (session: Session, format: ExportFormat) => void;
  sessionTitles: Record<string, string>;
  onRenameSession: (session: Session, title: string) => void;
  sessionOrder: Record<string, string[]>;
  onReorderSessions: (engine: string, projectId: string, orderedIds: string[]) => void;
  onReorderProjects: (orderedIds: string[]) => void;
  onRequestDeleteSession: (session: Session) => void;
  onRequestRemoveProject: (project: Project) => void;
  onRequestPurgeProject: (project: Project) => void;
}
const WorkbenchProjectTree: React.FC<ProjectTreeProps> = ({
  projects, selectedProjectId, sessions, sessionsByProject, sessionsLoading, expandedProjects, activeSessionId, runningSessionIds, openTabSessions,
  onToggleProject, onOpenSession,
  onNewSession, onNewSessionInProject, onRefreshProject, onOpenInExplorer, onCopyText, onDuplicateSession, onExportSession,
  sessionTitles, onRenameSession, sessionOrder, onReorderSessions, onReorderProjects,
  onRequestDeleteSession, onRequestRemoveProject, onRequestPurgeProject,
}) => {
  const { t } = useTranslation();
  const [showAll, setShowAll] = useState<Set<string>>(new Set());
  // 右键菜单受控状态：记录当前打开菜单的目标 key
  const [menuFor, setMenuFor] = useState<string | null>(null);
  // 会话 inline 重命名编辑态
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');

  const projectName = (p: Project) => {
    const norm = p.path.replace(/\\/g, '/').replace(/\/+$/, '');
    return norm.split('/').pop() || norm;
  };

  // 标签页会话与项目的归一化路径匹配：project_id 在虚拟项目/大小写差异下可能对不上，
  // 故同时以归一化路径作为回退匹配键，确保新会话落到正确项目。
  const normPath = (p?: string) => (p ? p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase() : '');
  const tabSessionBelongsTo = (s: Session, project: Project) =>
    s.project_id === project.id || (!!s.project_path && normPath(s.project_path) === normPath(project.path));

  return (
    <div className="flex-1 min-h-0 overflow-y-auto py-2 px-1">
      <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70 flex items-center gap-1.5">
        <FolderOpen className="h-3 w-3" />
        <span className="normal-case tracking-normal text-[11px]">{t('workbench.projectsCount', { count: projects.length })}</span>
        <button
          onClick={onNewSession}
          className="ml-auto h-5 w-5 rounded flex items-center justify-center text-muted-foreground hover:text-primary hover:bg-primary/10 transition-all duration-150 active:scale-90"
          title={t('workbench.newSessionInProject')}
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="space-y-0.5 mt-0.5">
      <SortableList
        items={projects}
        customHandle
        listClassName="space-y-0.5"
        onReorder={(items) => onReorderProjects(items.map((p) => p.id))}
        renderItem={(project) => {
        const isExpanded = expandedProjects.has(project.id);
        const isCurrent = selectedProjectId === project.id;
        // 多项目展开：优先读该项目的按项目缓存；缓存未命中时回退到当前选中项目的 sessions。
        const cachedSessions = sessionsByProject[project.id];
        const diskSessions = cachedSessions ?? (isCurrent ? sessions : []);
        // 缓存未命中（首次展开、尚未加载完）视为加载中，用于空状态文案区分「加载中 / 暂无会话」。
        const isProjectLoading = cachedSessions === undefined && (isCurrent ? sessionsLoading : isExpanded);
        // 实时合并该项目下"已在标签页打开但尚未落盘/尚未刷新"的会话，
        // 使新建会话拿到 sessionId 后立刻出现在树里，无需等 AI 完成事件。
        const diskIds = new Set(diskSessions.map((s) => s.id));
        const pendingTabSessions = openTabSessions.filter(
          (s) => tabSessionBelongsTo(s, project) && !diskIds.has(s.id),
        );
        const rawSessions = pendingTabSessions.length > 0
          ? [...pendingTabSessions, ...diskSessions]
          : diskSessions;
        // 应用用户自定义排序：order key 以项目维度存储（引擎前缀固定，仅作存储键）。
        const orderKey = `proj:${project.id}`;
        const savedOrder = sessionOrder[orderKey];
        const projectSessions = savedOrder && savedOrder.length > 0
          ? [...rawSessions].sort((a, b) => {
              const ia = savedOrder.indexOf(a.id);
              const ib = savedOrder.indexOf(b.id);
              if (ia === -1 && ib === -1) return 0;
              if (ia === -1) return 1;
              if (ib === -1) return -1;
              return ia - ib;
            })
          : rawSessions;
        const expandedAll = showAll.has(project.id);
        const visible = expandedAll ? projectSessions : projectSessions.slice(0, RECENT_SESSION_COUNT);

        // 该项目下运行中的会话数：取所有已打开标签会话中归属本项目、且处于 streaming 的。
        // 用 openTabSessions（不依赖项目是否展开/缓存是否命中），保证未展开项目也能显示运行标识。
        const runningCount = openTabSessions.filter(
          (s) => tabSessionBelongsTo(s, project) && runningSessionIds.has(s.id),
        ).length;
        const hasRunning = runningCount > 0;

        return (
          <div className="px-1">
            <div
              role="button"
              tabIndex={0}
              onClick={() => onToggleProject(project)}
              onContextMenu={(e) => { e.preventDefault(); setMenuFor(`proj:${project.id}`); }}
              className={cn(
                'group/proj relative w-full flex items-center gap-1.5 pl-1.5 pr-1 py-1.5 rounded-lg text-xs cursor-pointer transition-all duration-150',
                isCurrent
                  ? 'bg-primary/10 text-foreground font-semibold'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted/50 font-medium'
              )}
            >
              {isCurrent && <span className="absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-full bg-primary" />}
              {/* 拖拽手柄：hover 项目行时显示，按住可调整项目显示顺序 */}
              <SortableDragHandle className="flex-shrink-0 h-4 w-3 -ml-1 opacity-0 group-hover/proj:opacity-100 transition-opacity cursor-grab">
                <GripVertical className="h-3 w-3" />
              </SortableDragHandle>
              <ChevronRight className={cn('h-3.5 w-3.5 flex-shrink-0 transition-transform duration-200 text-muted-foreground/70', isExpanded && 'rotate-90')} />
              {/* 文件夹图标：有运行中会话时变运行色（amber），优先级高于选中色，一眼区分"正在跑" */}
              <FolderOpen className={cn(
                'h-3.5 w-3.5 flex-shrink-0',
                hasRunning ? 'text-amber-500' : isCurrent ? 'text-primary' : 'text-muted-foreground/70'
              )} />
              <span className="flex-1 truncate text-left">{projectName(project)}</span>

              {/* 运行中会话数：图标变色 + 数字（amber 小字），常驻显示、不随 hover 隐藏 */}
              {hasRunning && (
                <span
                  className="flex-shrink-0 flex items-center gap-0.5 text-[10px] font-semibold text-amber-500 tabular-nums"
                  title={t('workbench.runningSessions', { count: runningCount })}
                >
                  <Loader2 className="h-3 w-3 animate-spin" />
                  {runningCount}
                </span>
              )}

              {/* 会话数徽章（分引擎图标）：hover 项目行时隐藏，给 ⋯ 让位 */}
              <span className="group-hover/proj:hidden">
                <EngineCountBadges project={project} isCurrent={isCurrent} />
              </span>

              {/* ⋯ 操作菜单（hover 浮现 / 右键也可触发） */}
              <DropdownMenu open={menuFor === `proj:${project.id}`} onOpenChange={(o) => setMenuFor(o ? `proj:${project.id}` : null)}>
                <DropdownMenuTrigger asChild>
                  <button
                    onClick={(e) => { e.stopPropagation(); setMenuFor(`proj:${project.id}`); }}
                    className={cn(
                      'flex-shrink-0 h-5 w-5 rounded flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted-foreground/15 transition-opacity',
                      menuFor === `proj:${project.id}` ? 'opacity-100' : 'opacity-0 group-hover/proj:opacity-100'
                    )}
                  >
                    <MoreHorizontal className="h-3.5 w-3.5" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-52" onClick={(e) => e.stopPropagation()}>
                  <DropdownMenuItem onClick={() => onNewSessionInProject(project)}>
                    <Plus className="h-4 w-4 mr-2" />{t('workbench.ctx.newSession')}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => onOpenInExplorer(project.path)}>
                    <FolderInput className="h-4 w-4 mr-2" />{t('workbench.ctx.openInExplorer')}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => onCopyText(project.path, t('workbench.ctx.pathCopied'))}>
                    <Copy className="h-4 w-4 mr-2" />{t('workbench.ctx.copyPath')}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => onRefreshProject(project)}>
                    <RefreshCw className="h-4 w-4 mr-2" />{t('workbench.ctx.refreshSessions')}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => onRequestRemoveProject(project)}>
                    <X className="h-4 w-4 mr-2" />{t('workbench.ctx.removeFromList')}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => onRequestPurgeProject(project)}
                    className="text-destructive focus:text-destructive"
                  >
                    <Trash2 className="h-4 w-4 mr-2" />{t('workbench.ctx.deletePermanently')}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            {isExpanded && (
              <div className="ml-[15px] pl-2.5 border-l border-border/40 space-y-px my-0.5">
                {projectSessions.length === 0 ? (
                  <div className="px-2 py-2 text-[11px] text-muted-foreground/50 italic">
                    {/* 多项目展开：该项目缓存未命中（加载中）显示「加载中」，加载完成且确实无会话才显示「暂无会话」 */}
                    {isProjectLoading ? t('workbench.loadingSessions') : t('workbench.noSessions')}
                  </div>
                ) : (
                  <>
                    <SortableList
                      items={visible}
                      customHandle
                      listClassName="space-y-px"
                      disabled={expandedAll}
                      onReorder={(items) => {
                        // 拖拽仅在「最近 N 个」视图启用（展开全部时退化为纯列表、不挂 dnd-kit，
                        // 避免几百个 useSortable 实例导致 Linux 反复开关文件夹卡死）。
                        // 此时 items 是拖拽后的前 N 个，完整顺序 = 新前 N + 其余会话（保持原相对序）。
                        const movedIds = new Set(items.map((s) => s.id));
                        const rest = projectSessions.filter((s) => !movedIds.has(s.id));
                        onReorderSessions('proj', project.id, [...items, ...rest].map((s) => s.id));
                      }}
                      renderItem={(session) => {
                      const isActive = activeSessionId === session.id;
                      const isRunning = runningSessionIds.has(session.id);
                      const customTitle = sessionTitles[session.id];
                      const preview = customTitle
                        ? truncateText(customTitle, 40)
                        : session.first_message
                          ? truncateText(getFirstLine(session.first_message), 40)
                          : session.id.slice(0, 8);
                      const isRenaming = renamingId === session.id;
                      return (
                        <div
                          onClick={() => { if (!isRenaming) onOpenSession(session); }}
                          onContextMenu={(e) => { e.preventDefault(); setMenuFor(`sess:${session.id}`); }}
                          className={cn(
                            'group/sess relative flex items-center gap-1.5 pl-1 pr-1 py-1.5 rounded-md cursor-pointer transition-all duration-150',
                            // 运行态不再铺满整行遮罩：背景以「是否选中」为准，运行状态改用旋转 loading 图标表达，两者互不打架。
                            isActive
                              ? 'bg-gradient-to-r from-primary/15 to-primary/5 text-foreground'
                              : isRunning
                                ? 'bg-amber-500/[0.06] text-foreground'
                                : 'text-muted-foreground/90 hover:text-foreground hover:bg-muted/40'
                          )}
                        >
                          {isActive ? (
                            <span className="absolute left-0 top-1 bottom-1 w-0.5 rounded-full bg-primary" />
                          ) : isRunning ? (
                            <span className="absolute left-0 top-1 bottom-1 w-0.5 rounded-full bg-amber-500/80" />
                          ) : null}
                          {/* 拖拽手柄：仅「最近 N 个」视图可见可用（展开全部时退化纯列表、无拖拽） */}
                          {!expandedAll && (
                            <SortableDragHandle className="flex-shrink-0 h-4 w-3 opacity-0 group-hover/sess:opacity-100 transition-opacity">
                              <GripVertical className="h-3 w-3" />
                            </SortableDragHandle>
                          )}
                          {/* 运行中直接用旋转 loading 图标替换引擎图标，明确表达「执行中」；空闲时显示引擎图标 */}
                          <span className="flex items-center justify-center flex-shrink-0">
                            {isRunning ? (
                              <Loader2 className="h-3.5 w-3.5 text-amber-500 animate-spin" />
                            ) : (
                              <EngineDot engine={session.engine} active={isActive} />
                            )}
                          </span>
                          {isRenaming ? (
                            <input
                              autoFocus
                              value={renameDraft}
                              onClick={(e) => e.stopPropagation()}
                              onChange={(e) => setRenameDraft(e.target.value)}
                              onBlur={() => { onRenameSession(session, renameDraft); setRenamingId(null); }}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') { onRenameSession(session, renameDraft); setRenamingId(null); }
                                else if (e.key === 'Escape') setRenamingId(null);
                              }}
                              className="flex-1 min-w-0 px-1 py-0.5 rounded bg-background border border-primary/50 text-[11px] outline-none"
                            />
                          ) : (
                            <span
                              onDoubleClick={(e) => { e.stopPropagation(); setRenameDraft(customTitle || preview); setRenamingId(session.id); }}
                              className={cn('flex-1 truncate text-[11px] leading-relaxed', isActive && 'font-medium')}
                            >
                              {preview}
                            </span>
                          )}

                          {/* 会话行操作菜单：懒挂载——仅当前打开的那一行渲染完整 Radix DropdownMenu 树，
                              其余几百行只渲染纯 button，消除"每行常驻一个 DropdownMenu Root+Trigger"的开销。 */}
                          {menuFor === `sess:${session.id}` ? (
                            <DropdownMenu open onOpenChange={(o) => { if (!o) setMenuFor(null); }}>
                              <DropdownMenuTrigger asChild>
                                <button
                                  onClick={(e) => { e.stopPropagation(); }}
                                  className="flex-shrink-0 h-5 w-5 rounded flex items-center justify-center text-foreground bg-muted-foreground/15 opacity-100"
                                >
                                  <MoreHorizontal className="h-3.5 w-3.5" />
                                </button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="start" className="w-48" onClick={(e) => e.stopPropagation()}>
                                <DropdownMenuItem onClick={() => onOpenSession(session)}>
                                  <ExternalLink className="h-4 w-4 mr-2" />{t('workbench.ctx.openSession')}
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={() => onDuplicateSession(session)}>
                                  <Files className="h-4 w-4 mr-2" />{t('workbench.ctx.duplicate')}
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={() => onExportSession(session, 'markdown')}>
                                  <Download className="h-4 w-4 mr-2" />{t('workbench.ctx.exportMd')}
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={() => onExportSession(session, 'json')}>
                                  <Download className="h-4 w-4 mr-2" />{t('workbench.ctx.exportJson')}
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={() => onExportSession(session, 'jsonl')}>
                                  <Download className="h-4 w-4 mr-2" />{t('workbench.ctx.exportJsonl')}
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={() => onCopyText(session.id, t('workbench.ctx.idCopied'))}>
                                  <Copy className="h-4 w-4 mr-2" />{t('workbench.ctx.copyId')}
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={() => onOpenInExplorer(session.project_path)}>
                                  <FolderInput className="h-4 w-4 mr-2" />{t('workbench.ctx.openFolder')}
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={() => {
                                  setRenameDraft(sessionTitles[session.id] || (session.first_message ? getFirstLine(session.first_message) : session.id.slice(0, 8)));
                                  setRenamingId(session.id);
                                }}>
                                  <Pencil className="h-4 w-4 mr-2" />{t('workbench.ctx.rename')}
                                </DropdownMenuItem>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem
                                  onClick={() => onRequestDeleteSession(session)}
                                  className="text-destructive focus:text-destructive"
                                >
                                  <Trash2 className="h-4 w-4 mr-2" />{t('workbench.ctx.deleteSession')}
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          ) : (
                            <button
                              onClick={(e) => { e.stopPropagation(); setMenuFor(`sess:${session.id}`); }}
                              className="flex-shrink-0 h-5 w-5 rounded flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted-foreground/15 transition-opacity opacity-0 group-hover/sess:opacity-100"
                            >
                              <MoreHorizontal className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                      );
                    }}
                    />
                    {projectSessions.length > RECENT_SESSION_COUNT && (
                      <button
                        onClick={() => setShowAll((prev) => {
                          const next = new Set(prev);
                          if (expandedAll) next.delete(project.id); else next.add(project.id);
                          return next;
                        })}
                        className="w-full flex items-center gap-1.5 px-2 py-1 mt-0.5 text-[10.5px] font-medium text-primary/70 hover:text-primary transition-colors"
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
      }}
      />
      </div>
    </div>
  );
};
