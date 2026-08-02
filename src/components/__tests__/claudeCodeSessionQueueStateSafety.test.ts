import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source = readFileSync(
  resolve(process.cwd(), 'src/components/ClaudeCodeSession.tsx'),
  'utf8',
);

describe('ClaudeCodeSession queued prompt state safety', () => {
  test('updates the terminal-handler ref synchronously with every queue state change', () => {
    expect(source).toContain(
      'const [queuedPrompts, setQueuedPromptsState] = useState<QueuedPrompt[]>',
    );
    expect(source).toContain(
      'const queuedPromptsRef = useRef<QueuedPrompt[]>(queuedPrompts)',
    );
    expect(source).toContain('const setQueuedPrompts = useCallback<React.Dispatch<React.SetStateAction<QueuedPrompt[]>>>');

    const setterStart = source.indexOf('const setQueuedPrompts = useCallback');
    const setterEnd = source.indexOf('\n  });', setterStart);
    const setterSource = source.slice(setterStart, setterEnd);
    const refUpdateIndex = setterSource.indexOf('queuedPromptsRef.current = nextQueuedPrompts');
    const stateUpdateIndex = setterSource.indexOf('setQueuedPromptsState(nextQueuedPrompts)');

    expect(setterStart).toBeGreaterThanOrEqual(0);
    expect(refUpdateIndex).toBeGreaterThanOrEqual(0);
    expect(stateUpdateIndex).toBeGreaterThan(refUpdateIndex);
    expect(source).not.toContain(
      'useEffect(() => {\n    queuedPromptsRef.current = queuedPrompts;\n  }, [queuedPrompts]);',
    );
  });
});
