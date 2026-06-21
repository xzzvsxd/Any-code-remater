import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const repoRoot = process.cwd();

const systemInitializedSource = readFileSync(
  resolve(repoRoot, 'src/components/widgets/system/SystemInitializedWidget.tsx'),
  'utf8',
);

const toolsListSource = readFileSync(
  resolve(repoRoot, 'src/components/widgets/system/components/ToolsList.tsx'),
  'utf8',
);

describe('system initialized render safety', () => {
  test('memoizes static system init widgets so streaming updates do not rebuild tool lists', () => {
    expect(systemInitializedSource).toContain('React.memo<SystemInitializedWidgetProps>');
    expect(systemInitializedSource).toContain('const formattedTimestamp = useMemo(');
    expect(systemInitializedSource).not.toContain('{formatTimestamp(timestamp) &&');

    expect(toolsListSource).toContain('React.memo<ToolsListProps>');
    expect(toolsListSource).toContain('const regularTools = useMemo(');
    expect(toolsListSource).toContain('const mcpToolsByProvider = useMemo(');
  });

  test('tool list render is stable when equivalent tools arrays are recreated', () => {
    expect(toolsListSource).toContain('areToolListsEqual');
    expect(toolsListSource).toContain('splitToolsForDisplay');
    expect(toolsListSource).toContain('React.memo<ToolsListProps>(');
    expect(toolsListSource).toContain('areToolListsEqual(prev.tools, next.tools)');
    expect(toolsListSource).not.toContain('tools.filter(tool =>');
  });
});
