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

  test('memoizes the input area so streaming parent churn does not re-render static chrome', () => {
    expect(inputAreaSource).toContain('React.memo');
    expect(inputAreaSource).toContain('InputAreaComponent');
  });
});
