import React, { createContext, useContext, useState, useCallback, useEffect, useRef, ReactNode } from 'react';
import { api, Project, Session } from '@/lib/api';
import { useTranslation } from 'react-i18next';

interface ProjectContextType {
  projects: Project[];
  selectedProject: Project | null;
  sessions: Session[];
  loading: boolean;
  error: string | null;
  loadProjects: () => Promise<void>;
  selectProject: (project: Project) => Promise<void>;
  registerProjectByPath: (projectPath: string) => Promise<void>;
  refreshSessions: () => Promise<void>;
  scheduleProjectRefresh: (includeSessions?: boolean) => void;
  deleteProject: (project: Project) => Promise<void>;
  clearSelection: () => void;
}

const ProjectContext = createContext<ProjectContextType | undefined>(undefined);

export const ProjectProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const { t } = useTranslation();
  const [projects, setProjects] = useState<Project[]>([]);
  const [manualProjects, setManualProjects] = useState<Project[]>([]);
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const codexSessionsCacheRef = useRef<{ value: any[]; expiresAt: number } | null>(null);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refreshPromiseRef = useRef<Promise<void> | null>(null);

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

  const loadSessionsForProject = useCallback(async (project: Project, projectList?: Project[]) => {
    const availableProjects = projectList ?? projects;
    const matchedProject =
      findRealProjectByPath(availableProjects, project.path) ??
      (isVirtualProject(project) ? null : findProjectByPath(availableProjects, project.path));
    const effectiveProject = matchedProject ?? project;

    let claudeCodexSessions: Session[] = [];

    if (matchedProject) {
      claudeCodexSessions = await api.getProjectSessions(matchedProject.id, matchedProject.path);
    } else {
      try {
        const codexSessions = await getCachedCodexSessions();
        const normalizedProjectPath = normalizeProjectPath(project.path);

        claudeCodexSessions = codexSessions
          .filter(session => normalizeProjectPath(session.projectPath) === normalizedProjectPath)
          .map(session => ({
            id: session.id,
            project_id: effectiveProject.id,
            project_path: session.projectPath,
            created_at: session.createdAt,
            model: session.model || 'gpt-5.3-codex',
            engine: 'codex' as const,
            first_message: session.firstMessage || 'Codex Session',
            last_message_timestamp: session.lastMessageTimestamp,
          }));
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
    allSessions.sort((a, b) => b.created_at - a.created_at);

    return {
      effectiveProject,
      sessions: allSessions,
    };
  }, [findProjectByPath, findRealProjectByPath, getCachedCodexSessions, isVirtualProject, normalizeProjectPath, projects]);

  const loadProjects = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const list = await api.listProjects();
      
      // 1. 获取 Codex 会话列表（全局获取，开销小）
      let codexSessions: any[] = [];
      try {
        codexSessions = await getCachedCodexSessions();
      } catch (e) {
        console.warn("Failed to load codex sessions for sorting:", e);
      }

      // 2. 计算每个项目的"最后活跃时间"
      // 默认使用创建时间，如果发现更有更新的 Codex 会话，则更新
      const projectLastActive = new Map<string, number>();
      
      // 辅助函数：标准化路径（去除末尾斜杠，转小写，统一斜杠）
      const normalize = (p: string) => p ? p.replace(/\\/g, '/').replace(/\/$/, '').toLowerCase() : '';

      // 初始化：使用项目创建时间
      list.forEach(p => {
        const normPath = normalize(p.path);
        projectLastActive.set(normPath, p.created_at);
      });

      // 更新：检查 Codex 会话
      codexSessions.forEach(session => {
        if (!session.projectPath) return;
        const normPath = normalize(session.projectPath);
        
        // 获取会话的最新时间（优先使用最后消息时间，否则使用创建时间）
        // 注意：Codex 会话的时间戳可能是 ISO 字符串或 Unix 时间戳，需要统一
        let sessionTime = 0;
        
        if (session.lastMessageTimestamp) {
          sessionTime = new Date(session.lastMessageTimestamp).getTime() / 1000;
        } else if (session.createdAt) {
          sessionTime = typeof session.createdAt === 'string' 
            ? new Date(session.createdAt).getTime() / 1000 
            : session.createdAt;
        }

        const current = projectLastActive.get(normPath) || 0;
        if (sessionTime > current) {
          projectLastActive.set(normPath, sessionTime);
        }
      });

      // 3. 排序：按最后活跃时间降序（最新的在前）
      const sortedList = list.sort((a, b) => {
        const timeA = projectLastActive.get(normalize(a.path)) || a.created_at;
        const timeB = projectLastActive.get(normalize(b.path)) || b.created_at;
        return timeB - timeA;
      });

      setProjects(mergeProjects(sortedList, manualProjects));
    } catch (err) {
      console.error("Failed to load projects:", err);
      setError(t('common.loadingProjects'));
    } finally {
      setLoading(false);
    }
  }, [getCachedCodexSessions, manualProjects, mergeProjects, t]);

  const selectProject = useCallback(async (project: Project) => {
    try {
      setLoading(true);
      setError(null);
      const { effectiveProject, sessions: allSessions } = await loadSessionsForProject(project);

      setSessions(allSessions);
      setSelectedProject(effectiveProject);

      // Background indexing
      api.preindexProject(effectiveProject.path).catch(console.error);
    } catch (err) {
      console.error("Failed to load sessions:", err);
      setError(t('common.loadingSessions'));
    } finally {
      setLoading(false);
    }
  }, [loadSessionsForProject, t]);

  const registerProjectByPath = useCallback(async (projectPath: string) => {
    try {
      setLoading(true);
      setError(null);

      const existingProject = findProjectByPath(projects, projectPath);
      if (existingProject) {
        setProjects(prevProjects => mergeProjects([existingProject], prevProjects));
        setSelectedProject(null);
        setSessions([]);
        return;
      }

      const latestProjects = await api.listProjects().catch(() => [] as Project[]);
      const matchedProject = findProjectByPath(latestProjects, projectPath);
      const projectToRegister = matchedProject ?? buildVirtualProject(projectPath);

      // 使用手动项目列表保留“尚未产生会话”的项目卡片
      const nextManualProjects = matchedProject
        ? manualProjects.filter(project => normalizeProjectPath(project.path) !== normalizeProjectPath(projectPath))
        : mergeProjects([projectToRegister], manualProjects);

      setManualProjects(nextManualProjects);
      setProjects(prevProjects => mergeProjects([projectToRegister], mergeProjects(prevProjects, nextManualProjects)));
      setSelectedProject(null);
      setSessions([]);

      api.preindexProject(projectToRegister.path).catch(console.error);
    } catch (err) {
      console.error("Failed to register project by path:", err);
      setError(t('common.loadingProjects'));
    } finally {
      setLoading(false);
    }
  }, [buildVirtualProject, findProjectByPath, manualProjects, mergeProjects, normalizeProjectPath, projects, t]);

  const refreshSessions = useCallback(async () => {
    if (selectedProject) {
      try {
        const latestProjects = await api.listProjects().catch(() => [] as Project[]);
        const { effectiveProject, sessions: allSessions } = await loadSessionsForProject(selectedProject, latestProjects);

        setSelectedProject(effectiveProject);
        setSessions(allSessions);
      } catch (err) {
        console.error("Failed to refresh sessions:", err);
      }
    }
  }, [loadSessionsForProject, selectedProject]);

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
          setSelectedProject(null);
          setSessions([]);
        }
        return;
      }

      setLoading(true);
      await api.deleteProject(project.id);
      await loadProjects();
      if (selectedProject?.id === project.id) {
        setSelectedProject(null);
        setSessions([]);
      }
    } catch (err) {
      console.error("Failed to delete project:", err);
      throw err;
    } finally {
      setLoading(false);
    }
  }, [loadProjects, normalizeProjectPath, selectedProject]);

  const clearSelection = useCallback(() => {
    setSelectedProject(null);
    setSessions([]);
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
