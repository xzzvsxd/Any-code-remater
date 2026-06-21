import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';

const askDialog = readFileSync('src/components/dialogs/AskUserQuestionDialog.tsx', 'utf8');
const planDialog = readFileSync('src/components/dialogs/PlanApprovalDialog.tsx', 'utf8');
const userQuestionContext = readFileSync('src/contexts/UserQuestionContext.tsx', 'utf8');
const planModeContext = readFileSync('src/contexts/PlanModeContext.tsx', 'utf8');
const claudeSession = readFileSync('src/components/ClaudeCodeSession.tsx', 'utf8');
const askBridge = readFileSync('src-tauri/src/commands/claude/ask_user_bridge.rs', 'utf8');

describe('interaction dialogs UX wiring', () => {
  test('AskUserQuestion dialog shows session title, deadline countdown and defer response action', () => {
    expect(askDialog).toContain('sessionTitle?: string');
    expect(askDialog).toContain('expiresAtMs?: number');
    expect(askDialog).toContain('onDeferResponse?: () => void');
    expect(askDialog).toContain('formatInteractionCountdown');
    expect(askDialog).toContain('当前会话');
    expect(askDialog).toContain('暂时没想好，暂时不回答');
  });

  test('PlanApproval dialog shows session title, deadline countdown and no-decision action', () => {
    expect(planDialog).toContain('sessionTitle?: string');
    expect(planDialog).toContain('expiresAtMs?: number');
    expect(planDialog).toContain('onDeferDecision?: () => void');
    expect(planDialog).toContain('formatInteractionCountdown');
    expect(planDialog).toContain('当前会话');
    expect(planDialog).toContain('暂不决定，先别执行');
  });

  test('PlanApproval dialog reserves a non-overlapping bottom guidance area', () => {
    expect(planDialog).toContain('max-h-[88vh] flex flex-col gap-0 p-0 overflow-hidden');
    expect(planDialog).toContain('flex-1 min-h-0 px-5 py-4 flex flex-col');
    expect(planDialog).toContain('shrink-0 border-t border-border/60');
    expect(planDialog).not.toContain('h-[300px] rounded-lg border bg-muted/30 p-4');
  });

  test('bridge contexts can resolve blocking requests without approving or answering content', () => {
    expect(userQuestionContext).toContain('expiresAtMs?: number');
    expect(userQuestionContext).toContain('deferQuestionResponse');
    expect(userQuestionContext).toContain('用户暂时没想好，暂时不回答');
    expect(planModeContext).toContain('expiresAtMs?: number');
    expect(planModeContext).toContain('deferPlanDecision');
    expect(planModeContext).toContain('用户暂时未决定是否批准该计划');
  });

  test('Claude session passes interaction title/deadline metadata from backend events to dialogs', () => {
    expect(claudeSession).toContain('timeoutSeconds');
    expect(claudeSession).toContain('expiresAtMs');
    expect(claudeSession).toContain('interactionSessionTitle');
    expect(claudeSession).toContain('sessionTitle={interactionSessionTitle}');
    expect(claudeSession).toContain('expiresAtMs={pendingQuestion?.expiresAtMs}');
    expect(claudeSession).toContain('expiresAtMs={pendingApproval?.expiresAtMs}');
  });

  test('backend ask bridge emits explicit deadline metadata', () => {
    expect(askBridge).toContain('timeoutSeconds');
    expect(askBridge).toContain('expiresAtMs');
    expect(askBridge).toContain('ASK_TIMEOUT_SECS');
  });
});
