import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, test } from 'vitest';

const readSource = (relativePath: string) =>
  readFileSync(resolve(process.cwd(), relativePath), 'utf8');

describe('detached session window stream routing contract', () => {
  test('passes the detached window tab id into ClaudeCodeSession so backend stream emits target the window', () => {
    const source = readSource('src/pages/SessionWindow.tsx');

    expect(source).toContain('tabId={state.tabId || undefined}');
  });

  test('threads the stable UI tab id into usePromptExecution routing', () => {
    const source = readSource('src/components/ClaudeCodeSession.tsx');

    expect(source).toContain('routingTabId: tabIdProp');
  });

  test('does not mark Claude session listeners attached before listen promises resolve', () => {
    const source = readSource('src/hooks/usePromptExecution.ts');
    const attachStart = source.indexOf('const attachSessionSpecificListeners = async (sid: string) => {');
    const attachEnd = source.indexOf('async function handleStreamMessage', attachStart);
    const attachBody = source.slice(attachStart, attachEnd);

    const markAttachedIndex = attachBody.indexOf('hasAttachedSessionListeners = true;');
    const outputListenIndex = attachBody.indexOf('const specificOutputUnlisten = await listen');
    const completeListenIndex = attachBody.indexOf('const specificCompleteUnlisten = await listen');

    expect(markAttachedIndex).toBeGreaterThan(outputListenIndex);
    expect(markAttachedIndex).toBeGreaterThan(completeListenIndex);
  });

  test('decides whether a global Claude output is fallback-eligible when the event is received, not later when the queue consumes it', () => {
    const source = readSource('src/hooks/usePromptExecution.ts');
    const genericStart = source.indexOf("const genericOutputUnlisten = await listen<ClaudeGlobalEventPayload<string | string[]>>('claude-output'");
    const genericEnd = source.indexOf('// 🔒 CRITICAL FIX: 全局事件现在格式为 { tab_id: string | null, payload: string }', genericStart + 1);
    const genericBody = source.slice(genericStart, genericEnd);

    const snapshotIndex = genericBody.indexOf('const hadAttachedSessionListenersAtReceive = hasAttachedSessionListeners;');
    const enqueueIndex = genericBody.indexOf('claudeTaskQueue.enqueue(async () => {');
    const routingIndex = genericBody.indexOf('hasAttachedSessionListeners: hadAttachedSessionListenersAtReceive');

    expect(snapshotIndex).toBeGreaterThanOrEqual(0);
    expect(snapshotIndex).toBeLessThan(enqueueIndex);
    expect(routingIndex).toBeGreaterThan(enqueueIndex);
  });
});
