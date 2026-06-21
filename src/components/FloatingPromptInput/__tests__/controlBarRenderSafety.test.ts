import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const controlBarSource = readFileSync(
  resolve(process.cwd(), 'src/components/FloatingPromptInput/ControlBar.tsx'),
  'utf8',
);

const contextIndicatorSource = readFileSync(
  resolve(process.cwd(), 'src/components/widgets/ContextWindowIndicator.tsx'),
  'utf8',
);

describe('control bar render safety', () => {
  test('freezes passive message widgets while streaming', () => {
    expect(controlBarSource).toContain('messagesForPassiveWidgets');
    expect(controlBarSource).toContain('isLoading ? passiveMessagesRef.current : messages');
    expect(controlBarSource).toContain('messages={messagesForPassiveWidgets}');
  });

  test('memo comparator ignores streaming message churn for passive controls', () => {
    expect(controlBarSource).toContain('areControlBarPropsEqual');
    expect(controlBarSource).toContain('prev.isLoading && next.isLoading');
    expect(controlBarSource).toContain('messagesEqual');
    expect(controlBarSource).toContain('React.memo(ControlBarComponent, areControlBarPropsEqual)');
  });

  test('does not use motion or pulse animations in always-visible streaming controls', () => {
    expect(controlBarSource).not.toContain('framer-motion');
    expect(contextIndicatorSource).not.toContain('framer-motion');
    expect(contextIndicatorSource).not.toContain('animate-pulse');
    expect(contextIndicatorSource).toContain('React.memo');
  });
});
