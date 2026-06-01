import { invoke } from "@tauri-apps/api/core";
import {
  listGeminiSessionsCached,
  clearGeminiSessionsCache,
  deleteGeminiSessionsCache
} from '@/lib/api/sessionCache';
import type {
  ConversionResult,
  GeminiProviderConfig,
  CurrentGeminiProviderConfig
} from '@/lib/api/types';

export const geminiApi = {
  // ============================================================================
  // GEMINI PROVIDER MANAGEMENT
  // ============================================================================

  /**
   * Gets the list of Gemini provider presets
   * @returns Promise resolving to array of Gemini provider configurations
   */
  async getGeminiProviderPresets(): Promise<GeminiProviderConfig[]> {
    try {
      return await invoke<GeminiProviderConfig[]>("get_gemini_provider_presets");
    } catch (error) {
      console.error("Failed to get Gemini provider presets:", error);
      throw error;
    }
  },

  /**
   * Gets the current Gemini provider configuration from ~/.gemini directory
   * @returns Promise resolving to current Gemini configuration
   */
  async getCurrentGeminiProviderConfig(): Promise<CurrentGeminiProviderConfig> {
    try {
      return await invoke<CurrentGeminiProviderConfig>("get_current_gemini_provider_config");
    } catch (error) {
      console.error("Failed to get current Gemini provider config:", error);
      throw error;
    }
  },

  /**
   * Switches to a Gemini provider configuration
   * Writes env to ~/.gemini/.env and updates settings.json
   * @param config - The Gemini provider configuration to switch to
   * @returns Promise resolving to success message
   */
  async switchGeminiProvider(config: GeminiProviderConfig): Promise<string> {
    try {
      return await invoke<string>("switch_gemini_provider", { config });
    } catch (error) {
      console.error("Failed to switch Gemini provider:", error);
      throw error;
    }
  },

  /**
   * Adds a new Gemini provider configuration
   * @param config - The Gemini provider configuration to add
   * @returns Promise resolving to success message
   */
  async addGeminiProviderConfig(config: Omit<GeminiProviderConfig, 'id'>): Promise<string> {
    // Generate ID from name
    const id = config.name
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');

    const fullConfig: GeminiProviderConfig = {
      ...config,
      id,
      createdAt: Date.now(),
    };

    try {
      return await invoke<string>("add_gemini_provider_config", { config: fullConfig });
    } catch (error) {
      console.error("Failed to add Gemini provider config:", error);
      throw error;
    }
  },

  /**
   * Updates an existing Gemini provider configuration
   * @param config - The Gemini provider configuration to update (with id)
   * @returns Promise resolving to success message
   */
  async updateGeminiProviderConfig(config: GeminiProviderConfig): Promise<string> {
    try {
      return await invoke<string>("update_gemini_provider_config", { config });
    } catch (error) {
      console.error("Failed to update Gemini provider config:", error);
      throw error;
    }
  },

  /**
   * Deletes a Gemini provider configuration by ID
   * @param id - The ID of the Gemini provider configuration to delete
   * @returns Promise resolving to success message
   */
  async deleteGeminiProviderConfig(id: string): Promise<string> {
    try {
      return await invoke<string>("delete_gemini_provider_config", { id });
    } catch (error) {
      console.error("Failed to delete Gemini provider config:", error);
      throw error;
    }
  },

  /**
   * Reorders Gemini provider configurations
   * @param ids - Array of provider IDs in the desired order
   * @returns Promise resolving to success message
   */
  async reorderGeminiProviderConfigs(ids: string[]): Promise<string> {
    try {
      return await invoke<string>("reorder_gemini_provider_configs", { ids });
    } catch (error) {
      console.error("Failed to reorder Gemini provider configs:", error);
      throw error;
    }
  },

  /**
   * Clears Gemini provider configuration (resets to official OAuth)
   * Clears .env and sets auth type to oauth-personal
   * @returns Promise resolving to success message
   */
  async clearGeminiProviderConfig(): Promise<string> {
    try {
      return await invoke<string>("clear_gemini_provider_config");
    } catch (error) {
      console.error("Failed to clear Gemini provider config:", error);
      throw error;
    }
  },

  /**
   * Tests Gemini provider connection
   * @param baseUrl - The base URL to test
   * @param apiKey - The API key to use for testing
   * @returns Promise resolving to test result message
   */
  async testGeminiProviderConnection(baseUrl: string, apiKey?: string): Promise<string> {
    try {
      return await invoke<string>("test_gemini_provider_connection", { baseUrl, apiKey });
    } catch (error) {
      console.error("Failed to test Gemini provider connection:", error);
      throw error;
    }
  },

  // ============================================================================
  // Session Conversion (Claude ↔ Codex)
  // ============================================================================

  /**
   * Convert a session between Claude and Codex formats
   * @param sessionId - The source session ID
   * @param targetEngine - The target engine ('claude' | 'codex')
   * @param projectId - The project ID (directory name)
   * @param projectPath - The project path
   * @returns Promise resolving to conversion result
   */
  async convertSession(
    sessionId: string,
    targetEngine: 'claude' | 'codex',
    projectId: string,
    projectPath: string
  ): Promise<ConversionResult> {
    try {
      return await invoke<ConversionResult>("convert_session", {
        sessionId,
        targetEngine,
        projectId,
        projectPath,
      });
    } catch (error) {
      console.error("Failed to convert session:", error);
      throw error;
    }
  },

  /**
   * Convert a Claude session to Codex format
   * @param sessionId - The Claude session ID (UUID format)
   * @param projectId - The project ID (directory name)
   * @param projectPath - The project path
   * @returns Promise resolving to conversion result
   */
  async convertClaudeToCodex(
    sessionId: string,
    projectId: string,
    projectPath: string
  ): Promise<ConversionResult> {
    try {
      return await invoke<ConversionResult>("convert_claude_to_codex", {
        sessionId,
        projectId,
        projectPath,
      });
    } catch (error) {
      console.error("Failed to convert Claude to Codex:", error);
      throw error;
    }
  },

  /**
   * Convert a Codex session to Claude format
   * @param sessionId - The Codex session ID (rollout-* format)
   * @param projectId - The project ID (directory name)
   * @param projectPath - The project path
   * @returns Promise resolving to conversion result
   */
  async convertCodexToClaude(
    sessionId: string,
    projectId: string,
    projectPath: string
  ): Promise<ConversionResult> {
    try {
      return await invoke<ConversionResult>("convert_codex_to_claude", {
        sessionId,
        projectId,
        projectPath,
      });
    } catch (error) {
      console.error("Failed to convert Codex to Claude:", error);
      throw error;
    }
  },

  // ==================== Google Gemini CLI Integration ====================

  /**
   * Executes a Gemini CLI session with streaming output
   * @param options - Gemini execution options
   * @returns Promise resolving when execution starts (events are streamed via event listeners)
   */
  async executeGemini(options: import('@/types/gemini').GeminiExecutionOptions): Promise<void> {
    try {
      clearGeminiSessionsCache();
      return await invoke("execute_gemini", { options });
    } catch (error) {
      console.error("Failed to execute Gemini:", error);
      throw error;
    }
  },

  /**
   * Cancels a running Gemini execution
   * @param sessionId - Optional session ID to cancel (cancels all if not provided)
   */
  async cancelGemini(sessionId: string): Promise<void> {
    if (!sessionId?.trim()) {
      throw new Error("sessionId is required to cancel Gemini execution safely");
    }
    try {
      await invoke("cancel_gemini", { sessionId });
    } catch (error) {
      console.error("Failed to cancel Gemini:", error);
      throw error;
    }
  },

  /**
   * Checks if Gemini CLI is installed
   * @returns Promise resolving to installation status
   */
  async checkGeminiInstalled(): Promise<import('@/types/gemini').GeminiInstallStatus> {
    try {
      return await invoke("check_gemini_installed");
    } catch (error) {
      console.error("Failed to check Gemini installation:", error);
      return {
        installed: false,
        error: String(error),
      };
    }
  },

  /**
   * Gets Gemini CLI configuration
   * @returns Promise resolving to Gemini configuration
   */
  async getGeminiConfig(): Promise<import('@/types/gemini').GeminiConfig> {
    try {
      return await invoke("get_gemini_config");
    } catch (error) {
      console.error("Failed to get Gemini config:", error);
      throw error;
    }
  },

  /**
   * Updates Gemini CLI configuration
   * @param config - New configuration to apply
   */
  async updateGeminiConfig(config: import('@/types/gemini').GeminiConfig): Promise<void> {
    try {
      await invoke("update_gemini_config", { config });
    } catch (error) {
      console.error("Failed to update Gemini config:", error);
      throw error;
    }
  },

  /**
   * Gets available Gemini models
   * @returns Promise resolving to array of model information
   */
  async getGeminiModels(): Promise<import('@/types/gemini').GeminiModelInfo[]> {
    try {
      return await invoke("get_gemini_models");
    } catch (error) {
      console.error("Failed to get Gemini models:", error);
      throw error;
    }
  },

  // ============================================================================
  // Gemini Session History
  // ============================================================================

  /**
   * Gets session logs for a project (from logs.json)
   * @param projectPath - Project path to get session logs for
   * @returns Promise resolving to array of session logs
   */
  async getGeminiSessionLogs(projectPath: string): Promise<import('@/types/gemini').GeminiSessionLog[]> {
    try {
      return await invoke("get_gemini_session_logs", { projectPath });
    } catch (error) {
      console.error("Failed to get Gemini session logs:", error);
      throw error;
    }
  },

  /**
   * Lists all sessions for a project (from chats/ directory)
   * @param projectPath - Project path to list sessions for
   * @returns Promise resolving to array of session info
   */
  async listGeminiSessions(projectPath: string): Promise<import('@/types/gemini').GeminiSessionInfo[]> {
    try {
      return await listGeminiSessionsCached(projectPath);
    } catch (error) {
      console.error("Failed to list Gemini sessions:", error);
      throw error;
    }
  },

  /**
   * Gets detailed session information
   * @param projectPath - Project path
   * @param sessionId - Session ID to get details for
   * @returns Promise resolving to complete session detail
   */
  async getGeminiSessionDetail(
    projectPath: string,
    sessionId: string
  ): Promise<import('@/types/gemini').GeminiSessionDetail> {
    try {
      return await invoke("get_gemini_session_detail", { projectPath, sessionId });
    } catch (error) {
      console.error("Failed to get Gemini session detail:", error);
      throw error;
    }
  },

  /**
   * Delete a Gemini session
   * @param projectPath - Project path
   * @param sessionId - Session ID to delete
   */
  async deleteGeminiSession(projectPath: string, sessionId: string): Promise<void> {
    try {
      await invoke("delete_gemini_session", { projectPath, sessionId });
      deleteGeminiSessionsCache(projectPath);
    } catch (error) {
      console.error("Failed to delete Gemini session:", error);
      throw error;
    }
  },
};
