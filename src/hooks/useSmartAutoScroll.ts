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
   */
  const performAutoScroll = (behavior: ScrollBehavior = 'smooth') => {
    // 用户已主动离开底部时，任何在途的自动滚动立即作废，避免“吸底”。
    // autoScrollEnabledRef 为同步状态，比 React state 更早生效，能即时止住正在执行的滚动循环。
    if (!autoScrollEnabledRef.current) return;

    const scrollElement = parentRef.current;
    if (!scrollElement) return;

    const targetScrollTop = scrollElement.scrollHeight - scrollElement.clientHeight;
    if (Math.abs(scrollElement.scrollTop - targetScrollTop) <= 1) {
      return;
    }

    scrollElement.scrollTo({
      top: targetScrollTop,
      behavior
    });
  };

  useEffect(() => {
    const scrollElement = parentRef.current;
    if (!scrollElement) return;

    /**
     * 用户主动输入（滚轮 / 触摸 / 键盘）是“离开底部”的最可靠信号。
     * 一旦检测到向上意图，立即解除粘底——向上滚动本身就是明确的“查看历史”意图，
     * 不再要求“离底部超过阈值”，否则用户在底部附近小幅上滑会被流式自动滚动立刻拉回（“吸铁石”）。
     * 仅排除已经精确贴底（≤1px）时的边界噪声。
     */
    const releaseOnUserIntent = (movingUp: boolean) => {
      if (!movingUp) return;
      if (getDistanceFromBottom(scrollElement) <= 1) return;
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
      if (getDistanceFromBottom(scrollElement) <= RESUME_AUTO_SCROLL_THRESHOLD) {
        syncAutoScrollState(true);
      }
    };

    scrollElement.addEventListener('wheel', handleWheel, { passive: true });
    scrollElement.addEventListener('touchstart', handleTouchStart, { passive: true });
    scrollElement.addEventListener('touchmove', handleTouchMove, { passive: true });
    scrollElement.addEventListener('keydown', handleKeyDown);
    scrollElement.addEventListener('scroll', handleScroll, { passive: true });

    return () => {
      scrollElement.removeEventListener('wheel', handleWheel);
      scrollElement.removeEventListener('touchstart', handleTouchStart);
      scrollElement.removeEventListener('touchmove', handleTouchMove);
      scrollElement.removeEventListener('keydown', handleKeyDown);
      scrollElement.removeEventListener('scroll', handleScroll);
    };
  }, []);

  /**
   * 新消息到达时，仅在仍然处于粘底状态下跟随到底部。
   */
  useEffect(() => {
    if (displayableMessages.length === 0 || !shouldAutoScroll || userScrolled) {
      return;
    }

    const timeoutId = setTimeout(() => {
      requestAnimationFrame(() => performAutoScroll(isLoading ? 'auto' : 'smooth'));
    }, 80);

    return () => clearTimeout(timeoutId);
  }, [displayableMessages.length, isLoading, lastMessageHash, shouldAutoScroll, userScrolled]);

  /**
   * 流式输出期间持续跟随最新内容，但用户一旦离开底部就立即停止。
   */
  useEffect(() => {
    if (!isLoading || !shouldAutoScroll || userScrolled) {
      return;
    }

    performAutoScroll('auto');

    let rafId = 0;
    let lastScrollTime = 0;

    const tick = (timestamp: number) => {
      if (timestamp - lastScrollTime >= 100) {
        performAutoScroll('auto');
        lastScrollTime = timestamp;
      }

      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);

    return () => cancelAnimationFrame(rafId);
  }, [isLoading, shouldAutoScroll, userScrolled, lastMessageHash]);

  /**
   * 非流式状态下给虚拟列表一个短暂的“粘底窗口”，用于处理高度重测后的补滚动。
   */
  useEffect(() => {
    if (isLoading || !shouldAutoScroll || userScrolled || displayableMessages.length === 0) {
      return;
    }

    let ticks = 0;
    const intervalId = setInterval(() => {
      ticks += 1;
      requestAnimationFrame(() => performAutoScroll('auto'));

      if (ticks >= 8) {
        clearInterval(intervalId);
      }
    }, 100);

    return () => clearInterval(intervalId);
  }, [displayableMessages.length, isLoading, lastMessageHash, shouldAutoScroll, userScrolled]);

  return {
    parentRef,
    userScrolled,
    setUserScrolled,
    setShouldAutoScroll
  };
}
