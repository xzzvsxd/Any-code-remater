import { describe, expect, test } from 'vitest';

import { DEFAULT_CODEX_MODEL_ID } from '@/lib/codexModelSupport';
import {
  resolveInitialExecutionEngineConfig,
  shouldSyncExecutionEngineConfig,
} from '../executionEngineConfigPolicy';

describe('ClaudeCodeSession initial execution engine policy', () => {
  test('new sessions default to Claude even when the previous persisted engine was Codex', () => {
    const config = resolveInitialExecutionEngineConfig({
      storedConfig: {
        engine: 'codex',
        codexMode: 'danger-full-access',
        codexModel: DEFAULT_CODEX_MODEL_ID,
        geminiModel: 'gemini-3-pro',
      },
      sessionEngine: undefined,
    });

    expect(config.engine).toBe('claude');
    expect(config.codexMode).toBe('danger-full-access');
    expect(config.codexModel).toBe(DEFAULT_CODEX_MODEL_ID);
    expect(config.geminiModel).toBe('gemini-3-pro');
  });

  test('existing session engine wins over the persisted global engine', () => {
    expect(resolveInitialExecutionEngineConfig({
      storedConfig: { engine: 'claude' },
      sessionEngine: 'codex',
    }).engine).toBe('codex');

    expect(resolveInitialExecutionEngineConfig({
      storedConfig: { engine: 'codex' },
      sessionEngine: 'gemini',
    }).engine).toBe('gemini');
  });

  test('invalid or missing stored config falls back to safe defaults', () => {
    const config = resolveInitialExecutionEngineConfig({
      storedConfig: { engine: 'gpt', codexMode: 'invalid', geminiApprovalMode: 'invalid' },
      sessionEngine: undefined,
    });

    expect(config).toMatchObject({
      engine: 'claude',
      codexMode: 'read-only',
      codexModel: DEFAULT_CODEX_MODEL_ID,
      geminiModel: 'gemini-3-flash',
    });
  });

  test('syncs same-engine model and permission changes from the live parent config', () => {
    const current = resolveInitialExecutionEngineConfig({
      storedConfig: { codexModel: 'gpt-5.4', codexMode: 'read-only' },
      sessionEngine: 'codex',
    });
    const incoming = { ...current, codexModel: 'gpt-5.5-codex', codexMode: 'full-auto' as const };

    expect(shouldSyncExecutionEngineConfig(current, incoming)).toBe(true);
    expect(shouldSyncExecutionEngineConfig(incoming, incoming)).toBe(false);
  });
});
