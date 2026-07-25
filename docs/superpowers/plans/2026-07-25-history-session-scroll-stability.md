# History Session Scroll Stability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate long-history blank screens and apparent ordering corruption during upward scrolling and prompt navigation without disabling virtualization.

**Architecture:** Keep real JSONL rows as an immutable ordered backbone, render Prompt Navigator as a compositor-only overlay, and make the virtual scroll track resilient to transient empty windows. Isolate geometry and retry decisions in pure helpers so the race conditions have deterministic tests while `SessionMessages` performs only bounded exceptional recovery work.

**Tech Stack:** React 18, TypeScript, TanStack Virtual, Tailwind CSS, Vitest, Tauri/Vite

**Performance acceptance:** Virtualization remains enabled; normal scrolling adds no polling or document queries; the navigator animates only compositor-friendly properties; exceptional recovery and prompt retries have fixed frame budgets; and UI-only merging is bounded by the persisted 50-event cap.

---

## File Map

- Create `src/components/session/virtualTrackLayout.ts`: sanitize TanStack geometry and preserve scroll-track height when a non-empty list temporarily has no virtual items.
- Create `src/components/session/promptScrollRetryPolicy.ts`: pure decision table for prompt-location retries.
- Create `src/components/session/__tests__/virtualTrackLayout.test.ts`: normal, malformed, and empty-window virtual-track cases.
- Create `src/components/session/__tests__/promptScrollRetryPolicy.test.ts`: prompt anchor, row fallback, virtual-window wait, re-scroll, cancellation-budget cases.
- Create `src/components/__tests__/promptNavigatorOverlay.test.ts`: structural invariant that navigator animation never changes message viewport width.
- Modify `src/lib/uiOnlySessionEvents.ts`: replace the mixed comparator with stable bucket insertion around the physical history backbone.
- Modify `src/lib/__tests__/uiOnlySessionEvents.test.ts`: timestamp regression, equality, missing-time, duplicate, and large-history invariants.
- Modify `src/components/PromptNavigator.tsx`: fixed-width absolute drawer with transform/opacity animation.
- Modify `src/components/ClaudeCodeSession.tsx`: positioned root containing block for the drawer.
- Modify `src/components/session/SessionMessages.tsx`: consume both helpers, contain row margins, preserve the virtual track, run bounded recovery, and reduce imperative scroll writes.
- Modify `src/components/session/__tests__/sessionMessagesVirtualizationSafety.test.ts`: integration-source invariants for margin containment and empty-window recovery.
- Modify `src/components/session/__tests__/sessionMessagesImperativeScroll.test.ts`: integration-source invariants for progress-driven prompt retries.

### Task 1: Preserve the Physical History Backbone

**Files:**
- Modify: `src/lib/__tests__/uiOnlySessionEvents.test.ts`
- Modify: `src/lib/uiOnlySessionEvents.ts:251-292`

- [ ] **Step 1: Add failing merge invariants**

Append tests that keep direct references to real messages and exercise timestamp disorder:

```ts
const realMessages = (count: number): ClaudeStreamMessage[] => Array.from(
  { length: count },
  (_, index) => index % 2 === 0
    ? user(`prompt-${index}`, new Date(Date.UTC(2026, 0, 1, 0, 0, count - index)).toISOString())
    : assistant(`answer-${index}`, new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString()),
);

test('preserves the exact physical order of real history when timestamps regress', () => {
  const history = realMessages(12);
  const merged = mergeUiOnlySessionMessages(history, [
    terminalEvent('middle event', '2026-01-01T00:00:05.000Z'),
  ]);

  expect(merged.filter(message => message.uiOnly !== true)).toEqual(history);
  expect(merged.filter(message => message.uiOnly !== true).every(
    (message, index) => message === history[index],
  )).toBe(true);
});

test('inserts equal and missing-time ui-only events deterministically', () => {
  const history = [
    assistant('first', '2026-01-01T00:00:01.000Z'),
    assistant('second', '2026-01-01T00:00:01.000Z'),
  ];
  const equalA = terminalEvent('equal-a', '2026-01-01T00:00:01.000Z');
  const equalB = terminalEvent('equal-b', '2026-01-01T00:00:01.000Z');
  const missing = { ...terminalEvent('missing', '2026-01-01T00:00:02.000Z'), timestamp: undefined, receivedAt: undefined };

  const merged = mergeUiOnlySessionMessages(history, [equalA, equalB, missing]);
  expect(merged).toEqual([history[0], history[1], equalA, equalB, expect.objectContaining({ result: 'missing' })]);
});

test('deduplicates ui-only events and scales without moving a 10000-row backbone', () => {
  const history = realMessages(10_000);
  const events = Array.from({ length: 50 }, (_, index) => terminalEvent(
    `event-${index}`,
    new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString(),
  ));

  const merged = mergeUiOnlySessionMessages(history, [...events, events[0]]);
  expect(merged).toHaveLength(10_050);
  expect(merged.filter(message => message.uiOnly !== true)).toEqual(history);
});
```

- [ ] **Step 2: Run the merge suite and verify RED**

Run:

```powershell
npx vitest run src/lib/__tests__/uiOnlySessionEvents.test.ts
```

Expected: at least the regression/equality test fails because the mixed comparator does not implement physical-backbone bucket insertion.

- [ ] **Step 3: Replace mixed sorting with stable bucket insertion**

Keep the existing normalization and identity helpers, then implement `mergeUiOnlySessionMessages` with this structure:

```ts
export function mergeUiOnlySessionMessages(
  historyMessages: ClaudeStreamMessage[],
  uiOnlyMessages: ClaudeStreamMessage[],
): ClaudeStreamMessage[] {
  if (uiOnlyMessages.length === 0) return historyMessages;

  const seen = new Set(historyMessages.map(getMessageIdentity));
  const uniqueUiMessages: Array<{ message: ClaudeStreamMessage; time: number; order: number }> = [];

  for (const sourceMessage of uiOnlyMessages) {
    const message = normalizeUiOnlySessionMessage(sourceMessage);
    const identity = getMessageIdentity(message);
    if (seen.has(identity)) continue;
    seen.add(identity);
    uniqueUiMessages.push({
      message,
      time: getMessageTime(message),
      order: uniqueUiMessages.length,
    });
  }

  if (historyMessages.length === 0) {
    return uniqueUiMessages.map(entry => entry.message);
  }
  if (uniqueUiMessages.length === 0) return historyMessages;

  const historyTimes = historyMessages.map(getMessageTime);
  const buckets: Array<Array<typeof uniqueUiMessages[number]>> = Array.from(
    { length: historyMessages.length + 1 },
    () => [],
  );

  for (const entry of uniqueUiMessages) {
    let bucketIndex = historyMessages.length;
    if (Number.isFinite(entry.time)) {
      bucketIndex = 0;
      for (let index = 0; index < historyTimes.length; index += 1) {
        const historyTime = historyTimes[index];
        if (Number.isFinite(historyTime) && historyTime <= entry.time) {
          bucketIndex = index + 1;
        }
      }
    }
    buckets[bucketIndex].push(entry);
  }

  for (const bucket of buckets) {
    bucket.sort((left, right) => {
      const leftValid = Number.isFinite(left.time);
      const rightValid = Number.isFinite(right.time);
      if (leftValid && rightValid && left.time !== right.time) return left.time - right.time;
      if (leftValid !== rightValid) return leftValid ? -1 : 1;
      return left.order - right.order;
    });
  }

  const merged: ClaudeStreamMessage[] = [];
  merged.push(...buckets[0].map(entry => entry.message));
  historyMessages.forEach((message, index) => {
    merged.push(message, ...buckets[index + 1].map(entry => entry.message));
  });
  return merged;
}
```

- [ ] **Step 4: Run the merge suite and verify GREEN**

Run:

```powershell
npx vitest run src/lib/__tests__/uiOnlySessionEvents.test.ts
```

Expected: every `ui-only session event merging` test passes, including 10,000 real messages plus 50 UI-only events.

- [ ] **Step 5: Commit the ordered merge**

```powershell
git add src/lib/uiOnlySessionEvents.ts src/lib/__tests__/uiOnlySessionEvents.test.ts
git commit -m "fix(session): preserve physical history order"
```

### Task 2: Preserve Virtual Track Geometry

**Files:**
- Create: `src/components/session/virtualTrackLayout.ts`
- Create: `src/components/session/__tests__/virtualTrackLayout.test.ts`

- [ ] **Step 1: Write the failing geometry tests**

Create a suite importing `getVirtualTrackLayout` and assert the exact invariant:

```ts
import { describe, expect, test } from 'vitest';
import { getVirtualTrackLayout } from '../virtualTrackLayout';

describe('getVirtualTrackLayout', () => {
  test('calculates normal document-flow spacers', () => {
    expect(getVirtualTrackLayout(1_000, [
      { start: 200, end: 350 },
      { start: 350, end: 500 },
    ], 10)).toEqual({
      totalSize: 1_000,
      paddingTop: 200,
      paddingBottom: 500,
      shouldRecover: false,
    });
  });

  test('preserves the full track when a non-empty list has an empty virtual window', () => {
    expect(getVirtualTrackLayout(84_000, [], 1_001)).toEqual({
      totalSize: 84_000,
      paddingTop: 0,
      paddingBottom: 84_000,
      shouldRecover: true,
    });
  });

  test('sanitizes invalid and reversed geometry to finite non-negative values', () => {
    const result = getVirtualTrackLayout(Number.NaN, [
      { start: -50, end: Number.POSITIVE_INFINITY },
      { start: 150, end: 100 },
    ], 2);
    expect(result).toEqual({
      totalSize: 150,
      paddingTop: 0,
      paddingBottom: 0,
      shouldRecover: false,
    });
  });

  test('does not recover an actually empty session', () => {
    expect(getVirtualTrackLayout(0, [], 0)).toEqual({
      totalSize: 0,
      paddingTop: 0,
      paddingBottom: 0,
      shouldRecover: false,
    });
  });
});
```

- [ ] **Step 2: Run the geometry suite and verify RED**

Run:

```powershell
npx vitest run src/components/session/__tests__/virtualTrackLayout.test.ts
```

Expected: FAIL because `../virtualTrackLayout` does not exist.

- [ ] **Step 3: Implement the geometry helper**

Create the focused helper:

```ts
export interface VirtualTrackItemGeometry {
  start: number;
  end: number;
}

export interface VirtualTrackLayout {
  totalSize: number;
  paddingTop: number;
  paddingBottom: number;
  shouldRecover: boolean;
}

const finiteNonNegative = (value: number): number => (
  Number.isFinite(value) ? Math.max(0, value) : 0
);

export function getVirtualTrackLayout(
  rawTotalSize: number,
  virtualItems: readonly VirtualTrackItemGeometry[],
  itemCount: number,
): VirtualTrackLayout {
  if (itemCount <= 0) {
    return { totalSize: 0, paddingTop: 0, paddingBottom: 0, shouldRecover: false };
  }

  const baseTotalSize = finiteNonNegative(rawTotalSize);
  if (virtualItems.length === 0) {
    const totalSize = Math.max(100, baseTotalSize);
    return { totalSize, paddingTop: 0, paddingBottom: totalSize, shouldRecover: true };
  }

  const firstStart = finiteNonNegative(virtualItems[0].start);
  const last = virtualItems[virtualItems.length - 1];
  const lastStart = finiteNonNegative(last.start);
  const lastEnd = Math.max(lastStart, finiteNonNegative(last.end));
  const totalSize = Math.max(baseTotalSize, firstStart, lastEnd);

  return {
    totalSize,
    paddingTop: Math.min(firstStart, totalSize),
    paddingBottom: Math.max(0, totalSize - lastEnd),
    shouldRecover: false,
  };
}
```

- [ ] **Step 4: Run the geometry suite and verify GREEN**

Run:

```powershell
npx vitest run src/components/session/__tests__/virtualTrackLayout.test.ts
```

Expected: 4 tests pass.

- [ ] **Step 5: Commit the geometry helper**

```powershell
git add src/components/session/virtualTrackLayout.ts src/components/session/__tests__/virtualTrackLayout.test.ts
git commit -m "test(session): define stable virtual track layout"
```

### Task 3: Stop Navigator Animation from Reflowing Messages

**Files:**
- Create: `src/components/__tests__/promptNavigatorOverlay.test.ts`
- Modify: `src/components/PromptNavigator.tsx:171-331`
- Modify: `src/components/ClaudeCodeSession.tsx:1638-1641`

- [ ] **Step 1: Write the failing overlay regression test**

Create a source-invariant test:

```ts
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';

const navigatorSource = readFileSync(resolve(process.cwd(), 'src/components/PromptNavigator.tsx'), 'utf8');
const sessionSource = readFileSync(resolve(process.cwd(), 'src/components/ClaudeCodeSession.tsx'), 'utf8');

describe('Prompt Navigator overlay geometry', () => {
  test('animates a fixed-width absolute drawer without resizing the message viewport', () => {
    expect(navigatorSource).toContain('absolute inset-y-0 right-0 z-50 w-80');
    expect(navigatorSource).toContain('transition-[transform,opacity]');
    expect(navigatorSource).toContain('translate-x-full opacity-0 pointer-events-none');
    expect(navigatorSource).not.toContain('transition-all duration-300');
    expect(navigatorSource).not.toContain('isOpen ? "w-80');
    expect(sessionSource).toContain('"relative flex h-full bg-background"');
  });
});
```

- [ ] **Step 2: Run the overlay suite and verify RED**

Run:

```powershell
npx vitest run src/components/__tests__/promptNavigatorOverlay.test.ts
```

Expected: FAIL because Prompt Navigator is a width-animated flex sibling.

- [ ] **Step 3: Convert Prompt Navigator to a compositor-only overlay**

Change the session root and navigator wrapper to:

```tsx
<div className={cn("relative flex h-full bg-background", className)}>
```

```tsx
<div
  aria-hidden={!isOpen}
  className={cn(
    "absolute inset-y-0 right-0 z-50 w-80 bg-background flex flex-col overflow-hidden border-l shadow-lg",
    "transition-[transform,opacity] duration-300 ease-in-out",
    isOpen
      ? "translate-x-0 opacity-100"
      : "translate-x-full opacity-0 pointer-events-none",
  )}
  onKeyDown={handleKeyDown}
>
  {isOpen && (/* retain the existing navigator contents unchanged */)}
</div>
```

Retain the current `isOpen` guard around the contents and prompt extraction so the closed overlay has negligible render cost.

- [ ] **Step 4: Run the overlay suite and verify GREEN**

Run:

```powershell
npx vitest run src/components/__tests__/promptNavigatorOverlay.test.ts
```

Expected: the overlay geometry test passes.

- [ ] **Step 5: Commit the overlay change**

```powershell
git add src/components/PromptNavigator.tsx src/components/ClaudeCodeSession.tsx src/components/__tests__/promptNavigatorOverlay.test.ts
git commit -m "fix(session): overlay prompt navigator"
```

### Task 4: Make Prompt-location Retries Progress-driven

**Files:**
- Create: `src/components/session/promptScrollRetryPolicy.ts`
- Create: `src/components/session/__tests__/promptScrollRetryPolicy.test.ts`
- Modify: `src/components/session/SessionMessages.tsx:599-706`
- Modify: `src/components/session/__tests__/sessionMessagesImperativeScroll.test.ts`

- [ ] **Step 1: Write the failing decision-table tests**

```ts
import { describe, expect, test } from 'vitest';
import { getPromptScrollRetryAction } from '../promptScrollRetryPolicy';

describe('getPromptScrollRetryAction', () => {
  test.each([
    [{ anchorFound: true, rowFound: true, targetVirtualized: true, attempt: 1, maxAttempts: 12 }, 'center-anchor'],
    [{ anchorFound: false, rowFound: true, targetVirtualized: true, attempt: 1, maxAttempts: 12 }, 'center-row'],
    [{ anchorFound: false, rowFound: false, targetVirtualized: true, attempt: 1, maxAttempts: 12 }, 'wait'],
    [{ anchorFound: false, rowFound: false, targetVirtualized: false, attempt: 1, maxAttempts: 12 }, 'scroll'],
    [{ anchorFound: false, rowFound: false, targetVirtualized: false, attempt: 12, maxAttempts: 12 }, 'stop'],
  ] as const)('returns %s as %s', (state, expected) => {
    expect(getPromptScrollRetryAction(state)).toBe(expected);
  });
});
```

- [ ] **Step 2: Run the retry-policy suite and verify RED**

Run:

```powershell
npx vitest run src/components/session/__tests__/promptScrollRetryPolicy.test.ts
```

Expected: FAIL because `../promptScrollRetryPolicy` does not exist.

- [ ] **Step 3: Implement the pure decision table**

```ts
export type PromptScrollRetryAction = 'center-anchor' | 'center-row' | 'wait' | 'scroll' | 'stop';

export interface PromptScrollRetryState {
  anchorFound: boolean;
  rowFound: boolean;
  targetVirtualized: boolean;
  attempt: number;
  maxAttempts: number;
}

export function getPromptScrollRetryAction(state: PromptScrollRetryState): PromptScrollRetryAction {
  if (state.anchorFound) return 'center-anchor';
  if (state.rowFound) return 'center-row';
  if (state.attempt >= state.maxAttempts) return 'stop';
  return state.targetVirtualized ? 'wait' : 'scroll';
}
```

- [ ] **Step 4: Replace the timer loop with bounded animation-frame progress checks**

Import the helper. Keep the initial `scrollToIndex`, request token, anchor centering, and highlight. Use a `maxAttempts` of 12. Each frame obtains:

```ts
const anchor = document.getElementById(`prompt-${promptIndex}`);
const row = parentRef.current?.querySelector<HTMLElement>(`[data-index="${targetGroupIndex}"]`) ?? null;
const targetVirtualized = rowVirtualizer.getVirtualItems().some(item => item.index === targetGroupIndex);
const action = getPromptScrollRetryAction({
  anchorFound: Boolean(anchor),
  rowFound: Boolean(row),
  targetVirtualized,
  attempt: attempts,
  maxAttempts,
});
```

For `center-anchor`, center and highlight the anchor. For `center-row`, use the same container-relative delta centering against the row and finish. For `scroll`, call `scrollToIndex` once more. For `wait` and `scroll`, schedule one next `requestAnimationFrame`; for `stop`, log once and finish. Store the frame id in `promptScrollRafRef` so the existing cancel path invalidates it.

Add integration assertions:

```ts
expect(source).toContain('getPromptScrollRetryAction');
expect(source).toContain('targetVirtualized');
expect(source).toContain('maxAttempts = 12');
expect(source).not.toContain('pollInterval = 100');
expect(source).not.toContain('maxAttempts = 24');
```

- [ ] **Step 5: Run policy and imperative-scroll suites and verify GREEN**

Run:

```powershell
npx vitest run src/components/session/__tests__/promptScrollRetryPolicy.test.ts src/components/session/__tests__/sessionMessagesImperativeScroll.test.ts
```

Expected: both suites pass and the source no longer contains the 24 × 100 ms unconditional retry loop.

- [ ] **Step 6: Commit the prompt retry policy**

```powershell
git add src/components/session/promptScrollRetryPolicy.ts src/components/session/__tests__/promptScrollRetryPolicy.test.ts src/components/session/SessionMessages.tsx src/components/session/__tests__/sessionMessagesImperativeScroll.test.ts
git commit -m "fix(session): bound prompt scroll retries"
```

### Task 5: Integrate Empty-window Recovery and Margin Containment

**Files:**
- Modify: `src/components/session/SessionMessages.tsx:1-27, 469-476, 743-891`
- Modify: `src/components/session/__tests__/sessionMessagesVirtualizationSafety.test.ts`

- [ ] **Step 1: Add failing component integration assertions**

Extend the safety suite:

```ts
test('keeps a non-empty virtual track intact and schedules bounded recovery', () => {
  expect(sessionMessagesSource).toContain('getVirtualTrackLayout');
  expect(sessionMessagesSource).toContain('shouldRecover');
  expect(sessionMessagesSource).toContain('EMPTY_WINDOW_RECOVERY_MAX_FRAMES');
  expect(sessionMessagesSource).toContain('rowVirtualizer.measure()');
  expect(sessionMessagesSource).toContain('cancelAnimationFrame(recoveryRafId)');
});

test('contains descendant margins inside each measured virtual row', () => {
  expect(sessionMessagesSource).toContain('className="relative flow-root w-full"');
});
```

- [ ] **Step 2: Run the safety and geometry suites and verify RED**

Run:

```powershell
npx vitest run src/components/session/__tests__/virtualTrackLayout.test.ts src/components/session/__tests__/sessionMessagesVirtualizationSafety.test.ts
```

Expected: geometry passes; the new integration assertions fail.

- [ ] **Step 3: Consume stable geometry and add bounded exceptional recovery**

Import `getVirtualTrackLayout`, replace the inline padding calculation, and add a recovery effect:

```ts
const virtualItems = rowVirtualizer.getVirtualItems();
const {
  totalSize: virtualTotalSize,
  paddingTop: virtualPaddingTop,
  paddingBottom: virtualPaddingBottom,
  shouldRecover,
} = getVirtualTrackLayout(
  rowVirtualizer.getTotalSize(),
  virtualItems,
  messageGroups.length,
);

const EMPTY_WINDOW_RECOVERY_MAX_FRAMES = 8;

useEffect(() => {
  if (!shouldRecover) return;

  let recoveryRafId = 0;
  let frames = 0;
  const recover = () => {
    frames += 1;
    const scrollElement = parentRef.current;
    if (!scrollElement || scrollElement.clientHeight <= 0) {
      if (frames < EMPTY_WINDOW_RECOVERY_MAX_FRAMES) {
        recoveryRafId = requestAnimationFrame(recover);
      }
      return;
    }
    rowVirtualizer.measure();
  };

  recoveryRafId = requestAnimationFrame(recover);
  return () => cancelAnimationFrame(recoveryRafId);
}, [parentRef, rowVirtualizer, shouldRecover]);
```

Move the constant to module scope before the component so it is not recreated. Render the helper's padding values exactly as the existing top/bottom spacers. In the empty-window case, the bottom spacer alone now retains `virtualTotalSize`. Change the measurable row class to:

```tsx
className="relative flow-root w-full"
```

- [ ] **Step 4: Run all affected session tests and verify GREEN**

Run:

```powershell
npx vitest run src/components/session/__tests__/virtualTrackLayout.test.ts src/components/session/__tests__/promptScrollRetryPolicy.test.ts src/components/session/__tests__/sessionMessagesVirtualizationSafety.test.ts src/components/session/__tests__/sessionMessagesImperativeScroll.test.ts src/components/session/__tests__/messageGroupVirtualization.test.ts src/components/session/__tests__/sessionMessagesBottomStability.test.ts
```

Expected: every listed suite passes.

- [ ] **Step 5: Commit virtual-track recovery**

```powershell
git add src/components/session/SessionMessages.tsx src/components/session/__tests__/sessionMessagesVirtualizationSafety.test.ts
git commit -m "fix(session): recover empty virtual windows"
```

### Task 6: Stress and Release Verification

**Files:**
- Temporarily create and delete: `.history-scroll-stress.mjs`
- Verify all modified files from Tasks 1-5

- [ ] **Step 1: Run a private-data-free structural stress check**

Create a temporary script that accepts the local JSONL path as an argument, parses rows in memory, attaches synthetic UI-only events, invokes a TypeScript-independent copy of the backbone invariant, and prints only aggregate counts. It must assert:

```text
real output count equals input row count
every real output element is the same object at the same physical index
all generated virtual layout values are finite and non-negative
empty-window paddingBottom equals the sanitized total size
```

Run it against:

```powershell
node .history-scroll-stress.mjs "C:\Users\admin\.claude\projects\D--Any-code-remater\aa24694a-5dbc-43a2-955a-620b38edc319.jsonl"
```

Expected: exit code 0 with aggregate row/event counts only. Delete `.history-scroll-stress.mjs` immediately afterward so no local path or session-derived data enters Git.

- [ ] **Step 2: Run focused regression tests**

```powershell
npx vitest run src/lib/__tests__/uiOnlySessionEvents.test.ts src/components/__tests__/promptNavigatorOverlay.test.ts src/components/session/__tests__/virtualTrackLayout.test.ts src/components/session/__tests__/promptScrollRetryPolicy.test.ts src/components/session/__tests__/sessionMessagesVirtualizationSafety.test.ts src/components/session/__tests__/sessionMessagesImperativeScroll.test.ts
```

Expected: all focused suites pass.

- [ ] **Step 3: Run full automated verification**

```powershell
npx vitest run
npm run typecheck
npm run build
git diff --check
```

Expected: full Vitest has zero failed tests, TypeScript exits 0, Vite production build exits 0, and `git diff --check` emits no errors.

- [ ] **Step 4: Review scope and commit final integration corrections**

```powershell
git status --short
git diff --stat HEAD~5..HEAD
git diff --check HEAD~5..HEAD
```

Expected: changes are limited to the design/plan documents and the session files listed in the File Map. If verification required small integration corrections, stage only those listed files and commit them with:

```powershell
git commit -m "test(session): verify long history stability"
```

- [ ] **Step 5: Integrate without disturbing unrelated main-worktree edits**

Re-read the main worktree status and current branch tip. Cherry-pick only the history-stability commits onto the current `main`, resolving against its latest tip while leaving the existing `FloatingPromptInput` working-tree changes untouched. Then rerun focused tests, typecheck, and build in `D:\Any-code-remater`.
