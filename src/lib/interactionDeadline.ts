export function getInteractionRemainingMs(expiresAtMs: number | undefined, nowMs = Date.now()): number {
  if (!expiresAtMs || !Number.isFinite(expiresAtMs)) {
    return 0;
  }

  return Math.max(0, expiresAtMs - nowMs);
}

export function formatInteractionCountdown(remainingMs: number): string {
  const totalSeconds = Math.max(0, Math.ceil(remainingMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}
