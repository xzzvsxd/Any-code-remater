import { invoke } from "@tauri-apps/api/core";
import type {
  RewindMode,
  RewindCapabilities,
  ResetSafetyInfo,
  PromptRecord,
  PromptRecordWithCapabilities,
  UsageDashboardStats
} from '@/lib/api/types';

export const promptApi = {
  // ==================== Checkpoint API Methods ====================

  /**
  /**
   * Tracks a batch of messages for a session for checkpointing
   */
  async trackSessionMessages(
    sessionId: string,
    projectId: string,
    projectPath: string,
    messages: string[]
  ): Promise<void> {
    try {
      return await invoke<void>("track_session_messages", {
        sessionId,
        projectId,
        projectPath,
        messages
      });
    } catch (error) {
      console.error("Failed to track session messages:", error);
      throw error;
    }
  },

  // ==================== Prompt Revert System ====================

  /**
   * Check and initialize Git repository
   */
  async checkAndInitGit(projectPath: string): Promise<boolean> {
    try {
      return await invoke<boolean>("check_and_init_git", { projectPath });
    } catch (error) {
      console.error("Failed to check/init Git:", error);
      return false;
    }
  },

  /**
   * Check if a git reset operation is safe
   * This prevents accidentally reverting to a much older version when
   * multiple engines or user manual commits are involved
   */
  async checkResetSafety(
    projectPath: string,
    targetCommit: string,
    currentEngine: string
  ): Promise<ResetSafetyInfo> {
    try {
      return await invoke<ResetSafetyInfo>("check_reset_safety", {
        projectPath,
        targetCommit,
        currentEngine,
      });
    } catch (error) {
      console.error("Failed to check reset safety:", error);
      // Return a safe default that allows proceeding
      return {
        commitsToLose: 0,
        hasOtherEngineCommits: false,
        hasUserCommits: false,
        commitsSummary: [],
        safeToProceed: true,
        warning: null,
      };
    }
  },

  /**
   * Record a prompt being sent
   */
  async recordPromptSent(
    sessionId: string,
    projectId: string,
    projectPath: string,
    promptText: string
  ): Promise<number> {
    try {
      return await invoke<number>("record_prompt_sent", {
        sessionId,
        projectId,
        projectPath,
        promptText
      });
    } catch (error) {
      console.error("Failed to record prompt:", error);
      throw error;
    }
  },

  /**
   * Mark a prompt as completed
   */
  async markPromptCompleted(
    sessionId: string,
    projectId: string,
    projectPath: string,
    promptIndex: number,
    promptText?: string
  ): Promise<void> {
    try {
      const payload: Record<string, unknown> = {
        sessionId,
        projectId,
        projectPath,
        promptIndex
      };
      if (promptText !== undefined) {
        payload.promptText = promptText;
      }
      return await invoke<void>("mark_prompt_completed", {
        ...payload
      });
    } catch (error) {
      console.error("Failed to mark prompt completed:", error);
      throw error;
    }
  },

  /**
   * Revert to a specific prompt with support for different rewind modes
   */
  async revertToPrompt(
    sessionId: string,
    projectId: string,
    projectPath: string,
    promptIndex: number,
    mode: RewindMode = "both"
  ): Promise<string> {
    try {
      return await invoke<string>("revert_to_prompt", {
        sessionId,
        projectId,
        projectPath,
        promptIndex,
        mode
      });
    } catch (error) {
      console.error("Failed to revert to prompt:", error);
      throw error;
    }
  },

  /**
   * Get list of all prompts for a session
   * Extracts all prompts from .jsonl (single source of truth)
   */
  async getPromptList(
    sessionId: string,
    projectId: string
  ): Promise<PromptRecord[]> {
    try {
      return await invoke<PromptRecord[]>("get_prompt_list", {
        sessionId,
        projectId
      });
    } catch (error) {
      console.error("Failed to get prompt list:", error);
      return [];
    }
  },

  /**
   * Gets dashboard Claude usage stats and grouped session stats in one backend scan.
   */
  async getUsageDashboardStats(options: {
    startDate?: string;
    endDate?: string;
    since?: string;
    until?: string;
    order?: "asc" | "desc";
  } = {}): Promise<UsageDashboardStats> {
    try {
      return await invoke<UsageDashboardStats>("get_usage_dashboard_stats", {
        startDate: options.startDate,
        endDate: options.endDate,
        since: options.since,
        until: options.until,
        order: options.order,
      });
    } catch (error) {
      console.error("Failed to get usage dashboard stats:", error);
      throw error;
    }
  },

  /**
   * Get prompts and rewind capabilities in one backend scan.
   * Avoids RevertPromptPicker doing one full JSONL scan per prompt.
   */
  async getPromptListWithCapabilities(
    sessionId: string,
    projectId: string
  ): Promise<PromptRecordWithCapabilities[]> {
    try {
      return await invoke<PromptRecordWithCapabilities[]>("get_prompt_list_with_capabilities", {
        sessionId,
        projectId
      });
    } catch (error) {
      console.error("Failed to get prompt list with capabilities:", error);
      return [];
    }
  },

  /**
   * Get unified prompt list with git records enriched from .git-records.json
   * Combines .jsonl prompts (all messages) with git records (hash-based mapping)
   * This includes both project interface prompts (with git records) and CLI prompts (without git records)
   */
  async getUnifiedPromptList(
    sessionId: string,
    projectId: string
  ): Promise<PromptRecord[]> {
    try {
      return await invoke<PromptRecord[]>("get_unified_prompt_list", {
        sessionId,
        projectId
      });
    } catch (error) {
      console.error("Failed to get unified prompt list:", error);
      return [];
    }
  },

  /**
   * Check rewind capabilities for a specific prompt
   * Determines whether a prompt can be reverted fully (conversation + code) or partially (conversation only)
   */
  async checkRewindCapabilities(
    sessionId: string,
    projectId: string,
    promptIndex: number
  ): Promise<RewindCapabilities> {
    try {
      return await invoke<RewindCapabilities>("check_rewind_capabilities", {
        sessionId,
        projectId,
        promptIndex
      });
    } catch (error) {
      console.error("Failed to check rewind capabilities:", error);
      throw error;
    }
  },

  // ==================== Claude Extensions (Plugins, Subagents & Skills) ====================

  /**
   * List all installed plugins
   */
  async listPlugins(projectPath?: string): Promise<LegacyAny[]> {
    try {
      return await invoke<LegacyAny[]>("list_plugins", { projectPath });
    } catch (error) {
      console.error("Failed to list plugins:", error);
      return [];
    }
  },

  /**
   * Toggle a plugin's enabled/disabled state
   * @param pluginName - The plugin key (e.g. "plugin-name@marketplace")
   * @returns The new enabled state (true = enabled, false = disabled)
   */
  async togglePluginEnabled(pluginName: string): Promise<boolean> {
    try {
      return await invoke<boolean>("toggle_plugin_enabled", { pluginName });
    } catch (error) {
      console.error("Failed to toggle plugin enabled state:", error);
      throw error;
    }
  },

  /**
   * Uninstall a plugin completely
   * @param pluginName - The plugin key (e.g. "plugin-name@marketplace")
   */
  async uninstallPlugin(pluginName: string): Promise<void> {
    try {
      return await invoke<void>("uninstall_plugin", { pluginName });
    } catch (error) {
      console.error("Failed to uninstall plugin:", error);
      throw error;
    }
  },

  /**
   * Reinstall a plugin from its marketplace source
   * @param pluginSource - The marketplace source identifier
   * @returns CLI output from the reinstall command
   */
  async reinstallPlugin(pluginSource: string): Promise<string> {
    try {
      return await invoke<string>("reinstall_plugin", { pluginSource });
    } catch (error) {
      console.error("Failed to reinstall plugin:", error);
      throw error;
    }
  },

  /**
   * Open plugins directory
   */
  async openPluginsDirectory(projectPath?: string): Promise<string> {
    try {
      return await invoke<string>("open_plugins_directory", { projectPath });
    } catch (error) {
      console.error("Failed to open plugins directory:", error);
      throw error;
    }
  },

  /**
   * List all subagents
   */
  async listSubagents(projectPath?: string): Promise<LegacyAny[]> {
    try {
      return await invoke<LegacyAny[]>("list_subagents", { projectPath });
    } catch (error) {
      console.error("Failed to list subagents:", error);
      return [];
    }
  },

  /**
   * List all agent skills
   */
  async listAgentSkills(projectPath?: string): Promise<LegacyAny[]> {
    try {
      return await invoke<LegacyAny[]>("list_agent_skills", { projectPath });
    } catch (error) {
      console.error("Failed to list agent skills:", error);
      return [];
    }
  },

  /**
   * Read a subagent file
   */
  async readSubagent(filePath: string): Promise<string> {
    try {
      return await invoke<string>("read_subagent", { filePath });
    } catch (error) {
      console.error("Failed to read subagent:", error);
      throw error;
    }
  },

  /**
   * Read a skill file
   */
  async readSkill(filePath: string): Promise<string> {
    try {
      return await invoke<string>("read_skill", { filePath });
    } catch (error) {
      console.error("Failed to read skill:", error);
      throw error;
    }
  },

  /**
   * Open agents directory in file explorer
   */
  async openAgentsDirectory(projectPath?: string): Promise<string> {
    try {
      return await invoke<string>("open_agents_directory", { projectPath });
    } catch (error) {
      console.error("Failed to open agents directory:", error);
      throw error;
    }
  },

  /**
   * Open skills directory in file explorer
   */
  async openSkillsDirectory(projectPath?: string): Promise<string> {
    try {
      return await invoke<string>("open_skills_directory", { projectPath });
    } catch (error) {
      console.error("Failed to open skills directory:", error);
      throw error;
    }
  },

  /**
   * Create a new subagent
   * @param name - Agent name (alphanumeric, hyphens, underscores only)
   * @param description - Short description of the agent
   * @param content - Agent system prompt content
   * @param scope - "project" or "user"
   * @param projectPath - Required for project scope
   */
  async createSubagent(
    name: string,
    description: string,
    content: string,
    scope: 'project' | 'user',
    projectPath?: string
  ): Promise<{ name: string; path: string; scope: string; description: string; content: string }> {
    try {
      return await invoke("create_subagent", { name, description, content, scope, projectPath });
    } catch (error) {
      console.error("Failed to create subagent:", error);
      throw error;
    }
  },

  /**
   * Create a new Agent Skill
   * @param name - Skill name (alphanumeric, hyphens, underscores only)
   * @param description - Short description of what this skill does
   * @param content - Skill instructions content
   * @param scope - "project" or "user"
   * @param projectPath - Required for project scope
   */
  async createSkill(
    name: string,
    description: string,
    content: string,
    scope: 'project' | 'user',
    projectPath?: string
  ): Promise<{ name: string; path: string; scope: string; description: string; content: string }> {
    try {
      return await invoke("create_skill", { name, description, content, scope, projectPath });
    } catch (error) {
      console.error("Failed to create skill:", error);
      throw error;
    }
  },

  /**
   * Open a directory in system file explorer (cross-platform)
   */
  async openDirectoryInExplorer(directoryPath: string): Promise<void> {
    try {
      return await invoke<void>("open_directory_in_explorer", { directoryPath });
    } catch (error) {
      console.error("Failed to open directory in explorer:", error);
      throw error;
    }
  },

  /**
   * Open a file with system default application (cross-platform)
   */
  async openFileWithDefaultApp(filePath: string): Promise<void> {
    try {
      return await invoke<void>("open_file_with_default_app", { filePath });
    } catch (error) {
      console.error("Failed to open file with default app:", error);
      throw error;
    }
  },

  // ==================== Git Statistics ====================

  /**
   * Get Git diff statistics between commits
   */
  async getGitDiffStats(
    projectPath: string,
    fromCommit: string,
    toCommit?: string
  ): Promise<{ linesAdded: number; linesRemoved: number; filesChanged: number }> {
    try {
      return await invoke("get_git_diff_stats", { projectPath, fromCommit, toCommit });
    } catch (error) {
      console.error("Failed to get git diff stats:", error);
      throw error;
    }
  },

  /**
   * Get code changes for current session
   */
  async getSessionCodeChanges(
    projectPath: string,
    sessionStartCommit: string
  ): Promise<{ linesAdded: number; linesRemoved: number; filesChanged: number }> {
    try {
      return await invoke("get_session_code_changes", { projectPath, sessionStartCommit });
    } catch (error) {
      console.error("Failed to get session code changes:", error);
      throw error;
    }
  },
};
