import { describe, expect, test } from 'vitest';
import { formatInteractionCountdown, getInteractionRemainingMs } from '../interactionDeadline';

describe('interaction deadline helpers', () => {
  test('formats countdown as compact mm:ss text', () => {
    expect(formatInteractionCountdown(0)).toBe('00:00');
    expect(formatInteractionCountdown(59_000)).toBe('00:59');
    expect(formatInteractionCountdown(61_000)).toBe('01:01');
    expect(formatInteractionCountdown(5 * 60_000)).toBe('05:00');
  });

  test('clamps expired deadlines at zero remaining time', () => {
    expect(getInteractionRemainingMs(1_000, 2_000)).toBe(0);
    expect(getInteractionRemainingMs(5_000, 2_000)).toBe(3_000);
  });
});
