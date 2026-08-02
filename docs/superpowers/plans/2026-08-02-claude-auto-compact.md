# Claude Auto-Compact Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Any Code's competing auto-compaction logic with Claude Code's official 256k configurable window and render native compaction lifecycle events in the conversation timeline.

**Architecture:** Claude settings are the only persistent configuration source and Claude Code is the only automatic executor. Pure TypeScript resolvers provide bounded parsing and display state, while native `system/status`, compact progress, and `system/compact_boundary` messages feed a dedicated full-width timeline renderer. The legacy Rust manager remains only as dormant compatibility code; startup monitoring and CLI token feeds are removed.

**Tech Stack:** React 18, TypeScript, Vitest, Tailwind CSS, Framer Motion, Lucide React, Tauri 2, Rust.

---

## File Map

- Create `src/lib/claudeAutoCompact.ts`: official setting constants, parser, validation, environment precedence, and model-capped resolution.
- Create `src/lib/__tests__/claudeAutoCompact.test.ts`: resolver behavior.
- Create `src/lib/compactLifecycle.ts`: normalize Claude compact messages into UI lifecycle data.
- Create `src/lib/__tests__/compactLifecycle.test.ts`: native message shape coverage.
- Create `src/components/message/CompactLifecycleMessage.tsx`: dedicated divider renderer.
- Create `src/components/message/__tests__/compactLifecycleRenderSafety.test.ts`: renderer/system routing safety.
- Modify `src-tauri/src/commands/claude/config.rs`: inject official defaults without overwriting explicit user settings.
- Modify `src-tauri/src/commands/claude/mod.rs`: expose startup default initialization.
- Modify `src-tauri/src/main.rs`: initialize official defaults and stop the legacy polling manager.
- Modify `src-tauri/src/commands/claude/cli_runner.rs`: remove legacy session registration and token accounting.
- Modify `src/components/settings/GeneralSettings.tsx`: add official enable and integer-window controls.
- Modify `src/components/Settings.tsx`: notify mounted sessions after a successful settings save.
- Modify `src/components/FloatingPromptInput/index.tsx`: load resolved settings only on mount/save events.
- Modify `src/components/FloatingPromptInput/ControlBar.tsx`: pass resolved settings through the memo boundary.
- Modify `src/components/widgets/ContextWindowIndicator.tsx`: replace the 22.5% estimate with official-window display.
- Modify `src/components/message/SystemMessage.tsx` and `StreamMessageV2.tsx`: route compact lifecycle messages.
- Modify `src/components/session/messageHeightEstimate.ts`: assign a stable compact-row estimate.
- Modify `src/components/ClaudeStatusIndicator.tsx`: remove legacy manager polling.
- Modify `src/i18n/locales/en.json`, `zh.json`, and `zh-TW.json`: new labels.

### Task 1: Official Configuration Resolver

**Files:**
- Create: `src/lib/claudeAutoCompact.ts`
- Create: `src/lib/__tests__/claudeAutoCompact.test.ts`

- [ ] **Step 1: Write failing parser and resolution tests**

Cover the default, enable flag, settings value, environment precedence, `256k`, `256`, `200000`, `auto`, invalid values, supported range, and model capping:

```ts
expect(resolveClaudeAutoCompactConfig({}, 1_000_000)).toMatchObject({
  enabled: true,
  configuredWindow: 256_000,
  effectiveWindow: 256_000,
  source: 'default',
});
expect(resolveClaudeAutoCompactConfig({
  autoCompactWindow: 300_000,
  env: { CLAUDE_CODE_AUTO_COMPACT_WINDOW: '256k' },
}, 1_000_000)).toMatchObject({
  configuredWindow: 256_000,
  source: 'environment',
  isEnvironmentOverride: true,
});
expect(resolveClaudeAutoCompactConfig({ autoCompactWindow: 256_000 }, 200_000)
  .effectiveWindow).toBe(200_000);
```

- [ ] **Step 2: Run tests and verify RED**

Run: `npx vitest run src/lib/__tests__/claudeAutoCompact.test.ts`

Expected: FAIL because `claudeAutoCompact.ts` does not exist.

- [ ] **Step 3: Implement the pure resolver**

Export:

```ts
export const DEFAULT_CLAUDE_AUTO_COMPACT_WINDOW = 256_000;
export const MIN_CLAUDE_AUTO_COMPACT_WINDOW = 100_000;
export const MAX_CLAUDE_AUTO_COMPACT_WINDOW = 1_000_000;
export const CLAUDE_AUTO_COMPACT_SETTINGS_CHANGED_EVENT =
  'claude-auto-compact-settings-changed';

export type ClaudeAutoCompactSource =
  | 'environment'
  | 'settings'
  | 'default'
  | 'automatic';

export interface ResolvedClaudeAutoCompactConfig {
  enabled: boolean;
  configuredWindow: number | null;
  effectiveWindow: number | null;
  source: ClaudeAutoCompactSource;
  isEnvironmentOverride: boolean;
}
```

Mirror Claude's parser: `m`/`k` suffixes, 100-1000 shorthand, `auto`, integer rounding, and inclusive 100k-1M bounds. Invalid environment input falls through to settings; invalid settings input falls through to 256k.

- [ ] **Step 4: Run tests and verify GREEN**

Run: `npx vitest run src/lib/__tests__/claudeAutoCompact.test.ts`

Expected: all resolver tests pass.

### Task 2: Official Defaults and Legacy Executor Removal

**Files:**
- Modify: `src-tauri/src/commands/claude/config.rs`
- Modify: `src-tauri/src/commands/claude/mod.rs`
- Modify: `src-tauri/src/main.rs`
- Modify: `src-tauri/src/commands/claude/cli_runner.rs`

- [ ] **Step 1: Write failing Rust unit tests**

```rust
#[test]
fn auto_compact_defaults_fill_missing_official_settings() {
    let mut settings = serde_json::json!({"env": {"KEEP": "yes"}});
    assert!(apply_auto_compact_defaults(&mut settings));
    assert_eq!(settings["autoCompactEnabled"], true);
    assert_eq!(settings["autoCompactWindow"], 256_000);
    assert_eq!(settings["env"]["KEEP"], "yes");
}

#[test]
fn auto_compact_defaults_preserve_explicit_values() {
    let mut settings = serde_json::json!({
        "autoCompactEnabled": false,
        "autoCompactWindow": 300_000
    });
    assert!(!apply_auto_compact_defaults(&mut settings));
    assert_eq!(settings["autoCompactEnabled"], false);
    assert_eq!(settings["autoCompactWindow"], 300_000);
}
```

Add a source safety test rejecting `start_monitoring`, `register_session`, and `update_session_tokens` calls from application startup and Claude execution.

- [ ] **Step 2: Run tests and verify RED**

Run: `cargo test --manifest-path src-tauri/Cargo.toml auto_compact_defaults -- --nocapture`

Expected: FAIL because the helper is missing.

- [ ] **Step 3: Implement official default persistence**

Add `apply_auto_compact_defaults(&mut Value) -> bool` and `ensure_claude_auto_compact_defaults() -> Result<(), String>`. Read with the existing tolerant parser, insert only missing official keys, preserve `env` and unknown fields, create the Claude directory when needed, and write only when changed.

Call it during Tauri setup before sessions start. Log an initializer error and continue startup so an external malformed settings file does not stop the app.

- [ ] **Step 4: Remove active legacy paths**

Delete the startup `start_monitoring` task. Remove `auto_compact_available`, `register_session`, and asynchronous `update_session_tokens` blocks from `cli_runner.rs`. Keep command registration and managed state for API compatibility, but no normal run reaches automatic `/compact`.

- [ ] **Step 5: Run Rust tests and verify GREEN**

Run: `cargo test --manifest-path src-tauri/Cargo.toml auto_compact_defaults -- --nocapture`

Expected: default-preservation and source safety tests pass.

### Task 3: Settings UI and Synchronization

**Files:**
- Modify: `src/components/settings/GeneralSettings.tsx`
- Modify: `src/components/Settings.tsx`
- Modify: `src/i18n/locales/en.json`
- Modify: `src/i18n/locales/zh.json`
- Modify: `src/i18n/locales/zh-TW.json`
- Create: `src/components/__tests__/claudeAutoCompactSettingsSafety.test.ts`

- [ ] **Step 1: Write failing settings wiring tests**

Assert that the general settings switch binds `autoCompactEnabled`, a numeric input binds `autoCompactWindow`, its range is 100-1000 k tokens, and `Settings.saveSettings` dispatches `CLAUDE_AUTO_COMPACT_SETTINGS_CHANGED_EVENT` only after `saveClaudeSettings` resolves.

- [ ] **Step 2: Run the test and verify RED**

Run: `npx vitest run src/components/__tests__/claudeAutoCompactSettingsSafety.test.ts`

Expected: FAIL because controls and notification are absent.

- [ ] **Step 3: Add official controls**

```tsx
<Switch
  checked={settings?.autoCompactEnabled !== false}
  onCheckedChange={(checked) => updateSetting('autoCompactEnabled', checked)}
/>
<Input
  type="number"
  min={100}
  max={1000}
  step={1}
  value={Math.round(resolvedWindow / 1000)}
  onChange={(event) =>
    updateSetting('autoCompactWindow', clamp(Number(event.target.value) * 1000))
  }
/>
```

Show the active token value and an inline environment-override notice. Keep the input usable so the next saved value is ready after removing the environment override.

- [ ] **Step 4: Dispatch the settings refresh event**

After `api.saveClaudeSettings(updatedSettings)` succeeds, dispatch the imported event constant.

- [ ] **Step 5: Run the test and verify GREEN**

Run: `npx vitest run src/components/__tests__/claudeAutoCompactSettingsSafety.test.ts`

Expected: all settings wiring tests pass.

### Task 4: Context Indicator Uses the Official Window

**Files:**
- Modify: `src/components/FloatingPromptInput/index.tsx`
- Modify: `src/components/FloatingPromptInput/ControlBar.tsx`
- Modify: `src/components/widgets/ContextWindowIndicator.tsx`
- Create: `src/components/widgets/__tests__/contextWindowAutoCompactSafety.test.ts`

- [ ] **Step 1: Write failing behavior tests**

Assert that `AUTO_COMPACT_BUFFER_RATIO`, `MIN_AUTO_COMPACT_BUFFER`, and `getAutoCompactBuffer` are absent; the indicator accepts `autoCompactConfig`; disabled or automatic-null configurations hide the marker; a 1M model displays 256k and 165.1k usage reports about 90.9k remaining.

- [ ] **Step 2: Run the test and verify RED**

Run: `npx vitest run src/components/widgets/__tests__/contextWindowAutoCompactSafety.test.ts`

Expected: FAIL because the indicator still calculates 775k.

- [ ] **Step 3: Load settings at stable lifecycle points**

Keep resolved config in `FloatingPromptInput` state. Read `api.getClaudeSettings()` once on mount and again only when the settings event fires. Pass it through `ControlBar` and include the config identity in the memo comparator.

- [ ] **Step 4: Replace guessed calculations**

Use `effectiveWindow` for marker and remaining count. Label it `Auto-compact Window`, report source, and state that Claude compacts as usage approaches it. At 90% show `scheduled`; at or over the window show immediate status. Disabled settings show no compact block.

- [ ] **Step 5: Run tests and verify GREEN**

Run: `npx vitest run src/components/widgets/__tests__/contextWindowAutoCompactSafety.test.ts src/components/FloatingPromptInput/__tests__/controlBarRenderSafety.test.ts`

Expected: official-window and memo safety tests pass.

### Task 5: Native Compact Lifecycle Timeline

**Files:**
- Create: `src/lib/compactLifecycle.ts`
- Create: `src/lib/__tests__/compactLifecycle.test.ts`
- Create: `src/components/message/CompactLifecycleMessage.tsx`
- Create: `src/components/message/__tests__/compactLifecycleRenderSafety.test.ts`
- Modify: `src/components/message/SystemMessage.tsx`
- Modify: `src/components/message/StreamMessageV2.tsx`
- Modify: `src/components/message/index.ts`
- Modify: `src/components/session/messageHeightEstimate.ts`
- Modify: `src/components/widgets/execution/CommandOutputWidget.tsx`

- [ ] **Step 1: Write failing lifecycle normalization tests**

Cover:

```ts
{ type: 'system', subtype: 'status', status: 'compacting' }
{ type: 'compact_progress', event: { type: 'hooks_start', hookType: 'pre_compact' } }
{ type: 'compact_progress', event: { type: 'compact_start' } }
{ type: 'system', subtype: 'status', status: null,
  metadata: { compactResult: 'failed', compactError: 'summary request failed' } }
{ type: 'system', subtype: 'compact_boundary', compactMetadata: {
  trigger: 'auto', preTokens: 165_132, postTokens: 42_000, durationMs: 1840,
} }
```

Assert phases `scheduled`, `running`, `failed`, and `completed`, source labels, real reduction, duration, and missing metadata fallback.

- [ ] **Step 2: Run normalizer tests and verify RED**

Run: `npx vitest run src/lib/__tests__/compactLifecycle.test.ts`

Expected: FAIL because the normalizer is absent.

- [ ] **Step 3: Implement normalizer and verify GREEN**

Export `getCompactLifecycle(message): CompactLifecycle | null`. Read camelCase and snake_case metadata defensively with O(1) field access.

- [ ] **Step 4: Write failing renderer/routing tests**

Assert `StreamMessageV2` checks the normalizer before generic routing, `SystemMessage` directly handles compact events, the renderer contains horizontal separators and `motion-reduce:animate-none`, and height estimation is compact-specific.

- [ ] **Step 5: Run renderer tests and verify RED**

Run: `npx vitest run src/components/message/__tests__/compactLifecycleRenderSafety.test.ts`

Expected: FAIL because no dedicated renderer exists.

- [ ] **Step 6: Implement the divider**

Use `Archive`, `RefreshCw`, `CheckCircle2`, and `AlertCircle`. Render one responsive content row between two rules with optional metadata below. Running uses `animate-spin motion-reduce:animate-none`; completion shows valid `before -> after`, released tokens, percentage, and duration. Route structured messages before generic content extraction. Keep the old text matcher as a compatibility fallback using the same component.

- [ ] **Step 7: Add stable virtual estimate and verify GREEN**

Return a fixed estimate near 96px for recognized lifecycle messages before generic system estimation.

Run: `npx vitest run src/lib/__tests__/compactLifecycle.test.ts src/components/message/__tests__/compactLifecycleRenderSafety.test.ts src/components/session/__tests__/messageHeightEstimate.test.ts`

Expected: lifecycle, rendering, and height tests pass.

### Task 6: Remove Misleading Legacy Status Polling

**Files:**
- Modify: `src/components/ClaudeStatusIndicator.tsx`
- Create: `src/components/__tests__/claudeStatusAutoCompactSafety.test.ts`

- [ ] **Step 1: Write failing safety test**

Assert `ClaudeStatusIndicator` no longer imports or calls `useAutoCompactStatus` and no longer displays legacy manager counts or estimated post-compact tokens.

- [ ] **Step 2: Run test and verify RED**

Run: `npx vitest run src/components/__tests__/claudeStatusAutoCompactSafety.test.ts`

Expected: FAIL because polling remains.

- [ ] **Step 3: Remove polling and stale status panels**

Delete the hook call, compact popup block, and count badge. Keep installation, version, and cost status unchanged. Timeline and context indicator become the compact status surfaces.

- [ ] **Step 4: Run test and verify GREEN**

Run: `npx vitest run src/components/__tests__/claudeStatusAutoCompactSafety.test.ts`

Expected: no legacy dependency remains.

### Task 7: Integration, Release, and Push

**Files:**
- Modify version files selected by version consistency tooling.
- Delete `Auto Compact TO DO list.csv` after all rows are complete.

- [ ] **Step 1: Run focused tests**

Run all new tests plus existing context, message, and session safety suites. Expected: zero failures.

- [ ] **Step 2: Run full verification**

```powershell
npx vitest run
npm run validate
npm run build
cargo test --manifest-path src-tauri/Cargo.toml auto_compact_defaults -- --nocapture
git diff --check
```

Expected: every command exits 0.

- [ ] **Step 3: Inspect and commit implementation**

Stage only auto-compact implementation, tests, translations, and this plan. Exclude pre-existing session persistence and model-scope edits. Commit:

```text
feat(claude): use native auto-compaction
```

- [ ] **Step 4: Bump patch version**

Update all consistency targets from `5.29.105` to `5.29.106`, run release checks, and commit:

```text
chore(release): bump to 5.29.106
```

- [ ] **Step 5: Push and inspect Actions**

Push `main` to `origin`. Query the newest run with `gh run list --limit 5` and report its name, URL, and current status.
