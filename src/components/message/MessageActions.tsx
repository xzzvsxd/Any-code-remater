import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { Copy, Check, RefreshCw, Edit2, AlertCircle, GitBranch, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { clipboardService } from "@/lib/clipboard";

interface MessageActionsProps {
  content: string;
  branchPromptIndex?: number;
  onBranch?: (promptIndex: number) => void | Promise<void>;
  onRegenerate?: () => void;
  onEdit?: () => void;
  className?: string;
}

export const MessageActions: React.FC<MessageActionsProps> = ({
  content,
  branchPromptIndex = -1,
  onBranch,
  onRegenerate,
  onEdit,
  className,
}) => {
  const { t } = useTranslation();
  const [copyState, setCopyState] = useState<"idle" | "success" | "error">("idle");
  const [branchBusy, setBranchBusy] = useState(false);
  const canBranch = branchPromptIndex >= 0 && Boolean(onBranch);

  const handleBranch = async (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    if (!canBranch || branchBusy || !onBranch) return;

    try {
      setBranchBusy(true);
      await onBranch(branchPromptIndex);
    } finally {
      setBranchBusy(false);
    }
  };

  const handleCopy = async () => {
    try {
      await clipboardService.writeText(content);
      setCopyState("success");
    } catch (error) {
      console.error("[MessageActions] Copy failed:", error);
      setCopyState("error");
    } finally {
      setTimeout(() => setCopyState("idle"), 2000);
    }
  };

  const copyTooltip =
    copyState === "success"
      ? t("messages.copied")
      : copyState === "error"
        ? t("session.copyFailed")
        : t("session.copyToClipboard");

  return (
    <TooltipProvider>
      <div className={cn(
        "flex items-center gap-1 bg-background/80 backdrop-blur-sm border border-border/50 rounded-md shadow-sm p-1 transition-all",
        className
      )}>
        {canBranch && (
          <>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  onClick={handleBranch}
                  disabled={branchBusy}
                  className="h-6 w-6 text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-60"
                >
                  {branchBusy ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <GitBranch className="h-3.5 w-3.5" />
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t("message.branchFromHere", "从这里分支")}</TooltipContent>
            </Tooltip>
            <div aria-hidden="true" className="h-4 w-px bg-border/70" />
          </>
        )}

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              onClick={handleCopy}
              className="h-6 w-6 text-muted-foreground hover:text-foreground hover:bg-muted"
            >
              {copyState === "success" ? (
                <Check className="h-3.5 w-3.5 text-green-500" />
              ) : copyState === "error" ? (
                <AlertCircle className="h-3.5 w-3.5 text-destructive" />
              ) : (
                <Copy className="h-3.5 w-3.5" />
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent>{copyTooltip}</TooltipContent>
        </Tooltip>

        {onRegenerate && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                onClick={onRegenerate}
                className="h-6 w-6 text-muted-foreground hover:text-foreground hover:bg-muted"
              >
                <RefreshCw className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t('message.regenerate')}</TooltipContent>
          </Tooltip>
        )}

        {onEdit && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                onClick={onEdit}
                className="h-6 w-6 text-muted-foreground hover:text-foreground hover:bg-muted"
              >
                <Edit2 className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t('message.editMessage')}</TooltipContent>
          </Tooltip>
        )}
      </div>
    </TooltipProvider>
  );
};
