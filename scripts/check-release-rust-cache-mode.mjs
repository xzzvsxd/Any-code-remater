import { readFileSync } from "node:fs";

const workflowPaths = [
  ".github/workflows/build.yml",
  ".github/workflows/release-linux.yml",
  ".github/workflows/release-macos.yml",
  ".github/workflows/release-windows.yml",
];

const rustCacheBlocks = [];

for (const workflowPath of workflowPaths) {
  const workflow = readFileSync(workflowPath, "utf8");
  const lines = workflow.split(/\r?\n/);

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
      workflowPath,
      line: index + 1,
      text: lines.slice(start, end).join("\n"),
    });
  }
}

if (rustCacheBlocks.length === 0) {
  console.error(`release workflows: no Swatinem/rust-cache@v2 steps found`);
  process.exit(1);
}

const failures = [];

for (const block of rustCacheBlocks) {
  if (!/^\s+continue-on-error:\s+true\s*$/m.test(block.text)) {
    failures.push(`${block.workflowPath}:${block.line}: rust-cache step must be continue-on-error`);
  }

  if (!/^\s+save-if:\s+\$\{\{\s*false\s*\}\}\s*$/m.test(block.text)) {
    failures.push(`${block.workflowPath}:${block.line}: release rust-cache step must be restore-only via save-if: \${{ false }}`);
  }
}

if (failures.length > 0) {
  console.error(`release workflows: Rust cache must not be able to fail packaging jobs`);
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log(`check-release-rust-cache-mode: OK (${rustCacheBlocks.length} rust-cache steps)`);
