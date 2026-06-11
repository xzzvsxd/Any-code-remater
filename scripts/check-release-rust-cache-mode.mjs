import { readFileSync } from "node:fs";

const workflowPath = ".github/workflows/build.yml";
const workflow = readFileSync(workflowPath, "utf8");
const lines = workflow.split(/\r?\n/);

const rustCacheBlocks = [];

for (let index = 0; index < lines.length; index += 1) {
  if (!lines[index].includes("uses: Swatinem/rust-cache@v2")) {
    continue;
  }

  let start = index;
  while (start > 0 && !/^      - name: /.test(lines[start])) {
    start -= 1;
  }

  let end = index + 1;
  while (end < lines.length && !/^      - name: /.test(lines[end])) {
    end += 1;
  }

  rustCacheBlocks.push({
    line: index + 1,
    text: lines.slice(start, end).join("\n"),
  });
}

if (rustCacheBlocks.length === 0) {
  console.error(`${workflowPath}: no Swatinem/rust-cache@v2 steps found`);
  process.exit(1);
}

const failures = [];

for (const block of rustCacheBlocks) {
  if (!/^\s+continue-on-error:\s+true\s*$/m.test(block.text)) {
    failures.push(`line ${block.line}: rust-cache step must be continue-on-error`);
  }

  if (!/^\s+save-if:\s+\$\{\{\s*false\s*\}\}\s*$/m.test(block.text)) {
    failures.push(`line ${block.line}: release rust-cache step must be restore-only via save-if: \${{ false }}`);
  }
}

if (failures.length > 0) {
  console.error(`${workflowPath}: release Rust cache must not be able to fail packaging jobs`);
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log(`check-release-rust-cache-mode: OK (${rustCacheBlocks.length} rust-cache steps)`);
