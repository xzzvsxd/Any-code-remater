export interface VirtualRowMeasurementInput {
  rawHeight: number;
  cachedHeight?: number;
  fallbackHeight: number;
  hasRenderedContent: boolean;
}

const INVISIBLE_ROW_HEIGHT = 1;

/**
 * A row whose renderer returned null is a valid zero-content row, not a layout
 * failure. Keeping a tiny footprint preserves its position without creating a
 * large invisible virtual item that can push every visible message off-screen.
 */
export function resolveVirtualRowMeasuredHeight({
  rawHeight,
  cachedHeight,
  fallbackHeight,
  hasRenderedContent,
}: VirtualRowMeasurementInput): number {
  if (Number.isFinite(rawHeight) && rawHeight > 0) {
    return rawHeight;
  }

  if (!hasRenderedContent) {
    return INVISIBLE_ROW_HEIGHT;
  }

  if (typeof cachedHeight === 'number' && Number.isFinite(cachedHeight) && cachedHeight > 0) {
    return cachedHeight;
  }

  return Number.isFinite(fallbackHeight) && fallbackHeight > 0 ? fallbackHeight : INVISIBLE_ROW_HEIGHT;
}
