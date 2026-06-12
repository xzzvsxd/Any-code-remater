export interface StickyAutoScrollDecision {
  messageCount: number;
  isLoading: boolean;
  shouldAutoScroll: boolean;
  userScrolled: boolean;
}

export interface ResizeFollowDecision {
  isLoading: boolean;
  autoScrollEnabled: boolean;
}

/**
 * 持续粘底循环只服务于“正在流式输出”的场景。
 *
 * 历史会话首屏加载是一次性定位问题，不能让 ResizeObserver/rAF 在虚拟列表渐进测高期间
 * 持续抢 scrollTop；否则会和 SessionMessages.scrollToBottom 的首屏置底循环互相打架，
 * 在 Linux/WebKit 上表现为底部弹跳、粘底状态反复抖动。
 */
export function shouldRunStickyAutoScroll({
  messageCount,
  isLoading,
  shouldAutoScroll,
  userScrolled,
}: StickyAutoScrollDecision): boolean {
  return messageCount > 0 && isLoading && shouldAutoScroll && !userScrolled;
}

/**
 * 内容高度变化跟随也只在 streaming 时启用。
 *
 * 非 streaming 的历史消息测量/代码高亮重排应保持当前锚点，由初次进入会话的一次性置底负责。
 */
export function shouldFollowResizeToBottom({
  isLoading,
  autoScrollEnabled,
}: ResizeFollowDecision): boolean {
  return isLoading && autoScrollEnabled;
}
