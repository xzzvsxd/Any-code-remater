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

  test('streaming start cancels any idle bottom-settling loop before sticky auto-scroll takes over', () => {
    expect(source).toMatch(
      /useEffect\(\(\)\s*=>\s*{\s*if \(!isLoading\) return;\s*cancelBottomScrollLoop\(\);\s*},\s*\[isLoading\]\);/,
    );
  });

  test('scrollToBottom itself never starts the imperative settle loop while streaming', () => {
    expect(source).toMatch(
      /scrollToBottom:\s*\(\)\s*=>\s*{[\s\S]*?if \(messageGroups\.length === 0\) return;[\s\S]*?if \(isLoading\) return;[\s\S]*?rowVirtualizer\.scrollToIndex/,
    );
  });

  test('new imperative scroll commands cancel any pending prompt-navigation retry loop', () => {
    expect(source).toContain('cancelPromptScrollSearch');
    expect(source).toMatch(/scrollToBottom:\s*\(\)\s*=>\s*{[\s\S]*?cancelPromptScrollSearch\(\);/);
    expect(source).toMatch(/scrollToTop:\s*\(\)\s*=>\s*{[\s\S]*?cancelPromptScrollSearch\(\);/);
    expect(source).toMatch(/scrollToPrompt:\s*\(promptIndex:\s*number\)\s*=>\s*{[\s\S]*?cancelPromptScrollSearch\(\);/);
  });

  test('idle initial bottom settling uses a tight threshold so it cannot leave a visible bottom gap', () => {
    expect(source).toContain('const INITIAL_BOTTOM_THRESHOLD = 2');
    expect(source).toContain('bottomThresholdPx: INITIAL_BOTTOM_THRESHOLD');
    expect(source).not.toContain('const BOTTOM_THRESHOLD = 16; // 与 streaming 粘底死区一致');
  });

  test('virtualizer uses content-aware estimates instead of fixed 150/200px guesses', () => {
    expect(source).toContain('estimateMessageGroupHeight(messageGroups[index])');
    expect(source).toContain('overscan: SESSION_MESSAGES_OVERSCAN');
  });
});
