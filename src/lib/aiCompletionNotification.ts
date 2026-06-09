export type AiExecutionEngine = "claude" | "codex" | "gemini";

interface AiCompletionNotificationOptions {
  engine: AiExecutionEngine;
  queuedPromptCount?: number;
  sessionId?: string | null;
  runId?: string | null;
  elapsedSeconds?: number | null;
  projectPath?: string | null;
  sessionLabel?: string | null;
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

function formatElapsed(seconds?: number | null) {
  if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds < 1) {
    return "";
  }

  const wholeSeconds = Math.floor(seconds);
  if (wholeSeconds < 60) {
    return `${wholeSeconds} 秒`;
  }

  const minutes = Math.floor(wholeSeconds / 60);
  const remainingSeconds = wholeSeconds % 60;
  if (minutes < 60) {
    return remainingSeconds > 0 ? `${minutes} 分 ${remainingSeconds} 秒` : `${minutes} 分钟`;
  }

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes > 0 ? `${hours} 小时 ${remainingMinutes} 分` : `${hours} 小时`;
}

function basename(path?: string | null) {
  if (!path || typeof path !== "string") {
    return "";
  }

  const normalized = path.replace(/\\/g, "/").replace(/\/+$/, "");
  const name = normalized.split("/").pop();
  return name || "";
}

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

/**
 * 需要用户输入（提问 / 计划审批）时的通知：始终弹应用内 toast，
 * 窗口失焦时再补一条系统通知，确保用户即使切走也能知道"该我了"。
 */
export async function notifyUserInputNeeded(kind: "question" | "plan"): Promise<void> {
  if (typeof window === "undefined") return;

  const title = kind === "plan" ? "需要你审批计划" : "需要你回答";
  const body =
    kind === "plan"
      ? "AI 已提交计划，等待你批准或拒绝后才会继续。"
      : "AI 正在等待你的回答后才能继续。";

  try {
    window.dispatchEvent(new CustomEvent("show-toast", {
      detail: { message: body, type: "info" },
    }));
  } catch (err) {
    if (isDev) console.debug("[notifyUserInputNeeded] toast failed:", err);
  }

  // 窗口失焦时补系统通知（聚焦时 toast 已足够，避免打扰）。
  if (typeof document === "undefined" || !document.hasFocus()) {
    await showSystemNotification(title, body);
  }
}

export async function notifyAiExecutionComplete({
  engine,
  queuedPromptCount = 0,
  sessionId = null,
  runId = null,
  elapsedSeconds = null,
  projectPath = null,
  sessionLabel = null,
}: AiCompletionNotificationOptions): Promise<void> {
  if (queuedPromptCount > 0 || typeof window === "undefined") {
    return;
  }

  const engineName = engineNames[engine];
  const title = "AI 执行完成";
  const elapsed = formatElapsed(elapsedSeconds);
  const projectName = sessionLabel || basename(projectPath);
  const details = [
    projectName ? `项目：${projectName}` : "",
    elapsed ? `用时：${elapsed}` : "",
  ].filter(Boolean);
  const body = `${engineName} 已完成本次任务${details.length > 0 ? `（${details.join("，")}）` : ""}`;
  const identity = sessionId ?? runId ?? "unknown";
  const key = `${engine}:${identity}:${body}`;

  if (shouldDedupe(key)) {
    return;
  }

  showInAppToast(body);

  if (typeof document === "undefined" || !document.hasFocus()) {
    await showSystemNotification(title, body);
  }
}
