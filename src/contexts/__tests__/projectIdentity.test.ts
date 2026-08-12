import { describe, expect, test } from 'vitest';
import type { Project } from '@/lib/api';
import { findProjectByEncodedIdentity, mergeProjectsByIdentity } from '../projectIdentity';

const project = (id: string, path: string): Project => ({
  id,
  path,
  sessions: [id + '-session'],
  created_at: 1,
});

describe('project identity merging', () => {
  test('keeps separate real project ids even when decoded paths collide', () => {
    const first = project('D--workspace-alpha', 'D:/workspace/shared');
    const second = project('D--workspace-beta', 'D:/workspace/shared');

    expect(mergeProjectsByIdentity([first], [second])).toEqual([first, second]);
  });

  test('replaces a virtual path entry with the real project without merging real siblings', () => {
    const virtual = project('virtual:d:/workspace/shared', 'D:/workspace/shared');
    const real = project('D--workspace-shared', 'D:/workspace/shared');
    const sibling = project('D--workspace-shared-child', 'D:/workspace/shared');

    expect(mergeProjectsByIdentity([virtual], [real, sibling])).toEqual([real, sibling]);
  });

  test('uses the stable encoded id when a fallback-decoded path is lossy', () => {
    const physicalProject = project('D--AI-care', 'D:/AI/care');

    expect(findProjectByEncodedIdentity([physicalProject], 'D:/AI-care')).toBe(physicalProject);
  });
});
