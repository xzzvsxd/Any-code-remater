import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { filterPromotedDraftSessionsForSidebar } from '../workbenchSessionOrdering';

const sidebarSource = readFileSync(
  resolve(process.cwd(), 'src/components/layout/WorkbenchSidebar.tsx'),
  'utf8',
);

const tabWrapperSource = readFileSync(
  resolve(process.cwd(), 'src/components/TabSessionWrapper.tsx'),
  'utf8',
);

const draftSessionsCommandSource = readFileSync(
  resolve(process.cwd(), 'src-tauri/src/commands/draft_sessions.rs'),
  'utf8',
);

describe('workbench draft session ghost protection', () => {
  test('filters stale draft rows when their carrier tab has already become a real session', () => {
    const drafts = [
      { id: 'tab-1', content: 'already sent prompt' },
      { id: 'tab-2', content: 'still a real draft' },
    ];

    const visible = filterPromotedDraftSessionsForSidebar(drafts, new Set(['tab-1']));

    expect(visible.map((draft) => draft.id)).toEqual(['tab-2']);
  });

  test('keeps normal drafts when no promoted tab uses their carrier id', () => {
    const drafts = [
      { id: 'tab-1', content: 'draft A' },
      { id: 'tab-2', content: 'draft B' },
    ];

    const visible = filterPromotedDraftSessionsForSidebar(drafts, new Set(['other-tab']));

    expect(visible.map((draft) => draft.id)).toEqual(['tab-1', 'tab-2']);
  });

  test('WorkbenchSidebar renders the filtered draft list, not raw backend drafts', () => {
    expect(sidebarSource).toContain('filterPromotedDraftSessionsForSidebar');
    expect(sidebarSource).toContain('promotedDraftCarrierIdsSig');
    expect(sidebarSource).toContain('draftSessionsForSidebar');
    expect(sidebarSource).toContain('draftSessions={draftSessionsForSidebar}');
  });

  test('TabSessionWrapper deletes the draft carrier when a new tab is promoted to a session', () => {
    expect(tabWrapperSource).toContain("import { api } from '@/lib/api'");
    expect(tabWrapperSource).toContain('api.deleteDraftSession(tabId)');
    expect(tabWrapperSource).toContain("window.dispatchEvent(new CustomEvent('drafts-changed'))");
  });

  test('backend draft save/delete commands serialize read-modify-write access', () => {
    expect(draftSessionsCommandSource).toContain('DRAFT_STORE_LOCK');
    expect(draftSessionsCommandSource).toContain('OnceLock<Mutex<()>>');
    expect(draftSessionsCommandSource).toMatch(/let _guard = draft_store_lock\(\)\.lock\(\)/);
  });
});
