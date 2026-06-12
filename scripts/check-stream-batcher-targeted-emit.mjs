import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');
const sourcePath = resolve(repoRoot, 'src-tauri/src/commands/stream_batcher.rs');
const source = readFileSync(sourcePath, 'utf8');

const failures = [];

if (!source.includes('emit_to(')) {
  failures.push('stream_batcher.rs must use targeted emit_to() for high-frequency stream output');
}

if (!source.includes('EventTarget::webview_window')) {
  failures.push('stream_batcher.rs must target a concrete webview window');
}

if (!source.includes('get_webview_window')) {
  failures.push('stream_batcher.rs must detect whether the session window exists before falling back');
}

if (!source.includes('session-window-{}')) {
  failures.push('stream_batcher.rs must route tab output to session-window-{tab_id} when present');
}

if (/self\.app\.emit\s*\(/.test(source)) {
  failures.push('stream_batcher.rs must not broadcast streaming output with self.app.emit(...)');
}

if (failures.length > 0) {
  console.error('[check-stream-batcher-targeted-emit] failed:');
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log('[check-stream-batcher-targeted-emit] ok');
