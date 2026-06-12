import { describe, expect, test } from 'vitest';
import {
  shouldFollowResizeToBottom,
  shouldRunStickyAutoScroll,
} from '../smartAutoScrollPolicy';

describe('smart auto-scroll policy', () => {
  test('does not run sticky rAF auto-scroll for idle historical messages', () => {
    expect(shouldRunStickyAutoScroll({
      messageCount: 42,
      isLoading: false,
      shouldAutoScroll: true,
      userScrolled: false,
    })).toBe(false);
  });

  test('does not follow resize changes after an idle history load', () => {
    expect(shouldFollowResizeToBottom({
      isLoading: false,
      autoScrollEnabled: true,
    })).toBe(false);
  });

  test('keeps sticky auto-scroll enabled during active streaming', () => {
    expect(shouldRunStickyAutoScroll({
      messageCount: 42,
      isLoading: true,
      shouldAutoScroll: true,
      userScrolled: false,
    })).toBe(true);

    expect(shouldFollowResizeToBottom({
      isLoading: true,
      autoScrollEnabled: true,
    })).toBe(true);
  });

  test('respects explicit user scroll-away state during streaming', () => {
    expect(shouldRunStickyAutoScroll({
      messageCount: 42,
      isLoading: true,
      shouldAutoScroll: true,
      userScrolled: true,
    })).toBe(false);
  });
});
