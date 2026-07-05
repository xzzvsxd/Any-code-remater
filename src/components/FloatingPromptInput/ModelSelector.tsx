import React from "react";
import { useTranslation } from "react-i18next";
import { ChevronUp, Check, Star, Brain, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover } from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { ModelType, ThinkingEffort, ClaudeModelVersion, ClaudeModelFamily, ModelConfig } from "./types";
import {
  getModelFamilies,
  encodeClaudeModel,
  decodeClaudeModel,
  THINKING_MODES,
} from "./constants";
import { getDefaultModel, setDefaultModel } from "./defaultModelStorage";
import { ThinkingModeIndicator } from "./ThinkingModeIndicator";

interface ModelSelectorProps {
  /** 当前选中的模型（真实 model 串，如 "claude-sonnet-5" / "claude-opus-4-6[1m]"，或旧别名） */
  selectedModel: ModelType;
  onModelChange: (model: ModelType) => void;
  disabled?: boolean;
  /** 当前思考模式（"off" | "adaptive"） */
  selectedThinkingMode?: string;
  /** 当前思考程度 */
  selectedThinkingEffort?: ThinkingEffort;
  /** 直接设置思考程度（传 'off' 表示关闭）。整合进本弹窗底部 */
  onSetThinkingEffort?: (effort: ThinkingEffort | "off") => void;
  /** 环境变量自定义模型（非内置家族）。存在时作为附加"自定义"家族显示 */
  extraModels?: ModelConfig[];
}

/** effort 分段选项（顺序：Off → Low → Med → High → XHigh），复用 THINKING_MODES 的等级色阶 */
const EFFORT_SEGMENTS: Array<{ key: ThinkingEffort | "off"; level: number; labelKey: string }> =
  THINKING_MODES.map((m) => ({
    key: (m.id === "off" ? "off" : (m.effort as ThinkingEffort)),
    level: m.level,
    labelKey: m.name,
  }));

/**
 * ModelSelector —— 三段式模型选择弹窗
 *
 * 1) 家族 Tab（Haiku / Sonnet / Opus / Fable）
 * 2) 家族下版本列表（含勾选 + 星标设默认）
 * 3) 底部整合区：1M 上下文开关（仅 supports1m 版本）+ 思考程度分段
 */
export const ModelSelector: React.FC<ModelSelectorProps> = ({
  selectedModel,
  onModelChange,
  disabled = false,
  selectedThinkingMode,
  selectedThinkingEffort,
  onSetThinkingEffort,
  extraModels,
}) => {
  const { t } = useTranslation();
  const [open, setOpen] = React.useState(false);
  const [currentDefaultModel, setCurrentDefaultModel] = React.useState<ModelType | null>(
    () => getDefaultModel()
  );

  // 内置家族 + 可选的自定义模型家族（来自环境变量）。
  const families: ClaudeModelFamily[] = React.useMemo(() => {
    const base = getModelFamilies();
    if (extraModels && extraModels.length > 0) {
      const customFamily: ClaudeModelFamily = {
        key: "custom",
        label: "自定义",
        icon: <Sparkles className="h-4 w-4" />,
        versions: extraModels.map((m) => ({
          id: m.id,
          label: m.name,
          description: m.description,
          supports1m: false,
        })),
      };
      return [...base, customFamily];
    }
    return base;
  }, [extraModels]);

  // 解析当前选择 → {versionId, oneMillion}
  // 1) 先在全量家族（含自定义）里按真实 id 直接匹配（自定义模型无法被 decodeClaudeModel 识别）
  // 2) 再交给 decodeClaudeModel 处理内置别名/模糊串
  // 3) 都不中则回落到第一个家族的最新版
  const oneMillionInSelected = /\[1m\]|[-_]1m\b|\b1m\b/i.test(selectedModel || "");
  const selectedBase = (selectedModel || "").replace(/\[1m\]/i, "").trim();
  const directMatch = families
    .flatMap((f) => f.versions)
    .find((v) => v.id === selectedBase || v.id === selectedModel);
  const decoded = directMatch
    ? { versionId: directMatch.id, oneMillion: oneMillionInSelected }
    : decodeClaudeModel(selectedModel);
  const fallbackVersion = families[0].versions.find((v) => v.isLatest) || families[0].versions[0];
  const activeVersionId = decoded?.versionId || fallbackVersion.id;
  const activeOneMillion = decoded?.oneMillion || false;

  const activeFamily =
    families.find((f) => f.versions.some((v) => v.id === activeVersionId)) || families[0];
  const activeVersion =
    activeFamily.versions.find((v) => v.id === activeVersionId) || activeFamily.versions[0];
  const isCustomFamily = activeFamily.key === "custom";

  // 弹窗内浏览中的家族（点 Tab 切换，不立即改模型）
  const [browsingFamilyKey, setBrowsingFamilyKey] = React.useState(activeFamily.key);
  React.useEffect(() => {
    if (open) setBrowsingFamilyKey(activeFamily.key);
  }, [open, activeFamily.key]);

  const browsingFamily = families.find((f) => f.key === browsingFamilyKey) || activeFamily;

  // Trigger 上显示的当前选择信息（自定义模型直接用其 label，不加 "Claude " 前缀）
  const effectiveOneMillion = activeVersion.native1m || (activeVersion.supports1m && activeOneMillion);
  const triggerLabel = isCustomFamily ? activeVersion.label : `Claude ${activeVersion.label}`;

  const thinkingOn = selectedThinkingMode === "adaptive";
  const currentEffortKey: ThinkingEffort | "off" = thinkingOn ? (selectedThinkingEffort || "high") : "off";

  // 选中某版本：保留当前 1M 意图（若新版本支持），编码后回调
  const handleSelectVersion = (version: ClaudeModelVersion) => {
    const keep1m = version.supports1m && activeOneMillion;
    onModelChange(encodeClaudeModel(version.id, keep1m));
  };

  // 切换 1M 开关（仅对 supports1m 版本有效）
  const handleToggleOneMillion = (next: boolean) => {
    if (!activeVersion.supports1m) return;
    onModelChange(encodeClaudeModel(activeVersion.id, next));
  };

  // 设为默认（星标）
  const handleSetDefault = (e: React.MouseEvent, version: ClaudeModelVersion) => {
    e.stopPropagation();
    const encoded = encodeClaudeModel(version.id, version.supports1m && activeOneMillion);
    setDefaultModel(encoded);
    setCurrentDefaultModel(encoded);
  };

  const isDefaultVersion = (version: ClaudeModelVersion) => {
    const decodedDefault = currentDefaultModel ? decodeClaudeModel(currentDefaultModel) : null;
    return decodedDefault?.versionId === version.id;
  };

  return (
    <Popover
      trigger={
        <Button
          variant="outline"
          size="sm"
          disabled={disabled}
          className="h-8 gap-2 min-w-[160px] justify-start border-border/50 bg-background/50 hover:bg-accent/50"
        >
          {activeFamily.icon}
          <span className="flex-1 text-left truncate">{triggerLabel}</span>
          {effectiveOneMillion && (
            <span className="text-[10px] font-semibold text-primary/80 px-1 rounded bg-primary/10">
              1M
            </span>
          )}
          {thinkingOn && (
            <ThinkingModeIndicator
              level={EFFORT_SEGMENTS.find((s) => s.key === currentEffortKey)?.level || 0}
            />
          )}
          {isDefaultVersion(activeVersion) && (
            <Star className="h-3 w-3 text-yellow-500 fill-yellow-500" />
          )}
          <ChevronUp className="h-4 w-4 opacity-50" />
        </Button>
      }
      content={
        <div className="w-[380px] p-2">
          {/* 标题 */}
          <div className="px-1 pb-2 text-xs text-muted-foreground border-b border-border/50 mb-2">
            选择模型（点击星标设为新会话默认）
          </div>

          {/* 1) 家族 Tab */}
          <div className="flex items-center gap-1 mb-2">
            {families.map((family) => (
              <button
                key={family.key}
                onClick={() => setBrowsingFamilyKey(family.key)}
                className={cn(
                  "flex-1 flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-md text-sm transition-colors",
                  browsingFamilyKey === family.key
                    ? "bg-accent text-foreground font-medium"
                    : "text-muted-foreground hover:bg-accent/50"
                )}
              >
                {family.icon}
                <span>{family.label}</span>
              </button>
            ))}
          </div>

          {/* 2) 版本列表 */}
          <div className="space-y-0.5">
            {browsingFamily.versions.map((version) => {
              const isActive = version.id === activeVersionId;
              return (
                <button
                  key={version.id}
                  onClick={() => handleSelectVersion(version)}
                  className={cn(
                    "w-full flex items-start gap-3 p-2.5 rounded-md transition-colors text-left group",
                    "hover:bg-accent",
                    isActive && "bg-accent"
                  )}
                >
                  <div className="mt-0.5">{browsingFamily.icon}</div>
                  <div className="flex-1 space-y-0.5">
                    <div className="font-medium text-sm flex items-center gap-2">
                      {browsingFamily.key === "custom" ? version.label : `Claude ${version.label}`}
                      {version.isLatest && (
                        <span className="text-[10px] font-normal text-muted-foreground px-1 rounded bg-muted">
                          最新
                        </span>
                      )}
                      {version.native1m && (
                        <span className="text-[10px] font-semibold text-primary/80 px-1 rounded bg-primary/10">
                          原生 1M
                        </span>
                      )}
                      {isActive && <Check className="h-3.5 w-3.5 text-primary" />}
                    </div>
                    <div className="text-xs text-muted-foreground">{version.description}</div>
                  </div>
                  <button
                    onClick={(e) => handleSetDefault(e, version)}
                    className={cn(
                      "mt-0.5 p-1 rounded hover:bg-muted transition-colors",
                      isDefaultVersion(version)
                        ? "text-yellow-500"
                        : "text-muted-foreground/50 hover:text-muted-foreground opacity-0 group-hover:opacity-100"
                    )}
                    title={isDefaultVersion(version) ? "当前默认模型" : "设为默认模型"}
                  >
                    <Star
                      className={cn("h-4 w-4", isDefaultVersion(version) && "fill-yellow-500")}
                    />
                  </button>
                </button>
              );
            })}
          </div>

          {/* 3) 底部整合区 */}
          <div className="mt-2 pt-2 border-t border-border/50 space-y-2.5">
            {/* 1M 上下文开关 */}
            {activeVersion.native1m ? (
              <div className="flex items-center justify-between px-1 text-xs">
                <span className="text-muted-foreground">1M 上下文</span>
                <span className="text-primary/80 font-medium">原生已启用</span>
              </div>
            ) : activeVersion.supports1m ? (
              <div className="flex items-center justify-between px-1">
                <div className="flex flex-col">
                  <span className="text-sm">1M 上下文</span>
                  <span className="text-[11px] text-muted-foreground">
                    百万 token 长上下文窗口
                  </span>
                </div>
                <Switch
                  checked={activeOneMillion}
                  onCheckedChange={handleToggleOneMillion}
                  disabled={disabled}
                />
              </div>
            ) : (
              <div className="flex items-center justify-between px-1 text-xs">
                <span className="text-muted-foreground">1M 上下文</span>
                <span className="text-muted-foreground/60">该模型不支持</span>
              </div>
            )}

            {/* 思考程度分段 */}
            {onSetThinkingEffort && (
              <div className="px-1">
                <div className="flex items-center gap-1.5 mb-1.5 text-sm">
                  <Brain className="h-3.5 w-3.5" />
                  <span>思考程度</span>
                </div>
                <div className="flex items-center gap-1">
                  {EFFORT_SEGMENTS.map((seg) => {
                    const active = seg.key === currentEffortKey;
                    return (
                      <button
                        key={seg.key}
                        onClick={() => onSetThinkingEffort(seg.key)}
                        className={cn(
                          "flex-1 flex flex-col items-center gap-1 py-1.5 px-1 rounded-md border transition-colors",
                          active
                            ? "bg-accent border-primary/40 text-foreground"
                            : "border-transparent text-muted-foreground hover:bg-accent/50"
                        )}
                        title={t(seg.labelKey)}
                      >
                        <ThinkingModeIndicator level={seg.level} />
                        <span className="text-[10px] leading-none">
                          {seg.key === "off"
                            ? t("promptInput.thinkingOff", "关闭")
                            : seg.key === "low"
                              ? "Low"
                              : seg.key === "medium"
                                ? "Med"
                                : seg.key === "high"
                                  ? "High"
                                  : "XHigh"}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      }
      open={open}
      onOpenChange={setOpen}
      align="start"
      side="top"
    />
  );
};
