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

  test('CLI processing indicator receives timestamps but does not run a text refresh clock', () => {
    expect(cliProcessingIndicatorSource).toContain('startedAt?: number | null');
    expect(cliProcessingIndicatorSource).toContain('lastOutputAt?: number | null');
    expect(cliProcessingIndicatorSource).toContain('elapsedSeconds?: number');
    expect(cliProcessingIndicatorSource).toContain('idleSeconds?: number');
  });

  test('CLI processing indicator has no React interval-driven status text churn', () => {
    expect(cliProcessingIndicatorSource).not.toContain('setClockTick');
    expect(cliProcessingIndicatorSource).not.toContain('setInterval');
    expect(cliProcessingIndicatorSource).not.toContain('dotInterval');
    expect(cliProcessingIndicatorSource).not.toContain('verbInterval');
    expect(cliProcessingIndicatorSource).not.toContain('setVerbIndex');
    expect(cliProcessingIndicatorSource).toContain('cli-processing-spark');
    expect(cliProcessingIndicatorSource).toContain('cli-processing-progress');
  });

  test('floating prompt status copy does not own a React timer but keeps loader animation', () => {
    expect(floatingPromptInputSource).toContain('const ProcessingStatusCopy');
    const statusCopyBody = floatingPromptInputSource.slice(
      floatingPromptInputSource.indexOf('const ProcessingStatusCopy'),
      floatingPromptInputSource.indexOf('const NOOP_CANCEL_HANDLER'),
    );
    expect(statusCopyBody).not.toContain('setClockTick');
    expect(statusCopyBody).not.toContain('setInterval');
    expect(floatingPromptInputSource).toContain('executionStatus.lastOutputAt');
    expect(floatingPromptInputSource).toContain('animate-spin text-amber-500');
  });

  test('send-to-latest and deferred prompt navigation timers are cancelled on cleanup', () => {
    expect(claudeCodeSessionSource).toContain('sendJumpTimeoutRef');
    expect(claudeCodeSessionSource).toContain('pendingPromptNavRafRef');
    expect(claudeCodeSessionSource).toContain('window.clearTimeout(sendJumpTimeoutRef.current)');
    expect(claudeCodeSessionSource).toContain('cancelAnimationFrame(pendingPromptNavRafRef.current)');
  });
});
