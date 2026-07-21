# AI Session Rename Feedback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent task-style Haiku replies from becoming session titles and show an accessible, in-row “AI is naming” animation until manual AI rename completes.

**Architecture:** Keep title-generation policy in `sessionAutoTitle.ts`, with source-text prompt boundaries and a narrow rejection rule for assistant-style questions. Keep async ownership in `WorkbenchSidebar`, extract the visual busy state into a stateless `SessionAIRenameStatus` component, and use scoped CSS for shimmer, spin, success fade, and reduced-motion behavior.

**Tech Stack:** React 18, TypeScript 5.9, Tailwind CSS 4 utilities, project CSS tokens, lucide-react, i18next, Vitest 3.

---

## File map

- Modify `src/lib/sessionAutoTitle.ts`: build the title-only request, sanitize assistant acknowledgements, and reject interrogative task responses.
- Modify `src/lib/__tests__/sessionAutoTitle.test.ts`: lock down prompt boundaries, rejection, retries, fallback, and existing title behavior.
- Create `src/components/layout/SessionAIRenameStatus.tsx`: render the one-row accessible busy presentation selected in design option A.
- Create `src/components/layout/__tests__/workbenchAIRenameFeedback.test.ts`: verify the component, sidebar state wiring, CSS, and three locales.
- Modify `src/components/layout/WorkbenchSidebar.tsx`: connect the existing request ID to the row, globally disable duplicate AI rename actions, and mark successful titles for a short fade-in.
- Modify `src/styles/components.css`: add scoped motion and reduced-motion rules.
- Modify `src/i18n/locales/zh.json`: add `workbench.ctx.aiRenaming`.
- Modify `src/i18n/locales/en.json`: add `workbench.ctx.aiRenaming`.
- Modify `src/i18n/locales/zh-TW.json`: add `workbench.ctx.aiRenaming`.

### Task 1: Harden the title-generation contract

**Files:**
- Modify: `src/lib/__tests__/sessionAutoTitle.test.ts`
- Modify: `src/lib/sessionAutoTitle.ts`

- [ ] **Step 1: Add failing tests for assistant-style questions**

Add assertions alongside the sanitizer tests:

```ts
test('rejects assistant task responses instead of persisting them as titles', () => {
  expect(sanitizeGeneratedSessionTitle('我需要先了解你现有的代码结构。请告诉我：')).toBe('');
  expect(sanitizeGeneratedSessionTitle('I need to understand your code structure first. Please tell me:')).toBe('');
});
```

Add a fallback-path test:

```ts
test('retries task-style replies before using the local prompt fallback', async () => {
  vi.mocked(claudeSDK.sendMessage).mockResolvedValue({
    content: '我需要先了解你现有的代码结构。请告诉我：',
  } as any);

  const title = await autoNameSessionFromPrompt({
    sessionId: 'session-task-reply',
    prompt: '修复 AI 重命名提示词和加载反馈',
  });

  expect(title).toBe('修复 AI 重命名提示词和加载反馈');
  expect(claudeSDK.sendMessage).toHaveBeenCalledTimes(2);
  expect(api.setSessionTitle).toHaveBeenCalledWith(
    'session-task-reply',
    '修复 AI 重命名提示词和加载反馈',
  );
});
```

- [ ] **Step 2: Run the focused tests and confirm RED**

Run:

```powershell
npx vitest run src/lib/__tests__/sessionAutoTitle.test.ts
```

Expected: the new sanitizer assertion fails because the question is currently truncated into a non-empty title; the fallback test also receives the task-style response instead of falling back.

- [ ] **Step 3: Add the narrow response rejection rule**

In `sessionAutoTitle.ts`, detect assistant-style task continuation before truncation:

```ts
function isLikelyAssistantTaskResponse(title: string): boolean {
  const normalized = title.replace(/\s+/g, ' ').trim();
  if (!normalized) return false;

  return /^(?:我|我们)?(?:需要|得|想|会|将)?(?:先)?(?:了解|查看|检查|确认|知道|获取|分析).*(?:请告诉|请提供|能否|可以先|需要你)/i.test(normalized)
    || /^(?:i|we)\s+(?:need|want|would like|have)\s+to\s+(?:first\s+)?(?:understand|know|inspect|check|review|see).*(?:please|could you|can you|tell me|provide|share)/i.test(normalized);
}
```

Call it after extracting and normalizing the first line but before acknowledgement stripping and `truncateTitle`; return an empty title when it matches. Retain the already-written `<PROMPT>` request wrapper and system-role constraints.

- [ ] **Step 4: Run the focused tests and confirm GREEN**

Run:

```powershell
npx vitest run src/lib/__tests__/sessionAutoTitle.test.ts
```

Expected: all `sessionAutoTitle` tests pass, including two Haiku attempts followed by the local fallback.

- [ ] **Step 5: Commit only title-generation files**

```powershell
git add -- src/lib/sessionAutoTitle.ts src/lib/__tests__/sessionAutoTitle.test.ts
git commit -m "fix(session): constrain AI title generation"
```

### Task 2: Build the selected in-row busy presentation

**Files:**
- Create: `src/components/layout/SessionAIRenameStatus.tsx`
- Create: `src/components/layout/__tests__/workbenchAIRenameFeedback.test.ts`
- Modify: `src/styles/components.css`
- Modify: `src/i18n/locales/zh.json`
- Modify: `src/i18n/locales/en.json`
- Modify: `src/i18n/locales/zh-TW.json`

- [ ] **Step 1: Add a failing source-contract test**

Create `workbenchAIRenameFeedback.test.ts` with direct source checks matching the repository’s existing integration-test pattern:

```ts
import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');
const status = read('src/components/layout/SessionAIRenameStatus.tsx');
const sidebar = read('src/components/layout/WorkbenchSidebar.tsx');
const css = read('src/styles/components.css');
const zh = read('src/i18n/locales/zh.json');
const en = read('src/i18n/locales/en.json');
const zhTW = read('src/i18n/locales/zh-TW.json');

describe('Workbench AI rename feedback', () => {
  test('renders the selected in-row naming animation accessibly', () => {
    expect(status).toContain('Wand2');
    expect(status).toContain("t('workbench.ctx.aiRenaming')");
    expect(status).toContain('ai-rename-spinner');
    expect(status).toContain('ai-rename-shimmer-text');
    expect(status).toContain('aria-live="polite"');
    expect(status).toContain('aria-busy="true"');
  });

  test('provides scoped motion and reduced-motion fallbacks', () => {
    expect(css).toContain('@keyframes ai-rename-spin');
    expect(css).toContain('@keyframes ai-rename-text-shimmer');
    expect(css).toContain('.ai-rename-title-enter');
    expect(css).toContain('@media (prefers-reduced-motion: reduce)');
  });

  test('wires one active session into the row and disables duplicate requests', () => {
    expect(sidebar).toContain('const isAIRenaming = aiRenamingSessionId === session.id');
    expect(sidebar).toContain('<SessionAIRenameStatus />');
    expect(sidebar).toContain('disabled={Boolean(aiRenamingSessionId)}');
    expect(sidebar).toContain('recentlyAIRenamedSessionId');
  });

  test('localizes the naming status in every supported locale', () => {
    expect(zh).toContain('"aiRenaming": "AI 正在命名…"');
    expect(en).toContain('"aiRenaming": "AI is naming…"');
    expect(zhTW).toContain('"aiRenaming": "AI 正在命名…"');
  });
});
```

- [ ] **Step 2: Run the new test and confirm RED**

Run:

```powershell
npx vitest run src/components/layout/__tests__/workbenchAIRenameFeedback.test.ts
```

Expected: FAIL because `SessionAIRenameStatus.tsx`, CSS selectors, sidebar wiring, and locale keys do not exist.

- [ ] **Step 3: Implement the stateless busy component**

Create `SessionAIRenameStatus.tsx`:

```tsx
import React from 'react';
import { Wand2 } from 'lucide-react';
import { useTranslation } from '@/hooks/useTranslation';

export const SessionAIRenameStatus: React.FC = () => {
  const { t } = useTranslation();

  return (
    <span
      className="flex min-w-0 flex-1 items-center gap-1.5 text-[11px] leading-relaxed"
      aria-live="polite"
      aria-busy="true"
    >
      <Wand2 aria-hidden="true" className="ai-rename-spinner h-3.5 w-3.5 flex-shrink-0 text-primary" />
      <span className="ai-rename-shimmer-text truncate font-medium">
        {t('workbench.ctx.aiRenaming')}
      </span>
    </span>
  );
};
```

- [ ] **Step 4: Add scoped motion and reduced-motion CSS**

Append to `src/styles/components.css`:

```css
@keyframes ai-rename-spin {
  to { transform: rotate(360deg); }
}

@keyframes ai-rename-text-shimmer {
  from { background-position: 200% 0; }
  to { background-position: -200% 0; }
}

@keyframes ai-rename-title-enter {
  from { opacity: 0; transform: translateY(2px); }
  to { opacity: 1; transform: translateY(0); }
}

.ai-rename-spinner { animation: ai-rename-spin 1.1s linear infinite; }

.ai-rename-shimmer-text {
  color: transparent;
  background: linear-gradient(90deg, var(--color-muted-foreground), var(--color-primary), var(--color-muted-foreground));
  background-size: 200% 100%;
  background-clip: text;
  -webkit-background-clip: text;
  animation: ai-rename-text-shimmer 1.4s ease-in-out infinite;
}

.ai-rename-title-enter { animation: ai-rename-title-enter 180ms ease-out both; }

@media (prefers-reduced-motion: reduce) {
  .ai-rename-spinner,
  .ai-rename-shimmer-text,
  .ai-rename-title-enter { animation: none; }
  .ai-rename-shimmer-text { color: var(--color-primary); background: none; }
}
```

- [ ] **Step 5: Add the three locale keys**

Place `aiRenaming` beside `aiRename` in each `workbench.ctx` object:

```json
"aiRenaming": "AI 正在命名…"
```

```json
"aiRenaming": "AI is naming…"
```

```json
"aiRenaming": "AI 正在命名…"
```

### Task 3: Wire request state into the workbench row

**Files:**
- Modify: `src/components/layout/WorkbenchSidebar.tsx`
- Test: `src/components/layout/__tests__/workbenchAIRenameFeedback.test.ts`

- [ ] **Step 1: Add success-transition state with cleanup**

Import `SessionAIRenameStatus`, add `recentlyAIRenamedSessionId`, add a timeout ref, and clear the timeout in an unmount effect. After a successful title update, set the recently-renamed ID and schedule it to clear after 600ms.

```tsx
const [recentlyAIRenamedSessionId, setRecentlyAIRenamedSessionId] = useState<string | null>(null);
const aiRenameSuccessTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

useEffect(() => () => {
  if (aiRenameSuccessTimerRef.current) clearTimeout(aiRenameSuccessTimerRef.current);
}, []);
```

In the success branch:

```tsx
if (aiRenameSuccessTimerRef.current) clearTimeout(aiRenameSuccessTimerRef.current);
setRecentlyAIRenamedSessionId(session.id);
aiRenameSuccessTimerRef.current = setTimeout(() => {
  setRecentlyAIRenamedSessionId((current) => current === session.id ? null : current);
  aiRenameSuccessTimerRef.current = null;
}, 600);
```

- [ ] **Step 2: Pass state into the memoized project tree**

Add `recentlyAIRenamedSessionId: string | null` to `ProjectTreeProps`, pass it from `WorkbenchSidebar`, and receive it in `WorkbenchProjectTree` alongside `aiRenamingSessionId`.

- [ ] **Step 3: Render option A in the title slot**

Within each session row compute:

```tsx
const isAIRenaming = aiRenamingSessionId === session.id;
const didJustAIRename = recentlyAIRenamedSessionId === session.id;
```

Render in this priority order:

```tsx
{isRenaming ? (
  <input /* existing manual rename input unchanged */ />
) : isAIRenaming ? (
  <SessionAIRenameStatus />
) : (
  <span
    className={cn(
      'flex-1 truncate text-[11px] leading-relaxed',
      (isActive || isDraft) && 'font-medium',
      didJustAIRename && 'ai-rename-title-enter',
    )}
  >
    {preview || (isDraft ? t('workbench.draftUntitled') : '')}
  </span>
)}
```

- [ ] **Step 4: Make visual disabled state match the request guard**

Use the existing request ID as the shared rule:

```tsx
<DropdownMenuItem
  disabled={Boolean(aiRenamingSessionId)}
  onClick={() => onAIRenameSession(session)}
>
```

Keep the active request’s menu icon as `Loader2`; use `Wand2` otherwise. When the active row’s menu is reopened, show `workbench.ctx.aiRenaming` instead of the idle label.

- [ ] **Step 5: Run the focused UI tests and confirm GREEN**

Run:

```powershell
npx vitest run src/components/layout/__tests__/workbenchAIRenameFeedback.test.ts src/components/layout/__tests__/workbenchSidebarLargeListSafety.test.ts src/components/__tests__/autoTopicNamingIntegration.test.ts
```

Expected: all focused workbench and auto-topic integration tests pass.

- [ ] **Step 6: Commit the UI feedback**

```powershell
git add -- src/components/layout/SessionAIRenameStatus.tsx src/components/layout/WorkbenchSidebar.tsx src/components/layout/__tests__/workbenchAIRenameFeedback.test.ts src/styles/components.css src/i18n/locales/zh.json src/i18n/locales/en.json src/i18n/locales/zh-TW.json
git commit -m "fix(ui): show AI rename progress in session row"
```

### Task 4: Full verification and visual inspection

**Files:**
- Verify all changed files

- [ ] **Step 1: Run all affected Vitest suites**

```powershell
npx vitest run src/lib/__tests__/sessionAutoTitle.test.ts src/components/layout/__tests__/workbenchAIRenameFeedback.test.ts src/components/layout/__tests__/workbenchSidebarLargeListSafety.test.ts src/components/__tests__/autoTopicNamingIntegration.test.ts
```

Expected: all tests pass with zero failures.

- [ ] **Step 2: Run project typecheck**

```powershell
npm run typecheck
```

Expected: exit code 0 and no TypeScript errors.

- [ ] **Step 3: Run production build**

```powershell
npm run build
```

Expected: exit code 0; Vite emits production assets.

- [ ] **Step 4: Inspect the final diff and workspace boundaries**

```powershell
git diff --check
git status --short
git diff HEAD~2 -- src/lib/sessionAutoTitle.ts src/lib/__tests__/sessionAutoTitle.test.ts src/components/layout/SessionAIRenameStatus.tsx src/components/layout/WorkbenchSidebar.tsx src/components/layout/__tests__/workbenchAIRenameFeedback.test.ts src/styles/components.css src/i18n/locales/zh.json src/i18n/locales/en.json src/i18n/locales/zh-TW.json
```

Expected: no whitespace errors; unrelated uncommitted Claude 1M model files remain outside the feature commits.

- [ ] **Step 5: Run the app and inspect the session row**

Start the Vite app, open it in the in-app browser, and verify at desktop and 200px sidebar widths that the in-row status is legible, stable, and does not collide with badges or the overflow menu. Verify the rendered component honors reduced motion by inspecting the media rule and checking the non-animated label remains visible.

- [ ] **Step 6: Record final evidence and remove the temporary task CSV**

Update the execution checklist with test counts, typecheck/build exit codes, and visual findings. When every row is done, delete `AI Rename Fix TO DO list.csv` as required by Taskmaster LITE close-out.
