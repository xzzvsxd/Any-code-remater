import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';

const readSource = (relativePath: string): string =>
  readFileSync(resolve(process.cwd(), relativePath), 'utf8');

describe('raw JSONL retention', () => {
  test('live sessions do not keep a second unbounded copy of raw stream lines in the renderer', () => {
    const source = readSource('src/components/ClaudeCodeSession.tsx');

    expect(source).not.toContain('rawJsonlOutputRef.current.push(payload)');
    expect(source).not.toContain('rawJsonlOutputRef.current = typeof action');
    expect(source).toContain('const appendRawJsonlOutput = useCallback((_payload: string) => {');
  });

  test('history loading does not stringify the entire session into an unused raw JSONL cache', () => {
    const source = readSource('src/hooks/useSessionStream.ts');

    expect(source).not.toContain('setRawJsonlOutput(history.map(h => JSON.stringify(h)))');
  });
});
