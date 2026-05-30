import { persistUiOnlySessionMessage, loadUiOnlySessionMessages, mergeUiOnlySessionMessages } from '../src/lib/uiOnlySessionEvents.js';
import type { ClaudeStreamMessage } from '../src/types/claude';

class MemoryStorage {
  private store = new Map<string, string>();
  getItem(key: string): string | null {
    return this.store.has(key) ? this.store.get(key)! : null;
  }
  setItem(key: string, value: string): void {
    this.store.set(key, value);
  }
  removeItem(key: string): void {
    this.store.delete(key);
  }
}

const expect = (condition: boolean, label: string) => {
  if (!condition) {
    throw new Error(label);
  }
};

const storage = new MemoryStorage();
const errorMessage: ClaudeStreamMessage = {
  type: 'system',
  subtype: 'execution-error',
  result: 'Upstream failed with a visible diagnostic',
  engine: 'claude',
  timestamp: '2026-05-31T00:00:00.000Z',
  receivedAt: '2026-05-31T00:00:00.000Z',
};

const persisted = persistUiOnlySessionMessage({
  sessionId: 'session-1',
  projectPath: 'D:/Any-code-remater',
  engine: 'claude',
  message: errorMessage,
  storage,
});
expect(persisted, 'ui-only error should persist');

const loaded = loadUiOnlySessionMessages({
  sessionId: 'session-1',
  projectPath: 'D:/Any-code-remater',
  engine: 'claude',
  storage,
});
expect(loaded.length === 1, 'ui-only error should reload');
expect(loaded[0].result === errorMessage.result, 'visible upstream error details should round-trip');
expect((loaded[0] as any).uiOnly === true, 'loaded ui-only messages must be marked uiOnly');
expect((loaded[0] as any).excludeFromAiContext === true, 'loaded ui-only messages must be excluded from AI context');

const history: ClaudeStreamMessage[] = [
  {
    type: 'assistant',
    message: { role: 'assistant', content: [{ type: 'text', text: 'history' }] },
    timestamp: '2026-05-31T00:00:01.000Z',
  },
];
const merged = mergeUiOnlySessionMessages(history, loaded);
expect(merged.length === 2, 'history should merge with ui-only errors');
expect(merged.some((msg: ClaudeStreamMessage) => msg.result === errorMessage.result), 'merged messages should include visible upstream error');

console.log('ui-only session events verification passed');
