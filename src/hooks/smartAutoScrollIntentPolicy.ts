export interface DownwardIntentFromScrollDeltaInput {
  delta: number;
  deadband: number;
  isProgrammatic: boolean;
  hasRecentDirectUserIntent: boolean;
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
