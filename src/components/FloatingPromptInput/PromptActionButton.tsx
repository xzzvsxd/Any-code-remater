import React from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import type { ExecutionStatusInfo } from "./types";
import { resolvePromptActionButtonState } from "./promptActionButtonState";

interface PromptActionButtonProps {
  disabled?: boolean;
  isLoading: boolean;
  prompt: string;
  hasAttachments?: boolean;
  executionStatus?: ExecutionStatusInfo;
  onCancel: () => void;
  onSend: () => void;
}

const PromptActionButtonComponent: React.FC<PromptActionButtonProps> = ({
  disabled,
  isLoading,
  prompt,
  hasAttachments = false,
  executionStatus,
  onCancel,
  onSend,
}) => {
  const { t } = useTranslation();
  const canCancelExecution = !executionStatus || executionStatus.canCancel;
  const isCancellingExecution = executionStatus?.isCancelling === true;
  const actionButtonState = resolvePromptActionButtonState({
    isLoading,
    prompt,
    hasAttachments,
    disabled,
    canCancelExecution,
    isCancellingExecution,
  });

  if (actionButtonState.mode === 'cancel') {
    return (
      <div className="flex flex-col items-end gap-1">
        <Button
          onClick={onCancel}
          variant="destructive"
          size="default"
          disabled={actionButtonState.disabled}
          title={
            !canCancelExecution
              ? '正在启动进程，拿到当前会话 ID 后即可安全取消'
              : '只取消当前会话，不影响其他对话'
          }
          className="h-8 shadow-md bg-red-500 hover:bg-red-600 dark:bg-red-600 dark:hover:bg-red-700 text-white font-medium disabled:cursor-not-allowed disabled:opacity-70"
        >
          {isCancellingExecution ? '取消中...' : t('buttons.cancel')}
        </Button>
        {!canCancelExecution && (
          <span className="max-w-44 text-[10px] leading-tight text-muted-foreground text-right">
            启动中，等待会话 ID...
          </span>
        )}
      </div>
    );
  }

  return (
    <Button
      onClick={onSend}
      disabled={actionButtonState.disabled}
      size="default"
      className="h-8 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white shadow-sm transition-all duration-200"
    >
      {t('promptInput.send')}
    </Button>
  );
};

export const PromptActionButton = React.memo(PromptActionButtonComponent);
PromptActionButton.displayName = "PromptActionButton";
