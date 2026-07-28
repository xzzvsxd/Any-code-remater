import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const promptExecutionSource = readFileSync(
  resolve(process.cwd(), 'src/hooks/usePromptExecution.ts'),
  'utf8',
);

describe('prompt execution terminal event safety', () => {
  test('guards completion and error handlers so duplicate terminal events cannot advance the queued prompt twice', () => {
    expect(promptExecutionSource).toContain('createTerminalEventGate');
    expect(promptExecutionSource).toContain('const terminalEventGate = createTerminalEventGate()');

    const terminalGuardUsages = promptExecutionSource.match(/terminalEventGate\.tryStart\(/g) ?? [];
    expect(terminalGuardUsages.length).toBeGreaterThanOrEqual(6);
  });

  test('self-heals Claude completion from result stream messages via a deferred fallback, not an immediate teardown', () => {
    expect(promptExecutionSource).toContain('isClaudeResultMessage');
    expect(promptExecutionSource).toContain('isPotentialClaudeGlobalControlLine');
    // result 行不再直接 processComplete（那会在进程仍在收尾时提前撕监听器/停止刷新），
    // 而是安排一个延迟兜底看门狗；权威收尾由进程退出的 claude-complete 事件驱动。
    expect(promptExecutionSource).toContain('scheduleClaudeResultFallbackComplete');
    expect(promptExecutionSource).toMatch(
      /isClaudeResultMessage\(message\)[\s\S]{0,220}scheduleClaudeResultFallbackComplete\(processComplete\)/,
    );
    // 看门狗必须在权威收尾/错误收尾时被清理，避免重复触发或定时器泄漏。
    expect(promptExecutionSource).toContain('clearClaudeResultWatchdog');
  });

  test('releases Claude runtime state before optional prompt bookkeeping can stall', () => {
    const completionStart = promptExecutionSource.indexOf('const processComplete = async () =>');
    const completionEnd = promptExecutionSource.indexOf('const processClaudeError', completionStart);
    const completionSource = promptExecutionSource.slice(completionStart, completionEnd);
    const loadingReleaseIndex = completionSource.indexOf('setIsLoading(false)');
    const promptBookkeepingAwaitIndex = completionSource.indexOf('await pendingClaudePromptRecordingPromise');

    expect(completionStart).toBeGreaterThanOrEqual(0);
    expect(completionEnd).toBeGreaterThan(completionStart);
    expect(loadingReleaseIndex).toBeGreaterThanOrEqual(0);
    expect(promptBookkeepingAwaitIndex).toBeGreaterThanOrEqual(0);
    expect(loadingReleaseIndex).toBeLessThan(promptBookkeepingAwaitIndex);
  });
});
