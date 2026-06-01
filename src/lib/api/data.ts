import { invoke } from "@tauri-apps/api/core";
import type { HooksConfiguration } from '@/types/hooks';
import { HooksManager } from '@/lib/hooksManager';
import type {
  ProviderConfig,
  CurrentProviderConfig,
  ApiKeyUsage,
  SavedImageResult,
  TranslationConfig,
  TranslationCacheStats
} from '@/lib/api/types';

export const dataApi = {
  // Storage API methods

  /**
   * Lists all tables in the SQLite database
   * @returns Promise resolving to an array of table information
   */
  async storageListTables(): Promise<LegacyAny[]> {
    try {
      return await invoke<LegacyAny[]>("storage_list_tables");
    } catch (error) {
      console.error("Failed to list tables:", error);
      throw error;
    }
  },

  /**
   * Reads table data with pagination
   * @param tableName - Name of the table to read
   * @param page - Page number (1-indexed)
   * @param pageSize - Number of rows per page
   * @param searchQuery - Optional search query
   * @returns Promise resolving to table data with pagination info
   */
  async storageReadTable(
    tableName: string,
    page: number,
    pageSize: number,
    searchQuery?: string
  ): Promise<LegacyAny> {
    try {
      return await invoke<LegacyAny>("storage_read_table", {
        tableName,
        page,
        pageSize,
        searchQuery,
      });
    } catch (error) {
      console.error("Failed to read table:", error);
      throw error;
    }
  },

  /**
   * Updates a row in a table
   * @param tableName - Name of the table
   * @param primaryKeyValues - Map of primary key column names to values
   * @param updates - Map of column names to new values
   * @returns Promise resolving when the row is updated
   */
  async storageUpdateRow(
    tableName: string,
    primaryKeyValues: Record<string, LegacyAny>,
    updates: Record<string, LegacyAny>
  ): Promise<void> {
    try {
      return await invoke<void>("storage_update_row", {
        tableName,
        primaryKeyValues,
        updates,
      });
    } catch (error) {
      console.error("Failed to update row:", error);
      throw error;
    }
  },

  /**
   * Deletes a row from a table
   * @param tableName - Name of the table
   * @param primaryKeyValues - Map of primary key column names to values
   * @returns Promise resolving when the row is deleted
   */
  async storageDeleteRow(
    tableName: string,
    primaryKeyValues: Record<string, LegacyAny>
  ): Promise<void> {
    try {
      return await invoke<void>("storage_delete_row", {
        tableName,
        primaryKeyValues,
      });
    } catch (error) {
      console.error("Failed to delete row:", error);
      throw error;
    }
  },

  /**
   * Inserts a new row into a table
   * @param tableName - Name of the table
   * @param values - Map of column names to values
   * @returns Promise resolving to the last insert row ID
   */
  async storageInsertRow(
    tableName: string,
    values: Record<string, LegacyAny>
  ): Promise<number> {
    try {
      return await invoke<number>("storage_insert_row", {
        tableName,
        values,
      });
    } catch (error) {
      console.error("Failed to insert row:", error);
      throw error;
    }
  },

  /**
   * Executes a raw SQL query
   * @param query - SQL query string
   * @returns Promise resolving to query result
   */
  async storageExecuteSql(query: string): Promise<LegacyAny> {
    try {
      return await invoke<LegacyAny>("storage_execute_sql", { query });
    } catch (error) {
      console.error("Failed to execute SQL:", error);
      throw error;
    }
  },

  /**
   * Resets the entire database
   * @returns Promise resolving when the database is reset
   */
  async storageResetDatabase(): Promise<void> {
    try {
      return await invoke<void>("storage_reset_database");
    } catch (error) {
      console.error("Failed to reset database:", error);
      throw error;
    }
  },

  /**
   * Get hooks configuration for a specific scope
   * @param scope - The configuration scope: 'user', 'project', or 'local'
   * @param projectPath - Project path (required for project and local scopes)
   * @returns Promise resolving to the hooks configuration
   */
  async getHooksConfig(scope: 'user' | 'project' | 'local', projectPath?: string): Promise<HooksConfiguration> {
    try {
      return await invoke<HooksConfiguration>("get_hooks_config", { scope, projectPath });
    } catch (error) {
      console.error("Failed to get hooks config:", error);
      throw error;
    }
  },

  /**
   * Update hooks configuration for a specific scope
   * @param scope - The configuration scope: 'user', 'project', or 'local'
   * @param hooks - The hooks configuration to save
   * @param projectPath - Project path (required for project and local scopes)
   * @returns Promise resolving to success message
   */
  async updateHooksConfig(
    scope: 'user' | 'project' | 'local',
    hooks: HooksConfiguration,
    projectPath?: string
  ): Promise<string> {
    try {
      return await invoke<string>("update_hooks_config", { scope, projectPath, hooks });
    } catch (error) {
      console.error("Failed to update hooks config:", error);
      throw error;
    }
  },

  /**
   * Validate a hook command syntax
   * @param command - The shell command to validate
   * @returns Promise resolving to validation result
   */
  async validateHookCommand(command: string): Promise<{ valid: boolean; message: string }> {
    try {
      return await invoke<{ valid: boolean; message: string }>("validate_hook_command", { command });
    } catch (error) {
      console.error("Failed to validate hook command:", error);
      throw error;
    }
  },

  /**
   * Get merged hooks configuration (respecting priority)
   * @param projectPath - The project path
   * @returns Promise resolving to merged hooks configuration
   */
  async getMergedHooksConfig(projectPath: string): Promise<HooksConfiguration> {
    try {
      const [userHooks, projectHooks, localHooks] = await Promise.all([
        this.getHooksConfig('user'),
        this.getHooksConfig('project', projectPath),
        this.getHooksConfig('local', projectPath)
      ]);

      return HooksManager.mergeConfigs(userHooks, projectHooks, localHooks);
    } catch (error) {
      console.error("Failed to get merged hooks config:", error);
      throw error;
    }
  },


  /**
   * Set custom Claude CLI path
   * @param customPath - Path to custom Claude CLI executable
   * @returns Promise resolving when path is set successfully
   */
  async setCustomClaudePath(customPath: string): Promise<void> {
    try {
      return await invoke<void>("set_custom_claude_path", { customPath });
    } catch (error) {
      console.error("Failed to set custom Claude path:", error);
      throw error;
    }
  },

  /**
   * Get current Claude CLI path (custom or auto-detected)
   * @returns Promise resolving to current Claude CLI path
   */
  async getClaudePath(): Promise<string> {
    try {
      return await invoke<string>("get_claude_path");
    } catch (error) {
      console.error("Failed to get Claude path:", error);
      throw error;
    }
  },

  /**
   * Clear custom Claude CLI path and revert to auto-detection
   * @returns Promise resolving when custom path is cleared
   */
  async clearCustomClaudePath(): Promise<void> {
    try {
      return await invoke<void>("clear_custom_claude_path");
    } catch (error) {
      console.error("Failed to clear custom Claude path:", error);
      throw error;
    }
  },



  // Clipboard API methods

  /**
   * Saves clipboard image data to a temporary file
   * @param base64Data - Base64 encoded image data
   * @param format - Optional image format
   * @returns Promise resolving to saved image result
   */
  async saveClipboardImage(base64Data: string, format?: string): Promise<SavedImageResult> {
    try {
      return await invoke<SavedImageResult>("save_clipboard_image", { base64Data, format });
    } catch (error) {
      console.error("Failed to save clipboard image:", error);
      throw error;
    }
  },

  // Provider Management API methods

  /**
   * Gets the list of preset provider configurations
   * @returns Promise resolving to array of provider configurations
   */
  async getProviderPresets(): Promise<ProviderConfig[]> {
    try {
      return await invoke<ProviderConfig[]>("get_provider_presets");
    } catch (error) {
      console.error("Failed to get provider presets:", error);
      throw error;
    }
  },

  /**
   * Gets the current provider configuration from environment variables
   * @returns Promise resolving to current configuration
   */
  async getCurrentProviderConfig(): Promise<CurrentProviderConfig> {
    try {
      return await invoke<CurrentProviderConfig>("get_current_provider_config");
    } catch (error) {
      console.error("Failed to get current provider config:", error);
      throw error;
    }
  },

  /**
   * Switches to a new provider configuration
   * @param config - The provider configuration to switch to
   * @returns Promise resolving to success message
   */
  async switchProviderConfig(config: ProviderConfig): Promise<string> {
    try {
      return await invoke<string>("switch_provider_config", { config });
    } catch (error) {
      console.error("Failed to switch provider config:", error);
      throw error;
    }
  },

  /**
   * Clears all provider-related environment variables
   * @returns Promise resolving to success message
   */
  async clearProviderConfig(): Promise<string> {
    try {
      return await invoke<string>("clear_provider_config");
    } catch (error) {
      console.error("Failed to clear provider config:", error);
      throw error;
    }
  },

  /**
   * Tests connection to a provider endpoint
   * @param baseUrl - The base URL to test
   * @returns Promise resolving to test result message
   */
  async testProviderConnection(baseUrl: string): Promise<string> {
    try {
      return await invoke<string>("test_provider_connection", { baseUrl });
    } catch (error) {
      console.error("Failed to test provider connection:", error);
      throw error;
    }
  },

  /**
   * Adds a new provider configuration
   * @param config - The provider configuration to add
   * @returns Promise resolving to success message
   */
  async addProviderConfig(config: Omit<ProviderConfig, 'id'>): Promise<string> {
    // Generate ID from name
    const id = config.name
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');

    const fullConfig: ProviderConfig = {
      ...config,
      id
    };

    try {
      return await invoke<string>("add_provider_config", { config: fullConfig });
    } catch (error) {
      console.error("Failed to add provider config:", error);
      throw error;
    }
  },

  /**
   * Updates an existing provider configuration
   * @param config - The provider configuration to update (with id)
   * @returns Promise resolving to success message
   */
  async updateProviderConfig(config: ProviderConfig): Promise<string> {
    try {
      return await invoke<string>("update_provider_config", { config });
    } catch (error) {
      console.error("Failed to update provider config:", error);
      throw error;
    }
  },

  /**
   * Deletes a provider configuration by ID
   * @param id - The ID of the provider configuration to delete
   * @returns Promise resolving to success message
   */
  async deleteProviderConfig(id: string): Promise<string> {
    try {
      return await invoke<string>("delete_provider_config", { id });
    } catch (error) {
      console.error("Failed to delete provider config:", error);
      throw error;
    }
  },

  /**
   * Gets a single provider configuration by ID
   * @param id - The ID of the provider configuration to get
   * @returns Promise resolving to provider configuration
   */
  async getProviderConfig(id: string): Promise<ProviderConfig> {
    try {
      return await invoke<ProviderConfig>("get_provider_config", { id });
    } catch (error) {
      console.error("Failed to get provider config:", error);
      throw error;
    }
  },

  /**
   * Queries API Key usage/balance from the provider
   * @param baseUrl - The base URL of the provider API
   * @param apiKey - The API key to query usage for
   * @returns Promise resolving to API key usage information
   */
  async queryProviderUsage(baseUrl: string, apiKey: string): Promise<ApiKeyUsage> {
    try {
      return await invoke<ApiKeyUsage>("query_provider_usage", { baseUrl, apiKey });
    } catch (error) {
      console.error("Failed to query provider usage:", error);
      throw error;
    }
  },

  /**
   * Reorders provider configurations
   * @param ids - Array of provider IDs in the desired order
   * @returns Promise resolving to success message
   */
  async reorderProviderConfigs(ids: string[]): Promise<string> {
    try {
      return await invoke<string>("reorder_provider_configs", { ids });
    } catch (error) {
      console.error("Failed to reorder provider configs:", error);
      throw error;
    }
  },


  // ============================================================================
  // ACEMCP INTEGRATION
  // ============================================================================

  /**
   * Enhances a prompt by adding project context from acemcp semantic search
   * 🆕 v2: 支持历史上下文感知和多轮搜索
   *
   * @param prompt - The original prompt to enhance
   * @param projectPath - Path to the project directory
   * @param sessionId - 🆕 Optional session ID for history-aware search
   * @param projectId - 🆕 Optional project ID for history-aware search
   * @param maxContextLength - Maximum length of context to include (default: 3000)
   * @param enableMultiRound - 🆕 Enable multi-round search for better coverage (default: true)
   * @returns Promise resolving to enhancement result
   */
  async enhancePromptWithContext(
    prompt: string,
    projectPath: string,
    sessionId?: string,
    projectId?: string,
    maxContextLength?: number,
    enableMultiRound?: boolean
  ): Promise<{
    originalPrompt: string;
    enhancedPrompt: string;
    contextCount: number;
    acemcpUsed: boolean;
    error?: string;
  }> {
    try {
      return await invoke("enhance_prompt_with_context", {
        prompt,
        projectPath,
        sessionId,
        projectId,
        maxContextLength,
        enableMultiRound,
      });
    } catch (error) {
      console.error("Failed to enhance prompt with context:", error);
      throw error;
    }
  },

  /**
   * Tests if acemcp is available and can be used
   * @returns Promise resolving to true if acemcp is available
   */
  async testAcemcpAvailability(): Promise<boolean> {
    try {
      return await invoke<boolean>("test_acemcp_availability");
    } catch (error) {
      console.error("Failed to test acemcp availability:", error);
      return false;
    }
  },

  /**
   * Saves acemcp configuration to ~/.acemcp/settings.toml
   */
  async saveAcemcpConfig(
    baseUrl: string,
    token: string,
    batchSize?: number,
    maxLinesPerBlob?: number
  ): Promise<void> {
    try {
      return await invoke("save_acemcp_config", {
        baseUrl,
        token,
        batchSize,
        maxLinesPerBlob,
      });
    } catch (error) {
      console.error("Failed to save acemcp config:", error);
      throw error;
    }
  },

  /**
   * Loads acemcp configuration from ~/.acemcp/settings.toml
   */
  async loadAcemcpConfig(): Promise<{
    baseUrl: string;
    token: string;
    batchSize?: number;
    maxLinesPerBlob?: number;
  }> {
    try {
      return await invoke("load_acemcp_config");
    } catch (error) {
      console.error("Failed to load acemcp config:", error);
      // 返回默认配置
      return {
        baseUrl: '',
        token: '',
        batchSize: 10,
        maxLinesPerBlob: 800,
      };
    }
  },

  /**
   * Pre-indexes a project in background (non-blocking)
   * Automatically triggered when user selects a project
   */
  async preindexProject(projectPath: string): Promise<void> {
    try {
      // 后台执行，不等待结果
      invoke("preindex_project", { projectPath }).catch((error) => {
        console.warn("Background pre-indexing failed:", error);
      });
    } catch (error) {
      console.warn("Failed to start pre-indexing:", error);
    }
  },

  /**
   * Exports the embedded acemcp sidecar to a specified path
   * For CLI configuration
   */
  async exportAcemcpSidecar(targetPath: string): Promise<string> {
    try {
      return await invoke<string>("export_acemcp_sidecar", { targetPath });
    } catch (error) {
      console.error("Failed to export sidecar:", error);
      throw error;
    }
  },

  /**
   * Gets the path of extracted sidecar in temp directory (if exists)
   */
  async getExtractedSidecarPath(): Promise<string | null> {
    try {
      return await invoke<string | null>("get_extracted_sidecar_path");
    } catch (error) {
      console.error("Failed to get extracted sidecar path:", error);
      return null;
    }
  },

  // Translation API methods

  /**
   * Translates text using the translation service
   * @param text - The text to translate
   * @param targetLang - Optional target language (defaults to auto-detection)
   * @returns Promise resolving to translated text
   */
  async translateText(text: string, targetLang?: string): Promise<string> {
    try {
      return await invoke<string>("translate", { text, targetLang });
    } catch (error) {
      console.error("Failed to translate text:", error);
      throw error;
    }
  },

  /**
   * Translates multiple texts in batch
   * @param texts - Array of texts to translate
   * @param targetLang - Optional target language
   * @returns Promise resolving to array of translated texts
   */
  async translateBatch(texts: string[], targetLang?: string): Promise<string[]> {
    try {
      return await invoke<string[]>("translate_batch", { texts, targetLang });
    } catch (error) {
      console.error("Failed to batch translate texts:", error);
      throw error;
    }
  },

  /**
   * Gets the current translation configuration
   * @returns Promise resolving to translation configuration
   */
  async getTranslationConfig(): Promise<TranslationConfig> {
    try {
      return await invoke<TranslationConfig>("get_translation_config");
    } catch (error) {
      console.error("Failed to get translation config:", error);
      throw error;
    }
  },

  /**
   * Updates the translation configuration
   * @param config - New translation configuration
   * @returns Promise resolving to success message
   */
  async updateTranslationConfig(config: TranslationConfig): Promise<string> {
    try {
      return await invoke<string>("update_translation_config", { config });
    } catch (error) {
      console.error("Failed to update translation config:", error);
      throw error;
    }
  },

  /**
   * Clears the translation cache
   * @returns Promise resolving to success message
   */
  async clearTranslationCache(): Promise<string> {
    try {
      return await invoke<string>("clear_translation_cache");
    } catch (error) {
      console.error("Failed to clear translation cache:", error);
      throw error;
    }
  },

  /**
   * Gets translation cache statistics
   * @returns Promise resolving to cache statistics
   */
  async getTranslationCacheStats(): Promise<TranslationCacheStats> {
    try {
      return await invoke<TranslationCacheStats>("get_translation_cache_stats");
    } catch (error) {
      console.error("Failed to get translation cache stats:", error);
      throw error;
    }
  },

  /**
   * Detects the language of the given text
   * @param text - The text to analyze
   * @returns Promise resolving to detected language code
   */
  async detectTextLanguage(text: string): Promise<string> {
    try {
      return await invoke<string>("detect_text_language", { text });
    } catch (error) {
      console.error("Failed to detect text language:", error);
      throw error;
    }
  },

  /**
   * Initializes the translation service
   * @param config - Optional translation configuration
   * @returns Promise resolving to success message
   */
  async initTranslationService(config?: TranslationConfig): Promise<string> {
    try {
      return await invoke<string>("init_translation_service_command", { config });
    } catch (error) {
      console.error("Failed to initialize translation service:", error);
      throw error;
    }
  },
};
