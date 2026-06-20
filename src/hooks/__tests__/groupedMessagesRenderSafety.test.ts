import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const groupedMessagesSource = readFileSync(
  resolve(process.cwd(), 'src/hooks/useGroupedMessages.ts'),
  'utf8',
);

const subagentGroupingSource = readFileSync(
  resolve(process.cwd(), 'src/lib/subagentGrouping.ts'),
  'utf8',
);

describe('grouped messages render safety', () => {
  test('uses append-only grouping cache for common streaming updates', () => {
    expect(groupedMessagesSource).toContain('GroupedMessagesCache');
    expect(groupedMessagesSource).toContain('canUseAppendFastPath');
    expect(groupedMessagesSource).toContain('appendNormalGroup');
    expect(groupedMessagesSource).toContain('for (let index = cache.processedLength; index < messages.length; index++)');
  });

  test('falls back to full grouping for subagent messages that can rewrite earlier groups', () => {
    expect(groupedMessagesSource).toContain('isSubagentMessage(message)');
    expect(groupedMessagesSource).toContain('return null');
  });

  test('exports technical message classifier for safe incremental aggregation', () => {
    expect(subagentGroupingSource).toContain('export function getTechnicalMessageType');
  });
});
