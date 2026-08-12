import type { Project } from '@/lib/api';

export const normalizeProjectIdentityPath = (path: string): string =>
  path ? path.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase() : '';

export const isVirtualProjectId = (projectId: string): boolean =>
  projectId.startsWith('virtual:');

/** Claude Code's on-disk project id encoding (including the Windows drive colon). */
export const encodeProjectIdentityPath = (path: string): string =>
  path.replace(/[^a-zA-Z0-9]/g, '-');

export const findProjectByEncodedIdentity = (
  projects: Project[],
  projectPath: string,
): Project | null => {
  const encodedId = encodeProjectIdentityPath(projectPath);
  return projects.find((project) => (
    !isVirtualProjectId(project.id) && project.id === encodedId
  )) ?? null;
};

/**
 * Merge project snapshots without treating a decoded path as the physical
 * identity. Claude's project directory id is the session ownership boundary;
 * paths are only a fallback for virtual projects created before a directory
 * exists. Distinct real ids must remain visible even when lossy path decoding
 * produces the same path.
 */
export const mergeProjectsByIdentity = (
  primaryProjects: Project[],
  secondaryProjects: Project[],
): Project[] => {
  const merged: Project[] = [];
  const indexById = new Map<string, number>();
  const virtualIndexByPath = new Map<string, number>();

  [...primaryProjects, ...secondaryProjects].forEach((project) => {
    const existingIndex = indexById.get(project.id);
    if (existingIndex !== undefined) {
      return;
    }

    const isVirtual = isVirtualProjectId(project.id);
    const normalizedPath = normalizeProjectIdentityPath(project.path);

    if (isVirtual) {
      if (virtualIndexByPath.has(normalizedPath)) return;
      if (merged.some((candidate) => (
        !isVirtualProjectId(candidate.id)
        && normalizeProjectIdentityPath(candidate.path) === normalizedPath
      ))) {
        return;
      }

      virtualIndexByPath.set(normalizedPath, merged.length);
      indexById.set(project.id, merged.length);
      merged.push(project);
      return;
    }

    const virtualIndex = virtualIndexByPath.get(normalizedPath);
    if (virtualIndex !== undefined) {
      const virtualProject = merged[virtualIndex];
      indexById.delete(virtualProject.id);
      merged[virtualIndex] = project;
      indexById.set(project.id, virtualIndex);
      virtualIndexByPath.delete(normalizedPath);
      return;
    }

    indexById.set(project.id, merged.length);
    merged.push(project);
  });

  return merged;
};
