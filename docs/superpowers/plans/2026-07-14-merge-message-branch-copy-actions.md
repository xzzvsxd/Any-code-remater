# Merge Message Branch and Copy Actions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render the message branch action immediately before the copy action in one shared hover toolbar, removing the separate floating branch button.

**Architecture:** `SessionMessages` remains the source of branch eligibility and prompt-index calculation. It passes optional branch props through `StreamMessageV2` to `UserMessage` or `AIMessage`, which forward them into `MessageActions`; `MessageActions` owns branch busy state and renders `GitBranch | Copy` in one toolbar.

**Tech Stack:** React 18, TypeScript, Tailwind CSS, lucide-react, Vitest source-safety tests, Vite.

---

## File Map

- Create `src/components/message/__tests__/messageActionsBranching.test.ts`: regression coverage for the merged toolbar and prop path.
- Modify `src/components/message/MessageActions.tsx`: add the optional branch action, busy state, tooltip, and divider.
- Modify `src/components/message/AIMessage.tsx`: accept optional branch props and forward them to `MessageActions`.
- Modify `src/components/message/UserMessage.tsx`: accept optional branch props and forward them to `MessageActions`.
- Modify `src/components/message/SystemMessage.tsx`: render the shared toolbar for branchable execution interruption messages.
- Modify `src/components/message/StreamMessageV2.tsx`: carry branch props only into normal branchable message renderers.
- Modify `src/components/session/SessionMessages.tsx`: pass branch props into `StreamMessageV2` and remove the separate overlay.
- Delete `src/components/message/MessageBranchButton.tsx`: remove the obsolete independent floating implementation after confirming no remaining imports.

### Task 1: Add failing regression coverage

**Files:**
- Create: `src/components/message/__tests__/messageActionsBranching.test.ts`

- [ ] **Step 1: Write the failing source-safety tests**

Create a Vitest test that reads the relevant source files and asserts:

```ts
import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';

const readSource = (relativePath: string) =>
  readFileSync(new URL(relativePath, import.meta.url), 'utf8');

describe('merged message branch and copy actions', () => {
  test('renders branch before copy in MessageActions with one optional divider', () => {
    const source = readSource('../MessageActions.tsx');
    expect(source).toContain('branchPromptIndex?: number');
    expect(source).toContain('onBranch?: (promptIndex: number) => void | Promise<void>');
    expect(source).toContain('const canBranch = branchPromptIndex >= 0 && Boolean(onBranch)');
    expect(source.indexOf('<GitBranch')).toBeLessThan(source.indexOf('<Copy'));
    expect(source).toContain('{canBranch && (');
    expect(source).toContain('aria-hidden="true"');
  });

  test('threads branch props through the normal message renderer', () => {
    const streamSource = readSource('../StreamMessageV2.tsx');
    const aiSource = readSource('../AIMessage.tsx');
    const userSource = readSource('../UserMessage.tsx');
    expect(streamSource).toContain('branchPromptIndex?: number');
    expect(streamSource).toContain('onBranch?: (promptIndex: number) => void | Promise<void>');
    expect(aiSource).toContain('branchPromptIndex={branchPromptIndex}');
    expect(userSource).toContain('branchPromptIndex={branchPromptIndex}');
  });

  test('removes the independent SessionMessages branch overlay', () => {
    const sessionSource = readSource('../../session/SessionMessages.tsx');
    expect(sessionSource).not.toContain('MessageBranchButton');
    expect(sessionSource).not.toContain('group-hover/msg:opacity-100');
    expect(sessionSource).toContain('branchPromptIndex={!isStreaming ? branchPromptIndex : -1}');
    expect(sessionSource).toContain('onBranch={onBranch}');
  });
});
```

- [ ] **Step 2: Run the new test and confirm RED**

Run:

```powershell
npx vitest run src/components/message/__tests__/messageActionsBranching.test.ts
```

Expected: FAIL because `MessageActions` has no branch props and `SessionMessages` still imports/renders `MessageBranchButton`.

- [ ] **Step 3: Commit the failing test**

```powershell
git add src/components/message/__tests__/messageActionsBranching.test.ts
git commit -m "test(ui): cover merged message actions"
```

### Task 2: Merge branch behavior into `MessageActions`

**Files:**
- Modify: `src/components/message/MessageActions.tsx`
- Delete: `src/components/message/MessageBranchButton.tsx`

- [ ] **Step 1: Extend props and state**

Add imports and props:

```tsx
import { Copy, Check, RefreshCw, Edit2, AlertCircle, GitBranch, Loader2 } from "lucide-react";

interface MessageActionsProps {
  content: string;
  branchPromptIndex?: number;
  onBranch?: (promptIndex: number) => void | Promise<void>;
  onRegenerate?: () => void;
  onEdit?: () => void;
  className?: string;
}
```

Destructure the new props, add `branchBusy`, and derive:

```tsx
const [branchBusy, setBranchBusy] = useState(false);
const canBranch = branchPromptIndex >= 0 && Boolean(onBranch);
```

- [ ] **Step 2: Add the guarded branch click handler**

```tsx
const handleBranch = async (event: React.MouseEvent<HTMLButtonElement>) => {
  event.stopPropagation();
  if (!canBranch || branchBusy || !onBranch) return;

  try {
    setBranchBusy(true);
    await onBranch(branchPromptIndex);
  } finally {
    setBranchBusy(false);
  }
};
```

- [ ] **Step 3: Render branch and divider before copy**

At the start of the toolbar contents, render:

```tsx
{canBranch && (
  <>
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          onClick={handleBranch}
          disabled={branchBusy}
          className="h-6 w-6 text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-60"
        >
          {branchBusy ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <GitBranch className="h-3.5 w-3.5" />
          )}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{t("message.branchFromHere", "从这里分支")}</TooltipContent>
    </Tooltip>
    <div aria-hidden="true" className="h-4 w-px bg-border/70" />
  </>
)}
```

- [ ] **Step 4: Delete the obsolete independent component**

Confirm no remaining consumer after Task 3 changes, then remove:

```powershell
Remove-Item -LiteralPath 'src/components/message/MessageBranchButton.tsx'
```

Do not commit until prop threading in Task 3 compiles.

### Task 3: Thread branch props and remove the overlay

**Files:**
- Modify: `src/components/message/AIMessage.tsx`
- Modify: `src/components/message/UserMessage.tsx`
- Modify: `src/components/message/SystemMessage.tsx`
- Modify: `src/components/message/StreamMessageV2.tsx`
- Modify: `src/components/session/SessionMessages.tsx`

- [ ] **Step 1: Add optional props to `AIMessage` and `UserMessage`**

Use the same signatures in both prop interfaces:

```tsx
branchPromptIndex?: number;
onBranch?: (promptIndex: number) => void | Promise<void>;
```

Destructure them and forward into each existing toolbar:

```tsx
<MessageActions
  content={text || thinkingContent}
  branchPromptIndex={branchPromptIndex}
  onBranch={onBranch}
/>
```

For `UserMessage`, preserve the existing conditions around `MessageActions` and pass `content={text}`. For `SystemMessage`, pass the props only into `ExecutionStatusMessage` and render `MessageActions` only when the branch index is valid, so execution-cancelled and execution-error nodes retain branching and gain the paired copy action without changing other system messages.

- [ ] **Step 2: Add the prop path to `StreamMessageV2`**

Add to `StreamMessageV2Props` and destructuring:

```tsx
branchPromptIndex?: number;
onBranch?: (promptIndex: number) => void | Promise<void>;
```

Forward both props to normal user, assistant, and system rendering paths. `SystemMessage` itself restricts the toolbar to eligible execution interruption nodes. Do not pass them into `SubagentMessageGroup`, aggregated technical groups, system initialization, result, summary, or unrelated direct consumers.

- [ ] **Step 3: Replace the external overlay in `SessionMessages`**

Remove:

```tsx
import { MessageBranchButton } from "@/components/message/MessageBranchButton";
```

Pass the eligibility result directly into `StreamMessageV2`:

```tsx
branchPromptIndex={!isStreaming ? branchPromptIndex : -1}
onBranch={onBranch}
```

Delete the outer `group/msg` wrapper and the separate absolute-positioned `MessageBranchButton` block. Keep `ErrorBoundary`, `MeasurableItem`, and message measurement structure intact.

- [ ] **Step 4: Run focused tests and confirm GREEN**

Run:

```powershell
npx vitest run src/components/message/__tests__/messageActionsBranching.test.ts src/components/message/__tests__/messageContentRenderSafety.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Run type checking**

Run:

```powershell
npm run typecheck
```

Expected: exit code 0.

- [ ] **Step 6: Commit implementation**

```powershell
git add src/components/message/MessageActions.tsx src/components/message/AIMessage.tsx src/components/message/UserMessage.tsx src/components/message/StreamMessageV2.tsx src/components/session/SessionMessages.tsx src/components/message/MessageBranchButton.tsx
git commit -m "fix(ui): merge branch and copy actions"
```

### Task 4: Final verification and UI inspection

**Files:**
- No production changes expected.

- [ ] **Step 1: Run the targeted regression suite**

```powershell
npx vitest run src/components/message/__tests__/messageActionsBranching.test.ts src/components/message/__tests__/messageContentRenderSafety.test.ts
```

Expected: all tests pass.

- [ ] **Step 2: Run project validation**

```powershell
npm run typecheck
npm run build
```

Expected: both commands exit 0.

- [ ] **Step 3: Inspect repository state**

```powershell
git status --short
git log -3 --oneline
```

Expected: implementation worktree is clean and commits include the regression test and fix.

- [ ] **Step 4: Launch or reuse the local UI and visually verify**

Verify on a branchable non-streaming user message and AI reply:

- one hover toolbar only;
- `GitBranch` appears before `Copy` with one divider;
- both actions appear/disappear together;
- branch loading state stays in place;
- non-branchable messages show only copy;
- no independent right-side branch overlay remains.

## Baseline Note

The focused baseline run on 2026-07-14 showed `messageContentRenderSafety.test.ts` passing, while two pre-existing assertions in `sessionMessagesVirtualizationSafety.test.ts` failed before this feature changed production code. Final verification therefore uses the new regression test, the passing message-content safety suite, type checking, and a full build; the pre-existing virtualization failures must not be attributed to this change.
