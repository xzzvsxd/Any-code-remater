# Claude Opus 5 Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Claude Opus 5 as the latest native-1M Opus model with consistent selection, aliasing, display, context-window, frontend pricing, and Rust usage accounting.

**Architecture:** Extend the existing static Claude model registry and keep all current consumers intact. Add Opus 5-specific normalization before generic family fallbacks in both TypeScript and Rust, while explicitly preserving the historical `opus1m -> Opus 4.8[1m]` mapping.

**Tech Stack:** React 18, TypeScript 5.9, Vitest 3.2, Rust, Tauri 2.9, Cargo.

---

## File map

- Modify `src/components/FloatingPromptInput/constants.tsx`: Opus family metadata and UI encode/decode aliases.
- Modify `src/components/FloatingPromptInput/__tests__/claudeModelEncoding.test.ts`: registry, native-1M, and legacy alias regression coverage.
- Modify `src/lib/claudeModelSelection.ts`: built-in alias labels and legacy `opus1m` label.
- Modify `src/lib/claudeModelSelection.typecheck.ts`: compile-time/runtime label assertions used by `tsc`.
- Modify `src/lib/pricing.ts`: canonical Opus 5 price entry and frontend model resolver.
- Modify `src/lib/tokenCounter.ts`: Opus 5 token pricing, context window, aliases, and normalization.
- Create `src/lib/__tests__/claudeOpus5Model.test.ts`: cross-layer Opus 5 label/context/pricing tests.
- Modify `src-tauri/src/commands/usage.rs`: Rust model family, parser, price table, and tests.
- Modify only comments in `src/hooks/useContextWindowUsage.ts` and `src/components/widgets/ContextWindowIndicator.tsx` if they describe Opus 4.8 as the latest/native example.

### Task 1: Lock frontend model behavior with failing tests

**Files:**
- Modify: `src/components/FloatingPromptInput/__tests__/claudeModelEncoding.test.ts`
- Create: `src/lib/__tests__/claudeOpus5Model.test.ts`

- [ ] **Step 1: Add registry and encode/decode assertions**

Add these cases to `claudeModelEncoding.test.ts`:

```ts
it('exposes Opus 5 as the latest native-1M Opus version', () => {
  const opus = getModelFamilies().find((family) => family.key === 'opus');
  expect(opus?.versions[0]).toMatchObject({
    id: 'claude-opus-5',
    label: 'Opus 5',
    supports1m: false,
    native1m: true,
    isLatest: true,
  });
  expect(opus?.versions.filter((version) => version.isLatest)).toHaveLength(1);
});

it('never appends [1m] to Opus 5 because 1M is native', () => {
  expect(encodeClaudeModel('claude-opus-5', true)).toBe('claude-opus-5');
});

it('decodes the opus alias to Opus 5', () => {
  expect(decodeClaudeModel('opus')).toEqual({
    versionId: 'claude-opus-5',
    oneMillion: false,
  });
});
```

Keep the existing `opus1m` assertion unchanged so it proves backward compatibility.

- [ ] **Step 2: Add cross-layer label, context, and price tests**

Create `src/lib/__tests__/claudeOpus5Model.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { formatClaudeModelLabel } from '../claudeModelSelection';
import { getPricingForModel } from '../pricing';
import { getContextWindowSize, getModelPricing } from '../tokenCounter';

const expectedPricing = {
  input: 5,
  output: 25,
  cacheWrite: 6.25,
  cacheRead: 0.5,
};

describe('Claude Opus 5 support', () => {
  it('formats current and legacy Opus aliases correctly', () => {
    expect(formatClaudeModelLabel('opus')).toBe('Claude Opus 5');
    expect(formatClaudeModelLabel('claude-opus-5')).toBe('Claude Opus 5');
    expect(formatClaudeModelLabel('opus1m')).toBe('Claude Opus 4.8 1M');
  });

  it.each(['claude-opus-5', 'opus', 'opus5', 'opus-5'])(
    'treats %s as native 1M',
    (model) => expect(getContextWindowSize(model, 'claude')).toBe(1_000_000),
  );

  it.each([
    'claude-opus-5',
    'opus',
    'opus5',
    'opus-5',
    'anthropic.claude-opus-5',
    'claude-opus-5@20260724',
  ])('uses Opus 5 pricing for %s', (model) => {
    expect(getPricingForModel(model, 'claude')).toEqual(expectedPricing);
  });

  it('keeps token-counter pricing aligned with frontend pricing', () => {
    expect(getModelPricing('claude-opus-5')).toMatchObject({
      input: 5,
      output: 25,
      cache_write: 6.25,
      cache_read: 0.5,
    });
  });

  it('keeps explicit Opus 4.8 and opus1m on their historical model identity', () => {
    expect(formatClaudeModelLabel('claude-opus-4-8')).toBe('Claude Opus 4.8');
    expect(getContextWindowSize('opus1m', 'claude')).toBe(1_000_000);
  });
});
```

- [ ] **Step 3: Run frontend tests and verify RED**

Run:

```powershell
npx vitest run src/components/FloatingPromptInput/__tests__/claudeModelEncoding.test.ts src/lib/__tests__/claudeOpus5Model.test.ts
```

Expected: failures show Opus 4.8 is still latest, `opus` labels/resolves to Opus 4.8, and `claude-opus-5` lacks explicit 1M and price entries.

### Task 2: Implement frontend selection, aliases, context, and pricing

**Files:**
- Modify: `src/components/FloatingPromptInput/constants.tsx`
- Modify: `src/lib/claudeModelSelection.ts`
- Modify: `src/lib/claudeModelSelection.typecheck.ts`
- Modify: `src/lib/pricing.ts`
- Modify: `src/lib/tokenCounter.ts`
- Modify: `src/hooks/useContextWindowUsage.ts`
- Modify: `src/components/widgets/ContextWindowIndicator.tsx`

- [ ] **Step 1: Register Opus 5 and preserve the legacy 1M alias**

Add this as the first Opus version and remove `isLatest` from Opus 4.8:

```ts
{
  id: 'claude-opus-5',
  label: 'Opus 5',
  description: 'For complex agentic coding and enterprise work',
  supports1m: false,
  native1m: true,
  isLatest: true,
},
```

Add an explicit decoder guard beside the existing `sonnet1m` guard:

```ts
if (lower === 'opus' && /opus1m/i.test(raw)) {
  return { versionId: 'claude-opus-4-8', oneMillion: true };
}
```

- [ ] **Step 2: Update built-in labels without changing `opus1m`**

Set the Opus default label to `Claude Opus 5` and handle legacy aliases separately:

```ts
const DEFAULT_BUILT_IN_LABELS: Record<string, string> = {
  fable: 'Claude Fable 5',
  sonnet: 'Claude Sonnet 4.6',
  opus: 'Claude Opus 5',
};

if (lower === 'opus1m') return 'Claude Opus 4.8 1M';
```

Update `claudeModelSelection.typecheck.ts` to assert `opus` and `claude-opus-5` show Opus 5 while `opus1m` shows Opus 4.8 1M.

- [ ] **Step 3: Add canonical frontend pricing and resolver branches**

Add this key to both TypeScript price tables:

```ts
'claude-opus-5': {
  input: 5.0,
  output: 25.0,
  cacheWrite: 6.25,
  cacheRead: 0.50,
},
```

Use snake_case cache fields in `CLAUDE_PRICING`. Add an Opus 5 resolver after specific Opus 4.x branches:

```ts
if (
  normalized === 'opus' ||
  /opus-?5\b/.test(normalized) ||
  /claude-opus-5/.test(normalized)
) {
  return MODEL_PRICING['claude-opus-5'];
}
```

Change the generic Opus price fallback to `claude-opus-5`.

- [ ] **Step 4: Add native context and aliases**

Add:

```ts
'claude-opus-5': 1_000_000,
```

Change/add aliases:

```ts
'opus': 'claude-opus-5',
'opus1m': 'claude-opus-4-8[1m]',
'opus5': 'claude-opus-5',
'opus-5': 'claude-opus-5',
```

In `TokenCounterService.normalizeModel`, recognize Opus 5 after exact 4.x versions and change the generic Opus fallback to Opus 5.

- [ ] **Step 5: Run frontend tests and verify GREEN**

Run:

```powershell
npx vitest run src/components/FloatingPromptInput/__tests__/claudeModelEncoding.test.ts src/lib/__tests__/claudeOpus5Model.test.ts src/lib/__tests__/claudeFableModel.test.ts
```

Expected: all selected tests pass with zero failures.

### Task 3: Lock and implement Rust usage accounting

**Files:**
- Modify: `src-tauri/src/commands/usage.rs`

- [ ] **Step 1: Add failing Rust tests**

Add tests inside the existing `tests` module:

```rust
#[test]
fn opus5_pricing_matches_current_claude_model_table() {
    let pricing = ModelPricing::for_family(ModelFamily::Opus5);
    assert_eq!(pricing.input, 5.0);
    assert_eq!(pricing.output, 25.0);
    assert_eq!(pricing.cache_write, 6.25);
    assert_eq!(pricing.cache_read, 0.50);
}

#[test]
fn opus5_model_formats_resolve_without_reclassifying_opus48() {
    for model in [
        "claude-opus-5",
        "anthropic.claude-opus-5",
        "claude-opus-5@20260724",
        "opus",
    ] {
        assert_eq!(parse_model_family(model), ModelFamily::Opus5);
    }
    assert_eq!(parse_model_family("claude-opus-4-8"), ModelFamily::Opus48);
}
```

- [ ] **Step 2: Run Rust tests and verify RED**

Run:

```powershell
cargo test commands::usage::tests
```

Expected: compilation fails because `ModelFamily::Opus5` does not exist.

- [ ] **Step 3: Add the Opus5 family, price, and parser**

Add `Opus5` to `ModelFamily`, return the official price in `ModelPricing::for_family`, recognize Opus 5 after the explicit 4.x branches, and change the generic Opus fallback:

```rust
if normalized == "opus"
    || normalized.contains("opus5")
    || normalized.contains("opus-5")
{
    return ModelFamily::Opus5;
}
```

Cloud prefixes and Vertex suffixes are already normalized before this branch.

- [ ] **Step 4: Run Rust tests and verify GREEN**

Run:

```powershell
cargo test commands::usage::tests
```

Expected: five usage tests pass, zero fail.

### Task 4: Full regression verification

**Files:**
- Verify all modified source and test files.

- [ ] **Step 1: Run all frontend tests**

```powershell
npx vitest run
```

Expected: every Vitest file passes.

- [ ] **Step 2: Run TypeScript and production build checks**

```powershell
npm run typecheck
npm run build
```

Expected: both commands exit 0.

- [ ] **Step 3: Run Rust tests and compile check**

```powershell
cargo test commands::usage::tests
cargo check
```

Expected: both commands exit 0; existing dead-code warnings are acceptable.

- [ ] **Step 4: Audit diff and requirement coverage**

```powershell
git diff --check
git status --short
git diff -- src/components/FloatingPromptInput/constants.tsx src/lib/claudeModelSelection.ts src/lib/pricing.ts src/lib/tokenCounter.ts src-tauri/src/commands/usage.rs
```

Expected: no whitespace errors, no generated artifacts, no edits outside the planned Opus 5 surface.

### Task 5: Commit the implementation

**Files:**
- Commit the plan, tests, and implementation files only.

- [ ] **Step 1: Stage the reviewed files**

```powershell
git add docs/superpowers/plans/2026-07-25-claude-opus-5-support.md src/components/FloatingPromptInput/constants.tsx src/components/FloatingPromptInput/__tests__/claudeModelEncoding.test.ts src/lib/__tests__/claudeOpus5Model.test.ts src/lib/claudeModelSelection.ts src/lib/claudeModelSelection.typecheck.ts src/lib/pricing.ts src/lib/tokenCounter.ts src/hooks/useContextWindowUsage.ts src/components/widgets/ContextWindowIndicator.tsx src-tauri/src/commands/usage.rs
```

- [ ] **Step 2: Verify the staged scope**

```powershell
git diff --cached --check
git diff --cached --name-only
```

Expected: only the listed Opus 5 plan, tests, and source files are staged.

- [ ] **Step 3: Commit**

```powershell
git commit -m "feat(models): add Claude Opus 5"
```

Expected: commit succeeds on `codex/claude-opus-5`.

