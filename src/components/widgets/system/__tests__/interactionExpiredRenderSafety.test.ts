import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';

const askWidgetSource = readFileSync('src/components/widgets/system/AskUserQuestionWidget.tsx', 'utf8');
const planWidgetSource = readFileSync('src/components/widgets/system/PlanModeWidget.tsx', 'utf8');

describe('expired bridge interaction render safety', () => {
  test('AskUserQuestion widget has a first-class expired state instead of treating timeout as pending/error', () => {
    expect(askWidgetSource).toContain("bridgeResultStatus === 'expired'");
    expect(askWidgetSource).toContain('widget.answerExpired');
    expect(askWidgetSource).toContain('widget.answerExpiredDesc');
    expect(askWidgetSource).toContain('bridgeExpired');
  });

  test('PlanMode widget has a first-class expired state instead of staying in waiting approval', () => {
    expect(planWidgetSource).toContain("planStatus === 'expired'");
    expect(planWidgetSource).toContain('promptInput.planExpired');
    expect(planWidgetSource).toContain('widget.planExpiredWaiting');
    expect(planWidgetSource).toContain('isExpired');
  });
});
