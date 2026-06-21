import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const claudeCodeSessionSource = readFileSync(
  resolve(process.cwd(), 'src/components/ClaudeCodeSession.tsx'),
  'utf8',
);

const cliProcessingIndicatorSource = readFileSync(
  resolve(process.cwd(), 'src/components/session/CliProcessingIndicator.tsx'),
  'utf8',
);

const floatingPromptInputSource = readFileSync(
  resolve(process.cwd(), 'src/components/FloatingPromptInput/index.tsx'),
  'utf8',
);

describe('processing clock render isolation', () => {
  test('ClaudeCodeSession does not tick every second and re-render the full message tree', () => {
    expect(claudeCodeSessionSource).not.toContain('executionClockTick');
    expect(claudeCodeSessionSource).not.toContain('setExecutionClockTick');
  });

  test('ClaudeCodeSession resets idle clock for same-length tail replacements', () => {
    expect(claudeCodeSessionSource).toContain('getMessageActivityKey');
    expect(claudeCodeSessionSource).toContain('const lastMessageActivityKey = useMemo(');
    expect(claudeCodeSessionSource).toContain('[lastMessageActivityKey, isLoading]');
    expect(claudeCodeSessionSource).not.toContain('[messages.length, isLoading]');
  });

  test('CLI processing indicator derives live time from stable timestamps locally', () => {
    expect(cliProcessingIndicatorSource).toContain('startedAt?: number | null');
    expect(cliProcessingIndicatorSource).toContain('lastOutputAt?: number | null');
    expect(cliProcessingIndicatorSource).toContain('liveElapsedSeconds');
    expect(cliProcessingIndicatorSource).toContain('liveIdleSeconds');
  });

  test('CLI processing indicator uses one low-frequency clock and no text animation intervals', () => {
    expect(cliProcessingIndicatorSource).toContain('setClockTick');
    expect(cliProcessingIndicatorSource).toContain('}, 2000);');
    expect(cliProcessingIndicatorSource).not.toContain('dotInterval');
    expect(cliProcessingIndicatorSource).not.toContain('verbInterval');
    expect(cliProcessingIndicatorSource).not.toContain('setVerbIndex');
  });

  test('floating prompt status copy owns its own lightweight clock', () => {
    expect(floatingPromptInputSource).toContain('const ProcessingStatusCopy');
    expect(floatingPromptInputSource).toContain('setClockTick');
    expect(floatingPromptInputSource).toContain('}, 2000);');
    expect(floatingPromptInputSource).toContain('executionStatus.lastOutputAt');
    expect(floatingPromptInputSource).not.toContain('h-4 w-4 flex-shrink-0 animate-spin text-amber-500');
  });

  test('send-to-latest and deferred prompt navigation timers are cancelled on cleanup', () => {
    expect(claudeCodeSessionSource).toContain('sendJumpTimeoutRef');
    expect(claudeCodeSessionSource).toContain('pendingPromptNavRafRef');
    expect(claudeCodeSessionSource).toContain('window.clearTimeout(sendJumpTimeoutRef.current)');
    expect(claudeCodeSessionSource).toContain('cancelAnimationFrame(pendingPromptNavRafRef.current)');
  });
});
