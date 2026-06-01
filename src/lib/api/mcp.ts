import { invoke } from "@tauri-apps/api/core";
import type {
  MCPServerSpec,
  McpApps,
  McpServer,
  McpStatus,
  McpServerWithStatus,
  MCPServer,
  ServerStatus,
  MCPProjectConfig,
  AddServerResult,
  ImportResult
} from '@/lib/api/types';

export const mcpApi = {
  // ============================================================================
  // MCP SERVER OPERATIONS
  // ============================================================================

  /**
   * Adds a new MCP server
   */
  async mcpAdd(
    name: string,
    transport: string,
    command?: string,
    args: string[] = [],
    env: Record<string, string> = {},
    url?: string,
    scope: string = "local"
  ): Promise<AddServerResult> {
    try {
      return await invoke<AddServerResult>("mcp_add", {
        name,
        transport,
        command,
        args,
        env,
        url,
        scope
      });
    } catch (error) {
      console.error("Failed to add MCP server:", error);
      throw error;
    }
  },

  /**
   * Lists all configured MCP servers
   */
  async mcpList(): Promise<MCPServer[]> {
    try {
      return await invoke<MCPServer[]>("mcp_list");
    } catch (error) {
      console.error("API: Failed to list MCP servers:", error);
      throw error;
    }
  },

  /**
   * Gets details for a specific MCP server
   */
  async mcpGet(name: string): Promise<MCPServer> {
    try {
      return await invoke<MCPServer>("mcp_get", { name });
    } catch (error) {
      console.error("Failed to get MCP server:", error);
      throw error;
    }
  },

  /**
   * Removes an MCP server
   */
  async mcpRemove(name: string): Promise<string> {
    try {
      return await invoke<string>("mcp_remove", { name });
    } catch (error) {
      console.error("Failed to remove MCP server:", error);
      throw error;
    }
  },

  /**
   * Adds an MCP server from JSON configuration
   */
  async mcpAddJson(name: string, jsonConfig: string, scope: string = "local"): Promise<AddServerResult> {
    try {
      return await invoke<AddServerResult>("mcp_add_json", { name, jsonConfig, scope });
    } catch (error) {
      console.error("Failed to add MCP server from JSON:", error);
      throw error;
    }
  },

  /**
   * Imports MCP servers from Claude Desktop
   */
  async mcpAddFromClaudeDesktop(scope: string = "local"): Promise<ImportResult> {
    try {
      return await invoke<ImportResult>("mcp_add_from_claude_desktop", { scope });
    } catch (error) {
      console.error("Failed to import from Claude Desktop:", error);
      throw error;
    }
  },

  /**
   * Starts Claude Code as an MCP server
   */
  async mcpServe(): Promise<string> {
    try {
      return await invoke<string>("mcp_serve");
    } catch (error) {
      console.error("Failed to start MCP server:", error);
      throw error;
    }
  },

  /**
   * Tests connection to an MCP server
   */
  async mcpTestConnection(name: string): Promise<string> {
    try {
      return await invoke<string>("mcp_test_connection", { name });
    } catch (error) {
      console.error("Failed to test MCP connection:", error);
      throw error;
    }
  },

  /**
   * Exports MCP server configuration from .claude.json
   */
  async mcpExportConfig(): Promise<string> {
    try {
      return await invoke<string>("mcp_export_config");
    } catch (error) {
      console.error("Failed to export MCP configuration:", error);
      throw error;
    }
  },

  /**
   * Resets project-scoped server approval choices
   */
  async mcpResetProjectChoices(): Promise<string> {
    try {
      return await invoke<string>("mcp_reset_project_choices");
    } catch (error) {
      console.error("Failed to reset project choices:", error);
      throw error;
    }
  },

  /**
   * Gets the status of MCP servers
   */
  async mcpGetServerStatus(): Promise<Record<string, ServerStatus>> {
    try {
      return await invoke<Record<string, ServerStatus>>("mcp_get_server_status");
    } catch (error) {
      console.error("Failed to get server status:", error);
      throw error;
    }
  },

  /**
   * Reads .mcp.json from the current project
   */
  async mcpReadProjectConfig(projectPath: string): Promise<MCPProjectConfig> {
    try {
      return await invoke<MCPProjectConfig>("mcp_read_project_config", { projectPath });
    } catch (error) {
      console.error("Failed to read project MCP config:", error);
      throw error;
    }
  },

  /**
   * Saves .mcp.json to the current project
   */
  async mcpSaveProjectConfig(projectPath: string, config: MCPProjectConfig): Promise<string> {
    try {
      return await invoke<string>("mcp_save_project_config", { projectPath, config });
    } catch (error) {
      console.error("Failed to save project MCP config:", error);
      throw error;
    }
  },

  // ============================================================================
  // MCP 多应用支持方法（新版）
  // ============================================================================

  /**
   * 获取 Claude MCP 配置状态
   */
  async mcpGetStatus(): Promise<McpStatus> {
    try {
      return await invoke<McpStatus>("mcp_get_claude_status");
    } catch (error) {
      console.error("Failed to get MCP status:", error);
      throw error;
    }
  },

  /**
   * 获取所有 MCP 服务器（从 Claude 配置）
   * @deprecated 使用 mcpGetUnifiedServers 获取真实的多应用状态
   */
  async mcpGetAllServers(): Promise<Record<string, MCPServerSpec>> {
    try {
      return await invoke<Record<string, MCPServerSpec>>("mcp_get_all_servers");
    } catch (error) {
      console.error("Failed to get all MCP servers:", error);
      throw error;
    }
  },

  /**
   * 获取所有应用的 MCP 服务器统一视图（推荐）
   *
   * 返回合并后的服务器列表，每个服务器的 apps 字段显示真实的启用状态
   * @deprecated 使用 mcpGetEngineServers 代替，按引擎独立管理
   */
  async mcpGetUnifiedServers(): Promise<Record<string, McpServer>> {
    try {
      return await invoke<Record<string, McpServer>>("mcp_get_unified_servers");
    } catch (error) {
      console.error("Failed to get unified MCP servers:", error);
      throw error;
    }
  },

  // ============================================================================
  // 多引擎独立隔离控制 API（新设计）
  // ============================================================================

  /**
   * 获取指定引擎的 MCP 服务器列表
   *
   * @param engine 引擎名称（"claude" | "codex" | "gemini"）
   * @returns 该引擎的 MCP 服务器映射
   */
  async mcpGetEngineServers(
    engine: "claude" | "codex" | "gemini"
  ): Promise<Record<string, MCPServerSpec>> {
    try {
      return await invoke<Record<string, MCPServerSpec>>("mcp_get_engine_servers", {
        engine,
      });
    } catch (error) {
      console.error(`Failed to get ${engine} MCP servers:`, error);
      throw error;
    }
  },

  /**
   * 在指定引擎中添加或更新 MCP 服务器
   *
   * @param engine 引擎名称（"claude" | "codex" | "gemini"）
   * @param id 服务器 ID
   * @param serverSpec 服务器规范
   */
  async mcpUpsertEngineServer(
    engine: "claude" | "codex" | "gemini",
    id: string,
    serverSpec: MCPServerSpec
  ): Promise<string> {
    try {
      return await invoke<string>("mcp_upsert_engine_server", {
        engine,
        id,
        serverSpec,
      });
    } catch (error) {
      console.error(`Failed to upsert ${engine} MCP server:`, error);
      throw error;
    }
  },

  /**
   * 从指定引擎中删除 MCP 服务器
   *
   * @param engine 引擎名称（"claude" | "codex" | "gemini"）
   * @param id 服务器 ID
   */
  async mcpDeleteEngineServer(
    engine: "claude" | "codex" | "gemini",
    id: string
  ): Promise<string> {
    try {
      return await invoke<string>("mcp_delete_engine_server", {
        engine,
        id,
      });
    } catch (error) {
      console.error(`Failed to delete ${engine} MCP server:`, error);
      throw error;
    }
  },

  /**
   * 切换指定引擎中 MCP 服务器的启用状态
   *
   * @param engine 引擎名称（"claude" | "codex" | "gemini"）
   * @param id 服务器 ID
   * @param serverSpec 服务器规范
   * @param enabled 启用状态
   */
  async mcpToggleEngineServer(
    engine: "claude" | "codex" | "gemini",
    id: string,
    serverSpec: MCPServerSpec,
    enabled: boolean
  ): Promise<string> {
    try {
      return await invoke<string>("mcp_toggle_engine_server", {
        engine,
        id,
        serverSpec,
        enabled,
      });
    } catch (error) {
      console.error(`Failed to toggle ${engine} MCP server:`, error);
      throw error;
    }
  },

  /**
   * 带启用状态的 MCP 服务器条目
   */
  // McpServerWithStatus 类型定义在下方

  /**
   * 获取指定引擎的 MCP 服务器列表（包含禁用的服务器）
   *
   * @param engine 引擎名称（"claude" | "codex" | "gemini"）
   * @returns 该引擎的 MCP 服务器列表（包含启用状态）
   */
  async mcpGetEngineServersWithStatus(
    engine: "claude" | "codex" | "gemini"
  ): Promise<McpServerWithStatus[]> {
    try {
      return await invoke<McpServerWithStatus[]>("mcp_get_engine_servers_with_status", {
        engine,
      });
    } catch (error) {
      console.error(`Failed to get ${engine} MCP servers with status:`, error);
      throw error;
    }
  },

  /**
   * 添加或更新 MCP 服务器（支持多应用）
   */
  async mcpUpsertServer(
    id: string,
    name: string,
    serverSpec: MCPServerSpec,
    apps: McpApps
  ): Promise<string> {
    try {
      return await invoke<string>("mcp_upsert_server", {
        id,
        name,
        serverSpec,
        apps,
      });
    } catch (error) {
      console.error("Failed to upsert MCP server:", error);
      throw error;
    }
  },

  /**
   * 删除 MCP 服务器（从所有应用）
   */
  async mcpDeleteServer(id: string, apps: McpApps): Promise<string> {
    try {
      return await invoke<string>("mcp_delete_server", { id, apps });
    } catch (error) {
      console.error("Failed to delete MCP server:", error);
      throw error;
    }
  },

  /**
   * 切换 MCP 服务器在指定应用的启用状态
   */
  async mcpToggleApp(
    id: string,
    serverSpec: MCPServerSpec,
    app: string,
    enabled: boolean
  ): Promise<string> {
    try {
      return await invoke<string>("mcp_toggle_app", {
        id,
        serverSpec,
        app,
        enabled,
      });
    } catch (error) {
      console.error("Failed to toggle MCP app:", error);
      throw error;
    }
  },

  /**
   * 从指定应用导入 MCP 服务器
   */
  async mcpImportFromApp(app: string): Promise<string[]> {
    try {
      return await invoke<string[]>("mcp_import_from_app", { app });
    } catch (error) {
      console.error("Failed to import from app:", error);
      throw error;
    }
  },

  /**
   * 验证命令是否在 PATH 中可用
   */
  async mcpValidateCommand(cmd: string): Promise<boolean> {
    try {
      return await invoke<boolean>("mcp_validate_command", { cmd });
    } catch (error) {
      console.error("Failed to validate command:", error);
      throw error;
    }
  },

  /**
   * 读取 Claude MCP 配置文本内容
   */
  async mcpReadClaudeConfig(): Promise<string | null> {
    try {
      return await invoke<string | null>("mcp_read_claude_config");
    } catch (error) {
      console.error("Failed to read Claude MCP config:", error);
      throw error;
    }
  },

  /**
   * Get the stored Claude binary path from settings
   * @returns Promise resolving to the path if set, null otherwise
   */
  async getClaudeBinaryPath(): Promise<string | null> {
    try {
      return await invoke<string | null>("get_claude_binary_path");
    } catch (error) {
      console.error("Failed to get Claude binary path:", error);
      throw error;
    }
  },

  /**
   * Set the Claude binary path in settings
   * @param path - The absolute path to the Claude binary
   * @returns Promise resolving when the path is saved
   */
  async setClaudeBinaryPath(path: string): Promise<void> {
    try {
      return await invoke<void>("set_claude_binary_path", { path });
    } catch (error) {
      console.error("Failed to set Claude binary path:", error);
      throw error;
    }
  },
};
