/**
 * 智能自动滚动 Hook
 *
 * 提供消息列表的粘底能力，同时允许用户在处理中自由上滑查看历史消息。
 * 只有当用户明确回到底部附近时，才重新开启自动滚动。
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import type { ClaudeStreamMessage } from '@/types/claude';

interface SmartAutoScrollConfig {
  /** 可显示的消息列表（用于触发滚动） */
  displayableMessages: ClaudeStreamMessage[];
  /** 是否正在处理中（流式输出时） */
  isLoading: boolean;
}

interface SmartAutoScrollReturn {
  /** 滚动容器 ref */
  parentRef: React.RefObject<HTMLDivElement>;
  /** 用户是否主动离开底部 */
  userScrolled: boolean;
  /** 设置用户滚动状态 */
  setUserScrolled: (scrolled: boolean) => void;
  /** 设置自动滚动状态 */
  setShouldAutoScroll: (should: boolean) => void;
}

const RESUME_AUTO_SCROLL_THRESHOLD = 80;
// 用户主动上滑解除粘底后，只有真正回到“几乎精确贴底”才恢复自动跟随。
// 若沿用 80px 的宽松阈值，用户在底部附近小幅上滑（落在 80px 内）会被 scroll 事件
// 立刻判定为“已回到底部”而重新粘底，与上滑解除直接对冲 —— 这正是“吸铁石”根因。
const RESUME_AT_BOTTOM_THRESHOLD = 4;

/**
 * 计算最后一条消息的内容哈希，用于检测内容变化
 */
function getLastMessageContentHash(messages: ClaudeStreamMessage[]): string {
  if (messages.length === 0) return '';

  const lastMessage = messages[messages.length - 1];
  const contentLength = JSON.stringify(lastMessage.message?.content || '').length;

  return `${messages.length}-${lastMessage.type}-${contentLength}`;
}

/**
 * 获取距离底部的像素距离
 */
function getDistanceFromBottom(element: HTMLDivElement): number {
  return element.scrollHeight - element.scrollTop - element.clientHeight;
}

export function useSmartAutoScroll(config: SmartAutoScrollConfig): SmartAutoScrollReturn {
  const { displayableMessages, isLoading } = config;

  const [userScrolled, setUserScrolledState] = useState(false);
  const [shouldAutoScroll, setShouldAutoScrollState] = useState(true);

  const parentRef = useRef<HTMLDivElement>(null);
  const autoScrollEnabledRef = useRef(true);
  // 标记“用户主动上滑解除了粘底”。置位后，scroll 事件必须等用户几乎精确贴底才恢复粘底，
  // 避免在 80px 区间内被立即拉回（吸铁石）。回到底部恢复后清除该标记。
  const userIntentReleasedRef = useRef(false);

  const lastMessageHash = useMemo(
    () => getLastMessageContentHash(displayableMessages),
    [displayableMessages]
  );

  /**
   * 同步自动滚动与“用户已离开底部”两个状态，避免它们互相打架。
   */
  const syncAutoScrollState = (enabled: boolean) => {
    autoScrollEnabledRef.current = enabled;
    setShouldAutoScrollState(enabled);
    setUserScrolledState(!enabled);
  };

  const setUserScrolled = (scrolled: boolean) => {
    syncAutoScrollState(!scrolled);
  };

  const setShouldAutoScroll = (should: boolean) => {
    syncAutoScrollState(should);
  };

  /**
   * 执行自动滚动到底部。用户已离开底部时直接跳过。
   *
   * 关键：粘底只「向下追新增内容」，绝不「向上跟随高度收缩」。
   * 流式输出时虚拟列表会渐进测量上方消息的真实高度，某些帧实测 < 估算会让 scrollHeight
   * 短暂减小、目标位置上移；若跟着往上跳，就会与下一帧的内容增长来回对冲，表现为上下弹跳。
   * 而 scrollTop 永远不会超过 target（浏览器自动 clamp），高度收缩时浏览器会一次性把位置
   * 修正到位 —— 因此这里只处理「落后于底部」的情况，不主动制造任何向上的滚动，根除振荡。
   * 全程瞬时（无 smooth 动画）：粘底语义就是"始终钉在底部"，瞬时跳转才不会被高频更新打断。
   */
  const performAutoScroll = () => {
    // 用户已主动离开底部时，任何在途的自动滚动立即作废，避免“吸底”。
    // autoScrollEnabledRef 为同步状态，比 React state 更早生效，能即时止住正在执行的滚动循环。
    if (!autoScrollEnabledRef.current) return;

    const scrollElement = parentRef.current;
    if (!scrollElement) return;

    const targetScrollTop = scrollElement.scrollHeight - scrollElement.clientHeight;
    // 仅当 scrollTop 落后于底部（新内容在下方）才向下追。容差 2px 兼顾高 DPI 亚像素抖动。
    // target - scrollTop <= 2 同时覆盖：已贴底、以及高度收缩后 scrollTop 被 clamp 的情形。
    if (targetScrollTop - scrollElement.scrollTop <= 2) {
      return;
    }

    scrollElement.scrollTop = targetScrollTop;
  };

  useEffect(() => {
    const scrollElement = parentRef.current;
    if (!scrollElement) return;

    // 跨帧二次确认句柄：用于过滤虚拟列表测量抖动那一帧的“假性贴底”，下方 handleScroll 说明根因。
    let resumeConfirmFrame = 0;
    const cancelResumeConfirmation = () => {
      if (resumeConfirmFrame) {
        cancelAnimationFrame(resumeConfirmFrame);
        resumeConfirmFrame = 0;
      }
    };

    /**
     * 用户主动输入（滚轮 / 触摸 / 键盘）是“离开底部”的最可靠信号。
     * 一旦检测到向上意图，立即解除粘底——向上滚动本身就是明确的“查看历史”意图，
     * 不再要求“离底部超过阈值”，否则用户在底部附近小幅上滑会被流式自动滚动立刻拉回（“吸铁石”）。
     * 仅排除已经精确贴底（≤1px）时的边界噪声。
     */
    const releaseOnUserIntent = (movingUp: boolean) => {
      if (!movingUp) return;
      if (getDistanceFromBottom(scrollElement) <= 1) return;
      cancelResumeConfirmation();
      userIntentReleasedRef.current = true;
      syncAutoScrollState(false);
    };

    const handleWheel = (event: WheelEvent) => {
      releaseOnUserIntent(event.deltaY < 0);
    };

    let touchStartY = 0;
    const handleTouchStart = (event: TouchEvent) => {
      touchStartY = event.touches[0]?.clientY ?? 0;
    };
    const handleTouchMove = (event: TouchEvent) => {
      const currentY = event.touches[0]?.clientY ?? 0;
      // 手指下滑（clientY 增大）= 内容上移 = 查看历史
      releaseOnUserIntent(currentY > touchStartY);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      const upKeys = ['ArrowUp', 'PageUp', 'Home'];
      releaseOnUserIntent(upKeys.includes(event.key));
    };

    /**
     * scroll 事件只负责“回到底部时恢复粘底”，不再用 isAutoScrolling 标志屏蔽用户滚动，
     * 避免高频自动滚动期间把用户真实滚动一并吞掉。
     */
    const handleScroll = () => {
      // 用户主动上滑解除过粘底：必须几乎精确贴底（≤4px）才恢复，避免 80px 区间内被立即吸回。
      // 未经主动解除（如程序滚动后的微抖）：维持 80px 宽松阈值恢复，保证正常跟随体验。
      const resumeThreshold = userIntentReleasedRef.current
        ? RESUME_AT_BOTTOM_THRESHOLD
        : RESUME_AUTO_SCROLL_THRESHOLD;

      const distance = getDistanceFromBottom(scrollElement);
      if (distance > resumeThreshold) {
        cancelResumeConfirmation();
        return;
      }

      // 向上滚动时虚拟列表会渐进测量上方消息项的真实高度，导致 totalSize / scrollHeight
      // 在某一帧先行变化、而 scrollTop 的补偿调整尚未应用 —— 这一帧的 distance 会出现
      // “假性贴底”（甚至为负）。isLoading 期间又常驻一个自动滚动循环，一旦此刻误判贴底
      // 恢复粘底，就会被该循环立刻拽到底部，表现为“向上翻、一遇到刷新加载就弹到底”。
      // 因此跨一帧二次确认：仅当连续两帧都贴底，才认定为用户真实回到底部。
      cancelResumeConfirmation();
      resumeConfirmFrame = requestAnimationFrame(() => {
        resumeConfirmFrame = 0;
        if (!scrollElement.isConnected) return;
        const currentResumeThreshold = userIntentReleasedRef.current
          ? RESUME_AT_BOTTOM_THRESHOLD
          : RESUME_AUTO_SCROLL_THRESHOLD;
        if (getDistanceFromBottom(scrollElement) <= currentResumeThreshold) {
          userIntentReleasedRef.current = false;
          syncAutoScrollState(true);
        }
      });
    };

    scrollElement.addEventListener('wheel', handleWheel, { passive: true });
    scrollElement.addEventListener('touchstart', handleTouchStart, { passive: true });
    scrollElement.addEventListener('touchmove', handleTouchMove, { passive: true });
    scrollElement.addEventListener('keydown', handleKeyDown);
    scrollElement.addEventListener('scroll', handleScroll, { passive: true });

    return () => {
      cancelResumeConfirmation();
      scrollElement.removeEventListener('wheel', handleWheel);
      scrollElement.removeEventListener('touchstart', handleTouchStart);
      scrollElement.removeEventListener('touchmove', handleTouchMove);
      scrollElement.removeEventListener('keydown', handleKeyDown);
      scrollElement.removeEventListener('scroll', handleScroll);
    };
  }, []);

  /**
   * 统一的粘底驱动：由「真实新内容」驱动，而非每帧无脑 slam。
   *
   * 关键修复——之前流式期间常驻一个 60fps 循环，每帧都把视图钉到底部。但流式 markdown
   * （尤其未闭合的代码围栏）会让虚拟列表实测高度来回非单调摆动：代码块渲染时高度骤增、
   * 围栏闭合时又收缩。每帧追这个摆动的目标，就把每一次高度抖动放大成肉眼可见的上下弹跳，
   * 表现为「运行中乱跳、太敏感」。
   *
   * 现在改为：effect 依赖 lastMessageHash，仅在「内容真正变化」（新 token 批次到达）时重启，
   * 每次重启后跟随到底、稳定若干帧即停止释放 rAF。两个批次之间不滚动，因此「纯测量抖动」
   * （不改变内容哈希）不会触发任何粘底动作，弹跳的源头被切断。配合「只向下追、容差 2px」，
   * 连续增长的文本仍平滑跟随，只有非单调的瞬时摆动不再被逐帧追逐。
   */
  useEffect(() => {
    if (displayableMessages.length === 0 || !shouldAutoScroll || userScrolled) {
      return;
    }

    let rafId = 0;
    let settledFrames = 0;
    // 连续稳定帧达到预算即停止：足以吸收虚拟列表渐进高度重测，又不会长时间空转或追摆动。
    const SETTLE_FRAME_BUDGET = 10;

    const tick = () => {
      const before = parentRef.current?.scrollTop ?? 0;
      performAutoScroll();
      const after = parentRef.current?.scrollTop ?? 0;

      // 本帧没有再向下追（位置已稳定）才累计稳定帧；仍在移动则清零，确保跟随完成后才退出。
      if (Math.abs(after - before) <= 1) {
        settledFrames += 1;
      } else {
        settledFrames = 0;
      }
      if (settledFrames >= SETTLE_FRAME_BUDGET) {
        rafId = 0;
        return;
      }

      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);

    return () => {
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, [displayableMessages.length, isLoading, lastMessageHash, shouldAutoScroll, userScrolled]);

  return {
    parentRef,
    userScrolled,
    setUserScrolled,
    setShouldAutoScroll
  };
}
