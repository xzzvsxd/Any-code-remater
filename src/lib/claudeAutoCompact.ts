export const DEFAULT_CLAUDE_AUTO_COMPACT_WINDOW = 256_000;
export const MIN_CLAUDE_AUTO_COMPACT_WINDOW = 100_000;
export const MAX_CLAUDE_AUTO_COMPACT_WINDOW = 1_000_000;
export const CLAUDE_AUTO_COMPACT_SETTINGS_CHANGED_EVENT =
  'claude-auto-compact-settings-changed';

export type ClaudeAutoCompactSource =
  | 'environment'
  | 'settings'
  | 'default'
  | 'automatic';

export interface ResolvedClaudeAutoCompactConfig {
  enabled: boolean;
  configuredWindow: number | null;
  effectiveWindow: number | null;
  source: ClaudeAutoCompactSource;
  isEnvironmentOverride: boolean;
}

type ClaudeSettingsLike = {
  autoCompactEnabled?: unknown;
  autoCompactWindow?: unknown;
  env?: Record<string, unknown> | null;
};

const isSupportedWindow = (value: number): boolean => (
  Number.isFinite(value)
  && value >= MIN_CLAUDE_AUTO_COMPACT_WINDOW
  && value <= MAX_CLAUDE_AUTO_COMPACT_WINDOW
);

const isTruthyEnvironmentFlag = (value: unknown): boolean => {
  if (typeof value === 'boolean') return value;
  if (typeof value !== 'string') return false;
  return !['', '0', 'false', 'no', 'off'].includes(value.trim().toLowerCase());
};

export function parseClaudeAutoCompactWindow(value: unknown): number | 'auto' | null {
  if (typeof value === 'number') {
    const rounded = Math.round(value);
    return isSupportedWindow(rounded) ? rounded : null;
  }

  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  if (normalized === 'auto') return 'auto';
  if (!normalized) return null;

  let parsed: number;
  if (/^\d+(?:\.\d+)?m$/.test(normalized)) {
    parsed = Number.parseFloat(normalized.slice(0, -1)) * 1_000_000;
  } else if (/^\d+(?:\.\d+)?k$/.test(normalized)) {
    parsed = Number.parseFloat(normalized.slice(0, -1)) * 1_000;
  } else if (/^\d+$/.test(normalized)) {
    const numeric = Number.parseInt(normalized, 10);
    parsed = numeric >= 100 && numeric <= 1_000 ? numeric * 1_000 : numeric;
  } else {
    return null;
  }

  const rounded = Math.round(parsed);
  return isSupportedWindow(rounded) ? rounded : null;
}

export function clampClaudeAutoCompactWindow(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_CLAUDE_AUTO_COMPACT_WINDOW;
  return Math.min(
    MAX_CLAUDE_AUTO_COMPACT_WINDOW,
    Math.max(MIN_CLAUDE_AUTO_COMPACT_WINDOW, Math.round(value)),
  );
}

export function resolveClaudeAutoCompactConfig(
  rawSettings: ClaudeSettingsLike | null | undefined,
  contextWindowSize?: number | null,
): ResolvedClaudeAutoCompactConfig {
  const settings = rawSettings ?? {};
  const environment = settings.env && typeof settings.env === 'object' ? settings.env : {};
  const enabled = settings.autoCompactEnabled !== false
    && !isTruthyEnvironmentFlag(environment.DISABLE_AUTO_COMPACT);
  const environmentWindow = parseClaudeAutoCompactWindow(
    environment.CLAUDE_CODE_AUTO_COMPACT_WINDOW,
  );

  if (environmentWindow === 'auto') {
    return {
      enabled,
      configuredWindow: null,
      effectiveWindow: null,
      source: 'automatic',
      isEnvironmentOverride: true,
    };
  }

  const settingsWindow = parseClaudeAutoCompactWindow(settings.autoCompactWindow);
  const configuredWindow = typeof environmentWindow === 'number'
    ? environmentWindow
    : typeof settingsWindow === 'number'
      ? settingsWindow
      : DEFAULT_CLAUDE_AUTO_COMPACT_WINDOW;
  const effectiveWindow = typeof contextWindowSize === 'number'
    && Number.isFinite(contextWindowSize)
    && contextWindowSize > 0
    ? Math.min(configuredWindow, contextWindowSize)
    : configuredWindow;

  return {
    enabled,
    configuredWindow,
    effectiveWindow,
    source: typeof environmentWindow === 'number'
      ? 'environment'
      : typeof settingsWindow === 'number'
        ? 'settings'
        : 'default',
    isEnvironmentOverride: typeof environmentWindow === 'number',
  };
}
