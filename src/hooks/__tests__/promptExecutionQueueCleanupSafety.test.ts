import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const promptExecutionSource = readFileSync(
  resolve(process.cwd(), 'src/hooks/usePromptExecution.ts'),
  'utf8',
);

describe('prompt execution task queue cleanup safety', () => {
  test('drains per-run async task queues when API startup throws after listeners are installed', () => {
    expect(promptExecutionSource).toContain('const activeTaskQueues: Array<{ done: () => void }> = []');

    const queueRegistrations = promptExecutionSource.match(/activeTaskQueues\.push\(/g) ?? [];
    expect(queueRegistrations.length).toBeGreaterThanOrEqual(3);

    expect(promptExecutionSource).toContain('activeTaskQueues.forEach(queue => queue.done())');
  });

  test('registers runtime unlisteners immediately as each listener is installed', () => {
    expect(promptExecutionSource).toContain('const registerRuntimeUnlisten = useCallback(');

    const immediateRegistrations = promptExecutionSource.match(/registerRuntimeUnlisten\(await listen/g) ?? [];
    expect(immediateRegistrations.length).toBeGreaterThanOrEqual(12);
  });

  test('cleans partially installed session-specific listeners if attach fails', () => {
    expect(promptExecutionSource).toContain('const safeRuntimeUnlisten = useCallback(');

    const sessionAttachCreationGuards = promptExecutionSource.match(/const createdSessionUnlisteners: UnlistenFn\[\] = \[\]/g) ?? [];
    expect(sessionAttachCreationGuards.length).toBeGreaterThanOrEqual(3);

    const partialAttachCleanups = promptExecutionSource.match(/createdSessionUnlisteners\.forEach\(safeRuntimeUnlisten\)/g) ?? [];
    expect(partialAttachCleanups.length).toBeGreaterThanOrEqual(3);
  });
});
