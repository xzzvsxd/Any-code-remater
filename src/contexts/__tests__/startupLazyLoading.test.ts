import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const projectContextSource = readFileSync(
  resolve(process.cwd(), 'src/contexts/ProjectContext.tsx'),
  'utf8',
);

const apiSource = readFileSync(
  resolve(process.cwd(), 'src/lib/api.ts'),
  'utf8',
);

const claudeCommandSource = readFileSync(
  resolve(process.cwd(), 'src-tauri/src/commands/claude/mod.rs'),
  'utf8',
);

const tauriMainSource = readFileSync(
  resolve(process.cwd(), 'src-tauri/src/main.rs'),
  'utf8',
);

const sidebarSource = readFileSync(
  resolve(process.cwd(), 'src/components/layout/WorkbenchSidebar.tsx'),
  'utf8',
);

describe('workspace startup lazy loading', () => {
  test('ProjectContext renders projects from a fast summary API before background metadata hydration', () => {
    expect(apiSource).toContain('async listProjectsFast(): Promise<Project[]>');
    expect(projectContextSource).toContain('const list = await api.listProjectsFast();');
    expect(projectContextSource).toContain('hydrateProjectMetadata(sortedList, requestId);');
    expect(projectContextSource).toContain('scheduleDeferredProjectHydration');
    expect(projectContextSource).toContain('projectHydrationCancelRef');
    expect(projectContextSource).toContain('setProjectsLoading(false);');
  });

  test('backend exposes a fast project command that does not fan out into Codex or Gemini scans', () => {
    expect(claudeCommandSource).toContain('pub async fn list_projects_fast() -> Result<Vec<Project>, String>');
    expect(tauriMainSource).toContain('list_projects_fast');

    const fastCommand = claudeCommandSource.match(
      /pub async fn list_projects_fast\(\) -> Result<Vec<Project>, String> \{[\s\S]*?\n\}/,
    )?.[0] ?? '';

    expect(fastCommand).toContain('store.list_projects_fast()');
    expect(fastCommand).not.toContain('store.list_projects()');
    expect(fastCommand).not.toContain('list_codex_sessions');
    expect(fastCommand).not.toContain('list_session_files');
  });

  test('expanding a different project does not start a duplicate session scan beside selectProject', () => {
    expect(sidebarSource).toContain('const hasCachedSessions = sessionsByProject[project.id] !== undefined;');
    expect(sidebarSource).toContain('if (selectedProject?.id !== project.id) {');
    expect(sidebarSource).toContain('} else if (!hasCachedSessions) {');
    expect(sidebarSource).not.toContain('loadProjectSessions(project).catch(() => { /* ignore */ });\n      // 同时把它设为"当前选中"');
  });
});
