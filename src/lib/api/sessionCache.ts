import { invoke } from "@tauri-apps/api/core";

let codexSessionsCache: {
  value: import('@/types/codex').CodexSession[];
  expiresAt: number;
} | null = null;

const geminiSessionsCache = new Map<string, {
  value: import('@/types/gemini').GeminiSessionInfo[];
  expiresAt: number;
}>();

export const normalizeCachePath = (path: string) =>
  path ? path.replace(/\\/g, '/').replace(/\/$/, '').toLowerCase() : '';

export async function listCodexSessionsCached(): Promise<import('@/types/codex').CodexSession[]> {
  const now = Date.now();
  if (codexSessionsCache && codexSessionsCache.expiresAt > now) {
    return codexSessionsCache.value;
  }

  const value = await invoke<import('@/types/codex').CodexSession[]>("list_codex_sessions");
  codexSessionsCache = {
    value,
    expiresAt: now + 30_000,
  };
  return value;
}

export function clearCodexSessionsCache(): void {
  codexSessionsCache = null;
}

export async function listGeminiSessionsCached(projectPath: string): Promise<import('@/types/gemini').GeminiSessionInfo[]> {
  const key = normalizeCachePath(projectPath);
  const now = Date.now();
  const cached = geminiSessionsCache.get(key);
  if (cached && cached.expiresAt > now) {
    return cached.value;
  }

  const value = await invoke<import('@/types/gemini').GeminiSessionInfo[]>("list_gemini_sessions", { projectPath });
  geminiSessionsCache.set(key, {
    value,
    expiresAt: now + 30_000,
  });
  return value;
}

export function clearGeminiSessionsCache(): void {
  geminiSessionsCache.clear();
}

export function deleteGeminiSessionsCache(projectPath: string): void {
  geminiSessionsCache.delete(normalizeCachePath(projectPath));
}
