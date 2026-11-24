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

const setupName = '      - name: Provision migrations 019–025, then run isolated E2E';
const start = workflow.indexOf(setupName);
const end = start < 0 ? -1 : workflow.indexOf('\n      - name:', start + setupName.length);
const setup = start < 0 ? '' : workflow.slice(start, end < 0 ? undefined : end);
const requiredCondition =
  "github.event_name == 'workflow_dispatch' && github.ref == 'refs/heads/feat/m3-4-u5-hosted-e2e' && inputs.run_connected_today == true";
const connectedExpression = 'RUN_CONNECTED_TODAY: ${{ ' + requiredCondition + ' }}';
if (!setup.includes(connectedExpression) ||
    !setup.includes("if [ \"$RUN_CONNECTED_TODAY\" = 'true' ]; then") ||
    !setup.includes('COCINACORE_ISOLATED_E2E=1 E2E_PROVIDER_PORT=4319') ||
    !setup.includes('npm run test:e2e -- e2e/specs/today-recommendations-connected.spec.ts')) {
  fail('connected Today must remain explicitly opted in for the exact manual branch/input and exact spec');
}
if ((workflow.match(/E2E_PROVIDER_PORT=4319/g) ?? []).length !== 1 ||
    (workflow.match(/COCINACORE_ISOLATED_E2E=1/g) ?? []).length !== 1) {
  fail('connected Today environment must appear only in the gated execution');
}
if (!setup.includes('npm run test:e2e\n') ||
    setup.indexOf('npm run test:e2e\n') > setup.indexOf('if [ "$RUN_CONNECTED_TODAY" =')) {
  fail('the standard E2E suite must run before the optional connected Today journey');
}

const targetValidator = read('frontend/e2e/database-target.ts');
if (!/requireLoopbackPort\(database, 'E2E_DATABASE_URL', '5435'\)/.test(targetValidator) ||
    !/requireLoopbackPort\(appDatabase, 'E2E_APP_DATABASE_URL', '5435'\)/.test(targetValidator) ||
    !/decodeURIComponent\(appDatabase\.username\) !== 'cocinacore_runtime_rls'/.test(targetValidator) ||
    !/requireLoopbackPort\(redis, 'E2E_REDIS_URL', '6381'\)/.test(targetValidator)) {
  fail('fixture, runtime, and Redis targets must retain exact loopback port/database/role validation');
}
const playwrightConfig = read('frontend/playwright.config.ts');
if (!/applyValidatedTargetsToRunner\(process\.env\)/.test(playwrightConfig) ||
    !/DATABASE_URL: targets\.appDatabaseUrl/.test(playwrightConfig) ||
    /DATABASE_URL: targets\.databaseUrl/.test(playwrightConfig)) {
  fail('Playwright and its app server must use only the validated restricted runtime URL');
}

console.log('hosted Today E2E workflow contract passed');
NODE
