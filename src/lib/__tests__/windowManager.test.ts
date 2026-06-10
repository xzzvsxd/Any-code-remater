import { afterEach, describe, expect, it } from 'vitest';

import { parseSessionWindowParams } from '../windowManager';

const originalWindow = globalThis.window;

function setSearch(search: string): void {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      location: {
        search,
      },
    },
  });
}

describe('parseSessionWindowParams', () => {
  afterEach(() => {
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: originalWindow,
    });
  });

  it('preserves gemini engine for detached session windows', () => {
    setSearch(
      '?window=session&tab_id=tab-1&session_id=s1&project_path=D%3A%5Cproj&engine=gemini'
    );

    expect(parseSessionWindowParams()).toMatchObject({
      isSessionWindow: true,
      tabId: 'tab-1',
      sessionId: 's1',
      projectPath: 'D:\\proj',
      engine: 'gemini',
    });
  });
});
