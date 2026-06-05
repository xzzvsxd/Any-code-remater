import React, { createContext, useContext, useState, useCallback, useEffect, useRef, ReactNode } from 'react';
import { api, Project, Session } from '@/lib/api';
import { useTranslation } from 'react-i18next';

interface ProjectContextType {
  projects: Project[];
  selectedProject: Project | null;
  sessions: Session[];
  loading: boolean;
  projectsLoading: boolean;
  sessionsLoading: boolean;
  sessionsLoadProgress: SessionsLoadProgress;
  error: string | null;
  loadProjects: () => Promise<void>;
  selectProject: (project: Project) => Promise<void>;
  registerProjectByPath: (projectPath: string) => Promise<void>;
  refreshSessions: () => Promise<void>;
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

const sortSessionsByActivity = (sessionList: Session[]) => {
  return [...sessionList].sort((a, b) => {
    const getTime = (session: Session) => {
      if (session.last_message_timestamp) {
        const parsed = new Date(session.last_message_timestamp).getTime();
        if (Number.isFinite(parsed)) return parsed;
      }
      if (session.message_timestamp) {
        const parsed = new Date(session.message_timestamp).getTime();
        if (Number.isFinite(parsed)) return parsed;
      }
      return session.created_at * 1000;
    };

    return getTime(b) - getTime(a);
  });
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

const ProjectContext = createContext<ProjectContextType | undefined>(undefined);

export const ProjectProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const { t } = useTranslation();
  const [projects, setProjects] = useState<Project[]>([]);
  const [manualProjects, setManualProjects] = useState<Project[]>([]);
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [projectsLoading, setProjectsLoading] = useState(false);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [mutationLoading, setMutationLoading] = useState(false);
  const [sessionsLoadProgress, setSessionsLoadProgress] = useState<SessionsLoadProgress>(idleSessionsLoadProgress);
  const [error, setError] = useState<string | null>(null);
  const codexSessionsCacheRef = useRef<{ value: any[]; expiresAt: number } | null>(null);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refreshPromiseRef = useRef<Promise<void> | null>(null);
  const sessionLoadRequestRef = useRef(0);
  const loading = projectsLoading || sessionsLoading || mutationLoading;

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

  const loadProjects = useCallback(async () => {
    try {
      setProjectsLoading(true);
      setError(null);
      const list = await api.listProjects();
      const sortedList = [...list].sort((a, b) => b.created_at - a.created_at);
      setProjects(mergeProjects(sortedList, manualProjects));

      getCachedCodexSessions()
        .then(codexSessions => {
          const projectLastActive = new Map<string, number>();
          sortedList.forEach(project => {
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

          const resortedList = [...sortedList].sort((a, b) => {
            const timeA = projectLastActive.get(normalizeProjectPath(a.path)) || a.created_at;
            const timeB = projectLastActive.get(normalizeProjectPath(b.path)) || b.created_at;
            return timeB - timeA;
          });

          setProjects(mergeProjects(resortedList, manualProjects));
        })
        .catch(e => {
          console.warn("Failed to refresh Codex activity for project sorting:", e);
        });
    } catch (err) {
      console.error("Failed to load projects:", err);
      setError(t('common.loadingProjects'));
    } finally {
      setProjectsLoading(false);
    }
  }, [getCachedCodexSessions, manualProjects, mergeProjects, normalizeProjectPath, t]);

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
        return sortSessionsByActivity([...withoutSource, ...sourceSessions]);
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

      // 使用手动项目列表保留“尚未产生会话”的项目卡片
      const nextManualProjects = matchedProject
        ? manualProjects.filter(project => normalizeProjectPath(project.path) !== normalizeProjectPath(projectPath))
        : mergeProjects([projectToRegister], manualProjects);

      setManualProjects(nextManualProjects);
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
  }, [buildVirtualProject, findProjectByPath, manualProjects, mergeProjects, normalizeProjectPath, projects, t]);

  const refreshSessions = useCallback(async () => {
    if (selectedProject) {
      const requestId = sessionLoadRequestRef.current + 1;
      sessionLoadRequestRef.current = requestId;
      try {
        setSessionsLoading(true);
        setSessionsLoadProgress(loadingSessionsLoadProgress);
        const latestProjects = await api.listProjects().catch(() => [] as Project[]);
        const { effectiveProject, sessions: allSessions } = await loadSessionsForProject(selectedProject, latestProjects);

        if (sessionLoadRequestRef.current === requestId) {
          setSelectedProject(effectiveProject);
          setSessions(allSessions);
          setSessionsLoadProgress({ claude: 'done', codex: 'done', gemini: 'done' });
        }
      } catch (err) {
        console.error("Failed to refresh sessions:", err);
        if (sessionLoadRequestRef.current === requestId) {
          setSessionsLoadProgress({ claude: 'error', codex: 'error', gemini: 'error' });
        }
      } finally {
        if (sessionLoadRequestRef.current === requestId) {
          setSessionsLoading(false);
        }
      }
    }
  }, [loadSessionsForProject, selectedProject]);

  // 会话列表实时刷新（前端轮询）：选中项目展开后，页面可见且窗口聚焦时每 3s 刷新一次会话列表，
  // 使外部新增/删除会话无需手动收起重展即可自动出现/消失。失焦或页面隐藏时停止，避免无谓 IO
  // （也减轻后端文件扫描负载）。复用带 requestId 防竞态的 refreshSessions。
  const refreshSessionsRef = useRef(refreshSessions);
  useEffect(() => {
    refreshSessionsRef.current = refreshSessions;
  }, [refreshSessions]);

  useEffect(() => {
    if (!selectedProject) return;

    let timerId: ReturnType<typeof setInterval> | null = null;

    const canPoll = () =>
      document.visibilityState === 'visible' && document.hasFocus();

    const start = () => {
      if (timerId !== null) return;
      timerId = setInterval(() => {
        if (canPoll()) {
          refreshSessionsRef.current();
        }
      }, 3000);
    };

    const stop = () => {
      if (timerId !== null) {
        clearInterval(timerId);
        timerId = null;
      }
    };

    // 失焦/隐藏时停表，重新聚焦/可见时立即刷新一次再恢复轮询
    const handleVisibility = () => {
      if (canPoll()) {
        refreshSessionsRef.current();
        start();
      } else {
        stop();
      }
    };

    start();
    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('focus', handleVisibility);
    window.addEventListener('blur', handleVisibility);

    return () => {
      stop();
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('focus', handleVisibility);
      window.removeEventListener('blur', handleVisibility);
    };
  }, [selectedProject?.id]);

  const deleteProject = useCallback(async (project: Project) => {
    try {
      if (project.id.startsWith('virtual:')) {
        setManualProjects(prevProjects =>
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
  }, [loadProjects, normalizeProjectPath, selectedProject]);

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
      if (refreshTimerRef.current) {
        clearTimeout(refreshTimerRef.current);
      }
    };
  }, []);

  // Load projects on mount
  useEffect(() => {
    loadProjects();
  }, [loadProjects]);

  return (
    <ProjectContext.Provider value={{
      projects,
      selectedProject,
      sessions,
      loading,
      projectsLoading,
      sessionsLoading,
      sessionsLoadProgress,
      error,
      loadProjects,
      selectProject,
      registerProjectByPath,
      refreshSessions,
      scheduleProjectRefresh,
      deleteProject,
      clearSelection
    }}>
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
