import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';

const source = readFileSync('src-tauri/src/commands/session_search.rs', 'utf8');

describe('session search backend safety', () => {
  test('search supports Claude, Codex and Gemini session storage', () => {
    expect(source).toContain('find_codex_session_file');
    expect(source).toContain('read_gemini_session_text');
    expect(source).toContain('get_claude_dir');
  });

  test('search matches extracted conversation text instead of raw metadata blobs', () => {
    expect(source).toContain('extract_searchable_session_text');
    expect(source).toContain('is_searchable_text_key');
    expect(source).not.toContain('content.to_lowercase().matches(keyword_lower).count()');
  });
});
