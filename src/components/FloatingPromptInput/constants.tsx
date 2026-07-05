import { Zap, Brain, Sparkles, Crown } from "lucide-react";
import { ModelConfig, ThinkingModeConfig, ClaudeModelFamily } from "./types";

/**
 * Claude 模型家族数据源（UI 与解析的单一事实来源，DRY）。
 *
 * 版本 model ID 依据官方文档（platform.claude.com 模型总览 / code.claude.com 模型配置）：
 * - `sonnet` 别名现解析到 Sonnet 5，`opus` → Opus 4.8。要钉具体版本须用完整 model ID。
 * - Sonnet 5 与 Fable 5 原生自带 1M 上下文，对其使用 `[1m]` 后缀无效（故 supports1m=false, native1m=true）。
 * - 1M 开关仅对 Sonnet 4.6 / Opus 4.6/4.7/4.8 有实际意义。Haiku 仅 200K，不支持 1M。
 *
 * 启用 1M 时发送 `id + "[1m]"`，与既有 `claude-opus-4-8[1m]` 约定一致。
 */
export const CLAUDE_MODEL_FAMILIES: ClaudeModelFamily[] = [
  {
    key: "haiku",
    label: "Haiku",
    icon: <Zap className="h-4 w-4" />,
    versions: [
      {
        id: "claude-haiku-4-5",
        label: "Haiku 4.5",
        description: "The fastest model with near-frontier intelligence",
        supports1m: false,
        isLatest: true,
      },
    ],
  },
  {
    key: "sonnet",
    label: "Sonnet",
    icon: <Brain className="h-4 w-4" />,
    versions: [
      {
        id: "claude-sonnet-5",
        label: "Sonnet 5",
        description: "The best combination of speed and intelligence",
        supports1m: false,
        native1m: true,
        isLatest: true,
      },
      {
        id: "claude-sonnet-4-6",
        label: "Sonnet 4.6",
        description: "Fast and efficient for most coding tasks",
        supports1m: true,
      },
    ],
  },
  {
    key: "opus",
    label: "Opus",
    icon: <Sparkles className="h-4 w-4" />,
    versions: [
      {
        id: "claude-opus-4-8",
        label: "Opus 4.8",
        description: "For complex agentic coding and enterprise work",
        supports1m: true,
        isLatest: true,
      },
      {
        id: "claude-opus-4-7",
        label: "Opus 4.7",
        description: "Previous-generation Opus for complex reasoning",
        supports1m: true,
      },
      {
        id: "claude-opus-4-6",
        label: "Opus 4.6",
        description: "Earlier Opus release",
        supports1m: true,
      },
    ],
  },
  {
    key: "fable",
    label: "Fable",
    icon: <Crown className="h-4 w-4" />,
    versions: [
      {
        id: "claude-fable-5",
        label: "Fable 5",
        description: "Next-generation intelligence for long-running agents",
        supports1m: false,
        native1m: true,
        isLatest: true,
      },
    ],
  },
];

/**
 * 获取 Claude 模型家族列表。
 * 目前为静态数据；保留函数形态以便未来接入缓存/动态型号发现。
 */
export function getModelFamilies(): ClaudeModelFamily[] {
  return CLAUDE_MODEL_FAMILIES;
}

/**
 * 将 UI 选择（版本 id + 是否 1M）编码为发送给后端的 model 字符串。
 * 原生 1M 或不支持 1M 的型号忽略 useOneMillion，直接返回基础 id。
 */
export function encodeClaudeModel(versionId: string, useOneMillion: boolean): string {
  const version = CLAUDE_MODEL_FAMILIES
    .flatMap((f) => f.versions)
    .find((v) => v.id === versionId);
  if (useOneMillion && version?.supports1m) {
    return `${versionId}[1m]`;
  }
  return versionId;
}

/**
 * 将发送/存储用的 model 字符串解析回 UI 选择（版本 id + 是否 1M）。
 * 兼容旧别名（sonnet/opus/sonnet1m/opus1m/fable）与完整 model ID（含 [1m] 后缀）。
 * 无法识别时返回 null，交由调用方兜底。
 */
export function decodeClaudeModel(
  model: string | null | undefined
): { versionId: string; oneMillion: boolean } | null {
  if (!model || typeof model !== "string") return null;
  const raw = model.trim();
  if (!raw) return null;

  // 1M 检测：兼容 [1m] 后缀、-1m/_1m 分隔，以及旧别名无分隔写法（opus1m/sonnet1m）。
  const oneMillion = /\[1m\]|[-_]1m\b|\d?1m$|\b1m\b/i.test(raw);
  // 去除各种 1M 标记，得到基础串
  const base = raw
    .replace(/\[1m\]/i, "")
    .replace(/[-_]1m\b/i, "")
    .replace(/1m$/i, "")
    .trim();
  const lower = base.toLowerCase();

  const allVersions = CLAUDE_MODEL_FAMILIES.flatMap((f) => f.versions);

  // 0) 旧别名 sonnet1m / opus1m 的历史语义：sonnet1m→Sonnet 4.6+1M（sonnet 现指向 5），opus1m→Opus 4.8+1M
  if (lower === "sonnet" && /sonnet1m/i.test(raw)) {
    return { versionId: "claude-sonnet-4-6", oneMillion: true };
  }

  // 1) 完整 model ID 直接命中
  const direct = allVersions.find((v) => v.id.toLowerCase() === lower);
  if (direct) return { versionId: direct.id, oneMillion };

  // 2) 旧别名映射到各家族"最新"版本
  const latestOf = (key: string) =>
    CLAUDE_MODEL_FAMILIES.find((f) => f.key === key)?.versions.find((v) => v.isLatest)
    ?? CLAUDE_MODEL_FAMILIES.find((f) => f.key === key)?.versions[0];

  if (lower === "fable") {
    const v = latestOf("fable");
    return v ? { versionId: v.id, oneMillion } : null;
  }
  if (lower === "opus") {
    const v = latestOf("opus");
    return v ? { versionId: v.id, oneMillion } : null;
  }
  if (lower === "haiku") {
    const v = latestOf("haiku");
    return v ? { versionId: v.id, oneMillion } : null;
  }
  if (lower === "sonnet") {
    const v = latestOf("sonnet");
    return v ? { versionId: v.id, oneMillion } : null;
  }

  // 3) 模糊按家族关键字 + 版本号兜底（如 "claude-sonnet-4-6-20260101"）
  const byFamily = (kw: string, key: string) => {
    if (!lower.includes(kw)) return null;
    // 优先匹配含相同版本号的已知版本
    const fam = CLAUDE_MODEL_FAMILIES.find((f) => f.key === key);
    const hit = fam?.versions.find((v) => lower.includes(v.id.toLowerCase().replace(/^claude-[a-z]+-/, "")));
    const chosen = hit ?? fam?.versions.find((v) => v.isLatest) ?? fam?.versions[0];
    return chosen ? { versionId: chosen.id, oneMillion } : null;
  };
  return (
    byFamily("fable", "fable") ||
    byFamily("opus", "opus") ||
    byFamily("haiku", "haiku") ||
    byFamily("sonnet", "sonnet")
  );
}

/**
 * 向后兼容：由家族结构派生扁平 ModelConfig 列表。
 * 仍被 index.tsx（availableModels）与 resolveSelectedModelName / ContextWindowIndicator 消费。
 * 每个"最新"版本以其完整 model ID 作为条目 id。
 */
export function getModels(): ModelConfig[] {
  return CLAUDE_MODEL_FAMILIES.flatMap((family) =>
    family.versions.map((v) => ({
      id: v.id,
      name: `Claude ${v.label}`,
      description: v.description,
      icon: family.icon,
    }))
  );
}

/**
 * Static model list for backward compatibility.
 * Prefer using getModelFamilies() for the new selector UI.
 */
export const MODELS: ModelConfig[] = getModels();

/**
 * Thinking modes configuration
 * Claude Code adaptive thinking with effort levels.
 * Controls thinking depth via CLAUDE_CODE_EFFORT_LEVEL env var.
 *
 * Note: Names and descriptions are translation keys that will be resolved at runtime
 */
export const THINKING_MODES: ThinkingModeConfig[] = [
  {
    id: "off",
    name: "promptInput.thinkingModeOff",
    description: "promptInput.normalSpeed",
    level: 0,
  },
  {
    id: "adaptive",
    effort: "low",
    name: "promptInput.thinkingEffortLow",
    description: "promptInput.thinkingEffortLowDesc",
    level: 1,
  },
  {
    id: "adaptive",
    effort: "medium",
    name: "promptInput.thinkingEffortMedium",
    description: "promptInput.thinkingEffortMediumDesc",
    level: 2,
  },
  {
    id: "adaptive",
    effort: "high",
    name: "promptInput.thinkingEffortHigh",
    description: "promptInput.thinkingEffortHighDesc",
    level: 3,
  },
  {
    id: "adaptive",
    effort: "xhigh",
    name: "promptInput.thinkingEffortXHigh",
    description: "promptInput.thinkingEffortXHighDesc",
    level: 4,
  }
];
