import { describe, expect, test } from 'vitest';
import { normalizePersistedWorkbenchTab } from '@/lib/tabPersistence';

describe('workbench tab persistence', () => {
  test('restores persisted streaming tabs as idle runtime state', () => {
    const restored = normalizePersistedWorkbenchTab({
      id: 'tab-old',
      title: 'Old session',
      state: 'streaming',
      session: { id: 'old-session' },
      errorMessage: 'stale',
      hasChanges: true,
    });

    expect(restored.state).toBe('idle');
    expect(restored.errorMessage).toBeUndefined();
    expect(restored.type).toBe('session');
    expect(restored.hasUnsavedChanges).toBe(true);
  });

  test('preserves explicit error tabs but never invents streaming from missing state', () => {
    expect(normalizePersistedWorkbenchTab({
      id: 'tab-error',
      title: 'Error',
      state: 'error',
      errorMessage: 'boom',
    })).toMatchObject({
      state: 'error',
      errorMessage: 'boom',
      type: 'new',
      hasUnsavedChanges: false,
    });

    expect(normalizePersistedWorkbenchTab({
      id: 'tab-idle',
      title: 'Idle',
    }).state).toBe('idle');
  });
});
