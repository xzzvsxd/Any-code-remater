export interface DownwardIntentFromScrollDeltaInput {
  delta: number;
  deadband: number;
  isProgrammatic: boolean;
  hasRecentDirectUserIntent: boolean;
}

export interface ReleaseAutoScrollFromScrollDeltaInput extends DownwardIntentFromScrollDeltaInput {
  distanceFromBottom: number;
}

/**
 * scrollTop 增大不一定代表“用户想回到底部”：
 * - performAutoScroll 写 scrollTop 会产生 programmatic scroll 事件；
 * - react-virtual 测量上方行高时也会做 scrollTop 补偿以保锚点；
 * 这两类都不能作为恢复粘底的“向下意图”，否则 Linux/WebKit 下会反复粘底/解除并回弹。
 */
export function shouldMarkDownwardIntentFromScrollDelta({
  delta,
  deadband,
  isProgrammatic,
  hasRecentDirectUserIntent,
}: DownwardIntentFromScrollDeltaInput): boolean {
  return !isProgrammatic && hasRecentDirectUserIntent && delta > deadband;
}

/**
 * 滚动条拖拽/触摸板手势之外，用户也可能直接拖动 scrollbar 向上看历史。
 * 这类输入通常表现为 pointerdown 后只有 scroll 事件、没有 wheel deltaY；
 * 若不在 scroll delta < 0 时释放粘底，streaming rAF 会继续把视图拉回底部，
 * 用户就会感觉“拉不上去”。
 */
export function shouldReleaseAutoScrollFromScrollDelta({
  delta,
  deadband,
  isProgrammatic,
  hasRecentDirectUserIntent,
  distanceFromBottom,
}: ReleaseAutoScrollFromScrollDeltaInput): boolean {
  return (
    !isProgrammatic &&
    hasRecentDirectUserIntent &&
    delta < -deadband &&
    distanceFromBottom > 1
  );
}
