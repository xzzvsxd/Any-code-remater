import { describe, expect, test } from 'vitest';
import {
  evaluateBottomScrollFrame,
  getBottomScrollTop,
} from '../bottomScrollStabilizer';

describe('bottom scroll stabilizer', () => {
  test('targets the maximum legal scrollTop instead of overshooting to scrollHeight', () => {
    expect(getBottomScrollTop({ scrollHeight: 1200, clientHeight: 500 })).toBe(700);
  });

  test('does not produce negative targets for short content', () => {
    expect(getBottomScrollTop({ scrollHeight: 300, clientHeight: 500 })).toBe(0);
  });

  test('does not write scrollTop again when already at the bottom but height changed', () => {
    const result = evaluateBottomScrollFrame({
      scrollTop: 700,
      scrollHeight: 1200,
      clientHeight: 500,
      lastScrollHeight: 1000,
      stableCount: 2,
      stableFrames: 4,
    });

    expect(result.atBottom).toBe(true);
    expect(result.shouldWriteScrollTop).toBe(false);
    expect(result.nextStableCount).toBe(0);
    expect(result.done).toBe(false);
  });

  test('keeps settling for a minimum time even when early frames look stable', () => {
    const result = evaluateBottomScrollFrame({
      scrollTop: 700,
      scrollHeight: 1200,
      clientHeight: 500,
      lastScrollHeight: 1200,
      stableCount: 3,
      stableFrames: 4,
      elapsedMs: 120,
      minSettleMs: 600,
    });

    expect(result.atBottom).toBe(true);
    expect(result.shouldWriteScrollTop).toBe(false);
    expect(result.nextStableCount).toBe(4);
    expect(result.done).toBe(false);
  });

  test('treats small near-bottom drift as settled by default', () => {
    const result = evaluateBottomScrollFrame({
      scrollTop: 692,
      scrollHeight: 1200,
      clientHeight: 500,
      lastScrollHeight: 1200,
      stableCount: 3,
      stableFrames: 4,
    });

    expect(result.atBottom).toBe(true);
    expect(result.shouldWriteScrollTop).toBe(false);
    expect(result.done).toBe(true);
  });

  test('writes a clamped target only when still away from bottom', () => {
    const result = evaluateBottomScrollFrame({
      scrollTop: 650,
      scrollHeight: 1200,
      clientHeight: 500,
      lastScrollHeight: 1200,
      stableCount: 0,
      stableFrames: 4,
    });

    expect(result.atBottom).toBe(false);
    expect(result.shouldWriteScrollTop).toBe(true);
    expect(result.targetScrollTop).toBe(700);
    expect(result.nextStableCount).toBe(0);
  });
});
