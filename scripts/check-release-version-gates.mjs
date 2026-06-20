import { readFileSync } from 'node:fs';

function fail(message) {
  console.error(`check-release-version-gates: ${message}`);
  process.exit(1);
}

function readText(path) {
  try {
    return readFileSync(path, 'utf8');
  } catch (error) {
    fail(`missing file: ${path} (${error.message})`);
  }
}

function countRuntimeGates(workflow) {
  return (workflow.match(/node scripts\/verify-release-version\.mjs/g) ?? []).length;
}

const packageJson = JSON.parse(readText('package.json'));

if (packageJson.scripts?.['check:release-version-gates'] !== 'node scripts/check-release-version-gates.mjs') {
  fail('package.json is missing check:release-version-gates script');
}

if (!packageJson.scripts?.validate?.includes('npm run check:release-version-gates')) {
  fail('package.json validate must run check:release-version-gates');
}

const workflowExpectations = [
  ['.github/workflows/build.yml', 1],
  ['.github/workflows/release-linux.yml', 1],
  ['.github/workflows/release-macos.yml', 2],
  ['.github/workflows/release-windows.yml', 1],
];

const failures = [];
let totalRuntimeGates = 0;

for (const [workflowPath, minimumGateCount] of workflowExpectations) {
  const workflow = readText(workflowPath);
  const gateCount = countRuntimeGates(workflow);
  totalRuntimeGates += gateCount;

  if (gateCount < minimumGateCount) {
    failures.push(`${workflowPath}: expected at least ${minimumGateCount} release version gate(s), found ${gateCount}`);
  }

  if (!workflow.includes('Verify release version metadata')) {
    failures.push(`${workflowPath}: missing named release version metadata verification step/job`);
  }
}

const buildWorkflow = readText('.github/workflows/build.yml');
if (!buildWorkflow.includes('verify-release-version:')) {
  failures.push('.github/workflows/build.yml: missing shared verify-release-version job');
}

if (!/build-windows:\s+name:[\s\S]*?needs:\s+\[resolve-release,\s+verify-release-version\]/.test(buildWorkflow)) {
  failures.push('.github/workflows/build.yml: build-windows must depend on verify-release-version');
}

if (failures.length > 0) {
  console.error('check-release-version-gates: release workflows can publish versions that do not match source metadata');
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log(`check-release-version-gates: OK (${totalRuntimeGates} runtime gates)`);
