import React, { useImperativeHandle, forwardRef, useEffect, useRef } from "react";
import { motion } from "framer-motion";
import { useVirtualizer } from "@tanstack/react-virtual";
import { StreamMessageV2 } from "@/components/message";
import { MessageBranchButton } from "@/components/message/MessageBranchButton";
import type { MessageGroup } from "@/lib/subagentGrouping";
import { useSession } from "@/contexts/SessionContext";
import { CliProcessingIndicator } from "./CliProcessingIndicator";
import type { ExecutionStatusInfo } from "@/components/FloatingPromptInput/types";
import { evaluateBottomScrollFrame } from "./bottomScrollStabilizer";
import { shouldPreserveScrollAnchorOnMeasuredSizeChange } from "./virtualizerScrollAdjustmentPolicy";
import {
  SESSION_MESSAGES_OVERSCAN,
  estimateMessageGroupHeight,
} from "./messageHeightEstimate";

/**
 * 虚拟列表行。
 *
 * 只把 DOM 节点交给 TanStack Virtual 的 measureElement。
 * 不再叠加组件自己的 ResizeObserver：TanStack Virtual 内部已经会观察被测元素，
 * 双 observer 会在长历史/顶部区域制造重复测量和 rAF 风暴，表现为滚动抖动与卡顿。
 */
const MeasurableItem = ({ virtualItem, itemKey, measureElement, children, ...props }: any) => {
  return (
    <div
      {...props}
      ref={measureElement}
      data-index={virtualItem.index}
      data-item-key={itemKey}
    >
      {children}
    </div>
  );
};

export interface SessionMessagesRef {
  scrollToPrompt: (promptIndex: number) => void;
  /** 滚动到底部（使用虚拟列表的 scrollToIndex，解决消息过多时滚动不到底的问题） */
  scrollToBottom: () => void;
  /** 滚动到顶部（虚拟列表感知 + followUp 校正，避免高度重测把滚动位置顶飞/中断） */
  scrollToTop: () => void;
}

/**
 * ✅ 架构优化: 简化 Props 接口，移除可从 SessionContext 获取的数据
 *
 * 优化前: 10+ 个 props，包含配置、回调和会话数据
 * 优化后: 只保留核心渲染相关的 props
 *
 * 从 SessionContext 获取:
 * - claudeSettings → settings
 * - effectiveSession → session, sessionId, projectId, projectPath
 * - handleLinkDetected → onLinkDetected
 * - handleRevert → onRevert
 * - getPromptIndexForMessage → getPromptIndexForMessage
 */
interface SessionMessagesProps {
  messageGroups: MessageGroup[];
  isLoading: boolean;
  error?: string | null;
  parentRef: React.RefObject<HTMLDivElement>;
  executionStatus?: ExecutionStatusInfo;
  /** 取消执行回调 - 用于CLI风格处理指示器 */
  onCancel?: () => void;
}

export const SessionMessages = forwardRef<SessionMessagesRef, SessionMessagesProps>(({
  messageGroups,
  isLoading,
  error,
  parentRef,
  executionStatus,
  onCancel
}, ref) => {
  // ✅ 从 SessionContext 获取配置和回调，避免 Props Drilling
  const { settings, sessionId, projectId, projectPath, onLinkDetected, onRevert, getPromptIndexForMessage, onBranch, getBranchPromptIndexForMessage } = useSession();

  // 消息组的稳定身份 key：用于 useVirtualizer 的 getItemKey 与高度缓存。
  // 关键（修复 streaming 期间对话窗口上下乱跳/一直闪）：
  // 默认虚拟列表按「索引」缓存测量值，消息重新分组(normal↔aggregated)或重渲染时缓存易失效，
  // 退回粗估 estimateSize → 行高在「估算值↔真实值」间反复跳变 → 整列内容平移、肉眼可见地闪。
  // 改用基于消息身份的稳定 key，让测量缓存跨重渲染存活，从源头消除跳变。
  const getGroupKey = (group: MessageGroup | undefined, index: number): string => {
    if (!group) return `idx-${index}`;
    if (group.type === 'subagent') return `sub-${group.group.id}`;
    if (group.type === 'aggregated') return `agg-${group.index}`;
    return `n-${group.index}`;
  };

  // 已测量行的真实高度缓存（key -> 高度）。estimateSize 优先返回缓存值，
  // 使未在窗口内的行也能用「上次测得的真实高度」占位，而非粗估，避免重测时整列跳动。
  const measuredHeightsRef = useRef<Map<string, number>>(new Map());
  const bottomScrollRafRef = useRef<number>(0);
  const promptScrollRafRef = useRef<number>(0);
  const promptScrollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const promptScrollSearchTokenRef = useRef(0);
  const cancelBottomScrollLoop = () => {
    if (bottomScrollRafRef.current) {
      cancelAnimationFrame(bottomScrollRafRef.current);
      bottomScrollRafRef.current = 0;
    }
  };
  const cancelPromptScrollSearch = () => {
    promptScrollSearchTokenRef.current += 1;
    if (promptScrollRafRef.current) {
      cancelAnimationFrame(promptScrollRafRef.current);
      promptScrollRafRef.current = 0;
    }
    if (promptScrollTimeoutRef.current) {
      clearTimeout(promptScrollTimeoutRef.current);
      promptScrollTimeoutRef.current = null;
    }
  };

  /**
   * ✅ OPTIMIZED: Virtual list configuration for improved performance
   */
  const rowVirtualizer = useVirtualizer({
    count: messageGroups.length,
    getItemKey: (index) => getGroupKey(messageGroups[index], index),
    getScrollElement: () => parentRef.current,
    estimateSize: (index) => {
      // ✅ Dynamic height estimation based on message group type
      const messageGroup = messageGroups[index];
      if (!messageGroup) return 200;

      // 优先返回「已测得的真实高度」：避免未在窗口内的行用粗估占位，
      // 重新进入窗口测量时高度从估算值跳到真实值，导致整列平移闪动。
      // 例外：正在 streaming 的最后一行高度时刻在变，缓存的是滞后旧值，会低估 totalSize、
      // 让视图停在「离底一点点」（表现为贴底时被往上弹）。该行不读缓存，交给实时测量驱动粘底。
      const isStreamingRow = isLoading && index === messageGroups.length - 1;
      if (!isStreamingRow) {
        const cached = measuredHeightsRef.current.get(getGroupKey(messageGroup, index));
        if (cached) return cached;
      }

      return estimateMessageGroupHeight(messageGroups[index]);
    },
    overscan: SESSION_MESSAGES_OVERSCAN,
    // 让 TanStack Virtual 把 ResizeObserver 测量合并进 rAF。
    // WebKitGTK/Windows WebView 下，长消息和代码块重排会连续触发 RO；
    // 直接同步测量会造成布局抖动和顶部历史滚动卡顿。
    useAnimationFrameWithResizeObserver: true,
    measureElement: (element) => {
      // Ensure element is fully rendered before measurement
      const el = element as HTMLElement;
      const height = el?.getBoundingClientRect().height ?? 200;
      // 写入高度缓存（key 来自 MeasurableItem 设置的 data-item-key），
      // 供 estimateSize 复用真实高度，消除重测时的整列跳动。
      // 例外：正在 streaming 的最后一行高度时刻在变，不写缓存——否则会留下滞后旧值，
      // 下次 estimateSize 用它低估 totalSize，把贴底视图往上弹。
      const key = el?.getAttribute?.('data-item-key');
      const idxAttr = el?.getAttribute?.('data-index');
      const isStreamingRow = isLoading && idxAttr !== null && Number(idxAttr) === messageGroups.length - 1;
      if (key && height > 0 && !isStreamingRow) {
        measuredHeightsRef.current.set(key, height);
      }
      return height;
    },
  });

  rowVirtualizer.shouldAdjustScrollPositionOnItemSizeChange = (item) => {
    const el = parentRef.current;
    const scrollOffset = el?.scrollTop ?? rowVirtualizer.scrollOffset ?? 0;
    const clientHeight = el?.clientHeight ?? rowVirtualizer.scrollRect?.height ?? 0;
    const scrollHeight = el?.scrollHeight ?? rowVirtualizer.getTotalSize();
    const distanceFromBottom = Math.max(0, scrollHeight - scrollOffset - clientHeight);

    return shouldPreserveScrollAnchorOnMeasuredSizeChange({
      itemStart: item.start,
      scrollOffset,
      distanceFromBottom,
      bottomSettleActive: bottomScrollRafRef.current !== 0,
    });
  };

  // 切换会话时清空高度缓存：不同会话的消息 key 可能因 index 复用而碰撞，
  // 旧高度会污染新会话首屏布局。会话切换不频繁，清空成本可忽略。
  useEffect(() => {
    cancelBottomScrollLoop();
    cancelPromptScrollSearch();
    measuredHeightsRef.current.clear();
  }, [sessionId]);

  // 如果历史/空闲态的一次性置底循环尚未结束，随后会话进入 streaming，
  // 必须立即撤销该 imperative settle。streaming 期间底部跟随只允许
  // useSmartAutoScroll 写 scrollTop，否则两套 rAF 会在底部抢位置造成抽动。
  useEffect(() => {
    if (!isLoading) return;
    cancelBottomScrollLoop();
  }, [isLoading]);

  useEffect(() => {
    return () => {
      cancelBottomScrollLoop();
      cancelPromptScrollSearch();
    };
  }, []);

  useImperativeHandle(ref, () => ({
    scrollToBottom: () => {
      if (messageGroups.length === 0) return;
      // streaming 时不允许启动这里的长 settle 循环；粘底已由
      // useSmartAutoScroll 统一接管。这里的早退也防住旧闭包/外部 ref
      // 误调用 scrollToBottom 后重新制造双 rAF 抢写。
      if (isLoading) return;
      cancelBottomScrollLoop();
      cancelPromptScrollSearch();

      // Use virtualizer's scrollToIndex for reliable scrolling to the last item
      rowVirtualizer.scrollToIndex(messageGroups.length - 1, {
        align: 'end',
        behavior: 'auto',
      });

      // 进入会话/切换会话时的稳定置底：虚拟列表的真实行高是渐进测量的（先用 estimateSize 估算，
      // 再由 ResizeObserver 逐项测真值），totalSize 会在数百毫秒内持续变化。固定两三档 followUp
      // 不足以覆盖长会话的高度重测，导致停在"离底很远的随机位置"。
      // 这里改用 rAF 轮询：持续把视图钉到底，直到「连续若干帧 scrollHeight 不再变化且已贴底」
      // 或达到超时上限才停止，无论会话多长都能稳定落底。
      let rafId = 0;
      const startTs = performance.now();
      const MAX_DURATION = 2400; // ms 超时上限，覆盖大会话的渐进重测
      const MIN_SETTLE_DURATION = 800; // ms 最短稳定窗口，覆盖代码高亮/折叠块等延迟测高
      const STABLE_FRAMES = 4;   // 连续稳定帧数
      // 历史/空闲初始置底必须比 streaming 粘底更严格。
      // 16px 死区适合吸收流式微抖，但初次进入会话时会把 2~16px 的晚到测高漂移误判为
      // “已贴底”，从而留下肉眼可见的底部空隙/上弹。这里仅保留 2px 亚像素容差。
      const INITIAL_BOTTOM_THRESHOLD = 2;
      let stableCount = 0;
      let lastScrollHeight = -1;

      const step = () => {
        const el = parentRef.current;
        if (!el) return;

        const { scrollTop, scrollHeight, clientHeight } = el;
        const decision = evaluateBottomScrollFrame({
          scrollTop,
          scrollHeight,
          clientHeight,
          lastScrollHeight,
          stableCount,
          stableFrames: STABLE_FRAMES,
          elapsedMs: performance.now() - startTs,
          minSettleMs: MIN_SETTLE_DURATION,
          bottomThresholdPx: INITIAL_BOTTOM_THRESHOLD,
        });
        lastScrollHeight = scrollHeight;
        stableCount = decision.nextStableCount;

        if (!decision.atBottom) {
          // 仍未贴底：用虚拟列表把末项顶进窗口，并直接钉到底，双保险。
          rowVirtualizer.scrollToIndex(messageGroups.length - 1, { align: 'end', behavior: 'auto' });
        }

        if (decision.shouldWriteScrollTop) {
          // 只写合法最大 scrollTop；不要写 scrollHeight 让浏览器 clamp，避免 WebKit 上来回修正。
          el.scrollTop = decision.targetScrollTop;
        }

        if (decision.done) {
          bottomScrollRafRef.current = 0;
          return; // 稳定落底，结束
        }
        if (performance.now() - startTs > MAX_DURATION) {
          bottomScrollRafRef.current = 0;
          return; // 超时兜底
        }
        rafId = requestAnimationFrame(step);
        bottomScrollRafRef.current = rafId;
      };

      rafId = requestAnimationFrame(step);
      bottomScrollRafRef.current = rafId;
    },
    scrollToTop: () => {
      if (messageGroups.length === 0) return;
      cancelBottomScrollLoop();
      cancelPromptScrollSearch();

      // 用虚拟列表 scrollToIndex(0) 而非裸 scrollTo({top:0,smooth})：
      // 顶部 item 真实高度与估算不符会触发高度重测、改变 totalSize，smooth 动画期间会被"顶飞/中断"。
      // scrollToIndex 让虚拟列表先把首项渲染就位，再用 followUp 校正到真正的 top:0。
      rowVirtualizer.scrollToIndex(0, {
        align: 'start',
        behavior: 'auto',
      });

      const followUpDelays = [60, 200];
      followUpDelays.forEach((delay) => {
        setTimeout(() => {
          requestAnimationFrame(() => {
            if (parentRef.current && parentRef.current.scrollTop > 1) {
              parentRef.current.scrollTo({ top: 0, behavior: 'auto' });
            }
          });
        }, delay);
      });
    },
    scrollToPrompt: (promptIndex: number) => {
      cancelBottomScrollLoop();
      cancelPromptScrollSearch();
      const searchToken = promptScrollSearchTokenRef.current;

      // Find the targetGroupIndex for the given promptIndex.
      // Uses getPromptIndexForMessage to ensure counting logic matches backend
      // (excludes warmup/skill/sidechain/tool-result-only non-real user inputs)
      let targetGroupIndex = -1;

      for (let i = 0; i < messageGroups.length; i++) {
        const group = messageGroups[i];

        // Only check normal-type user messages
        if (group.type === 'normal' && group.message.type === 'user') {
          if (getPromptIndexForMessage) {
            const msgPromptIndex = getPromptIndexForMessage(group.index);
            if (msgPromptIndex === promptIndex) {
              targetGroupIndex = i;
              break;
            }
          }
        }
      }

      if (targetGroupIndex === -1) {
        console.warn(`[Prompt Navigation] Prompt #${promptIndex} not found in ${messageGroups.length} groups`);
        return;
      }

      // Step 1: Use 'auto' (instant) behavior so the virtualizer immediately
      // renders items near the target area, instead of 'smooth' which delays
      // rendering until the scroll animation reaches the target viewport
      rowVirtualizer.scrollToIndex(targetGroupIndex, {
        align: 'center',
        behavior: 'auto',
      });

      // Step 2: Robust element finding with rAF + retry mechanism.
      // The virtualizer needs time to measure and render the target row
      // after the scroll position changes.
      let attempts = 0;
      const maxAttempts = 24; // 提高重试预算至 ~2.4s，覆盖大会话加载/高度重测的慢路径
      const pollInterval = 100; // ms between retries

      const tryFindAndHighlight = () => {
        if (promptScrollSearchTokenRef.current !== searchToken) return;
        attempts++;
        const element = document.getElementById(`prompt-${promptIndex}`);

        if (element) {
          // 命中后用“容器内精确 delta 校正”对齐真实 DOM 锚点。
          // 只用 virtualizer.scrollToIndex 时，长消息/折叠工具/图片等动态高度可能让目标
          // 停在偏上位置；直接 element.scrollIntoView 又会和虚拟列表的窗口滚动互相打架。
          // 因此这里不调用浏览器全局滚动，而是在父滚动容器内按元素真实 rect 微调到居中。
          const parent = parentRef.current;
          if (parent) {
            const parentRect = parent.getBoundingClientRect();
            const elementRect = element.getBoundingClientRect();
            const targetTop =
              parent.scrollTop
              + (elementRect.top - parentRect.top)
              - Math.max(0, (parent.clientHeight - elementRect.height) / 2);
            parent.scrollTo({
              top: Math.max(0, targetTop),
              behavior: 'auto',
            });
          }

          try {
            element.animate(
              [
                { boxShadow: '0 0 0 3px rgba(59, 130, 246, 0.6)' },
                { boxShadow: '0 0 0 3px rgba(59, 130, 246, 0)' },
              ],
              { duration: 1500, easing: 'ease-out' }
            );
          } catch {
            // Web Animations API not available - silently ignore
          }
          return;
        }

        if (attempts < maxAttempts) {
          // 每次未命中都重新 scrollToIndex，把目标行"顶"进渲染窗口（而非每 3 次一次）。
          // 这是大会话定位需点多遍的根因之一：目标 DOM 长期不在窗口内，轮询白白耗尽。
          rowVirtualizer.scrollToIndex(targetGroupIndex, {
            align: 'center',
            behavior: 'auto',
          });
          promptScrollTimeoutRef.current = setTimeout(() => {
            promptScrollTimeoutRef.current = null;
            tryFindAndHighlight();
          }, pollInterval);
        } else {
          console.warn(`[Prompt Navigation] Element #prompt-${promptIndex} not found after ${maxAttempts} attempts`);
        }
      };

      // Wait for two animation frames to let the virtualizer process
      // the scroll and render the target area before searching for the element
      promptScrollRafRef.current = requestAnimationFrame(() => {
        if (promptScrollSearchTokenRef.current !== searchToken) return;
        promptScrollRafRef.current = requestAnimationFrame(() => {
          promptScrollRafRef.current = 0;
          tryFindAndHighlight();
        });
      });
    }
  }));

  return (
    // ✅ 重构布局: 移除固定 paddingBottom，因为输入框不再使用 fixed 定位
    // 消息区域现在是 Flex 容器的一部分，自然与输入区域分离
    <div
      ref={parentRef}
      className="session-message-scroll flex-1 overflow-y-auto relative"
      onWheelCapture={cancelBottomScrollLoop}
      onTouchStartCapture={cancelBottomScrollLoop}
      onPointerDownCapture={cancelBottomScrollLoop}
      style={{
        paddingTop: '20px',
        paddingBottom: '24px', // 底部留一点间距即可
        // 关闭浏览器 scroll anchoring：虚拟列表用绝对定位 + 固定容器高度「手动」管理滚动位置，
        // 浏览器自带的锚定会在内容高度变化时擅自改 scrollTop 保持锚点可见，与 react-virtual 的
        // 高度补偿、与 performAutoScroll 粘底三方打架，是 streaming 期间向上翻动「鬼畜抖动」的干扰源之一。
        overflowAnchor: 'none',
      }}
    >
      <div
        className="relative w-full max-w-5xl lg:max-w-6xl xl:max-w-7xl 2xl:max-w-[85%] mx-auto px-4 pt-8 pb-4"
        style={{
          height: `${Math.max(rowVirtualizer.getTotalSize(), 100)}px`,
          minHeight: '100px',
        }}
      >
        {rowVirtualizer.getVirtualItems().map((virtualItem) => {
          const messageGroup = messageGroups[virtualItem.index];

          // 防御性检查：确保 messageGroup 存在
          if (!messageGroup) {
            console.warn('[SessionMessages] messageGroup is undefined for index:', virtualItem.index);
            return null;
          }

            const message = messageGroup.type === 'normal' ? messageGroup.message : null;
            const originalIndex = messageGroup.type === 'normal' ? messageGroup.index : undefined;
            const promptIndex = message && message.type === 'user' && originalIndex !== undefined && getPromptIndexForMessage
              ? getPromptIndexForMessage(originalIndex)
              : undefined;

            // 分支锚点：仅对「用户消息 / 助手最终回复 / 中断消息」允许分支。
            // 聚合的工具/思考过程、子代理入口卡片不是对话节点，不显示分支按钮。
            const branchableMessage = messageGroup.type === 'normal' ? messageGroup.message : null;
            const isInterruption =
              branchableMessage?.type === 'system' &&
              (branchableMessage?.subtype === 'execution-cancelled' ||
                branchableMessage?.subtype === 'execution-error');
            const isFinalAssistantReply =
              branchableMessage?.type === 'assistant';
            const canBranchThisGroup =
              branchableMessage?.type === 'user' || isFinalAssistantReply || isInterruption;

            const branchAnchorIndex =
              messageGroup.type === 'normal' ? messageGroup.index : undefined;
            const branchPromptIndex =
              canBranchThisGroup && branchAnchorIndex !== undefined && getBranchPromptIndexForMessage
                ? getBranchPromptIndexForMessage(branchAnchorIndex)
                : -1;

            const isStreaming = virtualItem.index === messageGroups.length - 1 && isLoading;

            return (
              <MeasurableItem
                key={virtualItem.key}
                virtualItem={virtualItem}
                itemKey={virtualItem.key}
                measureElement={rowVirtualizer.measureElement}
                className="absolute inset-x-4 top-0"
                style={{
                  transform: `translateY(${virtualItem.start}px)`,
                }}
              >
                {/* group 容器：hover 时在右上角显示分支按钮，不打断现有消息渲染 */}
                <div className="relative group/msg">
                  {/* ✅ 架构优化: StreamMessageV2 现在从 SessionContext 获取数据 */}
                  <StreamMessageV2
                    messageGroup={messageGroup}
                    onLinkDetected={onLinkDetected}
                    claudeSettings={settings}
                    isStreaming={isStreaming}
                    promptIndex={promptIndex}
                    sessionId={sessionId ?? undefined}
                    projectId={projectId ?? undefined}
                    projectPath={projectPath}
                    onRevert={onRevert}
                  />
                  {/* 分支按钮：仅可分支节点显示，且像复制按钮一样 hover 才浮现 */}
                  {!isStreaming && branchPromptIndex >= 0 && (
                    <div className="absolute top-1 right-1 z-20 opacity-0 group-hover/msg:opacity-100 transition-opacity">
                      <MessageBranchButton
                        branchPromptIndex={branchPromptIndex}
                        onBranch={onBranch}
                      />
                    </div>
                  )}
                </div>
              </MeasurableItem>
            );
          })}
      </div>

      {/* CLI风格的处理状态指示器 - 显示在消息列表底部 */}
      <CliProcessingIndicator
        isProcessing={isLoading && messageGroups.length > 0}
        onCancel={onCancel}
        engineName={executionStatus?.engineName}
        elapsedSeconds={executionStatus?.elapsedSeconds}
        idleSeconds={executionStatus?.idleSeconds}
        canCancel={executionStatus?.canCancel}
        isCancelling={executionStatus?.isCancelling}
      />

      {/* Error indicator - 移除固定 marginBottom，因为输入框不再是 fixed 定位 */}
      {error && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive w-full max-w-5xl mx-auto mb-4"
        >
          {error}
        </motion.div>
      )}
    </div>
  );
});

SessionMessages.displayName = "SessionMessages";
