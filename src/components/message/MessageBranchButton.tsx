import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { GitBranch, Loader2 } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

interface MessageBranchButtonProps {
  /** 该消息可用的分支 promptIndex；< 0 时不渲染 */
  branchPromptIndex: number;
  /** 发起分支 */
  onBranch?: (promptIndex: number) => void | Promise<void>;
  className?: string;
}

/**
 * 消息级「分支」按钮。
 *
 * 悬浮在消息角落，点击后从该消息所属那一轮对话分叉出一个新会话（原会话保留）。
 * 适用于用户消息、助手最终回复、以及中断消息——只要能回溯到一个有效的用户提示词。
 */
export const MessageBranchButton: React.FC<MessageBranchButtonProps> = ({
  branchPromptIndex,
  onBranch,
  className,
}) => {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);

  if (branchPromptIndex < 0 || !onBranch) {
    return null;
  }

  const handleClick = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (busy) return;
    try {
      setBusy(true);
      await onBranch(branchPromptIndex);
    } finally {
      setBusy(false);
    }
  };

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={handleClick}
            disabled={busy}
            className={cn(
              "flex items-center justify-center h-6 w-6 rounded-md border border-border/50 bg-background/80 backdrop-blur-sm shadow-sm text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-60",
              className
            )}
          >
            {busy ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <GitBranch className="h-3.5 w-3.5" />
            )}
          </button>
        </TooltipTrigger>
        <TooltipContent>{t("message.branchFromHere", "从这里分支")}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
};

export default MessageBranchButton;
