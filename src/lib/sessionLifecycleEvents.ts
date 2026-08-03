export const WORKBENCH_SESSION_PROMOTED_EVENT = 'any-code:workbench-session-promoted';

export interface WorkbenchSessionPromotion {
  sessionId: string;
  projectId: string;
  projectPath: string;
  engine?: 'claude' | 'codex' | 'gemini';
}

type WorkbenchSessionPromotionListener = (detail: WorkbenchSessionPromotion) => void;

const resolveEventTarget = (target?: EventTarget): EventTarget => {
  if (target) return target;
  return window;
};

export function notifyWorkbenchSessionPromoted(
  detail: WorkbenchSessionPromotion,
  target?: EventTarget,
): void {
  resolveEventTarget(target).dispatchEvent(new CustomEvent(WORKBENCH_SESSION_PROMOTED_EVENT, { detail }));
}

export function subscribeWorkbenchSessionPromoted(
  listener: WorkbenchSessionPromotionListener,
  target?: EventTarget,
): () => void {
  const eventTarget = resolveEventTarget(target);
  const handleEvent = (event: Event) => {
    listener((event as CustomEvent<WorkbenchSessionPromotion>).detail);
  };

  eventTarget.addEventListener(WORKBENCH_SESSION_PROMOTED_EVENT, handleEvent);
  return () => eventTarget.removeEventListener(WORKBENCH_SESSION_PROMOTED_EVENT, handleEvent);
}
