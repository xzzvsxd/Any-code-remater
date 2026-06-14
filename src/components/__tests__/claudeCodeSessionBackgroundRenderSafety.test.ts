import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';

const source = readFileSync('src/components/ClaudeCodeSession.tsx', 'utf8');

describe('ClaudeCodeSession background render safety', () => {
  test('inactive tabs do not feed full message history into expensive visible-message rendering hooks', () => {
    expect(source).toContain('EMPTY_VISIBLE_MESSAGES');
    expect(source).toContain('const visibleMessages = isActive ? messages : EMPTY_VISIBLE_MESSAGES');
    expect(source).toContain('useSessionCostCalculation(visibleMessages');
    expect(source).toContain('useDisplayableMessages(visibleMessages');
    expect(source).toContain('buildPromptIndexByMessage(visibleMessages');
    expect(source).toContain('messages={visibleMessages}');
  });
});
