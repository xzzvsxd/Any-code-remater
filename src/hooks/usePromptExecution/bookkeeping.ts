export const awaitPromptBookkeeping = async (
  promise: Promise<void>,
  label: string,
  timeoutMs = 3000
) => {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  try {
    await Promise.race([
      promise,
      new Promise<void>((resolve) => {
        timeoutId = setTimeout(() => {
          console.warn(`[usePromptExecution] ${label} timed out after ${timeoutMs}ms; UI has already been unblocked.`);
          resolve();
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
};
