import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const releaseWorkflowPaths = [
  '.github/workflows/build.yml',
  '.github/workflows/release-linux.yml',
  '.github/workflows/release-macos.yml',
  '.github/workflows/release-windows.yml',
];

const extractRustCacheBlocks = (workflow: string) => {
  const lines = workflow.split(/\r?\n/);
  const blocks: string[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    if (!lines[index].includes('uses: Swatinem/rust-cache@v2')) continue;

    let start = index;
    while (start > 0 && !/^      - name: /.test(lines[start])) {
      start -= 1;
    }

    let end = index + 1;
    while (end < lines.length && !/^      - name: /.test(lines[end])) {
      end += 1;
    }

    blocks.push(lines.slice(start, end).join('\n'));
  }

  return blocks;
};

describe('release Rust cache safety', () => {
  test('all release workflows make rust-cache restore-only and non-fatal', () => {
    for (const workflowPath of releaseWorkflowPaths) {
      const workflow = readFileSync(resolve(process.cwd(), workflowPath), 'utf8');
      const rustCacheBlocks = extractRustCacheBlocks(workflow);

      expect(rustCacheBlocks.length, `${workflowPath} should use rust-cache`).toBeGreaterThan(0);

      for (const block of rustCacheBlocks) {
        expect(block, `${workflowPath} rust-cache must be non-fatal`).toMatch(/^\s+continue-on-error:\s+true\s*$/m);
        expect(block, `${workflowPath} rust-cache must not save during release packaging`).toMatch(
          /^\s+save-if:\s+\$\{\{\s*false\s*\}\}\s*$/m,
        );
      }
    }
  });
});
