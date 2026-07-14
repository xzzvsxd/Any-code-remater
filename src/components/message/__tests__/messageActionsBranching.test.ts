import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';

const readSource = (relativePath: string) =>
  readFileSync(new URL(relativePath, import.meta.url), 'utf8');

describe('merged message branch and copy actions', () => {
  test('renders branch before copy in MessageActions with one optional divider', () => {
    const source = readSource('../MessageActions.tsx');

    expect(source).toContain('branchPromptIndex?: number');
    expect(source).toContain('onBranch?: (promptIndex: number) => void | Promise<void>');
    expect(source).toContain('const canBranch = branchPromptIndex >= 0 && Boolean(onBranch)');
    expect(source.indexOf('<GitBranch')).toBeLessThan(source.indexOf('<Copy'));
    expect(source).toContain('{canBranch && (');
    expect(source).toContain('aria-hidden="true"');
  });

  test('threads branch props through the normal message renderer', () => {
    const streamSource = readSource('../StreamMessageV2.tsx');
    const aiSource = readSource('../AIMessage.tsx');
    const userSource = readSource('../UserMessage.tsx');

    expect(streamSource).toContain('branchPromptIndex?: number');
    expect(streamSource).toContain('onBranch?: (promptIndex: number) => void | Promise<void>');
    expect(aiSource).toContain('branchPromptIndex={branchPromptIndex}');
    expect(userSource).toContain('branchPromptIndex={branchPromptIndex}');
  });

  test('removes the independent SessionMessages branch overlay', () => {
    const sessionSource = readSource('../../session/SessionMessages.tsx');

    expect(sessionSource).not.toContain('MessageBranchButton');
    expect(sessionSource).not.toContain('group-hover/msg:opacity-100');
    expect(sessionSource).toContain('branchPromptIndex={!isStreaming ? branchPromptIndex : -1}');
    expect(sessionSource).toContain('onBranch={onBranch}');
  });
});
