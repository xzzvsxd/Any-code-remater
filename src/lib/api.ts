export type {
  ProcessType,
  ProcessInfo,
  Project,
  Session,
  SessionHistoryPage,
  ConversionSource,
  ConversionResult,
  ClaudeSettings,
  ClaudePermissionConfig,
  ClaudeExecutionConfig,
  ClaudeVersionStatus,
  ClaudeMdFile,
  FileEntry,
  RewindMode,
  RewindCapabilities,
  ResetSafetyInfo,
  PromptRecord,
  PromptRecordWithCapabilities,
  UsageEntry,
  ModelUsage,
  DailyUsage,
  ProjectUsage,
  ApiBaseUrlUsage,
  UsageStats,
  UsageDashboardStats,
  UsageOverview,
  SessionCacheTokens,
  ProviderConfig,
  CurrentProviderConfig,
  ApiKeyUsage,
  CodexProviderConfig,
  CurrentCodexConfig,
  GeminiProviderConfig,
  CurrentGeminiProviderConfig,
  MCPServerSpec,
  McpApps,
  McpServer,
  McpStatus,
  McpServerWithStatus,
  MCPServer,
  ServerStatus,
  MCPProjectConfig,
  MCPServerConfig,
  SavedImageResult,
  AddServerResult,
  TranslationConfig,
  TranslationCacheStats,
  AutoCompactConfig,
  CompactionStrategy,
  SessionContext,
  SessionStatus,
  AutoCompactStatus,
  ImportResult,
  ImportServerResult
} from '@/lib/api/types';

import { coreApi } from '@/lib/api/core';
import { mcpApi } from '@/lib/api/mcp';
import { dataApi } from '@/lib/api/data';
import { automationApi } from '@/lib/api/automation';
import { promptApi } from '@/lib/api/prompt';
import { codexApi } from '@/lib/api/codex';
import { geminiApi } from '@/lib/api/gemini';

/**
 * API client for interacting with the Rust backend.
 *
 * Kept as the stable public facade for `@/lib/api`; implementation groups live
 * under `src/lib/api/` so the IPC bridge remains maintainable.
 */
export const api = {
  ...coreApi,
  ...mcpApi,
  ...dataApi,
  ...automationApi,
  ...promptApi,
  ...codexApi,
  ...geminiApi,
};

export type ApiClient = typeof api;
