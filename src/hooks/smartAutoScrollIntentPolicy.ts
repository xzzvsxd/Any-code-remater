export interface DownwardIntentFromScrollDeltaInput {
  delta: number;
  deadband: number;
  isProgrammatic: boolean;
  hasRecentDirectUserIntent: boolean;
  directUserIntentDirection?: DirectUserIntentDirection;
}

export interface ReleaseAutoScrollFromScrollDeltaInput extends DownwardIntentFromScrollDeltaInput {
  distanceFromBottom: number;
}

export interface ResumeAutoScrollThresholdInput {
  userIntentReleased: boolean;
  userIntentDownward: boolean;
  relaxedThreshold: number;
  preciseThreshold: number;
  viewportHeight?: number;
  relaxedViewportRatio?: number;
  maxRelaxedThreshold?: number;
}

export type DirectUserIntentDirection = 'up' | 'down' | 'unknown';

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
  directUserIntentDirection = 'unknown',
}: DownwardIntentFromScrollDeltaInput): boolean {
  return (
    !isProgrammatic &&
    hasRecentDirectUserIntent &&
    directUserIntentDirection !== 'up' &&
    delta > deadband
  );
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

/**
 * 用户主动上滑后，不能仅靠“离底很近”恢复粘底，否则虚拟列表测高造成的假贴底会把用户吸回底部。
 * 但一旦检测到明确的向下意图，就应使用更宽松的底部恢复区间；运行中最后一行/状态条持续变高时，
 * 精确 4px 门槛太苛刻，会表现为“往底部翻却总被弹开、粘不住”。
 */
export function getResumeAutoScrollThreshold({
  userIntentReleased,
  userIntentDownward,
  relaxedThreshold,
  preciseThreshold,
  viewportHeight,
  relaxedViewportRatio = 0,
  maxRelaxedThreshold = relaxedThreshold,
}: ResumeAutoScrollThresholdInput): number {
  if (!userIntentReleased) {
    return relaxedThreshold;
  }

  if (!userIntentDownward) {
    return preciseThreshold;
  }

  if (!viewportHeight || relaxedViewportRatio <= 0) {
    return relaxedThreshold;
  }

  const viewportThreshold = Math.round(viewportHeight * relaxedViewportRatio);
  return Math.max(relaxedThreshold, Math.min(maxRelaxedThreshold, viewportThreshold));
}
