import { describe, expect, test } from 'vitest';
import { resolvePromptActionButtonState } from '../../components/FloatingPromptInput/promptActionButtonState';

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
