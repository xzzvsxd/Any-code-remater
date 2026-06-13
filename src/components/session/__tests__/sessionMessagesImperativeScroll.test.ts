import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';

const source = readFileSync(
  resolve(process.cwd(), 'src/components/session/SessionMessages.tsx'),
  'utf8',
);

describe('SessionMessages imperative scrolling invariants', () => {
  test('prompt navigation cancels the active bottom-settling loop before moving away from bottom', () => {
    expect(source).toMatch(/scrollToPrompt:\s*\(promptIndex:\s*number\)\s*=>\s*{\s*cancelBottomScrollLoop\(\);/);
  });

  test('session switches cancel any bottom-settling loop from the previous session', () => {
    expect(source).toMatch(/useEffect\(\(\)\s*=>\s*{\s*cancelBottomScrollLoop\(\);\s*cancelPromptScrollSearch\(\);\s*measuredHeightsRef\.current\.clear\(\);\s*},\s*\[sessionId\]\);/);
  });

  test('direct user scroll gestures cancel active bottom-settling loops', () => {
    expect(source).toContain('onWheelCapture={cancelBottomScrollLoop}');
    expect(source).toContain('onTouchStartCapture={cancelBottomScrollLoop}');
    expect(source).toContain('onPointerDownCapture={cancelBottomScrollLoop}');
  });

  test('new imperative scroll commands cancel any pending prompt-navigation retry loop', () => {
    expect(source).toContain('cancelPromptScrollSearch');
    expect(source).toMatch(/scrollToBottom:\s*\(\)\s*=>\s*{[\s\S]*?cancelPromptScrollSearch\(\);/);
    expect(source).toMatch(/scrollToTop:\s*\(\)\s*=>\s*{[\s\S]*?cancelPromptScrollSearch\(\);/);
    expect(source).toMatch(/scrollToPrompt:\s*\(promptIndex:\s*number\)\s*=>\s*{[\s\S]*?cancelPromptScrollSearch\(\);/);
  });
});
