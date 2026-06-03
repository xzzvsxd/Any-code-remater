import type { ModelType, ModelConfig } from "./types";

/**
 * 将 UI 选中的模型解析为真实模型名。
 *
 * selectedModel 是 UI 下拉别名（sonnet/opus/sonnet1m/opus1m/custom）。当选中自定义模型时，
 * 'custom' 字面量本身不携带真实模型 ID（如 claude-opus-4-8[1m]），需要回查 availableModels
 * 取出 custom 项的 name 才能得到真实名称。
 *
 * 该函数是「custom → 真实名」解析的唯一来源（DRY），同时服务于：
 * - 发送消息时确定传给后端的模型（handleSendPrompt）
 * - 上下文窗口大小计算（ContextWindowIndicator 的 model 入参）
 *
 * 任何一处单独内联此逻辑都会埋下「改了一处忘改另一处」的隐患。
 *
 * @param selectedModel 当前 UI 选中的模型别名
 * @param availableModels 可用模型列表（含可能存在的 custom 项）
 * @returns 真实模型名；非 custom 或未找到 custom 配置时原样返回 selectedModel
 */
export function resolveSelectedModelName(
  selectedModel: ModelType,
  availableModels: ModelConfig[],
): string {
  if (selectedModel === "custom") {
    const customModelConfig = availableModels.find((m) => m.id === "custom");
    if (customModelConfig?.name) {
      return customModelConfig.name;
    }
  }
  return selectedModel;
}
