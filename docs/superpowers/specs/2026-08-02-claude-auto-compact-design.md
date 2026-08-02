# Claude Auto-Compact Design

## Problem

Any Code currently reports and triggers Claude context compaction through three independent mechanisms:

1. `ContextWindowIndicator` estimates the threshold as the model window minus a hard-coded 22.5% buffer. A 1M model is therefore shown as compacting at 775k.
2. `AutoCompactManager` separately tracks tokens with a 120k maximum and an 85% threshold, then starts another `claude --resume ... /compact` process.
3. Claude Code has its own auto-compaction implementation and official `autoCompactEnabled` and `autoCompactWindow` settings.

The three mechanisms disagree, the Any Code manager can race Claude's native compaction, and its completed token count is estimated by dividing the previous count by three. Native compact lifecycle messages are passed through as generic system messages, so most are invisible or unstyled.

## Goals

- Use Claude Code's official auto-compaction implementation as the only automatic compaction executor.
- Default Any Code's official auto-compact window to 256,000 tokens.
- Let users enable or disable auto-compaction and set a custom window from 100k to 1M tokens.
- Make the context indicator show the configured official window instead of a guessed buffer.
- Render scheduled, running, completed, and failed compaction states as dedicated timeline dividers.
- Persist completed compact records through Claude's native JSONL `compact_boundary` entries.
- Avoid polling, duplicate Claude processes, full-history scans, and high-frequency settings reads.

## Non-Goals

- Any Code will not generate its own conversation summary.
- Any Code will not estimate post-compact token counts.
- Any Code will not expose Claude's internal summary strategy controls; Claude owns summary quality and retry behavior.
- This change does not alter Codex or Gemini context management.

## Official Configuration

Claude Code 2.1.158 accepts:

```json
{
  "autoCompactEnabled": true,
  "autoCompactWindow": 256000
}
```

`autoCompactWindow` is an integer token count in the inclusive range 100,000 to 1,000,000. Claude caps it to the selected model's context window. `CLAUDE_CODE_AUTO_COMPACT_WINDOW` takes precedence over the settings value and accepts `auto`, explicit token values such as `200000`, suffix values such as `256k`, and 100-1000 shorthand values interpreted as thousands.

Any Code will persist the official top-level settings fields. Missing settings resolve to a 256,000-token Any Code default. Existing explicit values and explicit disablement are preserved. When the environment override is valid, the UI reports it as the active source and makes the settings override relationship explicit.

The configured value is described as the **auto-compact window**, not an exact trigger point. Claude keeps its own model-dependent output and safety buffer and compacts as usage approaches the configured window. Any Code must not recreate or claim an exact private threshold.

## Architecture

### Configuration Model

A small pure TypeScript module owns UI-side parsing and resolution:

- constants for the default and supported range;
- parsing for Claude's environment variable syntax;
- clamping and validation for settings input;
- resolution of enabled state, configured window, effective model-capped window, and source.

`GeneralSettings` edits `autoCompactEnabled` and `autoCompactWindow`. Saving settings dispatches a lightweight browser event so mounted session controls refresh once. `FloatingPromptInput` loads the compact configuration on mount and after that event, then passes the resolved configuration to the memoized `ControlBar` and `ContextWindowIndicator`.

No settings lookup occurs on a streaming frame. The indicator calculation is O(1), and its existing bounded message-tail scan remains unchanged.

### Automatic Execution

Claude Code remains responsible for deciding when to compact, running PreCompact/PostCompact hooks, creating the summary, handling rapid refills, and recording the compact boundary.

Any Code's background `AutoCompactManager` will no longer be started at application launch. Claude sessions will no longer register with it or feed it token counts. This removes the competing polling loop and duplicate `claude --resume ... /compact` process. Existing backend command types may remain temporarily for API compatibility, but no automatic path invokes them.

Manual `/compact` continues to work through the normal prompt execution path and uses the same timeline renderer.

### Lifecycle Events

Claude's structured messages drive the timeline:

- `system/status` with `status: "compacting"` renders the active compact divider with a restrained spinner animation.
- compact progress messages, when present, update the same active state without creating multiple rows.
- `system/compact_boundary` renders completion and reads `compactMetadata.trigger`, `preTokens`, `postTokens`, and `durationMs`.
- compact status metadata with `compactResult: "failed"` renders a failure divider and preserves the error text.
- a near-window state derived from current usage appears in the context indicator as "即将压缩". It does not fabricate a persisted timeline record before Claude actually starts.

The native `compact_boundary` JSONL row is the durable record. Reopening a session therefore restores completed dividers without a second persistence store. Running states are process-lifecycle states and disappear when the process ends or the session reloads.

### Timeline UI

A focused `CompactLifecycleMessage` component renders all compact phases. It is a full-width divider rather than a chat card:

- horizontal rules on both sides establish the context boundary;
- `scheduled` uses a neutral amber accent and no continuous animation;
- `running` uses `RefreshCw` with a reduced-motion-aware rotation and stable fixed minimum height;
- `completed` uses a calm green/teal accent and shows `165k -> 42k`, `released 123k`, and duration when available;
- `failed` uses the existing destructive palette and exposes the supplied error;
- automatic and manual sources are labeled separately.

The component does not nest cards, uses existing Lucide icons, and keeps the compact content to one or two responsive rows. Unknown or partial metadata degrades to a meaningful label without hiding the boundary.

### Virtualization

Compact lifecycle rows have a dedicated stable height estimate. Their virtual identity prefers the native UUID; status updates use the existing message identity and render-revision paths. This prevents the divider's animation or metadata arrival from changing neighboring row positions unexpectedly.

## Error Handling

- Invalid saved values fall back to 256k in display and are normalized before saving.
- The settings input is constrained to 100k-1M and reports validation inline.
- A valid environment override is shown as authoritative; editing the saved window remains possible but is labeled as inactive until the environment value is removed.
- A disabled official setting removes the threshold marker and near-window warning.
- Missing compact metadata still renders a completed boundary with its timestamp.
- Failed native compaction status is shown without treating the entire assistant execution as completed.

## Testing

Tests cover:

- official window parsing, range validation, model capping, defaults, disablement, and environment precedence;
- settings UI source wiring and save notification;
- removal of the custom automatic manager from startup and Claude stream accounting;
- context indicator use of the resolved official configuration with no 22.5% estimate;
- rendering of running, completed, failed, automatic, and manual lifecycle variants;
- completed pre/post token formatting and missing-metadata fallback;
- stable virtualization height for compact lifecycle messages;
- history reload preservation through `compact_boundary`.

Final verification runs focused Vitest tests, the full test suite, TypeScript validation, production build, relevant Rust tests, and `git diff --check` before versioning and push.

## Acceptance Criteria

- A 1M Claude session with no prior custom value shows a 256k auto-compact window.
- A user can save any integer window from 100k to 1M and the next Claude run uses the official setting.
- No Any Code background process automatically sends `/compact`.
- The context meter, settings UI, and lifecycle rendering agree on the active configuration source.
- Native auto and manual compaction display dedicated timeline dividers with real metadata.
- Switching pages or reopening a session preserves completed compact dividers from JSONL.
- Streaming performance does not add unbounded scans, polling, or per-frame filesystem calls.
