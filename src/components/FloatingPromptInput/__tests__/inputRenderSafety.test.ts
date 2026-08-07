import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const floatingPromptInputSource = readFileSync(
  resolve(process.cwd(), 'src/components/FloatingPromptInput/index.tsx'),
  'utf8',
);

const inputAreaSource = readFileSync(
  resolve(process.cwd(), 'src/components/FloatingPromptInput/InputArea.tsx'),
  'utf8',
);

const controlBarSource = readFileSync(
  resolve(process.cwd(), 'src/components/FloatingPromptInput/ControlBar.tsx'),
  'utf8',
);

const promptActionButtonSource = readFileSync(
  resolve(process.cwd(), 'src/components/FloatingPromptInput/PromptActionButton.tsx'),
  'utf8',
);

describe('floating prompt input render safety', () => {
  test('uses stable callback props for heavy child controls', () => {
    expect(floatingPromptInputSource).toContain('NOOP_CANCEL_HANDLER');
    expect(floatingPromptInputSource).toContain('const effectiveOnCancel = onCancel ?? NOOP_CANCEL_HANDLER');
    expect(floatingPromptInputSource).toContain('const setExecutionEngineConfig = useCallback');
    expect(floatingPromptInputSource).toContain('const setSelectedModel = useCallback');
    expect(floatingPromptInputSource).toContain('const setEnableProjectContext = useCallback');
    expect(floatingPromptInputSource).not.toContain('onCancel || (() => {})');
  });

  test('batches textarea height measurement into animation frames', () => {
    expect(floatingPromptInputSource).toContain('heightAdjustFrameRef');
    expect(floatingPromptInputSource).toContain('requestAnimationFrame(() => {');
    expect(floatingPromptInputSource).toContain('cancelTextareaHeightAdjust');
    expect(floatingPromptInputSource).not.toContain("setTimeout(() => {\n        const textarea = state.isExpanded ? expandedTextareaRef.current : textareaRef.current;");
  });

  test('keeps compact textarea autosizing on the CSS layout path', () => {
    expect(inputAreaSource).toContain('data-prompt-autosize-mirror');
    expect(inputAreaSource).not.toContain("style={{ height: 'auto' }}");
    expect(floatingPromptInputSource).toContain('if (!state.isExpanded) {');
    expect(floatingPromptInputSource).toContain('expandedTextareaRef.current');
  });

  test('isolates dynamic text from Linux WebKit backdrop-filter layers', () => {
    expect(inputAreaSource).toContain('data-prompt-input-backdrop');
    expect(inputAreaSource).toContain('transform-gpu');
    expect(floatingPromptInputSource).toContain('data-prompt-input-glass-layer');
    expect(floatingPromptInputSource).not.toContain('bg-[var(--glass-bg)] backdrop-blur-[var(--glass-blur)] shadow');
  });

  test('keeps prompt churn out of the heavy control bar', () => {
    expect(controlBarSource).not.toContain('prompt: string;');
    expect(controlBarSource).not.toContain('resolvePromptActionButtonState');
    expect(promptActionButtonSource).toContain('resolvePromptActionButtonState');
    expect(promptActionButtonSource).toContain('React.memo');
    expect(floatingPromptInputSource).toContain('<PromptActionButton');
  });

  test('defers suggestion work behind urgent keystroke rendering', () => {
    expect(floatingPromptInputSource).toContain('useDeferredValue');
    expect(floatingPromptInputSource).toContain('currentPrompt: promptForSuggestion');
  });

  test('memoizes the input area so streaming parent churn does not re-render static chrome', () => {
    expect(inputAreaSource).toContain('React.memo');
    expect(inputAreaSource).toContain('InputAreaComponent');
  });
});
