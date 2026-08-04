import React, { createContext, useContext, useState, useCallback, useEffect, useRef, ReactNode } from 'react';
import { api, Project, Session } from '@/lib/api';
import { sortSessionsByActivity } from '@/lib/sessionOrdering';
import { useTranslation } from 'react-i18next';

interface ProjectContextType {
  projects: Project[];
  selectedProject: Project | null;
  sessions: Session[];
  /** 按项目 id 缓存的会话列表，支持多个项目同时展开各显各的会话 */
  sessionsByProject: Record<string, Session[]>;
  loading: boolean;
  projectsLoading: boolean;
  sessionsLoading: boolean;
  sessionsLoadProgress: SessionsLoadProgress;
  error: string | null;
  loadProjects: () => Promise<void>;
  selectProject: (project: Project) => Promise<void>;
  registerProjectByPath: (projectPath: string) => Promise<void>;
  refreshSessions: (options?: { silent?: boolean }) => Promise<void>;
  /** 加载指定项目的会话到 sessionsByProject 缓存，不改变 selectedProject（用于多项目展开） */
  loadProjectSessions: (project: Project, options?: { silent?: boolean }) => Promise<void>;
  scheduleProjectRefresh: (includeSessions?: boolean) => void;
  deleteProject: (project: Project) => Promise<void>;
  clearSelection: () => void;
}

type SessionSource = 'claude' | 'codex' | 'gemini';
type SessionSourceStatus = 'idle' | 'loading' | 'done' | 'error';

interface SessionsLoadProgress {
  claude: SessionSourceStatus;
  codex: SessionSourceStatus;
  gemini: SessionSourceStatus;
}

const idleSessionsLoadProgress: SessionsLoadProgress = {
  claude: 'idle',
  codex: 'idle',
  gemini: 'idle',
};

const loadingSessionsLoadProgress: SessionsLoadProgress = {
  claude: 'loading',
  codex: 'loading',
  gemini: 'loading',
};

const codexSessionToProjectSession = (
  session: any,
  projectId: string,
  fallbackProjectPath: string
): Session => ({
  id: session.id,
  project_id: projectId,
  project_path: session.projectPath || fallbackProjectPath,
  created_at: session.createdAt,
  model: session.model || 'gpt-5.3-codex',
  engine: 'codex' as const,
  first_message: session.firstMessage || 'Codex Session',
  last_message_timestamp: session.lastMessageTimestamp,
});

const getCodexSessionActivitySeconds = (session: any): number => {
  if (session.lastMessageTimestamp) {
    const parsed = new Date(session.lastMessageTimestamp).getTime();
    if (Number.isFinite(parsed)) return parsed / 1000;
  }

  if (session.updatedAt) {
    return typeof session.updatedAt === 'string'
      ? new Date(session.updatedAt).getTime() / 1000
      : session.updatedAt;
  }

  if (session.createdAt) {
    return typeof session.createdAt === 'string'
      ? new Date(session.createdAt).getTime() / 1000
      : session.createdAt;
  }

  return 0;
};

type IdleWindow = Window & {
  requestIdleCallback?: (callback: () => void, options?: { timeout?: number }) => number;
  cancelIdleCallback?: (handle: number) => void;
};

const PROJECT_HYDRATION_IDLE_TIMEOUT_MS = 1_500;
const PROJECT_HYDRATION_FALLBACK_DELAY_MS = 350;

const scheduleDeferredProjectHydration = (callback: () => void) => {
  const idleWindow: IdleWindow | undefined =
    typeof window !== 'undefined' ? (window as IdleWindow) : undefined;

  if (idleWindow?.requestIdleCallback) {
    const handle = idleWindow.requestIdleCallback(callback, {
      timeout: PROJECT_HYDRATION_IDLE_TIMEOUT_MS,
    });
    return () => idleWindow.cancelIdleCallback?.(handle);
  }

  const timeoutId = setTimeout(callback, PROJECT_HYDRATION_FALLBACK_DELAY_MS);
  return () => clearTimeout(timeoutId);
};

const ProjectContext = createContext<ProjectContextType | undefined>(undefined);

export const ProjectProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const { t } = useTranslation();
  const [projects, setProjects] = useState<Project[]>([]);
  // manualProjects 仅用于触发重渲染；所有读取一律走 manualProjectsRef 最新值。
  // loadProjects 的异步 .then 若读闭包捕获的 state，会是发起时的旧值，导致
  // 「新建项目后被迟到的旧刷新覆盖抹掉」的竞态，故读取统一改用 ref。
  const [, setManualProjects] = useState<Project[]>([]);
  const manualProjectsRef = useRef<Project[]>([]);
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [sessions, setSessions] = useState<Session[]>([]);
  // 按项目 id 缓存会话，支持多项目同时展开。selectProject/refreshSessions/loadProjectSessions 写入。
  const [sessionsByProject, setSessionsByProject] = useState<Record<string, Session[]>>({});
  const [projectsLoading, setProjectsLoading] = useState(false);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [mutationLoading, setMutationLoading] = useState(false);
  const [sessionsLoadProgress, setSessionsLoadProgress] = useState<SessionsLoadProgress>(idleSessionsLoadProgress);
  const [error, setError] = useState<string | null>(null);
  const codexSessionsCacheRef = useRef<{ value: any[]; expiresAt: number } | null>(null);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refreshPromiseRef = useRef<Promise<void> | null>(null);
  const projectHydrationRequestRef = useRef(0);
  const projectHydrationCancelRef = useRef<(() => void) | null>(null);
  const sessionLoadRequestRef = useRef(0);
  const loading = projectsLoading || sessionsLoading || mutationLoading;

  // 统一写入 manualProjects：同步更新 state 与 ref，保证异步回调始终能读到最新手动项目列表。
  const updateManualProjects = useCallback(
    (updater: Project[] | ((prev: Project[]) => Project[])) => {
      setManualProjects(prev => {
        const next = typeof updater === 'function'
          ? (updater as (prev: Project[]) => Project[])(prev)
          : updater;
        manualProjectsRef.current = next;
        return next;
      });
    },
    [],
  );

  const normalizeProjectPath = useCallback((path: string) => {
    return path ? path.replace(/\\/g, '/').replace(/\/$/, '').toLowerCase() : '';
  }, []);

  const isVirtualProject = useCallback((project: Project | null | undefined) => {
    return Boolean(project?.id.startsWith('virtual:'));
  }, []);

  const findProjectByPath = useCallback((projectList: Project[], projectPath: string) => {
    const normalizedProjectPath = normalizeProjectPath(projectPath);
    return projectList.find(project => normalizeProjectPath(project.path) === normalizedProjectPath) ?? null;
  }, [normalizeProjectPath]);

  const findRealProjectByPath = useCallback((projectList: Project[], projectPath: string) => {
    const normalizedProjectPath = normalizeProjectPath(projectPath);
    return projectList.find(project =>
      !isVirtualProject(project) && normalizeProjectPath(project.path) === normalizedProjectPath
    ) ?? null;
  }, [isVirtualProject, normalizeProjectPath]);

  const buildVirtualProject = useCallback((projectPath: string): Project => ({
    id: `virtual:${normalizeProjectPath(projectPath)}`,
    path: projectPath,
    sessions: [],
    created_at: Math.floor(Date.now() / 1000),
  }), [normalizeProjectPath]);

  const getCachedCodexSessions = useCallback(async () => {
    const now = Date.now();
    const cached = codexSessionsCacheRef.current;
    if (cached && cached.expiresAt > now) {
      return cached.value;
    }

    const value = await api.listCodexSessions();
    codexSessionsCacheRef.current = {
      value,
      expiresAt: now + 30_000,
    };
    return value;
  }, []);

  const mergeProjects = useCallback((primaryProjects: Project[], secondaryProjects: Project[]) => {
    const mergedProjects: Project[] = [];
    const seenPaths = new Set<string>();

    [...primaryProjects, ...secondaryProjects].forEach(project => {
      const normalizedProjectPath = normalizeProjectPath(project.path);
      if (seenPaths.has(normalizedProjectPath)) {
        return;
      }

      seenPaths.add(normalizedProjectPath);
      mergedProjects.push(project);
    });

    return mergedProjects;
  }, [normalizeProjectPath]);

  const resolveEffectiveProject = useCallback((project: Project, projectList?: Project[]) => {
    const availableProjects = projectList ?? projects;
    const matchedProject =
      findRealProjectByPath(availableProjects, project.path) ??
      (isVirtualProject(project) ? null : findProjectByPath(availableProjects, project.path));
    const effectiveProject = matchedProject ?? project;

    return { matchedProject, effectiveProject };
  }, [findProjectByPath, findRealProjectByPath, isVirtualProject, projects]);

  const loadSessionsForProject = useCallback(async (project: Project, projectList?: Project[]) => {
    const { matchedProject, effectiveProject } = resolveEffectiveProject(project, projectList);

    let claudeCodexSessions: Session[] = [];

    if (matchedProject) {
      claudeCodexSessions = await api.getProjectSessions(matchedProject.id, matchedProject.path);
    } else {
      try {
        const codexSessions = await getCachedCodexSessions();
        const normalizedProjectPath = normalizeProjectPath(project.path);

        claudeCodexSessions = codexSessions
          .filter(session => normalizeProjectPath(session.projectPath) === normalizedProjectPath)
          .map(session => codexSessionToProjectSession(session, effectiveProject.id, project.path));
      } catch (codexErr) {
        console.warn('[ProjectContext] Failed to load Codex sessions by project path:', codexErr);
      }
    }

    let geminiSessions: Session[] = [];
    try {
      const geminiSessionInfos = await api.listGeminiSessions(project.path);
      geminiSessions = geminiSessionInfos.map(info => ({
        id: info.sessionId,
        project_id: effectiveProject.id,
        project_path: project.path,
        created_at: new Date(info.startTime).getTime() / 1000,
        first_message: info.firstMessage,
        message_timestamp: info.startTime,
        last_message_timestamp: info.startTime,
        engine: 'gemini' as const,
      }));
    } catch (geminiErr) {
      console.warn('[ProjectContext] Failed to load Gemini sessions (may not exist):', geminiErr);
    }

    const allSessions = [...claudeCodexSessions, ...geminiSessions];

    return {
      effectiveProject,
      sessions: sortSessionsByActivity(allSessions),
    };
  }, [getCachedCodexSessions, normalizeProjectPath, resolveEffectiveProject]);

  const hydrateProjectMetadata = useCallback((baseProjects: Project[], requestId: number) => {
    const runHydration = async () => {
      if (projectHydrationRequestRef.current !== requestId) return;

      try {
        const fullProjects = await api.listProjects();
        if (projectHydrationRequestRef.current !== requestId) return;

        let hydratedProjects = [...fullProjects].sort((a, b) => b.created_at - a.created_at);

        try {
          const codexSessions = await getCachedCodexSessions();
          if (projectHydrationRequestRef.current !== requestId) return;

          const projectLastActive = new Map<string, number>();
          hydratedProjects.forEach(project => {
            projectLastActive.set(normalizeProjectPath(project.path), project.created_at);
          });

          codexSessions.forEach(session => {
            if (!session.projectPath) return;
            const normPath = normalizeProjectPath(session.projectPath);
            const sessionTime = getCodexSessionActivitySeconds(session);
            const current = projectLastActive.get(normPath) || 0;
            if (sessionTime > current) {
              projectLastActive.set(normPath, sessionTime);
            }
          });

          hydratedProjects = [...hydratedProjects].sort((a, b) => {
            const timeA = projectLastActive.get(normalizeProjectPath(a.path)) || a.created_at;
            const timeB = projectLastActive.get(normalizeProjectPath(b.path)) || b.created_at;
            return timeB - timeA;
          });
        } catch (e) {
          console.warn("Failed to refresh Codex activity for project sorting:", e);
        }

        if (projectHydrationRequestRef.current === requestId) {
          setProjects(mergeProjects(hydratedProjects, manualProjectsRef.current));
        }
      } catch (e) {
        console.warn("Failed to hydrate cross-engine project metadata:", e);
        if (projectHydrationRequestRef.current === requestId && baseProjects.length > 0) {
          setProjects(mergeProjects(baseProjects, manualProjectsRef.current));
        }
      }
    };

    projectHydrationCancelRef.current?.();
    projectHydrationCancelRef.current = scheduleDeferredProjectHydration(() => {
      projectHydrationCancelRef.current = null;
      void runHydration();
    });
  }, [getCachedCodexSessions, mergeProjects, normalizeProjectPath]);

  const loadProjects = useCallback(async () => {
    const requestId = projectHydrationRequestRef.current + 1;
    projectHydrationRequestRef.current = requestId;
    projectHydrationCancelRef.current?.();
    projectHydrationCancelRef.current = null;

    try {
      setProjectsLoading(true);
      setError(null);
      const list = await api.listProjectsFast();
      const sortedList = [...list].sort((a, b) => b.created_at - a.created_at);
      // 读 ref 最新值而非闭包捕获值，避免迟到回调用旧手动项目列表覆盖新建项目。
      if (projectHydrationRequestRef.current === requestId) {
        setProjects(mergeProjects(sortedList, manualProjectsRef.current));
        hydrateProjectMetadata(sortedList, requestId);
      }
    } catch (err) {
      console.error("Failed to load projects:", err);
      setError(t('common.loadingProjects'));
    } finally {
      if (projectHydrationRequestRef.current === requestId) {
        setProjectsLoading(false);
      }
    }
  }, [hydrateProjectMetadata, mergeProjects, t]);

  const selectProject = useCallback(async (project: Project) => {
    const requestId = sessionLoadRequestRef.current + 1;
    sessionLoadRequestRef.current = requestId;

    const { matchedProject, effectiveProject } = resolveEffectiveProject(project);
    const mergeSourceSessions = (source: SessionSource, sourceSessions: Session[]) => {
      if (sessionLoadRequestRef.current !== requestId) {
        return;
      }

      setSessions(prev => {
        const withoutSource = prev.filter(session => (session.engine || 'claude') !== source);
        const merged = sortSessionsByActivity([...withoutSource, ...sourceSessions]);
        // 同步写入按项目缓存，使该项目即便不是"当前选中"在树中也能持续显示会话（多项目展开）。
        setSessionsByProject(prevMap => {
          const existing = prevMap[effectiveProject.id] ?? [];
          const withoutSrc = existing.filter(s => (s.engine || 'claude') !== source);
          return { ...prevMap, [effectiveProject.id]: sortSessionsByActivity([...withoutSrc, ...sourceSessions]) };
        });
        return merged;
      });
    };
    const markSource = (source: SessionSource, status: SessionSourceStatus) => {
      if (sessionLoadRequestRef.current !== requestId) {
        return;
      }

      setSessionsLoadProgress(prev => ({ ...prev, [source]: status }));
    };

    setError(null);
    setSelectedProject(effectiveProject);
    setSessions([]);
    setSessionsLoading(true);
    setSessionsLoadProgress(loadingSessionsLoadProgress);

    api.preindexProject(effectiveProject.path).catch(console.error);

    const loaders: Array<[SessionSource, () => Promise<Session[]>]> = [
      ['claude', async () => matchedProject ? api.getClaudeProjectSessions(matchedProject.id) : []],
      ['codex', async () => {
        if (matchedProject) {
          return api.getCodexProjectSessions(matchedProject.id, matchedProject.path);
        }

        const codexSessions = await getCachedCodexSessions();
        const normalizedProjectPath = normalizeProjectPath(project.path);
        return codexSessions
          .filter(session => normalizeProjectPath(session.projectPath) === normalizedProjectPath)
          .map(session => codexSessionToProjectSession(session, effectiveProject.id, project.path));
      }],
      ['gemini', () => api.getGeminiProjectSessions(effectiveProject.id, effectiveProject.path)],
    ];

    await Promise.all(loaders.map(async ([source, loader]) => {
      try {
        const sourceSessions = await loader();
        mergeSourceSessions(source, sourceSessions);
        markSource(source, 'done');
      } catch (err) {
        console.warn(`[ProjectContext] Failed to load ${source} sessions:`, err);
        markSource(source, 'error');
      }
    }));

    if (sessionLoadRequestRef.current === requestId) {
      setSessionsLoading(false);
    }
  }, [getCachedCodexSessions, normalizeProjectPath, resolveEffectiveProject]);

  const registerProjectByPath = useCallback(async (projectPath: string) => {
    try {
      setMutationLoading(true);
      setError(null);

      const existingProject = findProjectByPath(projects, projectPath);
      if (existingProject) {
        sessionLoadRequestRef.current += 1;
        setProjects(prevProjects => mergeProjects([existingProject], prevProjects));
        setSelectedProject(null);
        setSessions([]);
        setSessionsLoading(false);
        setSessionsLoadProgress(idleSessionsLoadProgress);
        return;
      }

      // 关键修复：该路径可能是"曾被删除（隐藏）的项目"。delete_project 只是把它写入 hidden 列表，
      // listProjects 会过滤掉，导致重新添加时匹配不到真实项目、错误地建虚拟项目（读不进来、状态错乱）。
      // 因此添加前先按路径解除隐藏；确有恢复则真实项目会重新出现在 listProjects 结果中。
      await api.restoreProjectByPath(projectPath).catch(() => false);

      const latestProjects = await api.listProjects().catch(() => [] as Project[]);
      const matchedProject = findProjectByPath(latestProjects, projectPath);
      const projectToRegister = matchedProject ?? buildVirtualProject(projectPath);

      // 使用手动项目列表保留“尚未产生会话”的项目卡片。读 ref 最新值，避免与并发刷新竞态。
      const currentManualProjects = manualProjectsRef.current;
      const nextManualProjects = matchedProject
        ? currentManualProjects.filter(project => normalizeProjectPath(project.path) !== normalizeProjectPath(projectPath))
        : mergeProjects([projectToRegister], currentManualProjects);

      updateManualProjects(nextManualProjects);
      setProjects(prevProjects => mergeProjects([projectToRegister], mergeProjects(prevProjects, nextManualProjects)));
      sessionLoadRequestRef.current += 1;
      setSelectedProject(null);
      setSessions([]);
      setSessionsLoading(false);
      setSessionsLoadProgress(idleSessionsLoadProgress);

      api.preindexProject(projectToRegister.path).catch(console.error);
    } catch (err) {
      console.error("Failed to register project by path:", err);
      setError(t('common.loadingProjects'));
    } finally {
      setMutationLoading(false);
    }
  }, [buildVirtualProject, findProjectByPath, mergeProjects, normalizeProjectPath, projects, t, updateManualProjects]);

  const refreshSessions = useCallback(async (options?: { silent?: boolean }) => {
    if (selectedProject) {
      const silent = options?.silent === true;
      const requestId = sessionLoadRequestRef.current + 1;
      sessionLoadRequestRef.current = requestId;
      try {
        // 静默刷新（聚焦/轮询触发）不进入 loading 态，避免会话列表反复闪烁重渲染、拖慢界面。
        if (!silent) {
          setSessionsLoading(true);
          setSessionsLoadProgress(loadingSessionsLoadProgress);
        }
        const latestProjects = await api.listProjects().catch(() => [] as Project[]);
        const { effectiveProject, sessions: allSessions } = await loadSessionsForProject(selectedProject, latestProjects);

        if (sessionLoadRequestRef.current === requestId) {
          setSelectedProject(effectiveProject);
          setSessions(allSessions);
          // 同步当前项目的按项目缓存
          setSessionsByProject(prev => ({ ...prev, [effectiveProject.id]: allSessions }));
          // 把最新项目列表（含 session_counts）写回 projects，使删除/新增会话后引擎计数徽章即时刷新。
          // latestProjects 作 primary（同路径优先，更新计数）；prev 补充其中没有的虚拟/手动项目。
          if (latestProjects.length > 0) {
            setProjects(prev => mergeProjects(latestProjects, prev));
          }
          if (!silent) {
            setSessionsLoadProgress({ claude: 'done', codex: 'done', gemini: 'done' });
          }
        }
      } catch (err) {
        console.error("Failed to refresh sessions:", err);
        if (!silent && sessionLoadRequestRef.current === requestId) {
          setSessionsLoadProgress({ claude: 'error', codex: 'error', gemini: 'error' });
        }
      } finally {
        if (!silent && sessionLoadRequestRef.current === requestId) {
          setSessionsLoading(false);
        }
      }
    }
  }, [loadSessionsForProject, selectedProject, mergeProjects]);

  // 多项目展开：加载指定项目会话到 sessionsByProject 缓存，不触碰 selectedProject。
  // 每个项目独立的请求序号，防止同一项目并发刷新时旧结果覆盖新结果。
  const projectLoadReqRef = useRef<Record<string, number>>({});
  const loadProjectSessions = useCallback(async (project: Project, _options?: { silent?: boolean }) => {
    const pid = project.id;
    const reqId = (projectLoadReqRef.current[pid] ?? 0) + 1;
    projectLoadReqRef.current[pid] = reqId;
    try {
      const { sessions: allSessions } = await loadSessionsForProject(project);
      if (projectLoadReqRef.current[pid] === reqId) {
        setSessionsByProject(prev => ({ ...prev, [pid]: allSessions }));
      }
    } catch (err) {
      console.warn(`[ProjectContext] Failed to load sessions for project ${pid}:`, err);
      // 失败时写入空数组，让 UI 退出"加载中"占位，避免一直转圈
      if (projectLoadReqRef.current[pid] === reqId) {
        setSessionsByProject(prev => (prev[pid] ? prev : { ...prev, [pid]: [] }));
      }
    }
  }, [loadSessionsForProject]);

  // 注：会话列表的"聚焦时刷新"已下沉到 WorkbenchSidebar —— 它持有 expandedProjects，
  // 能在窗口重新聚焦时只静默刷新「已展开的项目」，避免刷新未展开项目造成无谓磁盘扫描。

  const deleteProject = useCallback(async (project: Project) => {
    try {
      if (project.id.startsWith('virtual:')) {
        updateManualProjects(prevProjects =>
          prevProjects.filter(item => normalizeProjectPath(item.path) !== normalizeProjectPath(project.path))
        );
        setProjects(prevProjects =>
          prevProjects.filter(item => normalizeProjectPath(item.path) !== normalizeProjectPath(project.path))
        );
        if (selectedProject && normalizeProjectPath(selectedProject.path) === normalizeProjectPath(project.path)) {
          sessionLoadRequestRef.current += 1;
          setSelectedProject(null);
          setSessions([]);
          setSessionsLoading(false);
          setSessionsLoadProgress(idleSessionsLoadProgress);
        }
        return;
      }

      setMutationLoading(true);
      await api.deleteProject(project.id);
      await loadProjects();
      // 清理该项目的会话缓存，避免树中残留已删除项目的会话
      setSessionsByProject(prev => {
        if (!(project.id in prev)) return prev;
        const next = { ...prev };
        delete next[project.id];
        return next;
      });
      if (selectedProject?.id === project.id) {
        sessionLoadRequestRef.current += 1;
        setSelectedProject(null);
        setSessions([]);
        setSessionsLoading(false);
        setSessionsLoadProgress(idleSessionsLoadProgress);
      }
    } catch (err) {
      console.error("Failed to delete project:", err);
      throw err;
    } finally {
      setMutationLoading(false);
    }
  }, [loadProjects, normalizeProjectPath, selectedProject, updateManualProjects]);

  const clearSelection = useCallback(() => {
    sessionLoadRequestRef.current += 1;
    setSelectedProject(null);
    setSessions([]);
    setSessionsLoading(false);
    setSessionsLoadProgress(idleSessionsLoadProgress);
  }, []);

  const scheduleProjectRefresh = useCallback((includeSessions: boolean = true) => {
    if (refreshTimerRef.current) {
      clearTimeout(refreshTimerRef.current);
    }

    refreshTimerRef.current = setTimeout(() => {
      refreshTimerRef.current = null;
      if (refreshPromiseRef.current) {
        return;
      }

      refreshPromiseRef.current = (async () => {
        await loadProjects();
        if (includeSessions && selectedProject) {
          await refreshSessions();
        }
      })()
        .catch(err => console.error("Failed to refresh projects after AI completion:", err))
        .finally(() => {
          refreshPromiseRef.current = null;
        });
    }, 500);
  }, [loadProjects, refreshSessions, selectedProject]);

  useEffect(() => {
    return () => {
      projectHydrationRequestRef.current += 1;
      projectHydrationCancelRef.current?.();
      projectHydrationCancelRef.current = null;
      if (refreshTimerRef.current) {
        clearTimeout(refreshTimerRef.current);
      }
    };
  }, []);

  // Load projects on mount
  useEffect(() => {
    loadProjects();
  }, [loadProjects]);

  const contextValue = React.useMemo<ProjectContextType>(() => ({
    projects,
    selectedProject,
    sessions,
    sessionsByProject,
    loading,
    projectsLoading,
    sessionsLoading,
    sessionsLoadProgress,
    error,
    loadProjects,
    selectProject,
    registerProjectByPath,
    refreshSessions,
    loadProjectSessions,
    scheduleProjectRefresh,
    deleteProject,
    clearSelection,
  }), [
    projects,
    selectedProject,
    sessions,
    sessionsByProject,
    loading,
    projectsLoading,
    sessionsLoading,
    sessionsLoadProgress,
    error,
    loadProjects,
    selectProject,
    registerProjectByPath,
    refreshSessions,
    loadProjectSessions,
    scheduleProjectRefresh,
    deleteProject,
    clearSelection,
  ]);

  return (
    <ProjectContext.Provider value={contextValue}>
      {children}
    </ProjectContext.Provider>
  );
};

export const useProject = () => {
  const context = useContext(ProjectContext);
  if (context === undefined) {
    throw new Error('useProject must be used within a ProjectProvider');
  }
  return context;
};
