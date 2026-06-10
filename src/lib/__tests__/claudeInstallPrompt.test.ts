import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

describe('Claude install prompt', () => {
  it('uses the current Claude Code npm package name in the status indicator', () => {
    const statusIndicator = readFileSync(
      resolve(repoRoot, 'src/components/ClaudeStatusIndicator.tsx'),
      'utf8'
    );

    expect(statusIndicator).toContain('npm install -g @anthropic-ai/claude-code');
    expect(statusIndicator).not.toContain('npm install -g @anthropic/claude');
  });
});
