import type { ClaudeStreamMessage } from '@/types/claude';

const TERMINAL_EXECUTION_SUBTYPES = new Set([
  'execution-complete',
  'execution-cancelled',
  'execution-error',
]);

const TERMINAL_CLOCK_SKEW_MS = 5_000;

export function isExecutionTerminalMessage(message: Partial<ClaudeStreamMessage> | null | undefined): boolean {
  if (!message || message.type !== 'system') {
    return false;
  }

  return TERMINAL_EXECUTION_SUBTYPES.has(String((message as LegacyAny).subtype || ''));
}

export function getExecutionMessageTimestampMs(message: Partial<ClaudeStreamMessage>): number | null {
  const rawTimestamp = (message as LegacyAny).receivedAt || (message as LegacyAny).timestamp;
  if (typeof rawTimestamp !== 'string' || rawTimestamp.trim().length === 0) {
    return null;
  }

  const parsed = Date.parse(rawTimestamp);
  return Number.isFinite(parsed) ? parsed : null;
}

export function hasExecutionTerminalAfter(
  messages: Array<Partial<ClaudeStreamMessage>>,
  executionStartedAt: number | null | undefined,
): boolean {
  if (typeof executionStartedAt !== 'number' || !Number.isFinite(executionStartedAt)) {
    return false;
  }

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!isExecutionTerminalMessage(message)) {
      continue;
    }

    const terminalTimestamp = getExecutionMessageTimestampMs(message);
    return terminalTimestamp !== null
      && terminalTimestamp + TERMINAL_CLOCK_SKEW_MS >= executionStartedAt;
  }

  return false;
}

export function shouldSuppressProcessingIndicator({
  isLoading,
  messages,
  executionStartedAt,
}: {
  isLoading: boolean;
  messages: Array<Partial<ClaudeStreamMessage>>;
  executionStartedAt: number | null | undefined;
}): boolean {
  return isLoading && hasExecutionTerminalAfter(messages, executionStartedAt);
}
