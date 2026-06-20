import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source = readFileSync(resolve(process.cwd(), 'src/hooks/useSmartAutoScroll.ts'), 'utf8');

describe('smart auto-scroll render safety invariants', () => {
  test('last-message change detection avoids JSON.stringify on potentially huge content', () => {
    expect(source).toContain('getMessageContentLengthHint');
    expect(source).not.toContain('JSON.stringify(lastMessage.message?.content');
  });
});
