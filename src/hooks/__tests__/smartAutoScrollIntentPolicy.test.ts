import { describe, expect, test } from 'vitest';
import {
  shouldMarkDownwardIntentFromScrollDelta,
  shouldReleaseAutoScrollFromScrollDelta,
} from '../smartAutoScrollIntentPolicy';

describe('smart auto-scroll intent policy', () => {
  test('does not treat programmatic bottom-follow scrolls as user downward intent', () => {
    expect(shouldMarkDownwardIntentFromScrollDelta({
      delta: 240,
      deadband: 16,
      isProgrammatic: true,
      hasRecentDirectUserIntent: true,
    })).toBe(false);
  });

  test('does not treat virtualizer layout compensation as user downward intent', () => {
    expect(shouldMarkDownwardIntentFromScrollDelta({
      delta: 240,
      deadband: 16,
      isProgrammatic: false,
      hasRecentDirectUserIntent: false,
    })).toBe(false);
  });

  test('marks scrollbar drag or other direct user scroll gestures as downward intent', () => {
    expect(shouldMarkDownwardIntentFromScrollDelta({
      delta: 240,
      deadband: 16,
      isProgrammatic: false,
      hasRecentDirectUserIntent: true,
    })).toBe(true);
  });

  test('releases sticky bottom-follow when scrollbar drag moves upward', () => {
    expect(shouldReleaseAutoScrollFromScrollDelta({
      delta: -48,
      deadband: 16,
      isProgrammatic: false,
      hasRecentDirectUserIntent: true,
      distanceFromBottom: 240,
    })).toBe(true);
  });

  test('does not release sticky bottom-follow for virtualizer compensation or bottom-edge jitter', () => {
    expect(shouldReleaseAutoScrollFromScrollDelta({
      delta: -48,
      deadband: 16,
      isProgrammatic: false,
      hasRecentDirectUserIntent: false,
      distanceFromBottom: 240,
    })).toBe(false);

    expect(shouldReleaseAutoScrollFromScrollDelta({
      delta: -48,
      deadband: 16,
      isProgrammatic: false,
      hasRecentDirectUserIntent: true,
      distanceFromBottom: 1,
    })).toBe(false);
  });
});
