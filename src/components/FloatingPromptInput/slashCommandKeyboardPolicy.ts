export type SlashCommandMenuKeyboardAction =
  | 'previous'
  | 'next'
  | 'select'
  | 'close'
  | 'pass-through';

export interface SlashCommandMenuKeyboardInput {
  key: string;
  shiftKey?: boolean;
  hasSelectedCommand: boolean;
}

export function resolveSlashCommandMenuKeyboardAction(
  input: SlashCommandMenuKeyboardInput,
): SlashCommandMenuKeyboardAction {
  switch (input.key) {
    case 'ArrowUp':
      return 'previous';
    case 'ArrowDown':
      return 'next';
    case 'Tab':
      return !input.shiftKey && input.hasSelectedCommand ? 'select' : 'pass-through';
    case 'Escape':
      return 'close';
    default:
      return 'pass-through';
  }
}
