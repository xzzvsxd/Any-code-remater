import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';

const readSource = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('Claude native auto-compact execution ownership', () => {
  test('application startup does not launch the legacy polling executor', () => {
    const main = readSource('src-tauri/src/main.rs');
    expect(main).toContain('ensure_claude_auto_compact_defaults');
    expect(main).not.toMatch(/manager_for_monitor[\s\S]*start_monitoring/);
  });

  test('Claude output no longer feeds the legacy manager', () => {
    const runner = readSource('src-tauri/src/commands/claude/cli_runner.rs');
    expect(runner).not.toContain('auto_compact_available');
    expect(runner).not.toContain('update_session_tokens');
    expect(runner).not.toContain('register_session(');
    expect(runner).toContain('Some("init" | "status" | "compact_boundary")');
  });

  test('persistent streaming emits native compact control messages immediately', () => {
    const streaming = readSource('src-tauri/src/commands/claude/streaming.rs');
    expect(streaming).toContain('mtype == "compact_progress"');
    expect(streaming).toContain('Some("init" | "status" | "compact_boundary")');
  });

  test('status indicator does not poll the retired auto-compact manager', () => {
    const indicator = readSource('src/components/ClaudeStatusIndicator.tsx');
    expect(indicator).not.toContain('useAutoCompactStatus');
    expect(indicator).not.toContain('autoCompactStatus');
  });
});
