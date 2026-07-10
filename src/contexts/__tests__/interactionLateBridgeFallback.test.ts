import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';

const userQuestionContextSource = readFileSync('src/contexts/UserQuestionContext.tsx', 'utf8');
const askWidgetSource = readFileSync('src/components/widgets/system/AskUserQuestionWidget.tsx', 'utf8');
const planModeContextSource = readFileSync('src/contexts/PlanModeContext.tsx', 'utf8');
const planWidgetSource = readFileSync('src/components/widgets/system/PlanModeWidget.tsx', 'utf8');

describe('late bridge interaction fallback state', () => {
  test('ask-user late answers are kept as local snapshots so the original widget can render them after timeout fallback', () => {
    expect(userQuestionContextSource).toContain('bridgeAnswerSnapshots');
    expect(userQuestionContextSource).toContain('getBridgeAnswerSnapshot');
    expect(userQuestionContextSource).toContain('setBridgeAnswerSnapshots');
    expect(askWidgetSource).toContain('getBridgeAnswerSnapshot');
    expect(askWidgetSource).toContain('bridgeAnswerSnapshot');
  });

  test('plan late decisions are mirrored to content keyed status and sent as fallback when bridge is already gone', () => {
    expect(planModeContextSource).toContain('deferredPlanIds');
    expect(planModeContextSource).toContain('getPlanId(plan)');
    expect(planModeContextSource).toContain('!hit && sendPromptCallbackRef.current');
    expect(planWidgetSource).toContain('getPlanStatus(getPlanId(plan))');
  });
});
