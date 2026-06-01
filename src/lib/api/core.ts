import { invoke } from "@tauri-apps/api/core";
import {
  listCodexSessionsCached,
  listGeminiSessionsCached
} from '@/lib/api/sessionCache';
import type {
  Project,
  Session,
  ClaudeSettings,
  ClaudeExecutionConfig,
  ClaudeVersionStatus,
  ClaudeMdFile,
  FileEntry,
  ProjectUsage,
  UsageStats,
  SessionCacheTokens,
  SessionHistoryPage
} from '@/lib/api/types';

export const coreApi = {
  /**
   * Lists all projects in the ~/.claude/projects directory
   * @returns Promise resolving to an array of projects
   */
  async listProjects(): Promise<Project[]> {
    try {
      return await invoke<Project[]>("list_projects");
    } catch (error) {
      console.error("Failed to list projects:", error);
      throw error;
    }
  },

  /**
   * Retrieves sessions for a specific project (both Claude and Codex)
   * @param projectId - The ID of the project to retrieve sessions for
   * @param projectPath - Optional project path to filter Codex sessions (if not provided, tries to infer from Claude sessions)
   * @returns Promise resolving to an array of sessions
   */
  async getProjectSessions(projectId: string, projectPath?: string): Promise<Session[]> {
    try {
      const [claudeSessions, codexSessions] = await Promise.all([
        invoke<Session[]>('get_project_sessions', { projectId }),
        listCodexSessionsCached(),
      ]);

      const targetPath = projectPath || claudeSessions[0]?.project_path;

      // Normalize paths for comparison (handle Windows backslashes and case insensitivity)
      const normalize = (p: string) => p ? p.replace(/\\/g, '/').replace(/\/$/, '').toLowerCase() : '';
      const targetPathNorm = normalize(targetPath || '');

      const filteredCodexSessions: Session[] = codexSessions
        .filter(cs => {
          // If we don't have a target path, we can't filter, so return no Codex sessions
          if (!targetPathNorm) return false;

          const csPathNorm = normalize(cs.projectPath);
          const match = csPathNorm === targetPathNorm;

          return match;
        })
        .map(cs => ({
          id: cs.id,
          project_id: projectId,
          project_path: cs.projectPath,
          created_at: cs.createdAt,
          model: cs.model || 'gpt-5.5',
          engine: 'codex' as const,
          // 🆕 Use actual first message from JSONL file
          first_message: cs.firstMessage || `Codex Session`,
          last_message_timestamp: cs.lastMessageTimestamp,
        }));

      // Merge and sort by creation time
      const allSessions = [...claudeSessions.map(s => ({ ...s, engine: 'claude' as const })), ...filteredCodexSessions];
      allSessions.sort((a, b) => b.created_at - a.created_at);

      return allSessions;
    } catch (error) {
      console.error("Failed to get project sessions:", error);
      throw error;
    }
  },

  /**
   * Retrieves only Claude sessions for a project. This is useful for progressive
   * UI loading where Codex/Gemini sessions can arrive independently.
   */
  async getClaudeProjectSessions(projectId: string): Promise<Session[]> {
    try {
      const claudeSessions = await invoke<Session[]>('get_project_sessions', { projectId });
      return claudeSessions.map(s => ({ ...s, engine: 'claude' as const }));
    } catch (error) {
      console.error("Failed to get Claude project sessions:", error);
      throw error;
    }
  },

  /**
   * Retrieves Codex sessions filtered to a single project path.
   */
  async getCodexProjectSessions(projectId: string, projectPath: string): Promise<Session[]> {
    try {
      const codexSessions = await listCodexSessionsCached();
      const normalize = (p: string) => p ? p.replace(/\\/g, '/').replace(/\/$/, '').toLowerCase() : '';
      const targetPathNorm = normalize(projectPath);

      if (!targetPathNorm) {
        return [];
      }

      return codexSessions
        .filter(cs => normalize(cs.projectPath) === targetPathNorm)
        .map(cs => ({
          id: cs.id,
          project_id: projectId,
          project_path: cs.projectPath,
          created_at: cs.createdAt,
          model: cs.model || 'gpt-5.5',
          engine: 'codex' as const,
          first_message: cs.firstMessage || `Codex Session`,
          last_message_timestamp: cs.lastMessageTimestamp,
        }));
    } catch (error) {
      console.error("Failed to get Codex project sessions:", error);
      throw error;
    }
  },

  /**
   * Retrieves Gemini sessions for a project path and converts them to the common
   * Session shape used by the list UI.
   */
  async getGeminiProjectSessions(projectId: string, projectPath: string): Promise<Session[]> {
    try {
      const geminiSessionInfos = await listGeminiSessionsCached(projectPath);
      return geminiSessionInfos.map(info => ({
        id: info.sessionId,
        project_id: projectId,
        project_path: projectPath,
        created_at: new Date(info.startTime).getTime() / 1000,
        first_message: info.firstMessage,
        message_timestamp: info.startTime,
        last_message_timestamp: info.startTime,
        engine: 'gemini' as const,
      }));
    } catch (error) {
      console.error("Failed to get Gemini project sessions:", error);
      throw error;
    }
  },

  /**
   * Deletes a session and all its associated data
   * @param sessionId - The session ID to delete
   * @param projectId - The project ID this session belongs to
   * @returns Promise resolving to success message
   */
  async deleteSession(sessionId: string, projectId: string): Promise<string> {
    try {
      return await invoke<string>('delete_session', { sessionId, projectId });
    } catch (error) {
      console.error("Failed to delete session:", error);
      throw error;
    }
  },

  /**
   * Deletes multiple sessions in batch
   * @param sessionIds - Array of session IDs to delete
   * @param projectId - The project ID these sessions belong to
   * @returns Promise resolving to success message
   */
  async deleteSessionsBatch(sessionIds: string[], projectId: string): Promise<string> {
    try {
      return await invoke<string>('delete_sessions_batch', { sessionIds, projectId });
    } catch (error) {
      console.error("Failed to batch delete sessions:", error);
      throw error;
    }
  },

  /**
   * Removes a project from the project list (without deleting files)
   * @param projectId - The ID of the project to remove from list
   * @returns Promise resolving to success message
   */
  async deleteProject(projectId: string): Promise<string> {
    try {
      return await invoke<string>('delete_project', { projectId });
    } catch (error) {
      console.error("Failed to remove project from list:", error);
      throw error;
    }
  },

  /**
   * Restores a hidden project back to the project list
   * @param projectId - The ID of the project to restore
   * @returns Promise resolving to success message
   */
  async restoreProject(projectId: string): Promise<string> {
    try {
      return await invoke<string>('restore_project', { projectId });
    } catch (error) {
      console.error("Failed to restore project:", error);
      throw error;
    }
  },

  /**
   * Lists all hidden projects
   * @returns Promise resolving to array of hidden project IDs
   */
  async listHiddenProjects(): Promise<string[]> {
    try {
      return await invoke<string[]>('list_hidden_projects');
    } catch (error) {
      console.error("Failed to list hidden projects:", error);
      throw error;
    }
  },

  /**
   * Permanently delete a project and all its files
   * @param projectId - The project ID to permanently delete
   * @returns Promise resolving to success message
   */
  async deleteProjectPermanently(projectId: string): Promise<string> {
    try {
      return await invoke<string>('delete_project_permanently', { projectId });
    } catch (error) {
      console.error("Failed to permanently delete project:", error);
      throw error;
    }
  },

  /**
   * Reads the Claude settings file
   * @returns Promise resolving to the settings object
  */
  async getClaudeSettings(): Promise<ClaudeSettings> {
    try {
      // Due to #[serde(flatten)] in Rust, the result is directly the settings object
      return await invoke<ClaudeSettings>("get_claude_settings");
    } catch (error) {
      console.error("Failed to get Claude settings:", error);
      throw error;
    }
  },

  /**
   * Opens a new Claude Code session
   * @param path - Optional path to open the session in
   * @returns Promise resolving when the session is opened
   */
  async openNewSession(path?: string): Promise<string> {
    try {
      return await invoke<string>("open_new_session", { path });
    } catch (error) {
      console.error("Failed to open new session:", error);
      throw error;
    }
  },

  /**
   * Reads the CLAUDE.md system prompt file
   * @returns Promise resolving to the system prompt content
   */
  async getSystemPrompt(): Promise<string> {
    try {
      return await invoke<string>("get_system_prompt");
    } catch (error) {
      console.error("Failed to get system prompt:", error);
      throw error;
    }
  },

  /**
   * Checks if Claude Code is installed and gets its version
   * @returns Promise resolving to the version status
   */
  async checkClaudeVersion(): Promise<ClaudeVersionStatus> {
    try {
      return await invoke<ClaudeVersionStatus>("check_claude_version");
    } catch (error) {
      console.error("Failed to check Claude version:", error);
      throw error;
    }
  },

  /**
   * Saves the CLAUDE.md system prompt file
   * @param content - The new content for the system prompt
   * @returns Promise resolving when the file is saved
   */
  async saveSystemPrompt(content: string): Promise<string> {
    try {
      return await invoke<string>("save_system_prompt", { content });
    } catch (error) {
      console.error("Failed to save system prompt:", error);
      throw error;
    }
  },

  /**
   * Reads the AGENTS.md system prompt file from Codex directory
   * @returns Promise resolving to the Codex system prompt content
   */
  async getCodexSystemPrompt(): Promise<string> {
    try {
      return await invoke<string>("get_codex_system_prompt");
    } catch (error) {
      console.error("Failed to get Codex system prompt:", error);
      throw error;
    }
  },

  /**
   * Saves the AGENTS.md system prompt file to Codex directory
   * @param content - The new content for the Codex system prompt
   * @returns Promise resolving when the file is saved
   */
  async saveCodexSystemPrompt(content: string): Promise<string> {
    try {
      return await invoke<string>("save_codex_system_prompt", { content });
    } catch (error) {
      console.error("Failed to save Codex system prompt:", error);
      throw error;
    }
  },

  /**
   * Reads the GEMINI.md system prompt file from Gemini directory
   * @returns Promise resolving to the content of GEMINI.md
   */
  async getGeminiSystemPrompt(): Promise<string> {
    try {
      return await invoke<string>("get_gemini_system_prompt");
    } catch (error) {
      console.error("Failed to get Gemini system prompt:", error);
      throw error;
    }
  },

  /**
   * Saves the GEMINI.md system prompt file to Gemini directory
   * @param content - The new content for the Gemini system prompt
   * @returns Promise resolving when the file is saved
   */
  async saveGeminiSystemPrompt(content: string): Promise<string> {
    try {
      return await invoke<string>("save_gemini_system_prompt", { content });
    } catch (error) {
      console.error("Failed to save Gemini system prompt:", error);
      throw error;
    }
  },

  /**
   * Saves the Claude settings file
   * @param settings - The settings object to save
   * @returns Promise resolving when the settings are saved
   */
  async saveClaudeSettings(settings: ClaudeSettings): Promise<string> {
    try {
      return await invoke<string>("save_claude_settings", { settings });
    } catch (error) {
      console.error("Failed to save Claude settings:", error);
      throw error;
    }
  },

  /**
   * Updates the Claude Code effort level in settings.json.
   * @param enabled - Whether to enable adaptive thinking
   * @param effort - Effort level: low, medium, high, xhigh, max (only used when enabled)
   * @returns Promise resolving when the settings are updated
   */
  async updateThinkingMode(enabled: boolean, effort?: string): Promise<string> {
    try {
      return await invoke<string>("update_thinking_mode", { enabled, effort });
    } catch (error) {
      console.error("Failed to update thinking mode:", error);
      throw error;
    }
  },

  async updateClaudeFastMode(enabled: boolean): Promise<string> {
    try {
      return await invoke<string>("update_claude_fast_mode", { enabled });
    } catch (error) {
      console.error("Failed to update Claude fast mode:", error);
      throw error;
    }
  },

  /**
   * Get Claude execution configuration
   * @returns Promise resolving to the current execution config
   */
  async getClaudeExecutionConfig(): Promise<ClaudeExecutionConfig> {
    try {
      return await invoke<ClaudeExecutionConfig>("get_claude_execution_config");
    } catch (error) {
      console.error("Failed to get Claude execution config:", error);
      throw error;
    }
  },

  /**
   * Update Claude execution configuration
   * @param config - The new execution configuration
   * @returns Promise resolving when the config is saved
   */
  async updateClaudeExecutionConfig(config: ClaudeExecutionConfig): Promise<void> {
    try {
      return await invoke<void>("update_claude_execution_config", { config });
    } catch (error) {
      console.error("Failed to update Claude execution config:", error);
      throw error;
    }
  },

  /**
   * Finds all CLAUDE.md files in a project directory
   * @param projectPath - The absolute path to the project
   * @returns Promise resolving to an array of CLAUDE.md files
   */
  async findClaudeMdFiles(projectPath: string): Promise<ClaudeMdFile[]> {
    try {
      return await invoke<ClaudeMdFile[]>("find_claude_md_files", { projectPath });
    } catch (error) {
      console.error("Failed to find CLAUDE.md files:", error);
      throw error;
    }
  },

  /**
   * Reads a specific CLAUDE.md file
   * @param filePath - The absolute path to the file
   * @returns Promise resolving to the file content
   */
  async readClaudeMdFile(filePath: string): Promise<string> {
    try {
      return await invoke<string>("read_claude_md_file", { filePath });
    } catch (error) {
      console.error("Failed to read CLAUDE.md file:", error);
      throw error;
    }
  },

  /**
   * Saves a specific CLAUDE.md file
   * @param filePath - The absolute path to the file
   * @param content - The new content for the file
   * @returns Promise resolving when the file is saved
   */
  async saveClaudeMdFile(filePath: string, content: string): Promise<string> {
    try {
      return await invoke<string>("save_claude_md_file", { filePath, content });
    } catch (error) {
      console.error("Failed to save CLAUDE.md file:", error);
      throw error;
    }
  },


  /**
   * Loads the JSONL history for a specific session (Claude or Codex)
   */
  async loadSessionHistory(sessionId: string, projectId: string, engine?: 'claude' | 'codex'): Promise<LegacyAny[]> {
    // For Codex sessions, read directly from .codex/sessions
    if (engine === 'codex') {
      return this.loadCodexSessionHistory(sessionId);
    }
    // For Claude sessions, use existing backend
    return invoke("load_session_history", { sessionId, projectId });
  },

  /**
   * Loads one page of session history from the end of the backing JSONL file.
   * This is the preferred API for the conversation view because it avoids
   * parsing/transferring every historical event before the first paint.
   */
  async loadSessionHistoryPage(
    sessionId: string,
    projectId: string,
    engine?: 'claude' | 'codex',
    options?: { offset?: number; limit?: number }
  ): Promise<SessionHistoryPage<LegacyAny>> {
    const offset = options?.offset ?? 0;
    const limit = options?.limit ?? 300;

    if (engine === 'codex') {
      return invoke("load_codex_session_history_page", { sessionId, offset, limit });
    }

    return invoke("load_session_history_page", { sessionId, projectId, offset, limit });
  },

  /**
   * 🆕 Loads Codex session history from JSONL file
   */
  async loadCodexSessionHistory(sessionId: string): Promise<LegacyAny[]> {
    try {
      return await invoke("load_codex_session_history", { sessionId });
    } catch (error) {
      console.error("Failed to load Codex session history:", error);
      throw error;
    }
  },

  /**
   * Executes a new interactive Claude Code session with streaming output
   * @param planMode - Enable Plan Mode for read-only research and planning
   * @param tabId - Unique identifier for the tab, used to filter global events
   */
  async executeClaudeCode(projectPath: string, prompt: string, model: string, planMode?: boolean, maxThinkingTokens?: number, tabId?: string, fastMode?: boolean): Promise<void> {
    return invoke("execute_claude_code", { projectPath, prompt, model, planMode, maxThinkingTokens, tabId, fastMode });
  },

  /**
   * Continues an existing Claude Code conversation with streaming output
   * @param planMode - Enable Plan Mode for read-only research and planning
   * @param tabId - Unique identifier for the tab, used to filter global events
   */
  async continueClaudeCode(projectPath: string, prompt: string, model: string, planMode?: boolean, maxThinkingTokens?: number, tabId?: string, fastMode?: boolean): Promise<void> {
    return invoke("continue_claude_code", { projectPath, prompt, model, planMode, maxThinkingTokens, tabId, fastMode });
  },

  /**
   * Resumes an existing Claude Code session by ID with streaming output
   * @param planMode - Enable Plan Mode for read-only research and planning
   * @param tabId - Unique identifier for the tab, used to filter global events
   */
  async resumeClaudeCode(projectPath: string, sessionId: string, prompt: string, model: string, planMode?: boolean, maxThinkingTokens?: number, tabId?: string, fastMode?: boolean): Promise<void> {
    return invoke("resume_claude_code", { projectPath, sessionId, prompt, model, planMode, maxThinkingTokens, tabId, fastMode });
  },

  /**
   * Cancels the currently running Claude Code execution
   * @param sessionId - Optional session ID to cancel a specific session
   */
  async cancelClaudeExecution(sessionId: string): Promise<void> {
    if (!sessionId?.trim()) {
      throw new Error("sessionId is required to cancel Claude execution safely");
    }
    return invoke("cancel_claude_execution", { sessionId });
  },

  /**
   * Lists all currently running Claude sessions
   * @returns Promise resolving to list of running Claude sessions
   */
  async listRunningClaudeSessions(): Promise<LegacyAny[]> {
    return invoke("list_running_claude_sessions");
  },

  /**
   * Gets live output from a Claude session
   * @param sessionId - The session ID to get output for
   * @returns Promise resolving to the current live output
   */
  async getClaudeSessionOutput(sessionId: string): Promise<string> {
    return invoke("get_claude_session_output", { sessionId });
  },

  /**
   * Lists files and directories in a given path
   */
  async listDirectoryContents(directoryPath: string): Promise<FileEntry[]> {
    return invoke("list_directory_contents", { directoryPath });
  },

  /**
   * Searches for files and directories matching a pattern
   */
  async searchFiles(basePath: string, query: string): Promise<FileEntry[]> {
    return invoke("search_files", { basePath, query });
  },

  /**
   * Gets overall usage statistics
   * @returns Promise resolving to usage statistics
   */
  async getUsageStats(): Promise<UsageStats> {
    try {
      return await invoke<UsageStats>("get_usage_stats");
    } catch (error) {
      console.error("Failed to get usage stats:", error);
      throw error;
    }
  },


  /**
   * Gets usage statistics filtered by date range
   * @param startDate - Start date (ISO format)
   * @param endDate - End date (ISO format)
   * @returns Promise resolving to usage statistics
   */
  async getUsageByDateRange(startDate: string, endDate: string): Promise<UsageStats> {
    try {
      return await invoke<UsageStats>("get_usage_by_date_range", { startDate, endDate });
    } catch (error) {
      console.error("Failed to get usage by date range:", error);
      throw error;
    }
  },

  /**
   * Gets usage statistics grouped by session
   * @param since - Optional start date (YYYYMMDD)
   * @param until - Optional end date (YYYYMMDD)
   * @param order - Optional sort order ('asc' or 'desc')
   * @returns Promise resolving to an array of session usage data
   */
  async getSessionStats(
    since?: string,
    until?: string,
    order?: "asc" | "desc"
  ): Promise<ProjectUsage[]> {
    try {
      return await invoke<ProjectUsage[]>("get_session_stats", {
        since,
        until,
        order,
      });
    } catch (error) {
      console.error("Failed to get session stats:", error);
      throw error;
    }
  },




  /**
   * Gets cache tokens for a specific session
   * @param sessionId - The session ID to get cache tokens for
   * @returns Promise resolving to session cache tokens
   */
  async getSessionCacheTokens(sessionId: string): Promise<SessionCacheTokens> {
    try {
      return await invoke<SessionCacheTokens>("get_session_cache_tokens", { sessionId });
    } catch (error) {
      console.error("Failed to get session cache tokens:", error);
      throw error;
    }
  },

  // ============================================================================
  // CODEX USAGE STATISTICS
  // ============================================================================

  /**
   * Gets Codex usage statistics
   * @param startDate - Optional start date (YYYY-MM-DD)
   * @param endDate - Optional end date (YYYY-MM-DD)
   * @returns Promise resolving to Codex usage statistics
   */
  async getCodexUsageStats(
    startDate?: string,
    endDate?: string
  ): Promise<import('@/types/usage').CodexUsageStats> {
    try {
      return await invoke<import('@/types/usage').CodexUsageStats>("get_codex_usage_stats", {
        startDate,
        endDate,
      });
    } catch (error) {
      console.error("Failed to get Codex usage stats:", error);
      throw error;
    }
  },

  // ============================================================================
  // GEMINI USAGE STATISTICS
  // ============================================================================

  /**
   * Gets Gemini usage statistics
   * @param startDate - Optional start date (YYYY-MM-DD)
   * @param endDate - Optional end date (YYYY-MM-DD)
   * @returns Promise resolving to Gemini usage statistics
   */
  async getGeminiUsageStats(
    startDate?: string,
    endDate?: string
  ): Promise<import('@/types/usage').GeminiUsageStats> {
    try {
      return await invoke<import('@/types/usage').GeminiUsageStats>("get_gemini_usage_stats", {
        startDate,
        endDate,
      });
    } catch (error) {
      console.error("Failed to get Gemini usage stats:", error);
      throw error;
    }
  },
};
