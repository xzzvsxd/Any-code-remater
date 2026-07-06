import { describe, expect, test } from 'vitest';

import {
  parseSessionModelForPromptInput,
  resolvePromptInputModelForScopeChange,
} from '../modelSessionScope';

describe('FloatingPromptInput session-scoped model state', () => {
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

  test('uses the user default only for a new empty scope without a session model', () => {
    expect(resolvePromptInputModelForScopeChange({
      previousScopeKey: 'session:old',
      nextScopeKey: 'draft:new',
      currentModel: 'claude-opus-4-8[1m]',
      sessionModel: undefined,
      userDefaultModel: 'claude-sonnet-5',
      defaultModel: 'sonnet',
    })).toBe('claude-sonnet-5');
  });
});
