export type CompactLifecyclePhase =
  | 'scheduled'
  | 'preparing'
  | 'running'
  | 'completed'
  | 'failed';

export type CompactTrigger = 'auto' | 'manual' | 'unknown';

export interface CompactLifecycleEvent {
  phase: CompactLifecyclePhase;
  trigger: CompactTrigger;
  beforeTokens?: number;
  afterTokens?: number;
  durationMs?: number;
  error?: string;
}

const asRecord = (value: unknown): Record<string, unknown> => (
  value !== null && typeof value === 'object'
    ? value as Record<string, unknown>
    : {}
);

const readNumber = (value: unknown): number | undefined => (
  typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : undefined
);

const readString = (value: unknown): string | undefined => (
  typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : undefined
);

const normalizeTrigger = (value: unknown): CompactTrigger => {
  const trigger = readString(value)?.toLowerCase();
  if (trigger === 'auto' || trigger === 'automatic') return 'auto';
  if (trigger === 'manual') return 'manual';
  return 'unknown';
};

export function normalizeCompactLifecycleMessage(raw: unknown): CompactLifecycleEvent | null {
  const message = asRecord(raw);
  const type = readString(message.type);
  const subtype = readString(message.subtype);
  const metadata = asRecord(message.metadata);
  const compactResult = readString(
    metadata.compactResult ?? metadata.compact_result,
  )?.toLowerCase();

  if (type === 'system' && subtype === 'status' && compactResult === 'failed') {
    return {
      phase: 'failed',
      trigger: normalizeTrigger(metadata.trigger),
      error: readString(metadata.compactError ?? metadata.compact_error)
        ?? 'Unknown compaction error',
    };
  }

  if (
    type === 'system'
    && subtype === 'status'
    && ['success', 'completed', 'complete'].includes(compactResult ?? '')
  ) {
    return {
      phase: 'completed',
      trigger: normalizeTrigger(metadata.trigger),
    };
  }

  if (
    type === 'system'
    && subtype === 'status'
    && readString(message.status)?.toLowerCase() === 'compacting'
  ) {
    return {
      phase: 'scheduled',
      trigger: normalizeTrigger(metadata.trigger),
    };
  }

  if (type === 'compact_progress') {
    const event = asRecord(message.event);
    const eventType = readString(event.type)?.toLowerCase();
    const hookType = readString(event.hookType ?? event.hook_type)?.toLowerCase();

    if (eventType === 'hooks_start' && hookType === 'pre_compact') {
      return {
        phase: 'preparing',
        trigger: normalizeTrigger(event.trigger ?? message.trigger),
      };
    }

    if (eventType === 'compact_start') {
      return {
        phase: 'running',
        trigger: normalizeTrigger(event.trigger ?? message.trigger),
      };
    }
  }

  if (type === 'system' && subtype === 'compact_boundary') {
    const compactMetadata = asRecord(
      message.compactMetadata ?? message.compact_metadata,
    );
    return {
      phase: 'completed',
      trigger: normalizeTrigger(compactMetadata.trigger),
      beforeTokens: readNumber(compactMetadata.preTokens ?? compactMetadata.pre_tokens),
      afterTokens: readNumber(compactMetadata.postTokens ?? compactMetadata.post_tokens),
      durationMs: readNumber(compactMetadata.durationMs ?? compactMetadata.duration_ms),
    };
  }

  return null;
}

export function normalizeLegacyCompactOutput(output: string): CompactLifecycleEvent | null {
  const normalized = output.toLowerCase();
  if (!normalized.includes('compacted.') || !normalized.includes('ctrl+r to see full summary')) {
    return null;
  }
  return { phase: 'completed', trigger: 'manual' };
}

export function getCompactSavings(event: CompactLifecycleEvent): {
  releasedTokens: number;
  releasedPercentage: number;
} | null {
  if (event.beforeTokens === undefined || event.afterTokens === undefined) return null;
  const releasedTokens = Math.max(0, event.beforeTokens - event.afterTokens);
  const releasedPercentage = event.beforeTokens > 0
    ? Math.round((releasedTokens / event.beforeTokens) * 100)
    : 0;
  return { releasedTokens, releasedPercentage };
}

export function areCompactLifecycleEventsEqual(
  previous: CompactLifecycleEvent | null,
  next: CompactLifecycleEvent | null,
): boolean {
  if (previous === next) return true;
  if (!previous || !next) return false;
  return previous.phase === next.phase
    && previous.trigger === next.trigger
    && previous.beforeTokens === next.beforeTokens
    && previous.afterTokens === next.afterTokens
    && previous.durationMs === next.durationMs
    && previous.error === next.error;
}
