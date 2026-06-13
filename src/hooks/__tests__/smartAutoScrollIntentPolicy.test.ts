import { describe, expect, test } from 'vitest';
import { shouldMarkDownwardIntentFromScrollDelta } from '../smartAutoScrollIntentPolicy';

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
});
