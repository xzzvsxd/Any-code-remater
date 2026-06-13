import { describe, expect, test } from 'vitest';
import {
  resolvePromptActionButtonState,
  shouldSuppressPromptEnterNewline,
  shouldSubmitPromptFromEnterKey,
} from '../../components/FloatingPromptInput/promptActionButtonState';

describe('prompt action button state', () => {
  test('shows cancel while running only when the prompt text is empty', () => {
    expect(resolvePromptActionButtonState({
      isLoading: true,
      prompt: '',
      hasAttachments: false,
      disabled: false,
      canCancelExecution: true,
      isCancellingExecution: false,
    })).toMatchObject({
      mode: 'cancel',
      disabled: false,
    });
  });

  test('shows send while running when the prompt contains text', () => {
    expect(resolvePromptActionButtonState({
      isLoading: true,
      prompt: 'follow up',
      hasAttachments: false,
      disabled: false,
      canCancelExecution: true,
      isCancellingExecution: false,
    })).toMatchObject({
      mode: 'send',
      disabled: false,
    });
  });

  test('keeps whitespace-only running prompt as cancel', () => {
    expect(resolvePromptActionButtonState({
      isLoading: true,
      prompt: '   \n\t',
      hasAttachments: false,
      disabled: false,
      canCancelExecution: true,
      isCancellingExecution: false,
    }).mode).toBe('cancel');
  });

  test('keeps attachment-only running prompt as cancel', () => {
    expect(resolvePromptActionButtonState({
      isLoading: true,
      prompt: '',
      hasAttachments: true,
      disabled: false,
      canCancelExecution: true,
      isCancellingExecution: false,
    })).toMatchObject({
      mode: 'cancel',
      disabled: false,
    });
  });

  test('idle send remains disabled without text or attachments', () => {
    expect(resolvePromptActionButtonState({
      isLoading: false,
      prompt: '',
      hasAttachments: false,
      disabled: false,
      canCancelExecution: true,
      isCancellingExecution: false,
    })).toMatchObject({
      mode: 'send',
      disabled: true,
    });
  });
});

describe('prompt Enter submit shortcut', () => {
  const base = {
    key: 'Enter',
    shiftKey: false,
    ctrlKey: false,
    metaKey: false,
    isExpanded: false,
    isFilePickerOpen: false,
    actionMode: 'send' as const,
    actionDisabled: false,
    isComposing: false,
    nativeIsComposing: false,
    keyCode: 13,
    which: 13,
    timeSinceCompositionEndMs: 1000,
  };

  test('submits compact prompt on plain Enter when send is active', () => {
    expect(shouldSubmitPromptFromEnterKey(base)).toBe(true);
  });

  test('submits compact prompt on plain Enter right after composition ended when the key event is no longer composing', () => {
    expect(shouldSubmitPromptFromEnterKey({
      ...base,
      timeSinceCompositionEndMs: 50,
    })).toBe(true);
  });

  test('does not submit compact prompt when current action is cancel', () => {
    expect(shouldSubmitPromptFromEnterKey({
      ...base,
      actionMode: 'cancel',
    })).toBe(false);
  });

  test('does not submit compact prompt while a file picker owns Enter', () => {
    expect(shouldSubmitPromptFromEnterKey({
      ...base,
      isFilePickerOpen: true,
    })).toBe(false);
  });

  test('does not submit compact prompt on Shift+Enter', () => {
    expect(shouldSubmitPromptFromEnterKey({
      ...base,
      shiftKey: true,
    })).toBe(false);
  });

  test('submits expanded prompt on plain Enter too', () => {
    expect(shouldSubmitPromptFromEnterKey({
      ...base,
      isExpanded: true,
    })).toBe(true);

    expect(shouldSubmitPromptFromEnterKey({
      ...base,
      isExpanded: true,
      ctrlKey: true,
    })).toBe(true);

    expect(shouldSubmitPromptFromEnterKey({
      ...base,
      isExpanded: true,
      metaKey: true,
    })).toBe(true);

    expect(shouldSubmitPromptFromEnterKey({
      ...base,
      isExpanded: true,
      shiftKey: true,
    })).toBe(false);
  });

  test('does not submit while IME composition is active', () => {
    expect(shouldSubmitPromptFromEnterKey({
      ...base,
      isComposing: true,
    })).toBe(false);

    expect(shouldSubmitPromptFromEnterKey({
      ...base,
      nativeIsComposing: true,
    })).toBe(false);

    expect(shouldSubmitPromptFromEnterKey({
      ...base,
      keyCode: 229,
      which: 229,
    })).toBe(false);
  });

  test('suppresses compact prompt newline on plain Enter when it is not an IME event', () => {
    expect(shouldSuppressPromptEnterNewline(base)).toBe(true);
    expect(shouldSuppressPromptEnterNewline({
      ...base,
      isFilePickerOpen: false,
    })).toBe(true);
    expect(shouldSuppressPromptEnterNewline({
      ...base,
      shiftKey: true,
    })).toBe(false);
    expect(shouldSuppressPromptEnterNewline({
      ...base,
      isComposing: true,
    })).toBe(false);
  });
});
