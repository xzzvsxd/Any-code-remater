import assert from 'node:assert/strict';
import { prepareRecentProjects } from '../src/lib/recentProjects.js';

type TestProject = {
  id: string;
  path: string;
  sessions: string[];
  created_at: number;
};

const projects: TestProject[] = Array.from({ length: 8 }, (_, index) => ({
  id: `project-${index}`,
  path: `/tmp/project-${index}`,
  created_at: 1000 + index,
  sessions: [],
}));

const prepared = prepareRecentProjects(projects);

assert.equal(prepared.length, 8, 'recent project picker should keep all projects, not only five');
assert.deepEqual(
  prepared.map((project: TestProject) => project.id),
  [...projects].sort((a, b) => b.created_at - a.created_at).map(project => project.id),
  'recent projects should still be sorted newest first',
);
assert.deepEqual(
  projects.map(project => project.id),
  Array.from({ length: 8 }, (_, index) => `project-${index}`),
  'preparing recent projects must not mutate the API result array',
);

console.log('recent projects verification passed');
