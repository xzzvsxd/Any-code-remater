export type FilePickerKeyboardAction =
  | 'close'
  | 'select'
  | 'previous'
  | 'next'
  | 'enter-directory'
  | 'back'
  | 'pass-through';

export interface FilePickerKeyboardInput {
  key: string;
  shiftKey?: boolean;
}

export function resolveFilePickerKeyboardAction(input: FilePickerKeyboardInput): FilePickerKeyboardAction {
  switch (input.key) {
    case 'Escape':
      return 'close';
    case 'Tab':
      return input.shiftKey ? 'pass-through' : 'select';
    case 'ArrowUp':
      return 'previous';
    case 'ArrowDown':
      return 'next';
    case 'ArrowRight':
      return 'enter-directory';
    case 'ArrowLeft':
      return 'back';
    default:
      return 'pass-through';
  }
}
