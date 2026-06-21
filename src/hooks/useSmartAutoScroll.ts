/**
 * 智能自动滚动 Hook
 *
 * 提供消息列表的粘底能力，同时允许用户在处理中自由上滑查看历史消息。
 * 只有当用户明确回到底部附近时，才重新开启自动滚动。
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import type { ClaudeStreamMessage } from '@/types/claude';
import {
  shouldFollowResizeToBottom,
  shouldRunStickyAutoScroll,
} from './smartAutoScrollPolicy';
import { shouldMarkDownwardIntentFromScrollDelta } from './smartAutoScrollIntentPolicy';

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
const PRECISE_BOTTOM_THRESHOLD = 2;
// 贴底死区：离底在此像素内一律视为"已贴底"，不再触发任何滚动。
// 根治"一直闪"的关键——流式期间消息区有持续改变高度的元素（光标/loading/思考动画、
// 代码高亮异步重排），会让虚拟列表 totalSize 持续微幅摆动。若每帧都去对齐这个摆动的目标，
// scrollTop 就被反复微调、肉眼可见地一直闪。设一个略大于"半行"的死区吸收这些微抖：
// 只有真正的新内容（通常 ≥ 一行 ~20px，超过死区）才触发跟随，且一次追到底。
const STICK_BOTTOM_DEADBAND = 16;
const PROGRAMMATIC_SCROLL_GUARD_MS = 120;
const DIRECT_SCROLL_GESTURE_WINDOW_MS = 1000;

/**
 * 轻量估算消息内容长度，用于检测最后一条消息是否发生了“足以重启粘底循环”的变化。
 *
 * 不能在这里 JSON.stringify：最后一条消息可能是大段工具输出 / 代码 / MCP 结果。
 * streaming 期间每次 displayableMessages 变化都会走这里，完整 stringify 会复制整段内容并阻塞
 * WebKit 主线程。这里只读取已知字段的 string.length，不创建大字符串副本。
 */
function getMessageContentLengthHint(value: unknown): number {
  if (value == null) return 0;
  if (typeof value === 'string') return value.length;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value).length;

  if (Array.isArray(value)) {
    let total = 0;
    for (const item of value) {
      total += getMessageContentLengthHint(item);
    }
    return total;
  }

  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    let total = 0;

    if (typeof record.text === 'string') total += record.text.length;
    if (typeof record.content === 'string') total += record.content.length;
    if (typeof record.result === 'string') total += record.result.length;
    if (typeof record.name === 'string') total += record.name.length;
    if (typeof record.type === 'string') total += record.type.length;

    // 对嵌套对象只加入 key 数量作为结构变化提示，避免深层 stringify/递归复制大对象。
    return total + Object.keys(record).length;
  }

  return 0;
}

function getLastMessageContentHash(messages: ClaudeStreamMessage[]): string {
  if (messages.length === 0) return '';

  const lastMessage = messages[messages.length - 1];
  const contentLength = getMessageContentLengthHint(lastMessage.message?.content);

  return `${messages.length}-${lastMessage.type}-${contentLength}`;
}

/**
 * 获取距离底部的像素距离
 */
function getDistanceFromBottom(element: HTMLDivElement): number {
  return element.scrollHeight - element.scrollTop - element.clientHeight;
}

interface AutoScrollOptions {
  precise?: boolean;
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
  // 标记“最近一次滚动是用户主动向下滚的”。这是恢复粘底的硬性意图闸门：
  // streaming 期间向上翻动时，虚拟列表渐进测量上方行真实高度 → react-virtual 增大 scrollOffset
  // 做高度补偿 → 某些帧“离底距离”被瞬间压到接近 0（假性贴底）。仅靠距离判断会把这种补偿
  // 误判为“用户回到底部”而恢复粘底，随即被 rAF 循环 slam 到底 —— 这正是“向上翻被鬼畜回滚”的根因。
  // 高度补偿不会产生向下意图，所以要求“贴底 + 有向下意图”双条件后，补偿造成的假贴底永不误恢复。
  const userIntentDownwardRef = useRef(false);
  // 记录上一帧 scrollTop，用于在 scroll 事件里甄别“真·向下滚动”与“高度补偿被动位移”。
  const lastScrollTopRef = useRef(0);
  // 自动贴底写 scrollTop 后，浏览器会派发 scroll 事件；这些事件不能反过来被当成用户意图。
  const programmaticScrollUntilRef = useRef(0);
  // 滚动条拖拽/触摸/滚轮/键盘等直接输入后的短窗口。只有这个窗口内的 scrollTop 增大，
  // 才作为“用户想回到底部”的兜底信号；虚拟列表测高补偿不带直接输入，不能恢复粘底。
  const directScrollGestureUntilRef = useRef(0);
  // ResizeObserver 在 WebKitGTK 下可能一帧内触发多次；用 rAF 合并，防止 RO 回调里直接
  // 读写 scrollHeight/scrollTop 造成同步布局风暴。
  const resizeFollowFrameRef = useRef(0);

  const lastMessageHash = useMemo(
    () => getLastMessageContentHash(displayableMessages),
    [displayableMessages]
  );

  /**
   * 同步自动滚动与“用户已离开底部”两个状态，避免它们互相打架。
   */
  const syncAutoScrollState = (enabled: boolean) => {
    userIntentReleasedRef.current = !enabled;
    userIntentDownwardRef.current = false;
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
   * 执行自动滚动到底部。返回本次是否实际滚动了。用户已离开底部时直接跳过。
   *
   * 两条铁律根除振荡：
   * 1) 死区（STICK_BOTTOM_DEADBAND）：离底在死区内一律不动 —— 吸收虚拟列表测量抖动与
   *    流式动画造成的高度微摆，这是"一直闪"的根治点。
   * 2) 只向下追、绝不向上跟随收缩：scrollTop 不会超过 target（浏览器自动 clamp），
   *    高度收缩浏览器会一次性修正，我们不主动制造向上滚动。
   * 全程瞬时（无 smooth）：粘底就是"钉在底部"，瞬时跳转才不会被高频更新打断。
   */
  const performAutoScroll = (options: AutoScrollOptions = {}): boolean => {
    if (!autoScrollEnabledRef.current) return false;

    const scrollElement = parentRef.current;
    if (!scrollElement) return false;

    const targetScrollTop = scrollElement.scrollHeight - scrollElement.clientHeight;
    const distance = targetScrollTop - scrollElement.scrollTop;
    const threshold = options.precise ? PRECISE_BOTTOM_THRESHOLD : STICK_BOTTOM_DEADBAND;
    // 落后不足死区：视为已贴底，不滚动（吸收微抖）。也覆盖高度收缩后 scrollTop 被 clamp 的情形。
    if (distance <= threshold) {
      return false;
    }

    programmaticScrollUntilRef.current = performance.now() + PROGRAMMATIC_SCROLL_GUARD_MS;
    lastScrollTopRef.current = targetScrollTop;
    scrollElement.scrollTop = targetScrollTop;
    return true;
  };

  useEffect(() => {
    const scrollElement = parentRef.current;
    if (!scrollElement) return;

    // 初始化基线：避免首个 scroll 事件用 scrollTop - 0 算出巨大正 delta 而误置向下意图。
    lastScrollTopRef.current = scrollElement.scrollTop;

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
      userIntentDownwardRef.current = false; // 上滑意图清除任何残留的向下意图
      syncAutoScrollState(false);
    };

    // 记录“用户主动向下滚动”意图。这是恢复粘底的钥匙：只有用户真的想回到底部时，
    // 才允许 handleScroll 在贴底时恢复粘底，从而把虚拟列表高度补偿造成的“假性贴底”挡在门外。
    const markDownwardIntent = (movingDown: boolean) => {
      if (movingDown) userIntentDownwardRef.current = true;
    };

    const markDirectScrollGesture = () => {
      directScrollGestureUntilRef.current = performance.now() + DIRECT_SCROLL_GESTURE_WINDOW_MS;
    };

    const handleWheel = (event: WheelEvent) => {
      if (event.deltaY !== 0) markDirectScrollGesture();
      releaseOnUserIntent(event.deltaY < 0);
      markDownwardIntent(event.deltaY > 0);
    };

    let touchStartY = 0;
    const handleTouchStart = (event: TouchEvent) => {
      touchStartY = event.touches[0]?.clientY ?? 0;
      markDirectScrollGesture();
    };
    const handleTouchMove = (event: TouchEvent) => {
      const currentY = event.touches[0]?.clientY ?? 0;
      markDirectScrollGesture();
      // 手指下滑（clientY 增大）= 内容上移 = 查看历史；手指上滑（clientY 减小）= 内容下移 = 回到底部
      releaseOnUserIntent(currentY > touchStartY);
      markDownwardIntent(currentY < touchStartY);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      const upKeys = ['ArrowUp', 'PageUp', 'Home'];
      const downKeys = ['ArrowDown', 'PageDown', 'End'];
      if (upKeys.includes(event.key) || downKeys.includes(event.key)) {
        markDirectScrollGesture();
      }
      releaseOnUserIntent(upKeys.includes(event.key));
      markDownwardIntent(downKeys.includes(event.key));
    };

    const handlePointerDown = () => {
      markDirectScrollGesture();
    };

    /**
     * scroll 事件只负责“回到底部时恢复粘底”，不再用 isAutoScrolling 标志屏蔽用户滚动，
     * 避免高频自动滚动期间把用户真实滚动一并吞掉。
     */
    const handleScroll = () => {
      // 通过 scrollTop 真实增大兜底捕获“向下意图”：拖动滚动条、点击轨道等不产生 wheel/touch 事件，
      // 但会让 scrollTop 增大。只有「增量明显（> 死区，排除高度补偿的微小被动位移）」才算意图。
      // 注意：虚拟列表高度补偿也会增大 scrollTop，但那是为保持锚点、幅度通常很小且伴随 scrollHeight 变化；
      // 这里用一个略大于死区的阈值过滤，宁可漏判（用户再滚一下即可）也不误判（误判=鬼畜回滚复发）。
      const currentScrollTop = scrollElement.scrollTop;
      const delta = currentScrollTop - lastScrollTopRef.current;
      lastScrollTopRef.current = currentScrollTop;
      const now = performance.now();
      const isProgrammatic = now <= programmaticScrollUntilRef.current;
      if (shouldMarkDownwardIntentFromScrollDelta({
        delta,
        deadband: STICK_BOTTOM_DEADBAND,
        isProgrammatic,
        hasRecentDirectUserIntent: now <= directScrollGestureUntilRef.current,
      })) {
        userIntentDownwardRef.current = true;
      }
      if (isProgrammatic) {
        cancelResumeConfirmation();
        return;
      }

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
      // 双重防线：
      //  ① 意图闸门：用户主动解除粘底后，必须检测到“向下意图”才允许恢复 —— 高度补偿造成的假贴底
      //     不带向下意图，永远被挡在门外（根治“向上翻被鬼畜回滚”）。
      //  ② 跨帧二次确认：仅当连续两帧都贴底，才认定真实回到底部，过滤单帧测量抖动。
      if (userIntentReleasedRef.current && !userIntentDownwardRef.current) {
        cancelResumeConfirmation();
        return;
      }
      cancelResumeConfirmation();
      resumeConfirmFrame = requestAnimationFrame(() => {
        resumeConfirmFrame = 0;
        if (!scrollElement.isConnected) return;
        const currentResumeThreshold = userIntentReleasedRef.current
          ? RESUME_AT_BOTTOM_THRESHOLD
          : RESUME_AUTO_SCROLL_THRESHOLD;
        if (getDistanceFromBottom(scrollElement) <= currentResumeThreshold) {
          userIntentReleasedRef.current = false;
          userIntentDownwardRef.current = false;
          syncAutoScrollState(true);
        }
      });
    };

    scrollElement.addEventListener('wheel', handleWheel, { passive: true });
    scrollElement.addEventListener('touchstart', handleTouchStart, { passive: true });
    scrollElement.addEventListener('touchmove', handleTouchMove, { passive: true });
    scrollElement.addEventListener('keydown', handleKeyDown);
    scrollElement.addEventListener('pointerdown', handlePointerDown, { passive: true });
    scrollElement.addEventListener('scroll', handleScroll, { passive: true });

    // 内容高度即时跟随：rAF 粘底循环靠 lastMessageHash 重启，有两个盲区——
    // ① streaming 平静期 settle 退出后，新内容到来时重启有一帧延迟；
    // ② 代码高亮异步重排会改变高度但内容长度不变（hash 不变）→ 不重启 → 不跟随。
    // 用 ResizeObserver 观察内容容器高度，任何高度变化且仍处于粘底态时立即追底。
    // performAutoScroll 自带死区 + 用户上滑解除保护，故与用户滚动、与 rAF 循环均不冲突
    //（scrollTop 调整不改内容尺寸，不会反过来触发本 observer，无循环）。
    let contentObserver: ResizeObserver | null = null;
    let resizeSettledFrames = 0;
    const cancelResizeFollow = () => {
      if (resizeFollowFrameRef.current) {
        cancelAnimationFrame(resizeFollowFrameRef.current);
        resizeFollowFrameRef.current = 0;
      }
    };
    const runResizeFollow = () => {
      resizeFollowFrameRef.current = 0;
      if (!shouldFollowResizeToBottom({
        isLoading,
        autoScrollEnabled: autoScrollEnabledRef.current,
      })) {
        return;
      }

      const didScroll = performAutoScroll();
      resizeSettledFrames = didScroll ? 0 : resizeSettledFrames + 1;

      if (resizeSettledFrames >= 3) {
        performAutoScroll({ precise: true });
        return;
      }

      resizeFollowFrameRef.current = requestAnimationFrame(runResizeFollow);
    };
    const scheduleResizeFollow = () => {
      if (!shouldFollowResizeToBottom({
        isLoading,
        autoScrollEnabled: autoScrollEnabledRef.current,
      })) {
        return;
      }
      resizeSettledFrames = 0;
      if (resizeFollowFrameRef.current) return;
      resizeFollowFrameRef.current = requestAnimationFrame(runResizeFollow);
    };
    const contentEl = scrollElement.firstElementChild;
    if (contentEl) {
      contentObserver = new ResizeObserver(() => {
        scheduleResizeFollow();
      });
      contentObserver.observe(contentEl);
    }

    return () => {
      cancelResumeConfirmation();
      cancelResizeFollow();
      contentObserver?.disconnect();
      scrollElement.removeEventListener('wheel', handleWheel);
      scrollElement.removeEventListener('touchstart', handleTouchStart);
      scrollElement.removeEventListener('touchmove', handleTouchMove);
      scrollElement.removeEventListener('keydown', handleKeyDown);
      scrollElement.removeEventListener('pointerdown', handlePointerDown);
      scrollElement.removeEventListener('scroll', handleScroll);
    };
  }, [isLoading]);

  /**
   * 统一的粘底驱动：由「真实新内容」驱动（依赖 lastMessageHash），而非每帧无脑 slam。
   *
   * 每次内容变化重启循环，持续把视图钉到底部，直到「连续若干帧都无需滚动」（已落在死区内，
   * performAutoScroll 返回 false）即停止释放 rAF。配合死区，纯高度微抖不会触发滚动，
   * 循环很快 settle 并退出，不再有"一直闪"。
   */
  useEffect(() => {
    if (!shouldRunStickyAutoScroll({
      messageCount: displayableMessages.length,
      isLoading,
      shouldAutoScroll,
      userScrolled,
    })) {
      return;
    }

    let rafId = 0;
    let settledFrames = 0;
    const SETTLE_FRAME_BUDGET = 6;

    const tick = () => {
      const didScroll = performAutoScroll();
      // 本帧无需滚动（已在死区内贴底）才累计稳定帧；一旦还需滚动就清零。
      if (didScroll) {
        settledFrames = 0;
      } else {
        settledFrames += 1;
      }
      if (settledFrames >= SETTLE_FRAME_BUDGET) {
        performAutoScroll({ precise: true });
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
