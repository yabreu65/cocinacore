#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
node - "$ROOT" <<'NODE'
const fs = require('node:fs');
const path = require('node:path');

const root = process.argv[2];
const fail = (message) => {
  console.error(`hosted Today E2E workflow contract failure: ${message}`);
  process.exit(1);
};
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');
const workflow = read('.github/workflows/ci.yml');

const dispatch = workflow.match(
  /^  workflow_dispatch:\n([\s\S]*?)(?=^  (?:pull_request|push):)/m,
)?.[1];
if (!dispatch ||
    !/^    inputs:\n      run_connected_today:\n        description: .+\n        type: boolean\n        required: false\n        default: false$/m.test(dispatch)) {
  fail('workflow_dispatch must expose a boolean run_connected_today input that defaults to false');
}
if (!/^  pull_request:\n    branches: \[main\]$/m.test(workflow) ||
    !/^  push:\n    branches: \[main\]$/m.test(workflow)) {
  fail('existing pull_request and push triggers must remain limited to main');
}

const e2eJob = workflow.slice(workflow.indexOf('  e2e-tests:'));
if (!e2eJob.startsWith('  e2e-tests:')) fail('hosted e2e-tests job is missing');
const connectedStepName = '      - name: Run connected Today Playwright journey';
const connectedStart = e2eJob.indexOf(connectedStepName);
const connectedEnd = connectedStart < 0
  ? -1
  : e2eJob.indexOf('\n      - name:', connectedStart + connectedStepName.length);
const connectedStep = connectedStart < 0
  ? ''
  : e2eJob.slice(connectedStart, connectedEnd < 0 ? undefined : connectedEnd);
const requiredCondition =
  "if: github.event_name == 'workflow_dispatch' && github.ref == 'refs/heads/feat/m3-4-u5-hosted-e2e' && inputs.run_connected_today == true";
if (!connectedStep ||
    !connectedStep.includes(requiredCondition) ||
    !/^        env:\n          COCINACORE_ISOLATED_E2E: "1"$/m.test(connectedStep) ||
    !/^        run: npm run test:e2e -- e2e\/specs\/today-recommendations-connected\.spec\.ts$/m.test(connectedStep)) {
  fail('the opt-in step must require manual dispatch, the exact M3.4 branch, and true input, and run only the connected Today spec');
}
if (!/^          E2E_PROVIDER_PORT: "4319"$/m.test(connectedStep) ||
    (workflow.match(/^ {10}E2E_PROVIDER_PORT:/gm) ?? []).length !== 1) {
  fail('E2E_PROVIDER_PORT=4319 must be set only in the connected Today step');
}
if ((workflow.match(/COCINACORE_ISOLATED_E2E/g) ?? []).length !== 1) {
  fail('the isolated opt-in must exist only on the gated connected Today step');
}
if (!/^      - name: Run E2E tests\n        run: npm run test:e2e$/m.test(e2eJob)) {
  fail('the existing general E2E suite must remain a separate unchanged invocation');
}

for (const [name, pattern] of [
  ['runner PostgreSQL URL', /^      DATABASE_URL: postgresql:\/\/postgres:postgres@127\.0\.0\.1:5435\/cocinacore_local_db$/m],
  ['isolated PostgreSQL URL', /^      E2E_DATABASE_URL: postgresql:\/\/postgres:postgres@127\.0\.0\.1:5435\/cocinacore_local_db$/m],
  ['runner Redis URL', /^      REDIS_URL: redis:\/\/127\.0\.0\.1:6381\/15$/m],
  ['isolated Redis URL', /^      E2E_REDIS_URL: redis:\/\/127\.0\.0\.1:6381\/15$/m],
]) {
  if (!pattern.test(e2eJob)) fail(`${name} must remain bound to the hosted loopback service`);
}
if (/^        env:[\s\S]*?\b(?:DATABASE_URL|REDIS_URL|E2E_DATABASE_URL|E2E_REDIS_URL):/m.test(connectedStep)) {
  fail('connected step must inherit only the already-validated hosted target URLs, not override them');
}

const targetValidator = read('frontend/e2e/database-target.ts');
if (!/requireLoopbackPort\(database, 'E2E_DATABASE_URL', '5435'\)/.test(targetValidator) ||
    !/requireLoopbackPort\(redis, 'E2E_REDIS_URL', '6381'\)/.test(targetValidator) ||
    !/database\.pathname !== '\/cocinacore_local_db'/.test(targetValidator)) {
  fail('existing E2E target validation must retain exact loopback ports and isolated database name');
}
const playwrightConfig = read('frontend/playwright.config.ts');
if (!/applyValidatedTargetsToRunner\(process\.env\)/.test(playwrightConfig) ||
    !/DATABASE_URL: targets\.databaseUrl/.test(playwrightConfig) ||
    !/REDIS_URL: targets\.redisUrl/.test(playwrightConfig)) {
  fail('Playwright and its app server must continue using validated E2E-only target URLs');
}

console.log('hosted Today E2E workflow contract passed');
NODE
