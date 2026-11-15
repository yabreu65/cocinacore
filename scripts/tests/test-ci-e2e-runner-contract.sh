#!/bin/sh
set -eu

ROOT=$(CDPATH='' cd -- "$(dirname -- "$0")/../.." && pwd)
node - "$ROOT" <<'NODE'
const fs = require('node:fs');
const path = require('node:path');

const root = process.argv[2];
const fail = (message) => {
  console.error(`CI E2E runner contract failure: ${message}`);
  process.exit(1);
};
const workflow = fs.readFileSync(path.join(root, '.github/workflows/ci.yml'), 'utf8');
const job = workflow.slice(workflow.indexOf('  e2e-tests:'));
if (!job.startsWith('  e2e-tests:')) fail('e2e-tests job is missing');
if (!/^    runs-on: ubuntu-24\.04$/m.test(job)) fail('E2E runner must pin ubuntu-24.04');
if (!/image: pgvector\/pgvector:pg16/.test(job)) fail('E2E must use PostgreSQL 16 with pgvector');
if (!/node-version: 22\.22\.3/.test(job)) fail('E2E must pin Node 22.22.3');

const setupName = '      - name: Provision 019, prepare and activate 020, then run isolated E2E';
const start = job.indexOf(setupName);
const end = start < 0 ? -1 : job.indexOf('\n      - name:', start + setupName.length);
const setup = start < 0 ? '' : job.slice(start, end < 0 ? undefined : end);
if (!setup) fail('single isolated provisioning-and-test step is missing');

const orderedCommands = [
  'npm run db:provision',
  'npm run db:migrate -- --stop-after 019',
  '--verify-boundary 019',
  'scripts/provision-runtime-role.sql',
  'scripts/provision-auth-role.sql',
  'scripts/provision-020-inert-capabilities.sql',
  'attestPreparedCapabilities(client, { required: true })',
  'scripts/rls-candidates/020e-a1-inert-capability-guard.sql',
  'MIGRATION_EXPECTED_PENDING=020_tenant_rls_hardening.sql,021_inventory_price_reference.sql,022_real_consumption_occurrences.sql npm run db:migrate -- --stop-after 020\n',
  "if (state !== 'pending')",
  'if npm run db:migrate:verify',
  'scripts/activate-020-capabilities.js',
  'MIGRATION_EXPECTED_PENDING=021_inventory_price_reference.sql,022_real_consumption_occurrences.sql npm run db:migrate\n',
  'npm run db:migrate:verify\n',
  'scripts/tests/test-inventory-021-constraints.sql',
  'npm run test:e2e',
];
let previous = -1;
for (const command of orderedCommands) {
  const index = setup.indexOf(command);
  if (index < 0 || index <= previous) fail(`missing or out-of-order command: ${command}`);
  previous = index;
}

for (const role of [
  'cocinacore_runtime_rls',
  'cocinacore_auth',
  'cocinacore_owner_metrics',
  'cocinacore_global_writer',
]) {
  if (!setup.includes(role)) fail(`isolated role ${role} is not provisioned or used`);
}
if (!/openssl rand -hex 32/.test(setup)) fail('role passwords must be generated ephemerally');
if (!/COCINACORE_ACTIVATION_DATABASE_URL="\$admin_url" node scripts\/activate-020-capabilities\.js/.test(setup)) {
  fail('activation admin must be supplied only to the explicit disposable activation process');
}
if (!/E2E_APP_DATABASE_URL="postgresql:\/\/cocinacore_runtime_rls:\$\{runtime_password\}@127\.0\.0\.1:5435\/cocinacore_local_db"/.test(setup)) {
  fail('Playwright application URL must use the restricted runtime login');
}
if (/^      (?:DATABASE_URL|BOOTSTRAP_DATABASE_URL|MIGRATION_DATABASE_URL|MIGRATION_ADMIN_PASSWORD):/m.test(job)) {
  fail('administrative database credentials must not be job-level environment variables');
}
if (!/unset BOOTSTRAP_DATABASE_URL MIGRATION_DATABASE_URL MIGRATION_ADMIN_PASSWORD/.test(setup)) {
  fail('migration and bootstrap credentials must be removed before E2E execution');
}
for (const flag of [
  'COCINACORE_SEPARATE_AUTH_DB=true',
  'COCINACORE_SIGNUP_BOOTSTRAP_ENABLED=true',
  'COCINACORE_SIGNUP_MAINTENANCE=false',
  'COCINACORE_OWNER_METRICS_DB_ENABLED=true',
  'COCINACORE_OWNER_GLOBAL_WRITER_ENABLED=true',
]) {
  if (!setup.includes(`export ${flag}`)) fail(`application capability flag is missing: ${flag}`);
}
if (!/trap cleanup EXIT/.test(setup) || !setup.includes('shutil.rmtree(target)')) {
  fail('E2E build output cleanup must be guarded and automatic');
}
if (/npm run db:bootstrap/.test(setup)) fail('legacy direct seed must not run after FORCE RLS');

const targets = fs.readFileSync(path.join(root, 'frontend/e2e/database-target.ts'), 'utf8');
if (!/environment\.DATABASE_URL = targets\.appDatabaseUrl/.test(targets) ||
    !/cocinacore_runtime_rls/.test(targets)) {
  fail('runner DATABASE_URL must resolve to the validated restricted application target');
}
const playwright = fs.readFileSync(path.join(root, 'frontend/playwright.config.ts'), 'utf8');
if (!/DATABASE_URL: targets\.appDatabaseUrl/.test(playwright) ||
    /DATABASE_URL: targets\.databaseUrl/.test(playwright)) {
  fail('Next.js app server must not receive the privileged fixture URL');
}
if (!playwright.includes('standalone/${distDir}/static') ||
    !playwright.includes('path.join("standalone",d,"static")') ||
    playwright.includes('standalone/.next/static')) {
  fail('Next.js standalone assets must be copied into the configured custom distDir');
}
for (const variable of [
  'BOOTSTRAP_DATABASE_URL',
  'MIGRATION_DATABASE_URL',
  'MIGRATION_ADMIN_PASSWORD',
  'COCINACORE_ACTIVATION_DATABASE_URL',
  'E2E_DATABASE_URL',
]) {
  if (!playwright.includes(`${variable}: ''`)) fail(`Next app environment must scrub ${variable}`);
}
const globalSetup = fs.readFileSync(path.join(root, 'frontend/e2e/global-setup.ts'), 'utf8');
if (!globalSetup.includes('/api/auth/signup') || !globalSetup.includes('/api/profile') ||
    !globalSetup.includes('/api/auth/login') ||
    !globalSetup.includes('identity.is_superuser') || !globalSetup.includes('identity.bypasses_rls')) {
  fail('HTTP signup/login and restricted runtime identity checks are required');
}

console.log('CI E2E migration and restricted-role contract passed');
NODE
