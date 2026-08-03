import type { ClaudeSettings } from './api';

export const RUNTIME_CONFIG_CHANGED_EVENT = 'any-code:runtime-config-changed';

export type RuntimeConfigEngine = 'claude' | 'codex' | 'gemini';

export interface RuntimeConfigChangedDetail {
  engine: RuntimeConfigEngine;
  /** Provider-selected model, when the selected provider explicitly defines one. */
  model?: string;
  /** Avoids a second backend read when Settings already owns the committed snapshot. */
  settings?: ClaudeSettings;
}

type RuntimeConfigListener = (detail: RuntimeConfigChangedDetail) => void;

const resolveEventTarget = (target?: EventTarget): EventTarget => {
  if (target) return target;
  return window;
};

export function notifyRuntimeConfigChanged(
  detail: RuntimeConfigChangedDetail,
  target?: EventTarget,
): void {
  resolveEventTarget(target).dispatchEvent(new CustomEvent(RUNTIME_CONFIG_CHANGED_EVENT, { detail }));
}

export function subscribeRuntimeConfigChanged(
  listener: RuntimeConfigListener,
  target?: EventTarget,
): () => void {
  const eventTarget = resolveEventTarget(target);
  const handleEvent = (event: Event) => {
    listener((event as CustomEvent<RuntimeConfigChangedDetail>).detail);
  };

  eventTarget.addEventListener(RUNTIME_CONFIG_CHANGED_EVENT, handleEvent);
  return () => eventTarget.removeEventListener(RUNTIME_CONFIG_CHANGED_EVENT, handleEvent);
}
