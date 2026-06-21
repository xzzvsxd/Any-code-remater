import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const promptSuggestionSource = readFileSync(
  resolve(process.cwd(), 'src/components/FloatingPromptInput/hooks/usePromptSuggestion.ts'),
  'utf8',
);

const sessionToolbarSource = readFileSync(
  resolve(process.cwd(), 'src/components/SessionToolbar.tsx'),
  'utf8',
);

describe('floating prompt render safety', () => {
  test('prompt suggestions do not derive cache keys from streaming messages while disabled', () => {
    expect(promptSuggestionSource).toContain('EMPTY_SUGGESTION_MESSAGES');
    expect(promptSuggestionSource).toContain('const messagesForSuggestion = enabled ? messages : EMPTY_SUGGESTION_MESSAGES');
    expect(promptSuggestionSource).toContain('generateCacheKey(messagesForSuggestion, currentPrompt)');
    expect(promptSuggestionSource).not.toContain('generateCacheKey(messages, currentPrompt)');
  });

  test('session export toolbar can ignore message churn while streaming', () => {
    expect(sessionToolbarSource).toContain('React.memo');
    expect(sessionToolbarSource).toContain('prevProps.isStreaming && nextProps.isStreaming');
    expect(sessionToolbarSource).toContain('prevProps.session?.id === nextProps.session?.id');
  });
});
