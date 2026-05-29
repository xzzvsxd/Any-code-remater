export type AiExecutionEngine = "claude" | "codex" | "gemini";

interface AiCompletionNotificationOptions {
  engine: AiExecutionEngine;
  queuedPromptCount?: number;
}

const engineNames: Record<AiExecutionEngine, string> = {
  claude: "Claude",
  codex: "Codex",
  gemini: "Gemini",
};

let lastNotificationKey = "";
let lastNotificationAt = 0;
const isDev = import.meta.env.DEV;

const shouldDedupe = (key: string) => {
  const now = Date.now();
  if (lastNotificationKey === key && now - lastNotificationAt < 1500) {
    return true;
  }
  lastNotificationKey = key;
  lastNotificationAt = now;
  return false;
};

function showInAppToast(message: string) {
  try {
    window.dispatchEvent(new CustomEvent("show-toast", {
      detail: {
        message,
        type: "success",
      },
    }));
  } catch (err) {
    if (isDev) {
      console.debug("[aiCompletionNotification] Failed to dispatch toast:", err);
    }
  }
}

async function showSystemNotification(title: string, body: string) {
  try {
    const notification = await import("@tauri-apps/plugin-notification");
    let permissionGranted = await notification.isPermissionGranted();

    if (!permissionGranted) {
      const permission = await notification.requestPermission();
      permissionGranted = permission === "granted";
    }

    if (permissionGranted) {
      notification.sendNotification({ title, body });
      return;
    }
  } catch (err) {
    if (isDev) {
      console.debug("[aiCompletionNotification] Tauri notification unavailable:", err);
    }
  }

  try {
    if ("Notification" in window) {
      if (Notification.permission === "default") {
        await Notification.requestPermission();
      }

      if (Notification.permission === "granted") {
        new Notification(title, { body });
      }
    }
  } catch (err) {
    if (isDev) {
      console.debug("[aiCompletionNotification] Browser notification unavailable:", err);
    }
  }
}

export async function notifyAiExecutionComplete({
  engine,
  queuedPromptCount = 0,
}: AiCompletionNotificationOptions): Promise<void> {
  if (queuedPromptCount > 0) {
    return;
  }

  const engineName = engineNames[engine];
  const title = "AI 执行完成";
  const body = `${engineName} 已完成本次任务`;
  const key = `${engine}:${body}`;

  if (shouldDedupe(key)) {
    return;
  }

  showInAppToast(body);
  await showSystemNotification(title, body);
}
