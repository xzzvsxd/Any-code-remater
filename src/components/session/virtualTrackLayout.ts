export interface VirtualTrackItemGeometry {
  start: number;
  end: number;
}

export interface VirtualTrackLayout {
  totalSize: number;
  paddingTop: number;
  paddingBottom: number;
  shouldRecover: boolean;
}

const finiteNonNegative = (value: number): number => (
  Number.isFinite(value) ? Math.max(0, value) : 0
);

/**
 * Converts TanStack Virtual's current window into document-flow spacer sizes.
 *
 * A non-empty list may briefly expose no virtual items while its scroll element
 * is hidden, resized, or being remeasured. The scroll track must retain its full
 * height during that frame; otherwise the browser clamps scrollTop and the list
 * can reopen on an unrelated or blank range.
 */
export function getVirtualTrackLayout(
  rawTotalSize: number,
  virtualItems: readonly VirtualTrackItemGeometry[],
  itemCount: number,
): VirtualTrackLayout {
  if (itemCount <= 0) {
    return {
      totalSize: 0,
      paddingTop: 0,
      paddingBottom: 0,
      shouldRecover: false,
    };
  }

  const baseTotalSize = finiteNonNegative(rawTotalSize);

  if (virtualItems.length === 0) {
    const totalSize = Math.max(100, baseTotalSize);
    return {
      totalSize,
      paddingTop: 0,
      paddingBottom: totalSize,
      shouldRecover: true,
    };
  }

  const firstStart = finiteNonNegative(virtualItems[0].start);
  const lastItem = virtualItems[virtualItems.length - 1];
  const lastStart = finiteNonNegative(lastItem.start);
  const lastEnd = Math.max(lastStart, finiteNonNegative(lastItem.end));
  const totalSize = Math.max(baseTotalSize, firstStart, lastEnd);

  return {
    totalSize,
    paddingTop: Math.min(firstStart, totalSize),
    paddingBottom: Math.max(0, totalSize - lastEnd),
    shouldRecover: false,
  };
}
