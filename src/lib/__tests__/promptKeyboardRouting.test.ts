import { describe, expect, test } from 'vitest';
import { resolveFilePickerKeyboardAction } from '../../components/FilePickerKeyboardPolicy';
import { resolveSlashCommandMenuKeyboardAction } from '../../components/FloatingPromptInput/slashCommandKeyboardPolicy';

describe('prompt keyboard routing', () => {
  test('lets plain Enter pass through the file picker so the prompt input can submit', () => {
    expect(resolveFilePickerKeyboardAction({
      key: 'Enter',
      shiftKey: false,
    })).toBe('pass-through');
  });

  test('uses unshifted Tab, not Enter, to select from the file picker', () => {
    expect(resolveFilePickerKeyboardAction({
      key: 'Tab',
      shiftKey: false,
    })).toBe('select');

    expect(resolveFilePickerKeyboardAction({
      key: 'Tab',
      shiftKey: true,
    })).toBe('pass-through');
  });

  test('lets plain Enter pass through the slash command menu so the prompt input can submit', () => {
    expect(resolveSlashCommandMenuKeyboardAction({
      key: 'Enter',
      shiftKey: false,
      hasSelectedCommand: true,
    })).toBe('pass-through');
  });

  test('uses unshifted Tab, not Enter, to select from the slash command menu', () => {
    expect(resolveSlashCommandMenuKeyboardAction({
      key: 'Tab',
      shiftKey: false,
      hasSelectedCommand: true,
    })).toBe('select');

    expect(resolveSlashCommandMenuKeyboardAction({
      key: 'Tab',
      shiftKey: true,
      hasSelectedCommand: true,
    })).toBe('pass-through');
  });
});
