#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
node - "$ROOT" <<'NODE'
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const root = process.argv[2];
const fail = (message) => {
  console.error(`culinary profile migration contract failure: ${message}`);
  process.exit(1);
};
const matchesAvailableTimeConstraint = (sql) =>
  /available_time_minutes[\s\S]{0,300}(between|>=)[\s\S]{0,100}5[\s\S]{0,100}(and|<=)[\s\S]{0,100}240/i.test(sql);
const matchesHouseholdArrayConstraint = (sql) =>
  /household_members[\s\S]{0,200}(jsonb|json)[\s\S]{0,500}(jsonb_array_length|array_length)/i.test(sql);
const multilineConstraintFixture = `
  habitual_time_minutes integer
    check (habitual_time_minutes between 5 and 240),
  household_members jsonb
    check (jsonb_typeof(household_members) = 'array'
      and jsonb_array_length(household_members) <= 12)
`;
if (!matchesAvailableTimeConstraint(multilineConstraintFixture.replaceAll('habitual_time_minutes', 'available_time_minutes'))) {
  fail('matcher fixture must accept a multiline available-time range constraint');
}
if (!matchesHouseholdArrayConstraint(multilineConstraintFixture)) {
  fail('matcher fixture must accept a multiline JSON-array constraint');
}
const runner = fs.readFileSync(path.join(root, 'frontend/scripts/run-migrations.js'), 'utf8');
const dotenvGuard = runner.match(/if\s*\(\s*process\.env\.COCINACORE_SKIP_DOTENV\s*!==\s*['"]1['"]\s*\)\s*\{([\s\S]*?)\n\}/);
if (!dotenvGuard || !/require\(['"]dotenv['"]\)\.config\(/.test(dotenvGuard[1])) {
  fail('migration runner must load dotenv by default and skip it only when COCINACORE_SKIP_DOTENV=1');
}
if ((runner.match(/require\(['"]dotenv['"]\)\.config\(/g) || []).length !== 1) {
  fail('migration runner must have exactly one guarded dotenv load');
}
const manifestPath = path.join(root, 'db/migrations/manifest.json');
const migrationPath = path.join(root, 'db/migrations/013_culinary_profile_context.sql');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const migration = manifest.migrations.find((entry) => entry.id === '013');
if (!migration || migration.filename !== '013_culinary_profile_context.sql') {
  fail('manifest must register migration 013 with its canonical filename');
}
if (migration.lane !== 'migration' || migration.transactional !== 'required' ||
    migration.legacyChecksumBackfillAllowed !== false) {
  fail('migration 013 must use the existing transactional, forward-only lane');
}
const expectedCatalogConstraints = [
  'user_culinary_profiles.user_culinary_profiles_available_time_minutes_check',
  'user_culinary_profiles.user_culinary_profiles_household_members_check',
];
if (!Array.isArray(migration.catalogAdditions) ||
    migration.catalogAdditions.some((addition) =>
      addition.kind !== 'constraint' || addition.schema !== 'public') ||
    JSON.stringify(migration.catalogAdditions.map((addition) => addition.identity).sort()) !==
      JSON.stringify(expectedCatalogConstraints.sort())) {
  fail('migration 013 catalog additions must contain only the two supported constraint identities');
}
const sql = fs.readFileSync(migrationPath);
const digest = crypto.createHash('sha256').update(sql).digest('hex');
if (migration.byteLength !== sql.length || migration.sha256 !== digest) {
  fail('manifest byte length and SHA-256 must match migration 013 exactly');
}
const source = sql.toString('utf8');
for (const column of ['disliked_ingredients', 'allergies', 'available_time_minutes', 'household_members']) {
  if (!new RegExp(`\\b${column}\\b`, 'i').test(source)) fail(`schema column ${column} is missing`);
}
if (!matchesAvailableTimeConstraint(source)) {
  fail('available preparation time must be constrained to 5–240 minutes');
}
if (!matchesHouseholdArrayConstraint(source)) {
  fail('household members must be stored as bounded JSON array data');
}
if (manifest.migrations.findIndex((entry) => entry.id === '013') !== 12) {
  fail('migration 013 must retain canonical sequence position 13');
}
for (const entry of manifest.migrations) {
  const bytes = fs.readFileSync(path.join(root, 'db/migrations', entry.filename));
  if (entry.byteLength !== bytes.length ||
      entry.sha256 !== crypto.createHash('sha256').update(bytes).digest('hex')) {
    fail(`manifest checksum or byte length is invalid for ${entry.filename}`);
  }
}
const task = fs.readFileSync(path.join(root, 'odd/tasks/m2-culinary-profile.md'), 'utf8');
for (const requirement of [
  /pre-backup/i,
  /exact target SHA/i,
  /exact expected pending set/i,
  /pre\/post ledger\+checksum verification/i,
  /existing migration lock\/transaction behavior/i,
  /post-run verify/i,
  /failure rollback before commit/i,
  /no automatic restore/i,
  /separate authorization/i,
]) {
  if (!requirement.test(task)) fail(`future migration runbook requirement missing: ${requirement}`);
}
const runbook = fs.readFileSync(path.join(root, 'docs/production/runbook.md'), 'utf8')
  .replace(/\s+/g, ' ')
  .toLowerCase();
if (!runbook.includes('npm run db:migrate:verify') ||
    !runbook.includes('no provisioning, mutating migration, ddl')) {
  fail('production M1 runbook must remain verify-only');
}
const harness = fs.readFileSync(path.join(root, 'scripts/test-culinary-profile-migration-integration.sh'), 'utf8');
if (!/CONTAINER_ID=\$\("\$\{DOCKER\[@\]\}" run[\s\S]*?--label "\$LABEL_KEY=\$RUN_ID"[\s\S]*?"\$IMAGE"\)/.test(harness)) {
  fail('integration harness must capture the immutable ID returned by docker run');
}
if (!/"\$\{DOCKER\[@\]\}" container inspect[\s\S]{0,200}\$CONTAINER_ID/.test(harness) ||
    !/"\$\{DOCKER\[@\]\}" exec[\s\S]{0,200}\$CONTAINER_ID/.test(harness)) {
  fail('post-start inspection and exec operations must target the captured container ID');
}
if (!/--label "\$LABEL_KEY=\$RUN_ID"/.test(harness) ||
    !/\.Config\.Image\}\}\|\{\{index \.Config\.Labels "com\.cocinacore\.culinary-migration\.run"/.test(harness) ||
    !/\[\[ "\$identity" == "\$IMAGE\|\$RUN_ID" \]\]/.test(harness)) {
  fail('integration harness must validate the exact run label and expected image');
}
if (!/if ! CONTAINER_ID=\$\([\s\S]*?run[\s\S]*?\); then\s*CONTAINER_ID=''\s*fail/.test(harness)) {
  fail('failed docker run must clear partial stdout before cleanup runs');
}
const runStart = harness.indexOf('if ! CONTAINER_ID=$(');
const runEnd = harness.indexOf('\nfi', runStart);
const runBlock = harness.slice(runStart, runEnd);
if (!runBlock.includes('--pull=never')) fail('docker run must use --pull=never');
if (!runBlock.includes("--publish '127.0.0.1::5432'")) fail('docker run must publish a dynamic loopback-only port');
if (!runBlock.includes("--tmpfs '/var/lib/postgresql/data:rw,noexec,nosuid,size=1g'") ||
    /--(?:mount|volume)\b|(?:^|\s)-v\s/.test(runBlock) ||
    !/exec "\$CONTAINER_ID" sh -c/.test(harness) ||
    !/while read -r device destination filesystem options dump pass; do[\s\S]*?\[ "\$destination" = "\/var\/lib\/postgresql\/data" \][\s\S]*?printf "%s %s\\n" "\$filesystem" "\$destination"[\s\S]*?done < \/proc\/mounts/.test(harness) ||
    /exec "\$CONTAINER_ID" awk/.test(harness) ||
    !/\/proc\/mounts/.test(harness) ||
    !/while IFS= read -r mount_line/.test(harness) ||
    /\bmapfile\b/.test(harness) ||
    !/read -r mount_type mount_destination <<< "\$mount_line"/.test(harness) ||
    !/if \[\[ "\$mount_destination" == '\/var\/lib\/postgresql\/data' \]\]; then[\s\S]{0,200}\(\(data_mount_count \+= 1\)\)[\s\S]{0,100}data_mount_type=\$mount_type/.test(harness) ||
    !/if \[\[ "\$data_mount_count" != 1 \|\| "\$data_mount_type" != 'tmpfs' \]\]/.test(harness) ||
    !/observed data mount records \(type destination; first 10 records\):/.test(harness) ||
    !/mount_index < \$\{#mount_lines\[@\]\} && mount_index < 10/.test(harness) ||
    !/no matching data mount records/.test(harness) ||
    /\.Mounts/.test(harness) ||
    /if\s+\[\[\s+"\$mounts"\s*(?:==|!=)/.test(harness)) {
  fail('integration harness must query /proc/mounts and require exactly one PostgreSQL data tmpfs, with bounded matching-record diagnostics');
}
const endpointGate = harness.indexOf('== unix://?*');
const imageInspect = harness.indexOf('image inspect');
if (endpointGate < 0 || imageInspect < 0 || endpointGate > imageInspect) {
  fail('local Unix endpoint gate must precede Docker resource operations');
}
const armedHarness = harness.slice(harness.indexOf('CONTAINER_CREATED=1'));
if (/container inspect[^\n]*"\$CONTAINER"/.test(armedHarness) ||
    /exec[^\n]*"\$CONTAINER"/.test(armedHarness) ||
    /rm -f "\$CONTAINER"/.test(armedHarness)) {
  fail('post-start inspect, exec, and removal must not target the mutable container name');
}
if (/rm -f "\$CONTAINER"/.test(harness) ||
    !/\$\{DOCKER\[@\]\}" rm -f "\$candidate_id"/.test(harness) ||
    !/identity.*\$candidate_id/.test(harness)) {
  fail('cleanup must validate and remove only the exact container ID');
}
if (!/DOCKER_HOST\+x/.test(harness) || !/DOCKER_CONTEXT\+x/.test(harness) ||
    !/docker context show/.test(harness) ||
    !/docker context inspect "\$DOCKER_CONTEXT_NAME"/.test(harness) ||
    !/\[\[ "\$DOCKER_ENDPOINT" == unix:\/\/\?\* \]\]/.test(harness) ||
    !/DOCKER=\(docker --host "\$DOCKER_ENDPOINT"\)/.test(harness)) {
  fail('integration harness must reject endpoint overrides and pin a local Unix Docker endpoint');
}
const executableHarness = harness.split('\n')
  .map((line) => line.replace(/#.*/, '').replace(/'(?:[^']*)'|"(?:[^"]*)"/g, ''))
  .join('\n');
const cleanup = harness.slice(harness.indexOf('cleanup() {'), harness.indexOf('\n}\ntrap cleanup'));
if (!/if ! rm -rf -- "\$WORKSPACE"; then[\s\S]*?elif \[\[ -e "\$WORKSPACE" \|\| -L "\$WORKSPACE" \]\]; then[\s\S]*?else\s*printf 'removed and verified absent: temporary workspace\\n'/.test(cleanup)) {
  fail('temporary workspace cleanup must report success only after exact removal and absence verification');
}
if (/(^|[=(\s])docker (?:info|image inspect|container inspect|container ls|run|exec|rm)\b/m.test(executableHarness) ||
    !harness.includes('container ls -a --no-trunc --format') ||
    !harness.includes("'{{.ID}}|{{.Names}}'") ||
    !cleanup.includes('container_list_has_id "$candidate_id"') ||
    !cleanup.includes('container_list_name_id "$CONTAINER"') ||
    !cleanup.includes('elif ! refresh_container_list; then') ||
    !cleanup.includes('removed and verified absent:')) {
  fail('cleanup absence checks must use a successful authoritative pinned container-list query');
}
console.log('culinary profile migration 013 static contract passed');
NODE
