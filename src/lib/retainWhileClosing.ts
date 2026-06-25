import { useRef } from "react";

/**
 * 退场动画期间保留最后一次可见内容。
 *
 * Radix Dialog 在 open: true → false 时不会立刻卸载 Content，而是保持挂载
 * 约 200ms 播放退场动画。若此刻父级已把数据 props 清空（例如
 * pendingQuestion=null → questions=[]、sessionTitle/倒计时变空），对话框会在
 * 淡出过程中塌缩成只剩静态标题的「空壳鬼影」，肉眼可见地违和。
 *
 * 本 hook 在 open 为 true 时持续记录传入值，open 变 false 后返回最后一次记录值，
 * 使退场动画淡出的是「完整内容」而非空壳；下次 open 再用新值。
 */
export function useRetainedWhileClosing<T>(open: boolean, value: T): T {
  const ref = useRef(value);
  if (open) {
    ref.current = value;
  }
  return open ? value : ref.current;
}
