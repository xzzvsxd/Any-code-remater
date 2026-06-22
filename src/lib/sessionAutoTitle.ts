import type { ClaudeSettings } from './api';

export const AUTO_TOPIC_NAMING_MODEL = 'claude-haiku-4-5-20251001';
export const AUTO_TITLE_HAIKU_TIMEOUT_MS = 4_000;

const AUTO_TITLE_MAX_LENGTH = 48;
const FALLBACK_TITLE_MAX_SOURCE_CHARS = 160;

export function isAutoTopicNamingEnabled(settings: ClaudeSettings | null | undefined): boolean {
  return settings?.autoTopicNaming !== false;
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

  if (title.length > AUTO_TITLE_MAX_LENGTH) {
    title = `${title.slice(0, AUTO_TITLE_MAX_LENGTH - 1).trimEnd()}…`;
  }

  return title;
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
        maxTokens: 32,
        temperature: 0.2,
        systemPrompt:
          '请根据用户首条 prompt 生成一个简短的会话标题。要求：4-16 个汉字或 3-8 个英文词；只输出标题本身；不要引号、不要编号、不要解释。',
      }
    )
  );

  return sanitizeGeneratedSessionTitle(response.content);
}

export async function autoNameSessionFromPrompt({
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

    await api.setSessionTitle(sessionId, title);
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
