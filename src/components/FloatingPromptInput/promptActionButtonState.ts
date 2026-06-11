export type PromptActionButtonMode = 'send' | 'cancel';

export interface PromptActionButtonStateInput {
  isLoading: boolean;
  prompt: string;
  hasAttachments: boolean;
  disabled?: boolean;
  canCancelExecution: boolean;
  isCancellingExecution: boolean;
}

export interface PromptActionButtonState {
  mode: PromptActionButtonMode;
  disabled: boolean;
}

export interface PromptEnterSubmitInput {
  key: string;
  shiftKey: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  isExpanded: boolean;
  isFilePickerOpen: boolean;
  actionMode: PromptActionButtonMode;
  actionDisabled: boolean;
  isComposing: boolean;
  nativeIsComposing?: boolean;
  keyCode?: number;
  which?: number;
  timeSinceCompositionEndMs: number;
}

export function resolvePromptActionButtonState(input: PromptActionButtonStateInput): PromptActionButtonState {
  const hasPromptText = input.prompt.trim().length > 0;
  const showCancel = input.isLoading && !hasPromptText;

  if (showCancel) {
    return {
      mode: 'cancel',
      disabled: Boolean(input.disabled || !input.canCancelExecution || input.isCancellingExecution),
    };
  }

  return {
    mode: 'send',
    disabled: Boolean(input.disabled || (!hasPromptText && !input.hasAttachments)),
  };
}

export function shouldSubmitPromptFromEnterKey(input: PromptEnterSubmitInput): boolean {
  if (input.key !== 'Enter') return false;
  if (input.shiftKey) return false;
  if (input.isFilePickerOpen) return false;
  if (input.actionMode !== 'send' || input.actionDisabled) return false;

  const isIMEProcessing =
    input.isComposing ||
    input.nativeIsComposing === true ||
    input.keyCode === 229 ||
    input.which === 229 ||
    input.timeSinceCompositionEndMs < 200;

  if (isIMEProcessing) return false;

  if (!input.isExpanded) {
    return true;
  }

  return input.ctrlKey === true || input.metaKey === true;
}
