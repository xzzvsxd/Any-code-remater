export interface VirtualTrackItemGeometry {
  start: number;
  end: number;
}

export interface VirtualTrackLayout {
  totalSize: number;
  shouldRecover: boolean;
}

const finiteNonNegative = (value: number): number => (
  Number.isFinite(value) ? Math.max(0, value) : 0
);

/**
 * Keeps TanStack Virtual's canonical absolute-positioned scroll track stable.
 *
 * A non-empty list may briefly expose no virtual items while its scroll element
 * is hidden, resized, or being remeasured. The scroll track must retain its full
 * height during that frame; otherwise the browser clamps scrollTop and the list
 * can reopen on an unrelated or blank range.
 *
 * Row placement deliberately stays out of this helper. Each rendered row must
 * use its own `virtualItem.start`; converting those coordinates back into normal
 * document flow makes earlier rows' real heights accumulate a second time and
 * can place the entire rendered window outside the viewport.
 */
export function getVirtualTrackLayout(
  rawTotalSize: number,
  virtualItems: readonly VirtualTrackItemGeometry[],
  itemCount: number,
): VirtualTrackLayout {
  if (itemCount <= 0) {
    return {
      totalSize: 0,
      shouldRecover: false,
    };
  }

  const baseTotalSize = finiteNonNegative(rawTotalSize);

  if (virtualItems.length === 0) {
    const totalSize = Math.max(100, baseTotalSize);
    return {
      totalSize,
      shouldRecover: true,
    };
  }

  const largestItemBoundary = virtualItems.reduce((largest, item) => {
    const start = finiteNonNegative(item.start);
    const end = Math.max(start, finiteNonNegative(item.end));
    return Math.max(largest, start, end);
  }, 0);
  const totalSize = Math.max(baseTotalSize, largestItemBoundary);

  return {
    totalSize,
    shouldRecover: false,
  };
}
