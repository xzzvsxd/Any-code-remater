export interface CrossChannelDuplicateGuardOptions {
  maxEntries?: number;
}

export interface CrossChannelDuplicateGuard<Source extends string> {
  shouldProcess: (key: string, source: Source) => boolean;
  clear: () => void;
  readonly size: number;
}

const DEFAULT_MAX_ENTRIES = 2_048;

/**
 * Source-aware duplicate guard for streams that briefly listen on both a global
 * channel and a session-specific channel during handoff.
 *
 * The old "seen payload hash" approach dropped every repeated payload.  That
 * corrupts legitimate streaming deltas such as two identical text chunks from
 * the same channel.  This guard drops only a payload key that has already been
 * seen from a *different* source, which is the duplicate pattern produced by
 * global/session overlap.
 */
export function createCrossChannelDuplicateGuard<Source extends string>(
  options: CrossChannelDuplicateGuardOptions = {},
): CrossChannelDuplicateGuard<Source> {
  const maxEntries = Math.max(1, Math.floor(options.maxEntries ?? DEFAULT_MAX_ENTRIES));
  const seenSourcesByKey = new Map<string, Source>();

  const remember = (key: string, source: Source) => {
    if (seenSourcesByKey.has(key)) {
      seenSourcesByKey.delete(key);
    }
    seenSourcesByKey.set(key, source);

    while (seenSourcesByKey.size > maxEntries) {
      const oldestKey = seenSourcesByKey.keys().next().value as string | undefined;
      if (oldestKey === undefined) break;
      seenSourcesByKey.delete(oldestKey);
    }
  };

  return {
    shouldProcess(key: string, source: Source) {
      const firstSource = seenSourcesByKey.get(key);
      if (firstSource !== undefined && firstSource !== source) {
        return false;
      }

      remember(key, source);
      return true;
    },
    clear() {
      seenSourcesByKey.clear();
    },
    get size() {
      return seenSourcesByKey.size;
    },
  };
}
