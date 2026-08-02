import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import {
  doesSessionModelOnlyDropOneMillion,
  parseSessionModelForPromptInput,
  readPromptInputLastSelectedModel,
  readPromptInputScopedModel,
  resolveInitialPromptInputModel,
  resolvePromptInputModelForScopeChange,
  shouldPersistPromptInputModelForScopeTransition,
  writePromptInputLastSelectedModel,
  writePromptInputScopedModel,
} from '../modelSessionScope';

describe('FloatingPromptInput session-scoped model state', () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: vi.fn((key: string) => store.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => {
        store.set(key, value);
      }),
      removeItem: vi.fn((key: string) => {
        store.delete(key);
      }),
      clear: vi.fn(() => {
        store.clear();
      }),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test('preserves explicit 1M suffix when parsing a saved Claude model', () => {
    expect(parseSessionModelForPromptInput('claude-opus-4-8[1m]')).toBe('claude-opus-4-8[1m]');
  });

  test('does not let a late bare runtime model clear 1M inside the same session scope', () => {
    expect(resolvePromptInputModelForScopeChange({
      previousScopeKey: 'session:current',
      nextScopeKey: 'session:current',
      currentModel: 'claude-opus-4-8[1m]',
      sessionModel: 'claude-opus-4-8',
      userDefaultModel: 'claude-sonnet-5',
      defaultModel: 'sonnet',
    })).toBe('claude-opus-4-8[1m]');
  });

  test('applies the new session model when the input is reused for a different session scope', () => {
    expect(resolvePromptInputModelForScopeChange({
      previousScopeKey: 'session:old',
      nextScopeKey: 'session:new',
      currentModel: 'claude-opus-4-8[1m]',
      sessionModel: 'claude-sonnet-4-6',
      userDefaultModel: 'claude-opus-4-8[1m]',
      defaultModel: 'sonnet',
    })).toBe('claude-sonnet-4-6');
  });

  test('prefers the saved scoped UI model over a bare runtime model when switching sessions', () => {
    expect(resolvePromptInputModelForScopeChange({
      previousScopeKey: 'session:old',
      nextScopeKey: 'session:restored',
      currentModel: 'claude-sonnet-5',
      scopedModel: 'claude-opus-4-8[1m]',
      sessionModel: 'claude-opus-4-8',
      userDefaultModel: 'claude-sonnet-5',
      defaultModel: 'sonnet',
    })).toBe('claude-opus-4-8[1m]');
  });

  test('keeps the current UI model when a draft is promoted to a real session id', () => {
    expect(resolvePromptInputModelForScopeChange({
      previousScopeKey: 'draft:tab-1',
      nextScopeKey: 'session:new-real-id',
      currentModel: 'claude-opus-4-8[1m]',
      sessionModel: undefined,
      userDefaultModel: 'claude-sonnet-5',
      defaultModel: 'sonnet',
    })).toBe('claude-opus-4-8[1m]');
  });

  test('keeps explicit 1M when switching to a session whose runtime model only dropped the suffix', () => {
    expect(resolvePromptInputModelForScopeChange({
      previousScopeKey: 'session:old',
      nextScopeKey: 'session:new-bare-runtime',
      currentModel: 'claude-opus-4-8[1m]',
      sessionModel: 'claude-opus-4-8',
      userDefaultModel: 'claude-sonnet-5',
      defaultModel: 'sonnet',
    })).toBe('claude-opus-4-8[1m]');
  });

  test('persists carried 1M intent into the new session scope for future restores', () => {
    expect(shouldPersistPromptInputModelForScopeTransition({
      previousScopeKey: 'session:old',
      nextScopeKey: 'session:new-bare-runtime',
      currentModel: 'claude-opus-4-8[1m]',
      sessionModel: 'claude-opus-4-8',
      nextModel: 'claude-opus-4-8[1m]',
    })).toBe(true);
  });

  test('keeps explicit 1M when opening a fresh draft from a session scope', () => {
    expect(resolvePromptInputModelForScopeChange({
      previousScopeKey: 'session:old',
      nextScopeKey: 'draft:new',
      currentModel: 'claude-opus-4-8[1m]',
      sessionModel: undefined,
      userDefaultModel: 'claude-opus-4-8',
      defaultModel: 'sonnet',
    })).toBe('claude-opus-4-8[1m]');
  });

  test('persists carried 1M intent into a fresh draft scope for future restores', () => {
    expect(shouldPersistPromptInputModelForScopeTransition({
      previousScopeKey: 'session:old',
      nextScopeKey: 'draft:new',
      currentModel: 'claude-opus-4-8[1m]',
      sessionModel: undefined,
      nextModel: 'claude-opus-4-8[1m]',
    })).toBe(true);
  });

  test('uses the user default for a new empty draft when there is no sticky 1M intent', () => {
    expect(resolvePromptInputModelForScopeChange({
      previousScopeKey: 'session:old',
      nextScopeKey: 'draft:new',
      currentModel: 'claude-opus-4-8',
      sessionModel: undefined,
      userDefaultModel: 'claude-sonnet-5',
      defaultModel: 'sonnet',
    })).toBe('claude-sonnet-5');
  });

  test('uses sticky last-selected 1M for a freshly mounted draft before a bare default can clear it', () => {
    writePromptInputLastSelectedModel('claude-opus-4-8[1m]');

    expect(resolveInitialPromptInputModel({
      scopeKey: 'draft:new-tab',
      scopedModel: readPromptInputScopedModel('draft:new-tab'),
      sessionModel: undefined,
      lastSelectedModel: readPromptInputLastSelectedModel(),
      userDefaultModel: 'claude-opus-4-8',
      defaultModel: 'sonnet',
    })).toBe('claude-opus-4-8[1m]');
  });

  test('does not keep stale 1M after the user last selected a bare model', () => {
    writePromptInputLastSelectedModel('claude-opus-4-8[1m]');
    writePromptInputLastSelectedModel('claude-opus-4-8');

    expect(resolveInitialPromptInputModel({
      scopeKey: 'draft:new-tab',
      scopedModel: readPromptInputScopedModel('draft:new-tab'),
      sessionModel: undefined,
      lastSelectedModel: readPromptInputLastSelectedModel(),
      userDefaultModel: 'claude-sonnet-5',
      defaultModel: 'sonnet',
    })).toBe('claude-sonnet-5');
  });

  test('detects late bare runtime models that would only clear the 1M UI intent', () => {
    expect(doesSessionModelOnlyDropOneMillion('claude-opus-4-8[1m]', 'claude-opus-4-8')).toBe(true);
    expect(doesSessionModelOnlyDropOneMillion('claude-opus-4-8[1m]', 'claude-sonnet-5')).toBe(false);
    expect(doesSessionModelOnlyDropOneMillion('claude-opus-4-8', 'claude-opus-4-8')).toBe(false);
  });

  test('persists scoped model selections without letting one scope overwrite another', () => {
    writePromptInputScopedModel('session:a', 'claude-opus-4-8[1m]');
    writePromptInputScopedModel('session:b', 'claude-sonnet-5');

    expect(readPromptInputScopedModel('session:a')).toBe('claude-opus-4-8[1m]');
    expect(readPromptInputScopedModel('session:b')).toBe('claude-sonnet-5');
    expect(readPromptInputScopedModel('session:c')).toBeNull();
  });
});
