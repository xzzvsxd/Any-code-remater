import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';

const sessionMessagesSource = readFileSync(
  resolve(process.cwd(), 'src/components/session/SessionMessages.tsx'),
  'utf8',
);

const messageBubbleSource = readFileSync(
  resolve(process.cwd(), 'src/components/message/MessageBubble.tsx'),
  'utf8',
);

const heightEstimateSource = readFileSync(
  resolve(process.cwd(), 'src/components/session/messageHeightEstimate.ts'),
  'utf8',
);

const cliProcessingIndicatorSource = readFileSync(
  resolve(process.cwd(), 'src/components/session/CliProcessingIndicator.tsx'),
  'utf8',
);

const toolsListSource = readFileSync(
  resolve(process.cwd(), 'src/components/widgets/system/components/ToolsList.tsx'),
  'utf8',
);

describe('session message virtualization safety', () => {
  test('does not layer a custom ResizeObserver on top of TanStack Virtual row measurement', () => {
    expect(sessionMessagesSource).not.toContain('new ResizeObserver');
    expect(sessionMessagesSource).toContain('ref={measureElement}');
    expect(sessionMessagesSource).toContain('useAnimationFrameWithResizeObserver: true');
  });

  test('positions virtual rows with compositor-friendly transforms instead of top offsets', () => {
    expect(sessionMessagesSource).toContain('transform: `translateY(${virtualItem.start}px)`');
    expect(sessionMessagesSource).not.toContain('top: virtualItem.start');
  });

  test('virtualized message rows do not replay framer-motion enter animations while scrolling history', () => {
    expect(messageBubbleSource).not.toContain('from "framer-motion"');
    expect(messageBubbleSource).not.toContain('<motion.div');
  });

  test('keeps overscan conservative so Linux history top scrolling does not mount too many heavy rows', () => {
    expect(heightEstimateSource).toContain('export const SESSION_MESSAGES_OVERSCAN = 4;');
  });

  test('bottom processing indicator avoids per-frame JS motion inside the scroll container', () => {
    expect(cliProcessingIndicatorSource).not.toContain('framer-motion');
    expect(cliProcessingIndicatorSource).not.toContain('<motion.');
    expect(cliProcessingIndicatorSource).not.toContain('<AnimatePresence');
  });

  test('bottom processing indicator avoids continuous pulse animations on Linux WebKit', () => {
    expect(cliProcessingIndicatorSource).not.toContain('animate-pulse');
  });

  test('bottom processing indicator avoids sub-second text timer churn', () => {
    expect(cliProcessingIndicatorSource).not.toContain('}, 400);');
  });

  test('system init tools list avoids per-tool svg icons in Linux scroll containers', () => {
    expect(toolsListSource).not.toContain('<Icon className=');
    expect(toolsListSource).not.toContain('getToolIcon(tool)');
  });

  test('top and prompt scroll follow-up timers are cancellable on unmount or session change', () => {
    expect(sessionMessagesSource).toContain('topScrollTimeoutsRef');
    expect(sessionMessagesSource).toContain('cancelTopScrollFollowUps');
    expect(sessionMessagesSource).toContain('clearTimeout(timeoutId)');
  });

  test('scroll container error state avoids framer-motion inside virtualized history', () => {
    expect(sessionMessagesSource).not.toContain('from "framer-motion"');
    expect(sessionMessagesSource).not.toContain('<motion.div');
  });
});
