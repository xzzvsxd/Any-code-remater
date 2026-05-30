import { getReleaseApiUrl } from './appMetadata.js';

export const UPDATE_NOTES_FALLBACK = '?????????????????? Release ???';

type DisplayNotesInput = {
  updaterNotes?: string | null;
  releaseNotes?: string | null;
};

export function isPlaceholderUpdateNotes(notes?: string | null): boolean {
  const text = notes?.trim();
  if (!text) return true;

  return /^see\s+the\s+full\s+changelog\s+at\s+https?:\/\//i.test(text)
    || /^https?:\/\/github\.com\/.+\/releases\/tag\//i.test(text);
}

export function getDisplayUpdateNotes({ updaterNotes, releaseNotes }: DisplayNotesInput): string {
  const releaseText = releaseNotes?.trim();
  if (releaseText) return releaseText;

  const updaterText = updaterNotes?.trim();
  if (updaterText && !isPlaceholderUpdateNotes(updaterText)) {
    return updaterText;
  }

  return UPDATE_NOTES_FALLBACK;
}

export async function fetchReleaseNotes(version: string, signal?: AbortSignal): Promise<string | null> {
  try {
    const response = await fetch(getReleaseApiUrl(version), {
      signal,
      headers: {
        Accept: 'application/vnd.github+json',
      },
    });

    if (!response.ok) {
      return null;
    }

    const data = await response.json() as { body?: unknown };
    const body = typeof data.body === 'string' ? data.body.trim() : '';
    return body || null;
  } catch (error) {
    if ((error as Error | undefined)?.name !== 'AbortError') {
      console.warn('[updateReleaseNotes] Failed to fetch release notes:', error);
    }
    return null;
  }
}
