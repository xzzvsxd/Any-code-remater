import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source = readFileSync(resolve(process.cwd(), 'src-tauri/src/main.rs'), 'utf8');

describe('Linux WebKit rendering defaults', () => {
  test('does not force software compositing unless the safe-rendering override is enabled', () => {
    expect(source).toContain('ANY_CODE_FORCE_SOFTWARE_WEBVIEW');
    expect(source).toContain('WEBKIT_DISABLE_COMPOSITING_MODE');
    expect(source).not.toContain(
      'if std::env::var_os("WEBKIT_DISABLE_COMPOSITING_MODE").is_none() {\n            std::env::set_var("WEBKIT_DISABLE_COMPOSITING_MODE", "1");',
    );
  });

  test('keeps the DMABUF workaround as the lightweight compatibility fallback', () => {
    expect(source).toContain('WEBKIT_DISABLE_DMABUF_RENDERER');
  });
});
