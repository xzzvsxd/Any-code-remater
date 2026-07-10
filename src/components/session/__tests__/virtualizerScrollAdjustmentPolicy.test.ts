import { describe, expect, test } from 'vitest';
import { shouldPreserveScrollAnchorOnMeasuredSizeChange } from '../virtualizerScrollAdjustmentPolicy';

describe('virtualizer scroll adjustment policy', () => {
  test('does not preserve old anchor while explicit bottom settling is active', () => {
    expect(shouldPreserveScrollAnchorOnMeasuredSizeChange({
      itemStart: 100,
      scrollOffset: 500,
      distanceFromBottom: 200,
      bottomSettleActive: true,
    })).toBe(false);
  });

  test('does not preserve old anchor when sticky bottom-follow owns the scroll position', () => {
    expect(shouldPreserveScrollAnchorOnMeasuredSizeChange({
      itemStart: 100,
      scrollOffset: 500,
      distanceFromBottom: 12,
      bottomSettleActive: false,
      autoScrollLockedToBottom: true,
      nearBottomThresholdPx: 32,
    })).toBe(false);
  });

  test('preserves anchor near bottom while the user is manually browsing a running session', () => {
    expect(shouldPreserveScrollAnchorOnMeasuredSizeChange({
      itemStart: 100,
      scrollOffset: 500,
      distanceFromBottom: 12,
      bottomSettleActive: false,
      autoScrollLockedToBottom: false,
      nearBottomThresholdPx: 32,
    })).toBe(true);
  });

  test('preserves anchor for measured items above viewport while user is away from bottom', () => {
    expect(shouldPreserveScrollAnchorOnMeasuredSizeChange({
      itemStart: 100,
      scrollOffset: 500,
      distanceFromBottom: 300,
      bottomSettleActive: false,
    })).toBe(true);
  });

  test('does not adjust for measured items below the current offset', () => {
    expect(shouldPreserveScrollAnchorOnMeasuredSizeChange({
      itemStart: 800,
      scrollOffset: 500,
      distanceFromBottom: 300,
      bottomSettleActive: false,
    })).toBe(false);
  });
});
