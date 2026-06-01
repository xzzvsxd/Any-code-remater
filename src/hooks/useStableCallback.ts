import { useCallback, useRef } from 'react';

/**
 * Stable function identity with always-fresh implementation.
 *
 * Useful for event/effect callbacks that must be dependency-safe without
 * repeatedly re-running expensive loaders on every render.
 */
export function useStableCallback<T extends (...args: LegacyAny[]) => LegacyAny>(callback: T): T {
  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  return useCallback(((...args: Parameters<T>): ReturnType<T> => {
    return callbackRef.current(...args);
  }) as T, []);
}
