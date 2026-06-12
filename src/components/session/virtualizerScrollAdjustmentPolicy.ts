export interface VirtualizerScrollAdjustmentDecision {
  itemStart: number;
  scrollOffset: number;
  distanceFromBottom: number;
  bottomSettleActive: boolean;
  nearBottomThresholdPx?: number;
}

/**
 * 控制 react-virtual 在测量真实行高变化时是否做“保锚点” scrollTop 补偿。
 *
 * - 用户已经离开底部并浏览历史：保留默认保锚点行为，避免上方行重测把视口顶飞。
 * - 初次打开历史会话正在显式置底，或已经接近底部：不要再让虚拟列表保旧锚点，否则会和
 *   “贴底”目标互相拉扯，表现为底部弹跳/反复解除粘底。
 */
export function shouldPreserveScrollAnchorOnMeasuredSizeChange({
  itemStart,
  scrollOffset,
  distanceFromBottom,
  bottomSettleActive,
  nearBottomThresholdPx = 32,
}: VirtualizerScrollAdjustmentDecision): boolean {
  if (bottomSettleActive) {
    return false;
  }

  if (distanceFromBottom <= nearBottomThresholdPx) {
    return false;
  }

  return itemStart < scrollOffset;
}
