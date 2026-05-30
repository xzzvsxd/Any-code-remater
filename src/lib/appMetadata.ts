export const UPDATE_RELEASE_REPOSITORY = 'xzzvsxd/Any-code-remater';

export function getCopyrightYear(date: Date = new Date()): number {
  return date.getFullYear();
}

export function normalizeVersionTag(version: string): string {
  const trimmed = version.trim();
  return trimmed.startsWith('v') ? trimmed : `v${trimmed}`;
}

export function getReleaseUrl(
  version: string,
  repository: string = UPDATE_RELEASE_REPOSITORY,
): string {
  return `https://github.com/${repository}/releases/tag/${normalizeVersionTag(version)}`;
}

export function getReleaseApiUrl(
  version: string,
  repository: string = UPDATE_RELEASE_REPOSITORY,
): string {
  return `https://api.github.com/repos/${repository}/releases/tags/${normalizeVersionTag(version)}`;
}
