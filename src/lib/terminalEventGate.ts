export type TerminalEventKind = 'complete' | 'error';

export interface TerminalEventGate {
  tryStart: (kind: TerminalEventKind) => boolean;
  readonly startedKind: TerminalEventKind | null;
}

/**
 * Per execution-run idempotency guard for terminal stream events.
 *
 * Some engines can emit more than one terminal signal for the same run
 * (for example Codex may produce both a JSONL `turn.completed` marker and a
 * backend `codex-complete` event).  Terminal handlers mutate shared run state
 * and may advance the queued prompt, so only the first terminal event may run.
 */
export function createTerminalEventGate(): TerminalEventGate {
  let startedKind: TerminalEventKind | null = null;

  return {
    tryStart(kind: TerminalEventKind) {
      if (startedKind) {
        return false;
      }
      startedKind = kind;
      return true;
    },
    get startedKind() {
      return startedKind;
    },
  };
}
