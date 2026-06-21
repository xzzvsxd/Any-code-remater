import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source = readFileSync(resolve(process.cwd(), 'src/hooks/useSmartAutoScroll.ts'), 'utf8');

describe('smart auto-scroll render safety invariants', () => {
  test('last-message change detection avoids JSON.stringify on potentially huge content', () => {
    expect(source).toContain('getMessageContentLengthHint');
    expect(source).not.toContain('JSON.stringify(lastMessage.message?.content');
  });

  test('resize-driven bottom following is rAF-batched and finishes with precise bottom settle', () => {
    expect(source).toContain('PRECISE_BOTTOM_THRESHOLD');
    expect(source).toContain('performAutoScroll({ precise: true })');
    expect(source).toContain('resizeFollowFrameRef');
    expect(source).toContain('requestAnimationFrame(runResizeFollow)');
    expect(source).not.toContain('contentObserver = new ResizeObserver(() => {\n        if (shouldFollowResizeToBottom');
  });
});
