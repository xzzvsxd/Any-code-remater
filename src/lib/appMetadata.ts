export const UPDATE_RELEASE_REPOSITORY = 'xzzvsxd/Any-code-remater';
export const PROJECT_REPOSITORY_URL = `https://github.com/${UPDATE_RELEASE_REPOSITORY}`;
export const PROJECT_RELEASES_URL = `${PROJECT_REPOSITORY_URL}/releases`;
export const UPDATE_MANIFEST_URL = `${PROJECT_RELEASES_URL}/latest/download/latest.json`;

export const UPSTREAM_PROJECTS = [
  {
    name: 'anyme123/Any-code',
    url: 'https://github.com/anyme123/Any-code',
  },
  {
    name: 'zm892729231/Any-code',
    url: 'https://github.com/zm892729231/Any-code',
  },
] as const;

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
