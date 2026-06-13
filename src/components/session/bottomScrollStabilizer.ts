export interface ScrollGeometry {
  scrollHeight: number;
  clientHeight: number;
}

export interface BottomScrollFrameInput extends ScrollGeometry {
  scrollTop: number;
  lastScrollHeight: number;
  stableCount: number;
  stableFrames: number;
  elapsedMs?: number;
  minSettleMs?: number;
  bottomThresholdPx?: number;
}

export interface BottomScrollFrameDecision {
  atBottom: boolean;
  heightStable: boolean;
  shouldWriteScrollTop: boolean;
  targetScrollTop: number;
  nextStableCount: number;
  done: boolean;
}

export function getBottomScrollTop({ scrollHeight, clientHeight }: ScrollGeometry): number {
  return Math.max(0, scrollHeight - clientHeight);
}

export function evaluateBottomScrollFrame({
  scrollTop,
  scrollHeight,
  clientHeight,
  lastScrollHeight,
  stableCount,
  stableFrames,
  elapsedMs,
  minSettleMs = 0,
  bottomThresholdPx = 16,
}: BottomScrollFrameInput): BottomScrollFrameDecision {
  const targetScrollTop = getBottomScrollTop({ scrollHeight, clientHeight });
  const distance = targetScrollTop - scrollTop;
  const atBottom = distance <= bottomThresholdPx;
  const heightStable = scrollHeight === lastScrollHeight;

  if (!atBottom) {
    return {
      atBottom,
      heightStable,
      shouldWriteScrollTop: true,
      targetScrollTop,
      nextStableCount: 0,
      done: false,
    };
  }

  const nextStableCount = heightStable ? stableCount + 1 : 0;
  const minimumSettleElapsed = elapsedMs === undefined || elapsedMs >= minSettleMs;
  return {
    atBottom,
    heightStable,
    shouldWriteScrollTop: false,
    targetScrollTop,
    nextStableCount,
    done: nextStableCount >= stableFrames && minimumSettleElapsed,
  };
}
