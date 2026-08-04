import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';

const source = readFileSync('src/components/ClaudeCodeSession.tsx', 'utf8');

describe('ClaudeCodeSession background render safety', () => {
  test('uses Unix seconds for synthetic session metadata', () => {
    expect(source).toContain('created_at: Math.floor(Date.now() / 1000)');
  });

  test('inactive tabs do not feed full message history into expensive visible-message rendering hooks', () => {
    expect(source).toContain('EMPTY_VISIBLE_MESSAGES');
    expect(source).toContain('const visibleMessages = isActive ? messages : EMPTY_VISIBLE_MESSAGES');
    expect(source).toContain('useSessionCostCalculation(visibleMessages');
    expect(source).toContain('useDisplayableMessages(visibleMessages');
    expect(source).toContain('usePromptIndexMaps(visibleMessages');
    expect(source).toContain('messages={visibleMessages}');
  });

  test('streaming message churn does not re-register stable prompt callbacks', () => {
    expect(source).toContain('messagesRef.current');
    expect(source).toContain('messages: messagesRef.current');
    expect(source).toContain('SessionHelpers.getConversationContext(messagesRef.current)');
    expect(source).not.toContain('resolveAutoContinuationModel = useCallback((): ModelType => {\n    return resolveClaudeContinuationModel({\n      requestedModel: \'sonnet\',\n      sessionModel: effectiveSession?.model || session?.model,\n      messages,');
  });

  test('remeasures every returning tab before existing-session-only reconnect work', () => {
    const activationEffectStart = source.indexOf('// 🔧 FIX: When a tab becomes active (visible)');
    const activationEffectEnd = source.indexOf('// ✅ Keyboard shortcuts', activationEffectStart);
    const activationEffect = source.slice(activationEffectStart, activationEffectEnd);
    const activeGuardIndex = activationEffect.indexOf('if (!isActive) return');
    const remeasureIndex = activationEffect.indexOf('sessionMessagesRef.current?.remeasureViewport()');
    const sessionGuardIndex = activationEffect.indexOf('if (!session) return');

    expect(activationEffectStart).toBeGreaterThanOrEqual(0);
    expect(activeGuardIndex).toBeGreaterThanOrEqual(0);
    expect(remeasureIndex).toBeGreaterThan(activeGuardIndex);
    expect(sessionGuardIndex).toBeGreaterThan(remeasureIndex);
  });

  test('keeps portaled interaction dialogs hidden while their conversation workspace is hidden', () => {
    expect(source).toContain('open={isActive && showApprovalDialog}');
    expect(source).toContain('open={isActive && showQuestionDialog}');
  });
});
