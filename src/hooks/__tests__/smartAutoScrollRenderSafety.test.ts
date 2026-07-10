import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source = readFileSync(resolve(process.cwd(), 'src/hooks/useSmartAutoScroll.ts'), 'utf8');

describe('smart auto-scroll render safety invariants', () => {
  test('last-message change detection avoids JSON.stringify on potentially huge content', () => {
    expect(source).toContain('getMessageContentLengthHint');
    expect(source).not.toContain('JSON.stringify(lastMessage.message?.content');
  });

  test('streaming bottom following never bypasses the deadband with a precise final settle', () => {
    expect(source).not.toContain('PRECISE_BOTTOM_THRESHOLD');
    expect(source).not.toContain('performAutoScroll({ precise: true })');
    expect(source).toContain('resizeFollowFrameRef');
    expect(source).toContain('requestAnimationFrame(runResizeFollow)');
    expect(source).not.toContain('contentObserver = new ResizeObserver(() => {\n        if (shouldFollowResizeToBottom');
  });
});
