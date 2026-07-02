import type { ClaudeSettings } from './api';

export const AUTO_TOPIC_NAMING_MODEL = 'claude-haiku-4-5-20251001';
export const AUTO_TITLE_HAIKU_TIMEOUT_MS = 4_000;
export const AUTO_TITLE_HAIKU_MAX_ATTEMPTS = 2;
export const AUTO_TITLE_PERSIST_MAX_ATTEMPTS = 3;

const AUTO_TITLE_MAX_LENGTH = 20;
const FALLBACK_TITLE_MAX_SOURCE_CHARS = 160;
const AUTO_TITLE_PERSIST_RETRY_DELAYS_MS = [0, 300] as const;
const inFlightAutoTitleBySessionId = new Map<string, Promise<string | null>>();

export function isAutoTopicNamingEnabled(settings: ClaudeSettings | null | undefined): boolean {
  return settings?.autoTopicNaming !== false;
}

function truncateTitle(title: string): string {
  const chars = Array.from(title);
  if (chars.length <= AUTO_TITLE_MAX_LENGTH) {
    return title;
  }

  return `${chars.slice(0, AUTO_TITLE_MAX_LENGTH - 1).join('').trimEnd()}…`;
}

export function sanitizeGeneratedSessionTitle(raw: string | undefined | null): string {
  if (!raw) {
    return '';
  }

  let title = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean) ?? '';

  title = title
    .replace(/^[-*•\d.)\s]+/, '')
    .replace(/^(标题|会话标题|话题|topic|title)\s*[:：]\s*/i, '')
    .replace(/^["'“”‘’`]+|["'“”‘’`]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  return truncateTitle(title);
}

export function generateFallbackSessionTitleFromPrompt(prompt: string): string {
  const trimmedPrompt = prompt.trim();
  if (!trimmedPrompt) {
    return '';
  }

  const firstUsefulLine = trimmedPrompt
    .slice(0, FALLBACK_TITLE_MAX_SOURCE_CHARS)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .map((line) => line.replace(/^```[\w.-]*\s*$/i, '').replace(/^~~~[\w.-]*\s*$/i, '').trim())
    .find(Boolean) ?? '';

  return sanitizeGeneratedSessionTitle(firstUsefulLine);
}

function rejectAfterTimeout(ms: number): Promise<never> {
  return new Promise((_, reject) => {
    setTimeout(() => reject(new Error(`Haiku topic naming timed out after ${ms}ms`)), ms);
  });
}

function wait(ms: number): Promise<void> {
  if (ms <= 0) {
    return Promise.resolve();
  }
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withAutoTitleTimeout<T>(promise: Promise<T>): Promise<T> {
  return Promise.race([
    promise,
    rejectAfterTimeout(AUTO_TITLE_HAIKU_TIMEOUT_MS),
  ]);
}

export async function generateSessionTitleFromPrompt(prompt: string): Promise<string> {
  const trimmedPrompt = prompt.trim();
  if (!trimmedPrompt) {
    return '';
  }

  const { claudeSDK } = await import('./claudeSDK');
  let lastError: unknown;

  for (let attempt = 0; attempt < AUTO_TITLE_HAIKU_MAX_ATTEMPTS; attempt += 1) {
    try {
      const response = await withAutoTitleTimeout(
        claudeSDK.sendMessage(
          [
            {
              role: 'user',
              content: trimmedPrompt,
            },
          ],
          {
            model: AUTO_TOPIC_NAMING_MODEL,
            maxTokens: 24,
            temperature: 0.2,
            systemPrompt:
              '请根据用户首条 prompt 生成一个简短的会话标题。要求：不超过 20 个字，优先 4-16 个汉字或 3-8 个英文词；只输出标题本身；不要引号、不要编号、不要解释。',
          }
        )
      );

      const title = sanitizeGeneratedSessionTitle(response.content);
      if (title) {
        return title;
      }
      lastError = new Error('Haiku returned an empty topic title');
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError instanceof Error ? lastError : new Error('Haiku topic naming failed');
}

async function setSessionTitleWithRetry(
  api: { setSessionTitle: (sessionId: string, title: string) => Promise<void> },
  sessionId: string,
  title: string,
): Promise<void> {
  let lastError: unknown;

  for (let attempt = 0; attempt < AUTO_TITLE_PERSIST_MAX_ATTEMPTS; attempt += 1) {
    try {
      await api.setSessionTitle(sessionId, title);
      return;
    } catch (error) {
      lastError = error;
      if (attempt >= AUTO_TITLE_PERSIST_MAX_ATTEMPTS - 1) {
        break;
      }
      await wait(AUTO_TITLE_PERSIST_RETRY_DELAYS_MS[attempt] ?? 0);
    }
  }

  throw lastError instanceof Error ? lastError : new Error('Persisting auto topic title failed');
}

async function autoNameSessionFromPromptOnce({
  sessionId,
  prompt,
}: {
  sessionId: string;
  prompt: string;
}): Promise<string | null> {
  const trimmedPrompt = prompt.trim();
  if (!sessionId || !trimmedPrompt) {
    return null;
  }

  try {
    const { api } = await import('./api');
    const settings = await api.getClaudeSettings();
    if (!isAutoTopicNamingEnabled(settings)) {
      return null;
    }

    const beforeMeta = await api.getSessionMeta();
    if (beforeMeta.titles?.[sessionId]?.trim()) {
      return null;
    }

    let title = '';
    try {
      title = sanitizeGeneratedSessionTitle(
        await generateSessionTitleFromPrompt(trimmedPrompt)
      );
    } catch (error) {
      console.warn('[SessionAutoTitle] Haiku topic naming failed, using local fallback:', error);
      title = generateFallbackSessionTitleFromPrompt(trimmedPrompt);
    }

    if (!title) {
      title = generateFallbackSessionTitleFromPrompt(trimmedPrompt);
    }

    if (!title) {
      return null;
    }

    // Re-check before writing so a manual rename that happened while Haiku was
    // generating is never overwritten.
    const afterMeta = await api.getSessionMeta();
    if (afterMeta.titles?.[sessionId]?.trim()) {
      return null;
    }

    await setSessionTitleWithRetry(api, sessionId, title);
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('session-title-changed', {
        detail: { sessionId, title },
      }));
    }

    return title;
  } catch (error) {
    console.warn('[SessionAutoTitle] Auto topic naming skipped:', error);
    return null;
  }
}

export async function autoNameSessionFromPrompt({
  sessionId,
  prompt,
}: {
  sessionId: string;
  prompt: string;
}): Promise<string | null> {
  const trimmedSessionId = sessionId.trim();
  const trimmedPrompt = prompt.trim();
  if (!trimmedSessionId || !trimmedPrompt) {
    return null;
  }

  const existing = inFlightAutoTitleBySessionId.get(trimmedSessionId);
  if (existing) {
    return existing;
  }

  const naming = autoNameSessionFromPromptOnce({
    sessionId: trimmedSessionId,
    prompt: trimmedPrompt,
  }).finally(() => {
    if (inFlightAutoTitleBySessionId.get(trimmedSessionId) === naming) {
      inFlightAutoTitleBySessionId.delete(trimmedSessionId);
    }
  });

  inFlightAutoTitleBySessionId.set(trimmedSessionId, naming);
  return naming;
}

/**
 * 手动触发的「AI 重命名」：与 autoNameSessionFromPrompt 不同，它由用户主动点击触发，
 * 因此刻意**绕过**「已有标题就跳过」的检查（用户就是想重新命名已命名的会话），
 * 也不受 autoTopicNaming 开关限制。AI 失败时降级为本地 fallback（截取首行）。
 * 返回最终写入的标题；无可用 prompt 或彻底失败时返回 null。
 */
export async function renameSessionWithAI({
  sessionId,
  prompt,
}: {
  sessionId: string;
  prompt: string;
}): Promise<string | null> {
  const trimmedSessionId = sessionId.trim();
  const trimmedPrompt = prompt.trim();
  if (!trimmedSessionId || !trimmedPrompt) {
    return null;
  }

  const { api } = await import('./api');

  let title = '';
  try {
    title = sanitizeGeneratedSessionTitle(
      await generateSessionTitleFromPrompt(trimmedPrompt)
    );
  } catch (error) {
    console.warn('[SessionAutoTitle] Manual AI rename failed, using local fallback:', error);
    title = generateFallbackSessionTitleFromPrompt(trimmedPrompt);
  }

  if (!title) {
    title = generateFallbackSessionTitleFromPrompt(trimmedPrompt);
  }

  if (!title) {
    return null;
  }

  await setSessionTitleWithRetry(api, trimmedSessionId, title);
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('session-title-changed', {
      detail: { sessionId: trimmedSessionId, title },
    }));
  }

  return title;
}
