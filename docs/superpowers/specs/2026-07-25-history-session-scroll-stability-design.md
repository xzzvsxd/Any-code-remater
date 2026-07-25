# History Session Scroll Stability Design

**Date:** 2026-07-25

**Status:** Approved for implementation

**Scope:** Long-history rendering, prompt navigation, UI-only event ordering, and virtual-scroll recovery

## Problem

Long sessions can turn blank after either of these actions:

1. Open an existing session and scroll upward through older messages.
2. Open Prompt Navigator and select a previously submitted prompt.

The failure is intermittent because it depends on a layout race. When Prompt Navigator opens or closes, its current flex width animation continuously changes the message viewport width for 300 ms. Markdown, code blocks, tool results, and grouped messages reflow during that animation. At the same time, the prompt-location routine repeatedly calls `scrollToIndex`, while TanStack Virtual is invalidating and remeasuring row heights.

During a hidden, resizing, or rapidly remeasured frame, `getVirtualItems()` may temporarily return an empty array even though the session contains messages. The current rendering path turns that transient state into zero top and bottom padding and retains only a 100 px minimum height. That collapses the virtual scroll track, makes the browser clamp a large `scrollTop`, and can strand the virtualizer at an unrelated position or in an apparently blank viewport.

The apparent ordering corruption has a separate contributing cause. Persisted UI-only events are merged with the JSONL history using a comparator that uses physical index for two real messages but timestamp whenever either side is UI-only. Real histories contain equal, missing, and decreasing timestamps, so the comparator does not define one globally consistent timeline. The JSONL row order must remain the authoritative order for real messages.

The history transport itself is not incrementally streamed into React: the Rust command reads the JSONL and returns one complete vector, and the frontend constructs and installs the loaded message array in one state update. The repair therefore targets post-load merging, grouping, measurement, and command-driven scrolling rather than the IPC loading mechanism.

## Evidence

- `PromptNavigator` is a flex sibling of the session content and animates `w-0` to `w-80` with `transition-all`.
- A prompt click closes the navigator and immediately invokes prompt scrolling in the same interaction.
- `SessionMessages` computes both virtual spacers as zero when `getVirtualItems()` is transiently empty and uses `Math.max(totalSize, 100)` only as a container minimum.
- Virtual rows contain descendants with vertical margins, but the measured row wrapper does not establish an independent formatting context.
- Prompt location may force `scrollToIndex` every 100 ms for up to 24 attempts, even after the target row has entered the virtual window.
- Local long-session inspection found JSONL timestamp regressions, duplicate timestamps, and missing timestamps in every sampled large history. The largest inspected fixture had 1001 rows, seven adjacent regressions, 36 equal adjacent timestamps, and 100 rows without timestamps.

## Goals

1. Keep the message viewport width stable while Prompt Navigator opens, closes, or animates.
2. Preserve the full virtual scroll track through transient empty-window frames.
3. Make measured row height match the row's actual document-flow footprint.
4. Preserve the exact relative order of all real JSONL messages while inserting UI-only events deterministically.
5. Reduce prompt-location scroll writes and cancel stale location attempts.
6. Retain virtualization and bounded work so thousand-message histories remain responsive.
7. Cover the failure modes with deterministic regression tests and a real long-history structural stress check.

## Non-goals

- Rendering the entire session without virtualization.
- Replacing the existing history IPC with paginated or streaming transport.
- Redesigning message grouping, Markdown rendering, or the visual style of Prompt Navigator.
- Persisting derived virtualizer state.
- Committing any locally captured private session history as a fixture.

## Design

### 1. Overlay Prompt Navigator

`ClaudeCodeSession` will establish a positioned containing block. `PromptNavigator` will become an absolute right-side overlay with a fixed `w-80`; visibility will animate only `transform` and `opacity`.

Open state:

```text
absolute inset-y-0 right-0 z-50 w-80 translate-x-0 opacity-100
```

Closed state:

```text
absolute inset-y-0 right-0 z-50 w-80 translate-x-full opacity-0 pointer-events-none
```

The component stays mounted so closing it does not synchronously tear down a large subtree while prompt scrolling starts. Its expensive prompt extraction remains gated by `isOpen`. `transition-all` is replaced by explicit transform/opacity transitions. This ensures panel animation never changes the message viewport width and therefore never triggers session-wide text reflow.

### 2. Stable UI-only Timeline Merge

Real history messages form an immutable physical-order backbone. The merge procedure will:

1. Normalize and deduplicate UI-only events in their input order.
2. Precompute valid timestamps for real messages without sorting the real array.
3. Assign every timestamped UI-only event to the bucket after the last real message whose timestamp is less than or equal to the event timestamp.
4. Put UI-only events with no valid timestamp in the final bucket.
5. Stably order events within each bucket by valid timestamp and then their original UI-only order.
6. Emit the leading bucket, then each real message followed by its bucket.

Timestamp regressions in real history do not move real messages. With at most 50 persisted UI-only events, a linear scan of the real history per event is bounded and simpler than imposing a false sorted-time assumption. The result guarantees that filtering out UI-only entries returns the original history array elements in the original sequence.

### 3. Virtual Track Layout Invariant

A focused helper will derive top padding, bottom padding, total size, and empty-window recovery state from virtual items. It will sanitize non-finite or negative coordinates.

The invariant is:

```text
itemCount > 0 and virtualItems is empty
    => rendered spacer height preserves the sanitized total virtual size
```

For a normal window, top padding is the first item start and bottom padding is `totalSize - lastItem.end`, both clamped to finite non-negative values. For an empty session, the track may be empty. For a non-empty session with a transient empty window, a single recovery spacer retains scroll height rather than collapsing to 100 px.

### 4. Bounded Empty-window Recovery

`SessionMessages` will watch the helper's recovery signal. A cancellable `requestAnimationFrame` loop will wait until the scroll element exists and has a positive `clientHeight`, then call `rowVirtualizer.measure()`. The loop will have a small fixed attempt budget and will be canceled when virtual items return, dependencies change, or the component unmounts.

This recovery path is exceptional and performs no continuous polling during normal scrolling. Keeping the scroll track intact prevents browser clamping while the remeasurement is pending.

### 5. Margin Containment for Measured Rows

The measurable virtual-row wrapper will add `flow-root`. This establishes a block formatting context and contains descendant vertical margins. `getBoundingClientRect().height` will then represent the row's complete document-flow height rather than allowing a first or last child's margin to escape the measured boundary.

### 6. Prompt-location Retry Policy

Prompt location keeps the existing request token so a new navigation request invalidates the previous one. The routine will make one initial `scrollToIndex` call, then inspect progress on bounded animation-frame retries:

- If the prompt anchor exists, center it and finish.
- If the target row exists but the nested anchor is not yet available, center the row as a fallback and finish.
- If the target group index is already in the virtual window, allow rendering/measurement to settle without issuing another `scrollToIndex` write.
- Only if the target group remains outside the virtual window may the routine reissue `scrollToIndex`.
- Stop after a short fixed retry budget.

This turns repeated imperative scrolling from a timer-driven loop into a progress-driven recovery mechanism and prevents a stale request from fighting a later click.

## Performance Constraints

- Keep TanStack Virtual enabled for all histories.
- Do not perform per-message DOM queries during ordinary render or scroll.
- Prompt extraction remains memoized and gated by navigator visibility.
- Empty-window recovery is inactive outside the exceptional empty-window state and is capped by a fixed frame budget.
- UI-only merge processes at most 50 UI-only events and does not sort or clone the real history backbone beyond constructing the final result.
- Prompt-location retries use animation frames, stop as soon as an anchor or row is usable, and suppress redundant scroll writes while the target row is already virtualized.
- The navigator animation affects compositor-friendly transform/opacity properties only.

## Test Matrix

### UI-only merge

- Real messages retain exact object identity and physical order when timestamps regress.
- Equal, missing, and invalid timestamps produce deterministic insertion.
- Multiple UI-only events in one bucket retain stable order.
- Duplicate UI-only events are removed.
- Empty history and empty UI-only inputs preserve existing fast paths.
- Synthetic 1,000- and 10,000-message histories with 50 UI-only events preserve the backbone invariant.

### Virtual track

- Normal windows calculate finite top and bottom padding.
- A non-empty session with no virtual items retains the full total size.
- Negative, `NaN`, infinite, reversed, and oversized coordinates are clamped.
- An empty session does not request recovery.

### Layout and navigation

- Source/structure regression verifies Prompt Navigator is an absolute fixed-width overlay and no longer animates width with `transition-all`.
- Session root supplies the positioned containing block.
- Measured rows use `flow-root`.
- Empty-window recovery is bounded and cancellable.
- Prompt-location policy reissues a scroll only while the target group is outside the virtual window and terminates for an anchor or row fallback.

### Integration and stress

- Existing session virtualization, bottom stability, grouping, and imperative-scroll suites continue to pass.
- A temporary local script reads a large history without committing its content and verifies physical-order preservation, unique group keys, and finite virtual-layout outputs.
- Full Vitest, TypeScript typecheck, and production build pass.

## Risks and Mitigations

| Risk | Mitigation |
|---|---|
| Overlay covers the right edge of messages while open | This matches a transient navigation drawer; it no longer destroys scroll geometry, and closing immediately reveals the unchanged viewport. |
| Empty-window recovery loops during a hidden view | Require positive `clientHeight`, cap attempts, and cancel on cleanup or state recovery. |
| UI-only event appears later than its wall-clock timestamp suggests | Preserve real history as authoritative; UI-only placement is deterministic and bounded by the physical backbone. |
| Row fallback centers a group containing several prompts | Use the exact prompt anchor whenever available; group centering is only the settled fallback that ends repeated scroll writes. |
| Virtualizer API behavior changes | Keep layout calculation and retry policy in pure helpers with direct tests; component integration remains small. |

## Rollback

The changes are isolated by concern:

- Revert the overlay classes to restore the prior navigator layout.
- Revert the pure merge implementation without affecting persistence format.
- Remove virtual-track recovery and `flow-root` without changing message data.
- Restore the previous prompt-location loop independently.

No storage schema, backend command, or persisted session file is changed, so rollback requires no data migration.
