import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const mcpWidgetSource = readFileSync(
  resolve(process.cwd(), 'src/components/widgets/mcp/MCPWidget.tsx'),
  'utf8',
);

const toolCallsGroupSource = readFileSync(
  resolve(process.cwd(), 'src/components/message/ToolCallsGroup.tsx'),
  'utf8',
);

const commandOutputWidgetSource = readFileSync(
  resolve(process.cwd(), 'src/components/widgets/execution/CommandOutputWidget.tsx'),
  'utf8',
);

const useToolTranslationSource = readFileSync(
  resolve(process.cwd(), 'src/components/widgets/common/useToolTranslation.ts'),
  'utf8',
);

describe('heavy tool output render safety', () => {
  test('MCPWidget keeps collapsed cards cheap and lazily builds large details only after expansion', () => {
    expect(mcpWidgetSource).toContain('getMcpContentSummary');
    expect(mcpWidgetSource).toContain('MCPExpandedDetails');
    expect(mcpWidgetSource).toContain('renderJsonBlock');
    expect(mcpWidgetSource).toContain('shouldRenderCodeBlockAsPlainText(inputString)');
  });

  test('fallback tool rendering keeps collapsed cards cheap and bounds previews', () => {
    expect(toolCallsGroupSource).toContain('getToolContentSummary');
    expect(toolCallsGroupSource).toContain('FallbackToolDetails');
    expect(toolCallsGroupSource).toContain('MAX_FALLBACK_PREVIEW_CHARS');
  });

  test('CommandOutputWidget limits ANSI/link parsing to bounded output previews', () => {
    expect(commandOutputWidgetSource).toContain('MAX_CLICKABLE_OUTPUT_CHARS');
    expect(commandOutputWidgetSource).toContain('getSafeOutputPreview');
    expect(commandOutputWidgetSource).toContain('shouldUsePlainTextOutput');
  });

  test('tool translation cache does not recreate translateContent after every cached result', () => {
    expect(useToolTranslationSource).toContain('translatedContentRef');
    expect(useToolTranslationSource).toContain('setCacheVersion');
    expect(useToolTranslationSource).toContain('React.useCallback(async (content: string, cacheKey: string) =>');
    expect(useToolTranslationSource).toContain('}, [])');
    expect(useToolTranslationSource).not.toContain('}, [translatedContent]');
  });
});
