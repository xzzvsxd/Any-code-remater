import { invoke } from "@tauri-apps/api/core";
import type {
  AutoCompactConfig,
  SessionContext,
  AutoCompactStatus
} from '@/lib/api/types';

export const automationApi = {
  // Auto-Compact Context Management API methods

  /**
   * Initializes the auto-compact manager
   * @returns Promise resolving when manager is initialized
   */
  async initAutoCompactManager(): Promise<void> {
    try {
      return await invoke<void>("init_auto_compact_manager");
    } catch (error) {
      console.error("Failed to initialize auto-compact manager:", error);
      throw error;
    }
  },

  /**
   * Registers a Claude session for auto-compact monitoring
   * @param sessionId - The session ID to register
   * @param projectPath - The project path
   * @param model - The model being used
   * @returns Promise resolving when session is registered
   */
  async registerAutoCompactSession(sessionId: string, projectPath: string, model: string): Promise<void> {
    try {
      return await invoke<void>("register_auto_compact_session", { sessionId, projectPath, model });
    } catch (error) {
      console.error("Failed to register auto-compact session:", error);
      throw error;
    }
  },

  /**
   * Updates session token count and checks for auto-compact trigger
   * @param sessionId - The session ID
   * @param tokenCount - Current token count
   * @returns Promise resolving to whether compaction was triggered
   */
  async updateSessionContext(sessionId: string, tokenCount: number): Promise<boolean> {
    try {
      return await invoke<boolean>("update_session_context", { sessionId, tokenCount });
    } catch (error) {
      console.error("Failed to update session context:", error);
      throw error;
    }
  },

  /**
   * Manually triggers compaction for a session
   * @param sessionId - The session ID
   * @param customInstructions - Optional custom compaction instructions
   * @returns Promise resolving when compaction is complete
   */
  async triggerManualCompaction(sessionId: string, customInstructions?: string): Promise<void> {
    try {
      return await invoke<void>("trigger_manual_compaction", { sessionId, customInstructions });
    } catch (error) {
      console.error("Failed to trigger manual compaction:", error);
      throw error;
    }
  },

  /**
   * Gets the current auto-compact configuration
   * @returns Promise resolving to the configuration
   */
  async getAutoCompactConfig(): Promise<AutoCompactConfig> {
    try {
      return await invoke<AutoCompactConfig>("get_auto_compact_config");
    } catch (error) {
      console.error("Failed to get auto-compact config:", error);
      throw error;
    }
  },

  /**
   * Updates the auto-compact configuration
   * @param config - The new configuration
   * @returns Promise resolving when configuration is updated
   */
  async updateAutoCompactConfig(config: AutoCompactConfig): Promise<void> {
    try {
      return await invoke<void>("update_auto_compact_config", { config });
    } catch (error) {
      console.error("Failed to update auto-compact config:", error);
      throw error;
    }
  },

  /**
   * Gets session context statistics
   * @param sessionId - The session ID
   * @returns Promise resolving to session context information
   */
  async getSessionContextStats(sessionId: string): Promise<SessionContext | null> {
    try {
      return await invoke<SessionContext | null>("get_session_context_stats", { sessionId });
    } catch (error) {
      console.error("Failed to get session context stats:", error);
      throw error;
    }
  },

  /**
   * Gets all monitored sessions
   * @returns Promise resolving to array of session contexts
   */
  async getAllMonitoredSessions(): Promise<SessionContext[]> {
    try {
      return await invoke<SessionContext[]>("get_all_monitored_sessions");
    } catch (error) {
      console.error("Failed to get monitored sessions:", error);
      throw error;
    }
  },

  /**
   * Unregisters session from auto-compact monitoring
   * @param sessionId - The session ID to unregister
   * @returns Promise resolving when session is unregistered
   */
  async unregisterAutoCompactSession(sessionId: string): Promise<void> {
    try {
      return await invoke<void>("unregister_auto_compact_session", { sessionId });
    } catch (error) {
      console.error("Failed to unregister auto-compact session:", error);
      throw error;
    }
  },

  /**
   * Stops auto-compact monitoring
   * @returns Promise resolving when monitoring is stopped
   */
  async stopAutoCompactMonitoring(): Promise<void> {
    try {
      return await invoke<void>("stop_auto_compact_monitoring");
    } catch (error) {
      console.error("Failed to stop auto-compact monitoring:", error);
      throw error;
    }
  },

  /**
   * Starts auto-compact monitoring
   * @returns Promise resolving when monitoring is started
   */
  async startAutoCompactMonitoring(): Promise<void> {
    try {
      return await invoke<void>("start_auto_compact_monitoring");
    } catch (error) {
      console.error("Failed to start auto-compact monitoring:", error);
      throw error;
    }
  },

  /**
   * Gets auto-compact status and statistics
   * @returns Promise resolving to status information
   */
  async getAutoCompactStatus(): Promise<AutoCompactStatus> {
    try {
      return await invoke<AutoCompactStatus>("get_auto_compact_status");
    } catch (error) {
      console.error("Failed to get auto-compact status:", error);
      throw error;
    }
  },

  /**
   * Gets active sessions information
   * @returns Promise resolving to array of active session info
   */
  async getActiveSessions(): Promise<LegacyAny[]> {
    try {
      return await invoke("get_active_sessions");
    } catch (error) {
      console.error('Failed to get active sessions:', error);
      throw error;
    }
  },

  // Subagent Management & Specialization API methods








  // Enhanced Hooks Automation API methods

  /**
   * Triggers a hook event with context
   * @param event - The hook event name
   * @param context - The hook execution context
   * @returns Promise resolving to hook chain execution result
   */
  async triggerHookEvent(event: string, context: LegacyAny): Promise<LegacyAny> {
    try {
      return await invoke<LegacyAny>("trigger_hook_event", { event, context });
    } catch (error) {
      console.error("Failed to trigger hook event:", error);
      throw error;
    }
  },

  /**
   * Tests a hook condition expression
   * @param condition - The condition expression to test
   * @param context - The hook context for evaluation
   * @returns Promise resolving to whether condition is true
   */
  async testHookCondition(condition: string, context: LegacyAny): Promise<boolean> {
    try {
      return await invoke<boolean>("test_hook_condition", { condition, context });
    } catch (error) {
      console.error("Failed to test hook condition:", error);
      throw error;
    }
  },

  /**
   * Executes pre-commit code review hook with intelligent decision making
   * @param projectPath - The project path to review
   * @param config - Optional configuration for the review hook
   * @returns Promise resolving to commit decision
   */
  async executePreCommitReview(
    projectPath: string,
    config?: import('@/types/enhanced-hooks').PreCommitCodeReviewConfig
  ): Promise<import('@/types/enhanced-hooks').CommitDecision> {
    try {
      return await invoke<import('@/types/enhanced-hooks').CommitDecision>("execute_pre_commit_review", {
        projectPath,
        config
      });
    } catch (error) {
      console.error("Failed to execute pre-commit review:", error);
      throw error;
    }
  },
};
