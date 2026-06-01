import { invoke } from "@tauri-apps/api/core";
import { codexProviderPresets } from '@/config/codexProviderPresets';
import {
  listCodexSessionsCached,
  clearCodexSessionsCache,
  deleteGeminiSessionsCache
} from '@/lib/api/sessionCache';
import type {
  RewindMode,
  RewindCapabilities,
  PromptRecord,
  PromptRecordWithCapabilities,
  CodexProviderConfig,
  CurrentCodexConfig
} from '@/lib/api/types';

export const codexApi = {
  // ==================== OpenAI Codex Integration ====================

  /**
   * Executes a Codex task in non-interactive mode with streaming output
   * @param options - Codex execution options
   * @returns Promise resolving when execution starts (events are streamed via event listeners)
   */
  async executeCodex(options: import('@/types/codex').CodexExecutionOptions): Promise<void> {
    try {
      clearCodexSessionsCache();
      return await invoke("execute_codex", { options });
    } catch (error) {
      console.error("Failed to execute Codex:", error);
      throw error;
    }
  },

  /**
   * Resumes a previous Codex session
   * @param sessionId - The session ID to resume
   * @param options - Codex execution options (prompt, mode, etc.)
   * @returns Promise resolving when execution starts
   */
  async resumeCodex(
    sessionId: string,
    options: Omit<import('@/types/codex').CodexExecutionOptions, 'sessionId'>
  ): Promise<void> {
    try {
      return await invoke("resume_codex", { sessionId, options });
    } catch (error) {
      console.error("Failed to resume Codex session:", error);
      throw error;
    }
  },

  /**
   * Resumes the last Codex session
   * @param options - Codex execution options
   * @returns Promise resolving when execution starts
   */
  async resumeLastCodex(
    options: Omit<import('@/types/codex').CodexExecutionOptions, 'resumeLast'>
  ): Promise<void> {
    try {
      return await invoke("resume_last_codex", { options });
    } catch (error) {
      console.error("Failed to resume last Codex session:", error);
      throw error;
    }
  },

  /**
   * Cancels a running Codex execution
   * @param sessionId - Optional session ID to cancel a specific session
   * @returns Promise resolving when cancellation is complete
   */
  async cancelCodex(sessionId: string): Promise<void> {
    if (!sessionId?.trim()) {
      throw new Error("sessionId is required to cancel Codex execution safely");
    }
    try {
      return await invoke("cancel_codex", { sessionId });
    } catch (error) {
      console.error("Failed to cancel Codex execution:", error);
      throw error;
    }
  },

  /**
   * Gets a list of all Codex sessions
   * @returns Promise resolving to array of Codex sessions
   */
  async listCodexSessions(): Promise<import('@/types/codex').CodexSession[]> {
    try {
      return await listCodexSessionsCached();
    } catch (error) {
      console.error("Failed to list Codex sessions:", error);
      throw error;
    }
  },

  /**
   * Deletes a Codex session
   * @param sessionId - The session ID to delete
   * @returns Promise resolving to success message
   */
  async deleteCodexSession(sessionId: string): Promise<string> {
    try {
      const result = await invoke<string>("delete_codex_session", { sessionId });
      clearCodexSessionsCache();
      return result;
    } catch (error) {
      console.error("Failed to delete Codex session:", error);
      throw error;
    }
  },

  /**
   * Checks if Codex is available and properly configured
   * @returns Promise resolving to availability status
   */
  async checkCodexAvailability(): Promise<{
    available: boolean;
    version?: string;
    error?: string;
  }> {
    try {
      return await invoke("check_codex_availability");
    } catch (error) {
      console.error("Failed to check Codex availability:", error);
      return {
        available: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  },

  // ============================================================================
  // Codex Mode Configuration (WSL Support)
  // ============================================================================

  /**
   * Gets Codex mode configuration
   * @returns Promise resolving to mode configuration info
   */
  async getCodexModeConfig(): Promise<{
    mode: 'auto' | 'native' | 'wsl';
    wslDistro: string | null;
    actualMode: 'native' | 'wsl';
    nativeAvailable: boolean;
    wslAvailable: boolean;
    availableDistros: string[];
    isWindows: boolean;
  }> {
    try {
      return await invoke("get_codex_mode_config");
    } catch (error) {
      console.error("Failed to get Codex mode config:", error);
      throw error;
    }
  },

  /**
   * Sets Codex mode configuration
   * @param mode - The mode to set: 'auto', 'native', or 'wsl'
   * @param wslDistro - Optional WSL distro name
   * @param customCodexPath - Optional custom Codex path
   * @returns Promise resolving to success message
   */
  async setCodexModeConfig(
    mode: 'auto' | 'native' | 'wsl',
    wslDistro?: string | null,
    customCodexPath?: string | null
  ): Promise<string> {
    try {
      return await invoke<string>("set_codex_mode_config", {
        mode,
        wslDistro: wslDistro || null,
        customCodexPath: customCodexPath || null
      });
    } catch (error) {
      console.error("Failed to set Codex mode config:", error);
      throw error;
    }
  },

  // ============================================================================
  // Gemini WSL Mode Configuration
  // ============================================================================

  /**
   * Gets Gemini WSL mode configuration
   * @returns Promise resolving to Gemini WSL mode configuration info
   */
  async getGeminiWslModeConfig(): Promise<{
    mode: 'auto' | 'native' | 'wsl';
    wslDistro: string | null;
    wslAvailable: boolean;
    availableDistros: string[];
    wslEnabled: boolean;
    wslGeminiPath: string | null;
    wslGeminiVersion: string | null;
    nativeAvailable: boolean;
    isWindows: boolean;
  }> {
    try {
      return await invoke("get_gemini_wsl_mode_config");
    } catch (error) {
      console.error("Failed to get Gemini WSL mode config:", error);
      throw error;
    }
  },

  /**
   * Sets Gemini WSL mode configuration
   * @param mode - The mode to set: 'auto', 'native', or 'wsl'
   * @param wslDistro - Optional WSL distro name
   * @returns Promise resolving when config is saved
   */
  async setGeminiWslModeConfig(
    mode: 'auto' | 'native' | 'wsl',
    wslDistro?: string | null
  ): Promise<void> {
    try {
      await invoke("set_gemini_wsl_mode_config", {
        mode,
        wslDistro: wslDistro || null
      });
    } catch (error) {
      console.error("Failed to set Gemini WSL mode config:", error);
      throw error;
    }
  },

  // ============================================================================
  // Claude WSL Mode Configuration
  // ============================================================================

  /**
   * Gets Claude WSL mode configuration
   * @returns Promise resolving to Claude WSL mode configuration info
   */
  async getClaudeWslModeConfig(): Promise<{
    mode: 'auto' | 'native' | 'wsl';
    wslDistro: string | null;
    wslAvailable: boolean;
    availableDistros: string[];
    wslEnabled: boolean;
    wslClaudePath: string | null;
    wslClaudeDir?: string | null;
    wslClaudeVersion: string | null;
    nativeAvailable: boolean;
    actualMode: 'native' | 'wsl';
    isWindows: boolean;
  }> {
    try {
      return await invoke("get_claude_wsl_mode_config");
    } catch (error) {
      console.error("Failed to get Claude WSL mode config:", error);
      throw error;
    }
  },

  /**
   * Sets Claude WSL mode configuration
   * @param mode - The mode to set: 'auto', 'native', or 'wsl'
   * @param wslDistro - Optional WSL distro name
   * @returns Promise resolving to success message
   */
  async setClaudeWslModeConfig(
    mode: 'auto' | 'native' | 'wsl',
    wslDistro?: string | null
  ): Promise<string> {
    try {
      return await invoke("set_claude_wsl_mode_config", {
        mode,
        wslDistro: wslDistro || null
      });
    } catch (error) {
      console.error("Failed to set Claude WSL mode config:", error);
      throw error;
    }
  },

  /**
   * Get current Codex CLI path（优先自定义，其次自动检测）
   */
  async getCodexPath(): Promise<string> {
    try {
      return await invoke<string>("get_codex_path");
    } catch (error) {
      console.error("Failed to get Codex path:", error);
      throw error;
    }
  },

  /**
   * Sets custom Codex CLI path
   * @param path - Path to custom Codex CLI executable (null to clear)
   * @returns Promise resolving to success message
   */
  async setCodexCustomPath(path: string | null): Promise<void> {
    try {
      const normalizedPath = path?.trim() ?? "";

      if (normalizedPath) {
        await invoke<void>("set_custom_codex_path", { customPath: normalizedPath });
      } else {
        await invoke<void>("clear_custom_codex_path");
      }
    } catch (error) {
      console.error("Failed to set custom Codex path:", error);
      throw error;
    }
  },

  /**
   * Validates a Codex path
   * @param path - Path to validate
   * @returns Promise resolving to whether the path is valid
   */
  async validateCodexPath(path: string): Promise<boolean> {
    try {
      return await invoke<boolean>("validate_codex_path_cmd", { path: path.trim() });
    } catch (error) {
      console.error("Failed to validate Codex path:", error);
      return false;
    }
  },

  /**
   * Scans for all possible Codex installation paths
   * @returns Promise resolving to array of found paths
   */
  async scanCodexPaths(): Promise<string[]> {
    try {
      return await invoke<string[]>("scan_codex_paths");
    } catch (error) {
      console.error("Failed to scan Codex paths:", error);
      return [];
    }
  },

  // ============================================================================
  // Codex Rewind Commands
  // ============================================================================

  /**
   * Records a Codex prompt being sent (called before execution)
   * @param sessionId - The Codex session ID
   * @param projectPath - The project path
   * @param promptText - The prompt text
   * @returns Promise resolving to the prompt index
   */
  async recordCodexPromptSent(
    sessionId: string,
    projectPath: string,
    promptText: string
  ): Promise<number> {
    try {
      return await invoke<number>("record_codex_prompt_sent", {
        sessionId,
        projectPath,
        promptText
      });
    } catch (error) {
      console.error("Failed to record Codex prompt sent:", error);
      throw error;
    }
  },

  /**
   * Records a Codex prompt completion (called after AI response)
   * @param sessionId - The Codex session ID
   * @param projectPath - The project path
   * @param promptIndex - The prompt index to complete
   */
  async recordCodexPromptCompleted(
    sessionId: string,
    projectPath: string,
    promptIndex: number,
    promptText?: string
  ): Promise<void> {
    try {
      const payload: Record<string, unknown> = {
        sessionId,
        projectPath,
        promptIndex
      };
      if (promptText !== undefined) {
        payload.promptText = promptText;
      }
      await invoke("record_codex_prompt_completed", {
        ...payload
      });
    } catch (error) {
      console.error("Failed to record Codex prompt completed:", error);
      throw error;
    }
  },

  /**
   * Gets Codex prompt list for a session (used by revert picker)
   */
  async getCodexPromptList(sessionId: string): Promise<PromptRecord[]> {
    try {
      return await invoke<PromptRecord[]>("get_codex_prompt_list", { sessionId });
    } catch (error) {
      console.error("Failed to get Codex prompt list:", error);
      return [];
    }
  },

  /**
   * Gets Codex prompt list with capabilities in one backend scan.
   */
  async getCodexPromptListWithCapabilities(sessionId: string): Promise<PromptRecordWithCapabilities[]> {
    try {
      return await invoke<PromptRecordWithCapabilities[]>("get_codex_prompt_list_with_capabilities", { sessionId });
    } catch (error) {
      console.error("Failed to get Codex prompt list with capabilities:", error);
      return [];
    }
  },

  /**
   * Checks rewind capabilities for a Codex prompt
   * @param sessionId - Codex session ID
   * @param promptIndex - Prompt index to check
   */
  async checkCodexRewindCapabilities(
    sessionId: string,
    promptIndex: number
  ): Promise<RewindCapabilities> {
    try {
      return await invoke<RewindCapabilities>("check_codex_rewind_capabilities", {
        sessionId,
        promptIndex,
      });
    } catch (error) {
      console.error("Failed to check Codex rewind capabilities:", error);
      // Fallback to conversation-only to keep UI functional
      return {
        conversation: true,
        code: false,
        both: false,
        warning: "无法获取 Codex 撤回能力，只能删除对话记录。",
        source: "cli",
      };
    }
  },

  /**
   * Reverts a Codex session to a specific prompt
   * @param sessionId - The Codex session ID
   * @param projectPath - The project path
   * @param promptIndex - The prompt index to revert to
   * @param mode - The rewind mode (conversation_only, code_only, or both)
   * @returns Promise resolving to the prompt text (for restoring to input)
   */
  async revertCodexToPrompt(
    sessionId: string,
    projectPath: string,
    promptIndex: number,
    mode: RewindMode = "both"
  ): Promise<string> {
    try {
      return await invoke<string>("revert_codex_to_prompt", {
        sessionId,
        projectPath,
        promptIndex,
        mode
      });
    } catch (error) {
      console.error("Failed to revert Codex to prompt:", error);
      throw error;
    }
  },

  // ============================================================================
  // Gemini Rewind Commands
  // ============================================================================

  /**
   * Records a Gemini prompt being sent (called before execution)
   * @param sessionId - The Gemini session ID
   * @param projectPath - The project path
   * @param promptText - The prompt text
   * @returns Promise resolving to the prompt index
   */
  async recordGeminiPromptSent(
    sessionId: string,
    projectPath: string,
    promptText: string
  ): Promise<number> {
    try {
      return await invoke<number>("record_gemini_prompt_sent", {
        sessionId,
        projectPath,
        promptText
      });
    } catch (error) {
      console.error("Failed to record Gemini prompt sent:", error);
      throw error;
    }
  },

  /**
   * Records a Gemini prompt completion (called after AI response)
   * @param sessionId - The Gemini session ID
   * @param projectPath - The project path
   * @param promptIndex - The prompt index to complete
   */
  async recordGeminiPromptCompleted(
    sessionId: string,
    projectPath: string,
    promptIndex: number,
    promptText?: string
  ): Promise<void> {
    try {
      const payload: Record<string, unknown> = {
        sessionId,
        projectPath,
        promptIndex
      };
      if (promptText !== undefined) {
        payload.promptText = promptText;
      }
      await invoke("record_gemini_prompt_completed", {
        ...payload
      });
    } catch (error) {
      console.error("Failed to record Gemini prompt completed:", error);
      throw error;
    }
  },

  /**
   * Gets Gemini prompt list for a session (used by revert picker)
   */
  async getGeminiPromptList(sessionId: string, projectPath: string): Promise<PromptRecord[]> {
    try {
      return await invoke<PromptRecord[]>("get_gemini_prompt_list", { sessionId, projectPath });
    } catch (error) {
      console.error("Failed to get Gemini prompt list:", error);
      return [];
    }
  },

  /**
   * Gets Gemini prompt list with capabilities in one backend scan.
   */
  async getGeminiPromptListWithCapabilities(
    sessionId: string,
    projectPath: string
  ): Promise<PromptRecordWithCapabilities[]> {
    try {
      return await invoke<PromptRecordWithCapabilities[]>("get_gemini_prompt_list_with_capabilities", { sessionId, projectPath });
    } catch (error) {
      console.error("Failed to get Gemini prompt list with capabilities:", error);
      return [];
    }
  },

  /**
   * Checks rewind capabilities for a Gemini prompt
   * @param sessionId - Gemini session ID
   * @param projectPath - The project path
   * @param promptIndex - Prompt index to check
   */
  async checkGeminiRewindCapabilities(
    sessionId: string,
    projectPath: string,
    promptIndex: number
  ): Promise<RewindCapabilities> {
    try {
      return await invoke<RewindCapabilities>("check_gemini_rewind_capabilities", {
        sessionId,
        projectPath,
        promptIndex,
      });
    } catch (error) {
      console.error("Failed to check Gemini rewind capabilities:", error);
      // Fallback to conversation-only to keep UI functional
      return {
        conversation: true,
        code: false,
        both: false,
        warning: "无法获取 Gemini 撤回能力，只能删除对话记录。",
        source: "project",
      };
    }
  },

  /**
   * Reverts a Gemini session to a specific prompt
   * @param sessionId - The Gemini session ID
   * @param projectPath - The project path
   * @param promptIndex - The prompt index to revert to
   * @param mode - The rewind mode (conversation_only, code_only, or both)
   * @returns Promise resolving to success message
   */
  async revertGeminiToPrompt(
    sessionId: string,
    projectPath: string,
    promptIndex: number,
    mode: RewindMode = "both"
  ): Promise<string> {
    try {
      const result = await invoke<string>("revert_gemini_to_prompt", {
        sessionId,
        projectPath,
        promptIndex,
        mode
      });
      deleteGeminiSessionsCache(projectPath);
      return result;
    } catch (error) {
      console.error("Failed to revert Gemini to prompt:", error);
      throw error;
    }
  },

  // ============================================================================
  // CODEX PROVIDER MANAGEMENT
  // ============================================================================

  /**
   * Gets the list of Codex provider presets
   * @returns Promise resolving to array of Codex provider configurations
   */
  async getCodexProviderPresets(): Promise<CodexProviderConfig[]> {
    try {
      return await invoke<CodexProviderConfig[]>("get_codex_provider_presets");
    } catch (error) {
      console.error("Failed to get Codex provider presets:", error);
      throw error;
    }
  },

  /**
   * Gets the current Codex provider configuration from ~/.codex directory
   * @returns Promise resolving to current Codex configuration
   */
  async getCurrentCodexConfig(): Promise<CurrentCodexConfig> {
    try {
      return await invoke<CurrentCodexConfig>("get_current_codex_config");
    } catch (error) {
      console.error("Failed to get current Codex config:", error);
      throw error;
    }
  },

  /**
   * Switches to a Codex provider configuration
   * Writes auth.json and config.toml to ~/.codex directory
   * @param config - The Codex provider configuration to switch to
   * @returns Promise resolving to success message
   */
  async switchCodexProvider(config: CodexProviderConfig): Promise<string> {
    try {
      return await invoke<string>("switch_codex_provider", { config });
    } catch (error) {
      console.error("Failed to switch Codex provider:", error);
      throw error;
    }
  },

  /**
   * Adds a new Codex provider configuration
   * @param config - The Codex provider configuration to add
   * @returns Promise resolving to success message
   */
  async addCodexProviderConfig(config: Omit<CodexProviderConfig, 'id'>): Promise<string> {
    // Generate base ID from name
    const baseId = config.name
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');

    // Check if ID conflicts with built-in presets
    const builtInIds = codexProviderPresets.map(p => p.id);

    // Get existing custom configurations to check for conflicts
    let existingConfigs: CodexProviderConfig[] = [];
    try {
      existingConfigs = await this.getCodexProviderPresets();
    } catch (error) {
      console.warn("Failed to load existing Codex configs:", error);
    }
    const existingIds = existingConfigs.map(c => c.id);

    // Generate unique ID by adding suffix if needed
    let id = baseId;
    let suffix = 1;
    while (builtInIds.includes(id) || existingIds.includes(id)) {
      id = `${baseId}-${suffix}`;
      suffix++;
    }

    const fullConfig: CodexProviderConfig = {
      ...config,
      id,
      createdAt: Date.now(),
    };

    try {
      return await invoke<string>("add_codex_provider_config", { config: fullConfig });
    } catch (error) {
      console.error("Failed to add Codex provider config:", error);
      throw error;
    }
  },

  /**
   * Updates an existing Codex provider configuration
   * @param config - The Codex provider configuration to update (with id)
   * @returns Promise resolving to success message
   */
  async updateCodexProviderConfig(config: CodexProviderConfig): Promise<string> {
    try {
      return await invoke<string>("update_codex_provider_config", { config });
    } catch (error) {
      console.error("Failed to update Codex provider config:", error);
      throw error;
    }
  },

  /**
   * Deletes a Codex provider configuration by ID
   * @param id - The ID of the Codex provider configuration to delete
   * @returns Promise resolving to success message
   */
  async deleteCodexProviderConfig(id: string): Promise<string> {
    try {
      return await invoke<string>("delete_codex_provider_config", { id });
    } catch (error) {
      console.error("Failed to delete Codex provider config:", error);
      throw error;
    }
  },

  /**
   * Reorders Codex provider configurations
   * @param ids - Array of provider IDs in the desired order
   * @returns Promise resolving to success message
   */
  async reorderCodexProviderConfigs(ids: string[]): Promise<string> {
    try {
      return await invoke<string>("reorder_codex_provider_configs", { ids });
    } catch (error) {
      console.error("Failed to reorder Codex provider configs:", error);
      throw error;
    }
  },

  /**
   * Clears Codex provider configuration (resets to official)
   * Removes auth.json and config.toml from ~/.codex directory
   * @returns Promise resolving to success message
   */
  async clearCodexProviderConfig(): Promise<string> {
    try {
      return await invoke<string>("clear_codex_provider_config");
    } catch (error) {
      console.error("Failed to clear Codex provider config:", error);
      throw error;
    }
  },

  /**
   * Tests Codex provider connection
   * @param baseUrl - The base URL to test
   * @param apiKey - The API key to use for testing
   * @returns Promise resolving to test result message
   */
  async testCodexProviderConnection(baseUrl: string, apiKey?: string): Promise<string> {
    try {
      return await invoke<string>("test_codex_provider_connection", { baseUrl, apiKey });
    } catch (error) {
      console.error("Failed to test Codex provider connection:", error);
      throw error;
    }
  },

  /**
   * Updates Codex reasoning effort level in config.toml
   * @param level - The reasoning level: 'low', 'medium', 'high', or 'xhigh'
   * @returns Promise resolving to success message
   */
  async updateCodexReasoningLevel(level: 'low' | 'medium' | 'high' | 'xhigh'): Promise<string> {
    try {
      return await invoke<string>("update_codex_reasoning_level", { level });
    } catch (error) {
      console.error("Failed to update Codex reasoning level:", error);
      throw error;
    }
  },

  /**
   * Gets the Codex multi-agent configuration
   */
  async getCodexMultiAgentConfig(): Promise<{ enabled: boolean; subagentModel?: string; subagentReasoningEffort?: string }> {
    try {
      return await invoke("get_codex_multi_agent_config");
    } catch (error) {
      console.error("Failed to get Codex multi-agent config:", error);
      throw error;
    }
  },

  /**
   * Sets the Codex multi-agent configuration
   */
  async setCodexMultiAgentConfig(config: { enabled: boolean; subagentModel?: string; subagentReasoningEffort?: string }): Promise<string> {
    try {
      return await invoke<string>("set_codex_multi_agent_config", { config });
    } catch (error) {
      console.error("Failed to set Codex multi-agent config:", error);
      throw error;
    }
  },
};
