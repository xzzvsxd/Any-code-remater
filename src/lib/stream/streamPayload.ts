/**
 * streamPayload - 流式 emit payload 协议适配
 *
 * 背景（Linux/WebKit 卡死优化）：后端过去「来一行 emit 一行」，高频时 IPC 次数过多。
 * 现支持后端把同一调度窗口内的多行打包成数组一次 emit，减少 IPC 往返。
 *
 * 协议（前后端约定，向后兼容）：
 * - 单行：payload 为 string（旧格式，后端可继续发，前端照常处理）。
 * - 批量：payload 为 string[]（新格式，后端把多行 JSONL 合并为数组）。
 *
 * 全局事件（{ tab_id, payload }）的 payload 字段同样可为 string | string[]。
 *
 * 本 helper 把两种形态统一规整为「行数组」，调用方按行遍历即可，无需感知协议差异。
 */

/** 把单行 string 或多行 string[] 规整为行数组（过滤空行）。 */
export function normalizeStreamLines(payload: string | string[] | null | undefined): string[] {
  if (payload == null) return [];
  if (Array.isArray(payload)) {
    return payload.filter((line) => typeof line === 'string' && line.length > 0);
  }
  if (typeof payload === 'string') {
    return payload.length > 0 ? [payload] : [];
  }
  return [];
}
