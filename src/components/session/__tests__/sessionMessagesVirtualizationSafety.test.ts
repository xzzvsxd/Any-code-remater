import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';

const sessionMessagesSource = readFileSync(
  resolve(process.cwd(), 'src/components/session/SessionMessages.tsx'),
  'utf8',
);

const thinkingBlockSource = readFileSync(
  resolve(process.cwd(), 'src/components/message/ThinkingBlock.tsx'),
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

  test('bottom processing indicator keeps explicit low-cost progress animation', () => {
    expect(cliProcessingIndicatorSource).not.toContain('animate-pulse');
    expect(cliProcessingIndicatorSource).toContain('cli-processing-spark');
    expect(cliProcessingIndicatorSource).toContain('cli-processing-progress');
  });

  test('bottom processing indicator avoids sub-second text timer churn', () => {
    expect(cliProcessingIndicatorSource).not.toContain('}, 400);');
  });

  test('system init tools list avoids per-tool svg icons in Linux scroll containers', () => {
    expect(toolsListSource).not.toContain('<Icon className=');
    expect(toolsListSource).not.toContain('getToolIcon(tool)');
  });

  test('system init tools list keeps regular tools bounded on initial top-row mount', () => {
    expect(toolsListSource).toContain('REGULAR_TOOL_PREVIEW_COUNT');
    expect(toolsListSource).toContain('displayedRegularTools');
    expect(toolsListSource).toContain('hiddenRegularToolCount');
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

  test('collapsed thinking rows invalidate stale virtual height cache and remeasure the list', () => {
    expect(thinkingBlockSource).toContain('SESSION_MESSAGE_LAYOUT_CHANGED_EVENT');
    expect(thinkingBlockSource).toContain("closest('[data-item-key]')");
    expect(thinkingBlockSource).toContain("getAttribute('data-index')");
    expect(thinkingBlockSource).toContain("notifyLayoutChanged('thinking-block-toggle')");
    expect(thinkingBlockSource).toContain("notifyLayoutChanged('thinking-block-auto-collapse')");

    expect(sessionMessagesSource).toContain('SESSION_MESSAGE_LAYOUT_CHANGED_EVENT');
    expect(sessionMessagesSource).toContain('scheduleVirtualizerRemeasure');
    expect(sessionMessagesSource).toContain('measuredHeightsRef.current.delete(itemKey)');
    expect(sessionMessagesSource).toContain('rowVirtualizer.measure()');
  });

  test('streamed thinking rows schedule one delayed auto-collapse after streaming ends', () => {
    expect(thinkingBlockSource).toContain('autoCollapseDelay = 2500');
    expect(thinkingBlockSource).toContain('autoCollapseTimerRef');
    expect(thinkingBlockSource).toContain('hasAutoCollapsedAfterStreamingRef');
    expect(thinkingBlockSource).toContain('window.setTimeout');
    expect(thinkingBlockSource).toContain('clearAutoCollapseTimer');
    expect(thinkingBlockSource).toContain("notifyLayoutChanged('thinking-block-auto-collapse')");
  });

  test('layout remeasure writes visible DOM heights back into TanStack item cache', () => {
    expect(sessionMessagesSource).toContain('pendingRemeasureItemIndexesRef');
    expect(sessionMessagesSource).toContain('measureVisibleRowsIntoVirtualizer');
    expect(sessionMessagesSource).toContain("querySelectorAll<HTMLElement>('[data-index][data-item-key]')");
    expect(sessionMessagesSource).toContain('rowVirtualizer.resizeItem(itemIndex, rawHeight)');
  });

  test('streaming completion remeasures rows so finished sessions do not keep bottom whitespace', () => {
    expect(sessionMessagesSource).toContain('prevIsLoadingRef');
    expect(sessionMessagesSource).toContain("reason: 'streaming-ended'");
    expect(sessionMessagesSource).toContain('scheduleVirtualizerRemeasure');
  });
});
