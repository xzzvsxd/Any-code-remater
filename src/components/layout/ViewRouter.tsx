import React, { useState, useEffect } from "react";
import { Plus } from "lucide-react";
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { useTranslation } from 'react-i18next';
import { motion, AnimatePresence, Transition } from "framer-motion"; // ✨ Added for transitions
import { api, type Project } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { ProjectList } from "@/components/ProjectList";
import { SessionList } from "@/components/SessionList";
import { RunningClaudeSessions } from "@/components/RunningClaudeSessions";
import { MarkdownEditor } from "@/components/MarkdownEditor";
import { CodexMarkdownEditor } from "@/components/CodexMarkdownEditor";
import { GeminiMarkdownEditor } from "@/components/GeminiMarkdownEditor";
import { ClaudeFileEditor } from "@/components/ClaudeFileEditor";
import { Settings } from "@/components/Settings";
import { ClaudeCodeSession } from "@/components/ClaudeCodeSession";
import { TabManager } from "@/components/TabManager";
import { UsageDashboard } from "@/components/UsageDashboard";
import { MCPManager } from "@/components/MCPManager";
import { ClaudeBinaryDialog } from "@/components/dialogs/ClaudeBinaryDialog";
import { Toast, ToastContainer } from "@/components/ui/toast";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ProjectSettings } from '@/components/ProjectSettings';
import { EnhancedHooksManager } from '@/components/EnhancedHooksManager';
import { ClaudeExtensionsManager } from '@/components/ClaudeExtensionsManager';
import { ProjectCardSkeleton, SessionListItemSkeleton } from '@/components/ui/skeleton';
import { useNavigation } from '@/contexts/NavigationContext';
import { useProject } from '@/contexts/ProjectContext';
import { useTabs } from '@/hooks/useTabs';
import { useGlobalKeyboardShortcuts } from '@/hooks/useGlobalKeyboardShortcuts';
import { selectProjectPath } from '@/lib/sessionHelpers';

type ClaudeCompletePayload = { tab_id?: string | null; payload: boolean } | boolean;

const isClaudeCompleteSuccess = (payload: ClaudeCompletePayload) => {
  if (typeof payload === 'boolean') return payload;
  return payload?.payload === true;
};

// ✨ View transition variants
const pageVariants = {
  initial: { opacity: 0, y: 10 },
  in: { opacity: 1, y: 0 },
  out: { opacity: 0, y: -10 }
};

const pageTransition: Transition = {
  type: "tween",
  ease: "anticipate",
  duration: 0.3
};

export const ViewRouter: React.FC = () => {
  const { t } = useTranslation();
  const { currentView, navigateTo, viewParams, setNavigationInterceptor, goBack } = useNavigation();
  const {
    projects, selectedProject, sessions, projectsLoading, sessionsLoading, sessionsLoadProgress, error,
    loadProjects, selectProject, registerProjectByPath, deleteProject, clearSelection, refreshSessions,
    scheduleProjectRefresh
  } = useProject();
  const { openSessionInBackground, switchToTab } = useTabs();

  const [showClaudeBinaryDialog, setShowClaudeBinaryDialog] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" | "info" } | null>(null);
  const [showNavigationConfirm, setShowNavigationConfirm] = useState(false);
  const [pendingView, setPendingView] = useState<LegacyAny | null>(null); // Store pending view for confirmation

  // Global keyboard shortcuts
  useGlobalKeyboardShortcuts({
    onOpenSettings: () => {
      navigateTo('settings');
    },
    enabled: currentView !== 'claude-code-session',
  });

  // Listen for open-prompt-api-settings
  useEffect(() => {
    const handleOpenPromptAPISettings = () => {
      navigateTo("settings", { initialTab: "prompt-api" });
    };
    const handleShowToast = (event: CustomEvent) => {
      const detail = event.detail || {};
      const message = typeof detail.message === 'string' ? detail.message : String(detail.message || '');
      const type = detail.type === 'success' || detail.type === 'error' || detail.type === 'info'
        ? detail.type
        : 'info';

      if (message.trim()) {
        setToast({ message, type });
      }
    };
    window.addEventListener('open-prompt-api-settings', handleOpenPromptAPISettings as EventListener);
    window.addEventListener('show-toast', handleShowToast as EventListener);
    return () => {
      window.removeEventListener('open-prompt-api-settings', handleOpenPromptAPISettings as EventListener);
      window.removeEventListener('show-toast', handleShowToast as EventListener);
    };
  }, [currentView, navigateTo]);

  // Listen for claude-session-selected
  useEffect(() => {
    const handleSessionSelected = (event: CustomEvent) => {
      const { session } = event.detail;
      const result = openSessionInBackground(session);
      switchToTab(result.tabId);
      navigateTo("claude-tab-manager");

      if (result.isNew) {
        setToast({ message: `会话 ${session.id.slice(-8)} 已打开`, type: "success" });
      } else {
        setToast({ message: `已切换到会话 ${session.id.slice(-8)}`, type: "info" });
      }
    };

    const handleClaudeNotFound = () => {
      setShowClaudeBinaryDialog(true);
    };

    window.addEventListener('claude-session-selected', handleSessionSelected as EventListener);
    window.addEventListener('claude-not-found', handleClaudeNotFound as EventListener);
    return () => {
      window.removeEventListener('claude-session-selected', handleSessionSelected as EventListener);
      window.removeEventListener('claude-not-found', handleClaudeNotFound as EventListener);
    };
  }, [openSessionInBackground, switchToTab, navigateTo]);

  // Listen for claude-complete
  useEffect(() => {
    let unlistenComplete: UnlistenFn | null = null;
    const setupListener = async () => {
      unlistenComplete = await listen<ClaudeCompletePayload>('claude-complete', async (event) => {
        if (isClaudeCompleteSuccess(event.payload)) {
          scheduleProjectRefresh(Boolean(selectedProject));
        }
      });
    };
    setupListener();
    return () => {
      if (unlistenComplete) unlistenComplete();
    };
  }, [selectedProject, scheduleProjectRefresh]);

  // Handlers
  const handleSessionDelete = async (sessionId: string, projectId: string) => {
    try {
      // Find the session to check its engine type
      const session = sessions.find(s => s.id === sessionId);
      const engine = (session as LegacyAny)?.engine;

      if (engine === 'codex') {
        // Delete Codex session
        await api.deleteCodexSession(sessionId);
      } else if (engine === 'gemini') {
        // Delete Gemini session - need project path from selectedProject
        if (selectedProject) {
          await api.deleteGeminiSession(selectedProject.path, sessionId);
        } else {
          throw new Error('No project selected for Gemini session deletion');
        }
      } else {
        // Delete Claude session
        await api.deleteSession(sessionId, projectId);
      }

      refreshSessions();
      loadProjects(); // 刷新项目列表以更新会话统计
      setToast({ message: `会话已成功删除`, type: "success" });
    } catch (err) {
      console.error("Failed to delete session:", err);
      setToast({ message: `删除会话失败`, type: "error" });
      // Still refresh sessions to reflect any state changes
      refreshSessions();
      loadProjects(); // 即使失败也刷新，以反映任何部分变更
    }
  };

  const handleSessionsBatchDelete = async (sessionIds: string[], projectId: string) => {
    try {
      // Separate Claude, Codex and Gemini sessions
      const claudeSessionIds: string[] = [];
      const codexSessionIds: string[] = [];
      const geminiSessionIds: string[] = [];

      sessionIds.forEach(id => {
        const session = sessions.find(s => s.id === id);
        if (session) {
          const engine = (session as LegacyAny).engine;
          if (engine === 'codex') {
            codexSessionIds.push(id);
          } else if (engine === 'gemini') {
            geminiSessionIds.push(id);
          } else {
            claudeSessionIds.push(id);
          }
        }
      });

      // Delete Codex sessions individually
      for (const id of codexSessionIds) {
        await api.deleteCodexSession(id);
      }

      // Delete Gemini sessions individually
      if (selectedProject) {
        for (const id of geminiSessionIds) {
          await api.deleteGeminiSession(selectedProject.path, id);
        }
      }

      // Delete Claude sessions in batch
      if (claudeSessionIds.length > 0) {
        await api.deleteSessionsBatch(claudeSessionIds, projectId);
      }

      refreshSessions();
      loadProjects(); // 刷新项目列表以更新会话统计
      setToast({ message: `成功删除 ${sessionIds.length} 个会话`, type: "success" });
    } catch (err) {
      console.error("Failed to batch delete sessions:", err);
      setToast({ message: `批量删除会话失败`, type: "error" });
      // Still refresh to reflect any partial deletions
      refreshSessions();
      loadProjects(); // 即使失败也刷新，以反映任何部分变更
    }
  };

  const handleSessionConvert = async (sessionId: string, targetEngine: 'claude' | 'codex', projectId: string, projectPath: string) => {
    try {
      const result = await api.convertSession(sessionId, targetEngine, projectId, projectPath);

      if (result.success) {
        refreshSessions();
        setToast({
          message: `会话已成功转换到 ${targetEngine === 'claude' ? 'Claude' : 'Codex'}！新会话 ID: ${result.newSessionId.substring(0, 8)}...`,
          type: "success"
        });
      } else {
        setToast({ message: `转换失败: ${result.error || '未知错误'}`, type: "error" });
      }
    } catch (err) {
      console.error("Failed to convert session:", err);
      setToast({ message: `转换会话失败: ${err}`, type: "error" });
    }
  };

  const handleProjectDeleteWrapper = async (project: Project) => {
    try {
      await deleteProject(project);
      setToast({ message: `项目 "${project.path.split('/').pop()}" 已删除成功`, type: "success" });
    } catch (err) {
      setToast({ message: `删除项目失败: ${err}`, type: "error" });
    }
  };

  const handleNewProjectClick = async () => {
    try {
      const projectPath = await selectProjectPath();
      if (!projectPath) {
        return;
      }

      await registerProjectByPath(projectPath);
    } catch (err) {
      console.error("Failed to open project selector:", err);
      setToast({ message: `${t('dialogs.openProjectPageFailed')}: ${err}`, type: "error" });
    }
  };

  // Render Logic
  const renderContent = () => {
    switch (currentView) {
      case "enhanced-hooks-manager":
        return (
          <EnhancedHooksManager
            onBack={goBack}
            projectPath={viewParams.projectPath}
          />
        );

      case "claude-extensions":
        return (
          <div className="flex-1 overflow-y-auto">
            <div className="container mx-auto p-6">
              <ClaudeExtensionsManager
                projectPath={viewParams.projectPath}
                onBack={goBack}
              />
            </div>
          </div>
        );

      case "editor":
        return (
          <div className="flex-1 overflow-hidden">
            <MarkdownEditor onBack={goBack} />
          </div>
        );

      case "codex-editor":
        return (
          <div className="flex-1 overflow-hidden">
            <CodexMarkdownEditor onBack={goBack} />
          </div>
        );

      case "gemini-editor":
        return (
          <div className="flex-1 overflow-hidden">
            <GeminiMarkdownEditor onBack={goBack} />
          </div>
        );

      case "settings":
        return (
          <div className="flex-1 flex flex-col" style={{ minHeight: 0 }}>
            <Settings 
              onBack={goBack} 
              initialTab={viewParams.initialTab}
            />
          </div>
        );

      case "projects":
        return (
          <div className="flex-1 overflow-y-auto">
            <div className="container mx-auto p-6">
              {!selectedProject && (
                <div className="mb-6 flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <h1 className="text-3xl font-bold tracking-tight">{t('common.ccProjectsTitle')}</h1>
                    <p className="text-sm text-muted-foreground mt-1">
                      {t('common.browseClaudeSessions')}
                    </p>
                  </div>
                  <Button
                    onClick={handleNewProjectClick}
                    size="default"
                    className="flex-shrink-0 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white shadow-sm transition-all duration-200 hover:shadow-md"
                  >
                    <Plus className="mr-2 h-4 w-4" />
                    {t('common.newProject')}
                  </Button>
                </div>
              )}

              {error && (
                <div className="mb-4 rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-xs text-destructive max-w-2xl">
                  {error}
                </div>
              )}

              {selectedProject ? (
                <div>
                  {sessionsLoading && (
                    <div
                      className="mb-3 rounded-2xl border border-primary/15 bg-primary/5 px-4 py-3 text-sm text-muted-foreground"
                      role="status"
                      aria-live="polite"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <span>正在异步加载会话，已加载的会话会实时显示；你可以先打开已出现的会话。</span>
                        <span className="text-xs">
                          Claude: {sessionsLoadProgress.claude === 'loading' ? '加载中' : sessionsLoadProgress.claude === 'done' ? '完成' : sessionsLoadProgress.claude === 'error' ? '失败' : '等待'}
                          <span className="mx-1">·</span>
                          Codex: {sessionsLoadProgress.codex === 'loading' ? '加载中' : sessionsLoadProgress.codex === 'done' ? '完成' : sessionsLoadProgress.codex === 'error' ? '失败' : '等待'}
                          <span className="mx-1">·</span>
                          Gemini: {sessionsLoadProgress.gemini === 'loading' ? '加载中' : sessionsLoadProgress.gemini === 'done' ? '完成' : sessionsLoadProgress.gemini === 'error' ? '失败' : '等待'}
                        </span>
                      </div>
                    </div>
                  )}

                  {sessionsLoading && sessions.length === 0 && (
                    <div className="mb-3 border border-border rounded-lg overflow-hidden divide-y divide-border">
                      {[...Array(4)].map((_, i) => (
                        <SessionListItemSkeleton key={i} />
                      ))}
                    </div>
                  )}

                  <SessionList
                    sessions={sessions}
                    projectPath={selectedProject.path}
                    onBack={clearSelection}
                    onEditClaudeFile={(file) => navigateTo("claude-file-editor", { file })}
                    onSessionDelete={handleSessionDelete}
                    onSessionsBatchDelete={handleSessionsBatchDelete}
                    onSessionConvert={handleSessionConvert}
                    onSessionClick={(session) => {
                      const result = openSessionInBackground(session);
                      switchToTab(result.tabId);
                      navigateTo("claude-tab-manager");
                      if (result.isNew) {
                        setToast({ message: `会话 ${session.id.slice(-8)} 已打开`, type: "success" });
                      } else {
                        setToast({ message: `已切换到会话 ${session.id.slice(-8)}`, type: "info" });
                      }
                    }}
                    onNewSession={(projectPath) => {
                      navigateTo("claude-tab-manager", { initialProjectPath: projectPath });
                    }}
                  />
                </div>
              ) : (
                <div>
                  <RunningClaudeSessions
                    onSessionClick={(session) => {
                      const result = openSessionInBackground(session);
                      switchToTab(result.tabId);
                      navigateTo("claude-tab-manager");
                      if (result.isNew) {
                        setToast({ message: `会话 ${session.id.slice(-8)} 已打开`, type: "success" });
                      } else {
                        setToast({ message: `已切换到会话 ${session.id.slice(-8)}`, type: "info" });
                      }
                    }}
                  />

                  {projectsLoading && projects.length === 0 ? (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 gap-3">
                      {[...Array(6)].map((_, i) => (
                        <ProjectCardSkeleton key={i} />
                      ))}
                    </div>
                  ) : projects.length > 0 ? (
                    <ProjectList
                      projects={projects}
                      onProjectClick={selectProject}
                      onProjectSettings={(project) => navigateTo("project-settings", { project })}
                      onProjectDelete={handleProjectDeleteWrapper}
                      onProjectsChanged={loadProjects}
                      loading={projectsLoading}
                    />
                  ) : (
                    <div className="py-8 text-center">
                      <p className="text-sm text-muted-foreground">
                        {t('common.noProjectsFound')}
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        );

      case "claude-file-editor":
        return viewParams.file ? (
          <ClaudeFileEditor
            file={viewParams.file}
            onBack={goBack}
          />
        ) : null;

      case "claude-code-session":
        return (
          <ClaudeCodeSession
            session={viewParams.initialSession}
            initialProjectPath={viewParams.initialProjectPath}
            onStreamingChange={(isStreaming) => {
              // Navigation protection
              if (isStreaming) {
                setNavigationInterceptor((nextView) => {
                  setPendingView(nextView);
                  setShowNavigationConfirm(true);
                  return false;
                });
              } else {
                setNavigationInterceptor(null);
              }
            }}
          />
        );

      case "claude-tab-manager":
        return (
          <TabManager
            initialSession={viewParams.initialSession}
            initialProjectPath={viewParams.initialProjectPath}
            onBack={() => navigateTo("projects")}
          />
        );

      case "usage-dashboard":
        return <UsageDashboard onBack={goBack} />;

      case "mcp":
        return <MCPManager onBack={goBack} />;

      case "project-settings":
        if (viewParams.project) {
          return (
            <ProjectSettings
              project={viewParams.project}
              onBack={goBack}
            />
          );
        }
        break;

      default:
        return null;
    }
  };

  return (
    <>
      {/* ✨ AnimatePresence for smooth page transitions */}
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={currentView}
          initial="initial"
          animate="in"
          exit="out"
          variants={pageVariants}
          transition={pageTransition}
          className="flex-1 flex flex-col h-full overflow-hidden"
        >
          {renderContent()}
        </motion.div>
      </AnimatePresence>

      <ClaudeBinaryDialog
        open={showClaudeBinaryDialog}
        onOpenChange={setShowClaudeBinaryDialog}
        onSuccess={() => {
          setToast({ message: t('messages.saved'), type: "success" });
          window.location.reload();
        }}
        onError={(message) => setToast({ message, type: "error" })}
      />

      <Dialog open={showNavigationConfirm} onOpenChange={setShowNavigationConfirm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>确认离开</DialogTitle>
            <DialogDescription>
              Claude 正在处理您的请求。确定要离开当前会话吗？这将中断正在进行的对话。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => {
              setShowNavigationConfirm(false);
              setPendingView(null);
            }}>
              取消
            </Button>
            <Button onClick={() => {
              setNavigationInterceptor(null); // Clear interceptor to allow navigation
              setShowNavigationConfirm(false);
              if (pendingView) {
                navigateTo(pendingView);
              }
            }}>
              确定离开
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ToastContainer>
        {toast && (
          <Toast
            message={toast.message}
            type={toast.type}
            onDismiss={() => setToast(null)}
          />
        )}
      </ToastContainer>
    </>
  );
};
