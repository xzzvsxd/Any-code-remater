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
