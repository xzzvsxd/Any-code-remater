import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';

const sessionMessagesSource = readFileSync(
  resolve(process.cwd(), 'src/components/session/SessionMessages.tsx'),
  'utf8',
).replace(/\r\n/g, '\n');

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

const toolCallsGroupSource = readFileSync(
  resolve(process.cwd(), 'src/components/message/ToolCallsGroup.tsx'),
  'utf8',
);

const errorBoundarySource = readFileSync(
  resolve(process.cwd(), 'src/components/ErrorBoundary.tsx'),
  'utf8',
);

describe('session message virtualization safety', () => {
  test('does not layer a custom ResizeObserver on top of TanStack Virtual row measurement', () => {
    expect(sessionMessagesSource).not.toContain('new ResizeObserver');
    expect(sessionMessagesSource).toContain('ref={measureElement}');
    expect(sessionMessagesSource).toContain('useAnimationFrameWithResizeObserver: true');
  });

  test('positions virtual rows in normal document flow with spacers instead of overlapping absolute transforms', () => {
    expect(sessionMessagesSource).toContain('const virtualPaddingTop');
    expect(sessionMessagesSource).toContain('const virtualPaddingBottom');
    expect(sessionMessagesSource).toContain('data-virtual-padding="top"');
    expect(sessionMessagesSource).toContain('data-virtual-padding="bottom"');
    expect(sessionMessagesSource).not.toContain('transform: `translateY(${virtualItem.start}px)`');
    expect(sessionMessagesSource).not.toContain('className="absolute inset-x-4 top-0"');
    expect(sessionMessagesSource).not.toContain('top: virtualItem.start');
  });

  test('keeps a non-empty virtual track intact and schedules bounded recovery', () => {
    expect(sessionMessagesSource).toContain('getVirtualTrackLayout');
    expect(sessionMessagesSource).toContain('shouldRecover');
    expect(sessionMessagesSource).toContain('EMPTY_WINDOW_RECOVERY_MAX_FRAMES');
    expect(sessionMessagesSource).toContain('rowVirtualizer.measure()');
    expect(sessionMessagesSource).toContain('cancelAnimationFrame(recoveryRafId)');
  });

  test('contains descendant margins inside each measured virtual row', () => {
    expect(sessionMessagesSource).toContain('className="relative flow-root w-full"');
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

  test('each virtualized message row has an error boundary so one bad widget cannot white-screen the session', () => {
    expect(sessionMessagesSource).toContain('import { ErrorBoundary }');
    expect(sessionMessagesSource).toContain('<ErrorBoundary');
    expect(sessionMessagesSource).toContain('resetKeys');
    expect(sessionMessagesSource).toContain('消息渲染失败');
    expect(sessionMessagesSource).toContain('<StreamMessageV2');
  });

  test('row error boundaries reset when virtual row identity changes after streaming/history reconciliation', () => {
    expect(errorBoundarySource).toContain('resetKeys?: unknown[]');
    expect(errorBoundarySource).toContain('componentDidUpdate');
    expect(errorBoundarySource).toContain('haveResetKeysChanged');
  });

  test('collapsed thinking rows invalidate stale virtual height cache and remeasure the list', () => {
    expect(thinkingBlockSource).toContain('SESSION_MESSAGE_LAYOUT_CHANGED_EVENT');
    expect(thinkingBlockSource).toContain("closest('[data-item-key]')");
    expect(thinkingBlockSource).toContain("getAttribute('data-index')");
    expect(thinkingBlockSource).toContain("notifyLayoutChanged('thinking-block-toggle')");
    expect(thinkingBlockSource).toContain("notifyLayoutChanged('thinking-block-auto-collapse')");

    expect(sessionMessagesSource).toContain('SESSION_MESSAGE_LAYOUT_CHANGED_EVENT');
    expect(sessionMessagesSource).toContain('scheduleVirtualizerRemeasure');
    expect(sessionMessagesSource).toContain('measuredHeightsRef.current.delete(measurementKey)');
    expect(sessionMessagesSource).toContain('measureVisibleRowsIntoVirtualizer');
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
    expect(sessionMessagesSource).toContain("querySelectorAll<HTMLElement>('[data-index][data-item-key][data-measurement-key]')");
    expect(sessionMessagesSource).toContain('rowVirtualizer.resizeItem(itemIndex, rawHeight)');
  });

  test('height cache is keyed by render revision so changed rows cannot reuse stale measurements', () => {
    expect(sessionMessagesSource).toContain('getMessageGroupMeasurementCacheKey');
    expect(sessionMessagesSource).toContain('data-measurement-key={measurementKey}');
    expect(sessionMessagesSource).toContain("getAttribute?.('data-measurement-key')");
    expect(sessionMessagesSource).not.toContain('measuredHeightsRef.current.get(getGroupKey');
    expect(sessionMessagesSource).not.toContain('measuredHeightsRef.current.set(itemKey, rawHeight)');
  });

  test('message render-revision changes refresh visible rows without clearing every TanStack item size', () => {
    expect(sessionMessagesSource).toContain('getMessageGroupsRenderSignature');
    expect(sessionMessagesSource).toContain('messageGroupsRenderSignature');
    expect(sessionMessagesSource).toContain("reason: 'message-groups-revised'");
    expect(sessionMessagesSource).toContain('const shouldRefreshAllVisibleRows');
    expect(sessionMessagesSource).toContain('pruneMeasuredHeightsToCurrentRevisions();');
    expect(sessionMessagesSource).not.toContain('if (shouldMeasureAllVisible) {\n        rowVirtualizer.measure();');
  });

  test('streaming and message revision events do not promote missing row identity to a full virtualizer reset', () => {
    expect(sessionMessagesSource).toContain('const isNonTargetedLayoutChange');
    expect(sessionMessagesSource).toContain("detail?.reason === 'message-groups-revised'");
    expect(sessionMessagesSource).toContain("detail?.reason === 'streaming-ended'");
    expect(sessionMessagesSource).toContain('!isNonTargetedLayoutChange');
    expect(sessionMessagesSource).toContain('if (shouldResetVirtualizerMeasurements) {\n        rowVirtualizer.measure();\n      }\n      measureVisibleRowsIntoVirtualizer({\n        all: shouldRefreshAllVisibleRows,');
  });

  test('targeted layout changes resize only the changed visible row instead of clearing every item size', () => {
    expect(sessionMessagesSource).not.toContain(`pendingRemeasureItemIndexesRef.current.clear();
      rowVirtualizer.measure();
      measureVisibleRowsIntoVirtualizer`);
    expect(sessionMessagesSource).toContain('if (shouldResetVirtualizerMeasurements) {');
    expect(sessionMessagesSource).toContain('measureVisibleRowsIntoVirtualizer({\n        all: shouldRefreshAllVisibleRows,');
  });

  test('virtualizer spacing uses TanStack padding instead of CSS padding outside totalSize accounting', () => {
    expect(sessionMessagesSource).toContain('paddingStart: SESSION_MESSAGES_PADDING_START');
    expect(sessionMessagesSource).toContain('paddingEnd: SESSION_MESSAGES_PADDING_END');
    expect(sessionMessagesSource).not.toContain('px-4 pt-8 pb-4');
  });

  test('streaming completion remeasures rows so finished sessions do not keep bottom whitespace', () => {
    expect(sessionMessagesSource).toContain('prevIsLoadingRef');
    expect(sessionMessagesSource).toContain("reason: 'streaming-ended'");
    expect(sessionMessagesSource).toContain('scheduleVirtualizerRemeasure');
  });

  test('tool and system init expand/collapse controls notify the virtualizer about height changes', () => {
    expect(toolsListSource).toContain('SESSION_MESSAGE_LAYOUT_CHANGED_EVENT');
    expect(toolsListSource).toContain("notifyLayoutChanged('system-tools-toggle')");
    expect(toolsListSource).toContain("notifyLayoutChanged('mcp-tools-toggle')");

    expect(toolCallsGroupSource).toContain('SESSION_MESSAGE_LAYOUT_CHANGED_EVENT');
    expect(toolCallsGroupSource).toContain("'tool-calls-toggle'");
    expect(toolCallsGroupSource).toContain("'fallback-tool-toggle'");
  });
});
