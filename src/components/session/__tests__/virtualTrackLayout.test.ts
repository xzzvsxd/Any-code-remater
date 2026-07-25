import { describe, expect, test } from 'vitest';
import { getVirtualTrackLayout } from '../virtualTrackLayout';

describe('getVirtualTrackLayout', () => {
  test('calculates normal document-flow spacers', () => {
    expect(getVirtualTrackLayout(
      1_000,
      [
        { start: 200, end: 350 },
        { start: 350, end: 500 },
      ],
      10,
    )).toEqual({
      totalSize: 1_000,
      paddingTop: 200,
      paddingBottom: 500,
      shouldRecover: false,
    });
  });

  test('preserves the full track when a non-empty list has an empty virtual window', () => {
    expect(getVirtualTrackLayout(84_000, [], 1_001)).toEqual({
      totalSize: 84_000,
      paddingTop: 0,
      paddingBottom: 84_000,
      shouldRecover: true,
    });
  });

  test('retains a nonzero recovery track when total size is temporarily invalid', () => {
    expect(getVirtualTrackLayout(Number.NaN, [], 20)).toEqual({
      totalSize: 100,
      paddingTop: 0,
      paddingBottom: 100,
      shouldRecover: true,
    });
  });

  test('sanitizes invalid and reversed geometry to finite non-negative values', () => {
    const result = getVirtualTrackLayout(
      Number.NaN,
      [
        { start: -50, end: Number.POSITIVE_INFINITY },
        { start: 150, end: 100 },
      ],
      2,
    );

    expect(result).toEqual({
      totalSize: 150,
      paddingTop: 0,
      paddingBottom: 0,
      shouldRecover: false,
    });
    expect(Object.values(result).filter(value => typeof value === 'number').every(
      value => Number.isFinite(value) && value >= 0,
    )).toBe(true);
  });

  test('expands total size to contain an item end beyond a stale total', () => {
    expect(getVirtualTrackLayout(300, [{ start: 400, end: 625 }], 5)).toEqual({
      totalSize: 625,
      paddingTop: 400,
      paddingBottom: 0,
      shouldRecover: false,
    });
  });

  test('does not recover an actually empty session', () => {
    expect(getVirtualTrackLayout(50_000, [], 0)).toEqual({
      totalSize: 0,
      paddingTop: 0,
      paddingBottom: 0,
      shouldRecover: false,
    });
  });
});
