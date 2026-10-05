#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
DEPLOY="$ROOT/scripts/deploy-pawtech-production.sh"
BACKUP_HELPER="$ROOT/scripts/backup-pawtech-cocinacore-predeploy.sh"
RUNNER="$ROOT/frontend/scripts/run-migrations.js"

fail() {
  printf '%s\n' "pawtech step 4 contract failure: $1" >&2
  exit 1
}

sh -n "$DEPLOY" || fail 'deploy script syntax is invalid'
node --check "$RUNNER" || fail 'migration runner syntax is invalid'

for expected in \
  'BACKUP_CREATED' \
  'BACKUP_CHECKSUM_OK' \
  'file_mode=$(stat -c' \
  'sidecar_mode=$(stat -c' \
  'parent_mode=$(stat -c' \
  "[ \"\$parent_mode\" = '700' ]" \
  'file_owner=$(stat -c' \
  'sidecar_owner=$(stat -c' \
  'parent_owner=$(stat -c' \
  'deploy_uid=$(id -u)' \
  'BACKUP_DUMP_VALID' \
  'BACKUP_OK' \
  'sha256sum -c' \
  'DATABASE_CHANGED=NO' \
  "log 'MIGRATION_EXPECTATION=NO_OP'" \
  'PREVIOUS_RENAME_ATTEMPTED=0' \
  'PREVIOUS_RENAMED=0' \
  'NEW_APP_STARTED=0' \
  'NEW_APP_RUN_ATTEMPTED=0' \
  'PREVIOUS_ID=' \
  'DEPLOYMENT_ATTEMPT=' \
  'com.cocinacore.deploy-attempt' \
  'CANDIDATE_STARTED=0' \
  'APP_ROLLBACK_SAFE' \
  'MANUAL_INTERVENTION_REQUIRED'; do
  grep -Fq -- "$expected" "$DEPLOY" || fail "missing deploy safety contract: $expected"
done

! grep -Eq 'db:provision|MIGRATION_ENV_FILE|MIGRATION_DATABASE_URL|BOOTSTRAP_DATABASE_URL|\.env\.migration|migration_admin' "$DEPLOY" ||
  fail 'Pawtech deployment must not use a provisioner or separated migration environment'
! grep -Eq 'pg_restore[^\n]*(--clean|--create)|docker (rm|stop|start|rename).*pawtech-(postgres|redis)|docker (compose|volume create|network create)' "$DEPLOY" ||
  fail 'database restore or shared-service mutation is forbidden'
! grep -Eq 'rm[^\n]*BACKUP_ARTIFACT|rm[^\n]*backup_sidecar' "$DEPLOY" || fail 'backup artifacts must be preserved during cleanup'
grep -Fq 'sha256sum -c' "$DEPLOY" && grep -Fq 'pg_restore --list <"$dump_file"' "$BACKUP_HELPER" ||
  fail 'backup checksum and stdin archive validation are required'
! grep -Fq 'pg_restore --list -' "$BACKUP_HELPER" ||
  fail 'archive validation must not pass a positional filename to pg_restore'
grep -Fq 'pg_dump -U cocinacore_user -d "$DATABASE_NAME" -Fc --no-owner --no-acl' "$BACKUP_HELPER" ||
  fail 'CocinaCore-only custom-format backup is required'

backup_line=$(grep -nF '"$RELEASE_DIR/scripts/backup-pawtech-cocinacore-predeploy.sh" "$RELEASE_SHA"' "$DEPLOY" | head -n 1 | cut -d: -f1)
build_line=$(grep -nF 'docker build' "$DEPLOY" | head -n 1 | cut -d: -f1)
checksum_line=$(grep -nF 'sha256sum -c' "$DEPLOY" | tail -n 1 | cut -d: -f1)
archive_line=$(grep -nF 'log "BACKUP_DUMP_VALID artifact=${BACKUP_ARTIFACT}"' "$DEPLOY" | cut -d: -f1)
verify_line=$(grep -nF 'npm run db:migrate:verify' "$DEPLOY" | cut -d: -f1)
no_op_line=$(grep -nF "log 'MIGRATION_EXPECTATION=NO_OP'" "$DEPLOY" | cut -d: -f1)
candidate_line=$(grep -nF "log 'CANDIDATE starting'" "$DEPLOY" | cut -d: -f1)
candidate_health_line=$(grep -nF "log 'CANDIDATE health=ok'" "$DEPLOY" | cut -d: -f1)
cutover_line=$(grep -nF 'log "CUTOVER new_image=${IMAGE}"' "$DEPLOY" | cut -d: -f1)
public_health_line=$(grep -nF '[ "$public_ok" -eq 1 ]' "$DEPLOY" | cut -d: -f1)
preflight_return_line=$(grep -nF 'PREFLIGHT_OK release=${RELEASE_SHA} storage=${STORAGE_DRIVER}' "$DEPLOY" | cut -d: -f1)
backup_timestamp_line=$(grep -nF 'BACKUP_ARTIFACT=$(' "$DEPLOY" | cut -d: -f1)
[ "$build_line" -lt "$backup_line" ] && [ "$backup_line" -lt "$checksum_line" ] &&
  [ "$checksum_line" -lt "$archive_line" ] && [ "$archive_line" -lt "$verify_line" ] &&
  [ "$verify_line" -lt "$no_op_line" ] && [ "$no_op_line" -lt "$candidate_line" ] &&
  [ "$candidate_line" -lt "$candidate_health_line" ] && [ "$candidate_health_line" -lt "$cutover_line" ] &&
  [ "$cutover_line" -lt "$public_health_line" ] && [ "$preflight_return_line" -lt "$backup_timestamp_line" ] ||
  fail 'preflight or build/backup/checksum/archive/verify/no-op/candidate/cutover/public-health order is invalid'
! grep -Eq 'npm run db:migrate([[:space:]]|$)' "$DEPLOY" || fail 'mutating db:migrate command is forbidden'
grep -Fq 'npm run db:migrate:verify' "$DEPLOY" || fail 'read-only db:migrate:verify command is missing'
grep -Fq 'DATABASE_CHANGED=NO' "$DEPLOY" || fail 'database change state is not explicit'
grep -Fq 'PREVIOUS_RENAMED=1' "$DEPLOY" || fail 'successful previous-container rename is not tracked'
grep -Fq 'NEW_APP_STARTED=1' "$DEPLOY" || fail 'new application creation is not tracked'
grep -Fq "{{.Config.Image}}|{{index .Config.Labels \"com.cocinacore.deploy-attempt\"}}" "$DEPLOY" ||
  fail 'partial app removal is not guarded by image and unique attempt identity'
grep -Fq 'PREVIOUS_ID=$(docker inspect' "$DEPLOY" || fail 'previous container identity is not captured'
grep -Fq "{{range \$name, \$_ := .NetworkSettings.Networks}}" "$DEPLOY" ||
  fail 'rollback network membership is not enumerated exactly'
grep -Fq 'if [ "$DEPLOY_SUCCEEDED" -ne 1 ] && { [ "$PREVIOUS_RENAME_ATTEMPTED" -eq 1 ] || [ "$PREVIOUS_RENAMED" -eq 1 ] || [ "$NEW_APP_RUN_ATTEMPTED" -eq 1 ]; }' "$DEPLOY" ||
  fail 'cutover cleanup does not distinguish rename/run-attempt states'
grep -Fq 'PREVIOUS_RENAME_ATTEMPTED=1' "$DEPLOY" || fail 'previous rename outcome is not reconciled after command failure'
rename_attempt_line=$(grep -nF 'PREVIOUS_RENAME_ATTEMPTED=1' "$DEPLOY" | tail -n 1 | cut -d: -f1)
rename_action_line=$(grep -nF 'docker rename "$APP_CONTAINER" "$PREVIOUS"' "$DEPLOY" | cut -d: -f1)
renamed_state_line=$(grep -nF 'PREVIOUS_RENAMED=1' "$DEPLOY" | tail -n 1 | cut -d: -f1)
[ "$rename_attempt_line" -lt "$rename_action_line" ] && [ "$rename_action_line" -lt "$renamed_state_line" ] ||
  fail 'rename attempt/success state ordering is unsafe'
attempted_line=$(grep -nF 'NEW_APP_RUN_ATTEMPTED=1' "$DEPLOY" | tail -n 1 | cut -d: -f1)
label_line=$(grep -nF -- '--label "com.cocinacore.deploy-attempt=$DEPLOYMENT_ATTEMPT"' "$DEPLOY" | tail -n 1 | cut -d: -f1)
[ "$attempted_line" -lt "$label_line" ] || fail 'failed docker run can leave an untracked partial app'
cleanup_block=$(sed -n '/^cleanup()/,/^}/p' "$DEPLOY")
identity_line=$(printf '%s\n' "$cleanup_block" | grep -nF 'attempted_identity=$(docker inspect' | head -n 1 | cut -d: -f1)
app_rm_line=$(printf '%s\n' "$cleanup_block" | grep -nF 'docker rm -f "$APP_CONTAINER"' | head -n 1 | cut -d: -f1)
[ -n "$identity_line" ] && [ -n "$app_rm_line" ] && [ "$identity_line" -lt "$app_rm_line" ] ||
  fail 'in-process cleanup must verify attempt identity before removing the app'
grep -Fq 'docker network connect "$network" "$APP_CONTAINER"' "$DEPLOY" || fail 'rollback does not restore required networks'
grep -Fq 'previous_app_health=ok' "$DEPLOY" && grep -Fq 'MANUAL_INTERVENTION_REQUIRED application_rollback_unverified' "$DEPLOY" ||
  fail 'previous application internal/public health is not verified'
grep -Fq "x.dependencies?.database?.status!=='ok'||x.dependencies?.redis?.status!=='ok'" "$DEPLOY" ||
  fail 'restored internal health omits database/redis status checks'
grep -Fq "if(x.status!=='ok'||x.dependencies?.database?.status!=='ok'||x.dependencies?.redis?.status!=='ok')" "$DEPLOY" ||
  fail 'restored public health omits app/database/redis JSON checks'
grep -Fq 'docker rm -f "$APP_CONTAINER"' "$DEPLOY" &&
  grep -Fq 'docker rename "$PREVIOUS" "$APP_CONTAINER"' "$DEPLOY" || fail 'application-only rollback is incomplete'
grep -Fq 'ROLLBACK_RESTORED previous_image=' "$DEPLOY" || fail 'rollback does not report verified previous image identity'
restored_line=$(printf '%s\n' "$cleanup_block" | grep -nF 'ROLLBACK_RESTORED previous_image=' | head -n 1 | cut -d: -f1)
rollback_safe_line=$(printf '%s\n' "$cleanup_block" | grep -nF "log 'APP_ROLLBACK_SAFE previous_app_health=ok'" | head -n 1 | cut -d: -f1)
[ -n "$restored_line" ] && [ -n "$rollback_safe_line" ] && [ "$restored_line" -lt "$rollback_safe_line" ] ||
  fail 'in-process cleanup is marked safe before identity/health validation'
printf '%s\\n' "$cleanup_block" | grep -Fq "if ! docker rename \"\$PREVIOUS\" \"\$APP_CONTAINER\"" ||
  fail 'previous rename failure does not enter postcondition validation'
printf '%s\\n' "$cleanup_block" | grep -Fq "docker inspect --format '{{.State.Running}}'" ||
  fail 'start failure does not validate running state'
printf '%s\\n' "$cleanup_block" | grep -Fq 'grep -Fxq "$network"' || fail 'network reconnect is not followed by exact membership validation'
printf '%s\\n' "$cleanup_block" | grep -Fq 'container_absent "$APP_CONTAINER" || rollback_ok=0' ||
  fail 'app removal lacks an absence postcondition'
printf '%s\\n' "$cleanup_block" | grep -Fq 'candidate_identity' &&
  printf '%s\\n' "$cleanup_block" | grep -Fq 'container_absent "$CANDIDATE" || rollback_ok=0' ||
  fail 'candidate cleanup lacks attempt identity and absence verification'
printf '%s\\n' "$cleanup_block" | grep -Fq '"$PREVIOUS_IMAGE" ] || rollback_ok=0' ||
  fail 'restoration does not verify the captured previous image'
printf '%s\\n' "$cleanup_block" | grep -Fq "'{{.State.Running}}'" || fail 'start failure lacks a running-state postcondition'
grep -Fq 'grep -Fxq "$network"' "$DEPLOY" || fail 'rollback network comparison is not exact'
grep -Fq "names=\$(docker ps -a --format '{{.Names}}')" "$DEPLOY" || fail 'container removal lacks a Docker-list absence postcondition'
grep -Fq 'MANUAL_INTERVENTION_REQUIRED application_rollback_unverified' "$DEPLOY" ||
  fail 'uncertain rollback does not fail closed'
grep -Fq 'no_automatic_restore' "$DEPLOY" || fail 'database restore boundary is not reported'
grep -Fq 'DATABASE_CHANGED=NO' "$DEPLOY" || fail 'explicit unchanged database evidence is missing'
! grep -Fq 'DATABASE_CHANGED=YES' "$DEPLOY" || fail 'database change YES branch must be absent'

for expected in \
  'if (options.verifyComplete)' \
  'Migration ledger is complete.' \
  'begin read only' \
  'if (separated) await assertAndAssumeMigrationIdentity(client, manifest);' \
  'Migration ledger is missing.'; do
  grep -Fq -- "$expected" "$RUNNER" || fail "missing migration runner contract: $expected"
done

verify_begin_line=$(grep -nF "await client.query('begin read only')" "$RUNNER" | cut -d: -f1)
verify_identity_line=$(grep -nF 'if (separated) await assertAndAssumeMigrationIdentity(client, manifest);' "$RUNNER" | cut -d: -f1)
verify_ledger_line=$(grep -nF 'hadLedger = await migrationLedgerExists(client);' "$RUNNER" | head -n 1 | cut -d: -f1)
[ "$verify_begin_line" -lt "$verify_identity_line" ] && [ "$verify_identity_line" -lt "$verify_ledger_line" ] ||
  fail 'separated verification must assume migration identity read-only before reading the ledger'

node - "$ROOT" <<'NODE'
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const root = process.argv[2];
const runner = path.join(root, 'frontend/scripts/run-migrations.js');
const harness = String.raw`
const Module = require('node:module');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const originalLoad = Module._load;
const originalReadFileSync = fs.readFileSync.bind(fs);
const originalReaddirSync = fs.readdirSync.bind(fs);
const manifest = JSON.parse(originalReadFileSync(process.env.MANIFEST_PATH, 'utf8'));
const futureSql = Buffer.from('select 1;');
if (process.env.FUTURE_013 === 'yes') {
  manifest.migrations.push({
    id: '013', filename: '013_future.sql', lane: 'migration',
    sha256: crypto.createHash('sha256').update(futureSql).digest('hex'),
    byteLength: futureSql.length, transactional: 'required', legacyChecksumBackfillAllowed: false,
  });
}
fs.readFileSync = (file, options) => {
  if (String(file) === process.env.MANIFEST_PATH) {
    const contents = Buffer.from(JSON.stringify(manifest));
    return options && typeof options === 'object' && options.encoding ? contents.toString(options.encoding) : contents;
  }
  if (String(file).endsWith('/013_future.sql')) return futureSql;
  return originalReadFileSync(file, options);
};
fs.readdirSync = (directory, options) => {
  const files = originalReaddirSync(directory, options);
  return process.env.FUTURE_013 === 'yes' && String(directory) === path.dirname(process.env.MANIFEST_PATH)
    ? [...files, '013_future.sql']
    : files;
};
const queries = [];
class Pool {
  async connect() {
    return {
      async query(sql) {
        const text = String(sql).trim().toLowerCase();
        queries.push(text);
        if (/^set role cocinacore_schema_owner$/.test(text)) return { rows: [] };
        if (/^(create|alter|drop|revoke|grant|insert|update|delete|set|reset)\\b/.test(text)) {
          throw new Error('unexpected mutation in read-only guard');
        }
        if (text.includes('select session_user, current_user, r.rolname')) {
          const schemaOwner = text.includes('where r.rolname = current_user');
          return { rows: [{
            session_user: 'migration_admin', current_user: schemaOwner ? 'cocinacore_schema_owner' : 'migration_admin',
            rolname: schemaOwner ? 'cocinacore_schema_owner' : 'migration_admin',
            rolcanlogin: !schemaOwner, rolinherit: false, rolsuper: false, rolcreatedb: false,
            rolcreaterole: false, rolreplication: false, rolbypassrls: false, rolconnlimit: -1,
            rolvaliduntil: null, rolconfig: null,
          }] };
        }
        if (text.includes('as database_settings')) return { rows: [{ database_settings: 0, tablespace_authority: 0, database_authority: 0 }] };
        if (text.includes('select count(*)::integer as count from authority')) return { rows: [{ count: 0 }] };
        if (text.includes('select kind, identity from (')) return { rows: manifest.baselineObjects.transferable.map((object) => ({
          kind: object.kind,
          identity: object.kind === 'schema' ? object.schema : object.kind === 'function'
            ? object.schema + '.' + object.name + '(' + object.arguments + ')'
            : object.schema + '.' + object.name,
        })) };
        if (text.includes('select count(*)::integer as count from grants')) return { rows: [{ count: 0 }] };
        if (text.includes('from pg_catalog.pg_auth_members')) return { rowCount: 1, rows: [{
          granted_role: 'cocinacore_schema_owner', member_role: 'migration_admin',
          admin_option: false, inherit_option: false, set_option: true,
        }] };
        if (text.includes('select rolname')) return { rows: [{ rolname: 'cocinacore_schema_owner' }] };
        if (text.includes('to_regclass')) return { rows: [{ exists: process.env.LEDGER !== 'missing' }] };
        if (text.includes('from pg_catalog.pg_attribute')) {
          const rows = [
            { attname: 'filename', data_type: 'text', attnotnull: true },
            { attname: 'applied_at', data_type: 'timestamp with time zone', attnotnull: true, default_expression: 'now()' },
            ...(process.env.SEPARATED === 'yes' ? [{ attname: 'checksum', data_type: 'text', attnotnull: true }] : []),
          ];
          return { rowCount: rows.length, rows };
        }
        if (text.includes('from pg_catalog.pg_class c') && text.includes('relrowsecurity')) return { rows: [
          { relrowsecurity: true, primary_keys: 1, public_grants: 0 },
        ] };
        if (text.includes('from public.schema_migrations')) {
          let entries = manifest.migrations.map((entry) => ({ filename: entry.filename, checksum: entry.sha256 }));
          if (process.env.LEDGER === 'pending' || process.env.LEDGER === 'pending-013') entries = entries.slice(0, -1);
          if (process.env.LEDGER === 'unknown') entries = [...entries, { filename: '999_unexpected.sql', checksum: 'f'.repeat(64) }];
          if (process.env.LEDGER === 'out-of-order') entries = [entries[1]];
          return { rows: entries };
        }
        return { rows: [] };
      },
      release() {},
    };
  }
  async end() {}
}
Module._load = function (request, parent, isMain) {
  if (request === 'pg') return { Pool };
  if (request === 'dotenv') return { config() {} };
  return originalLoad.call(this, request, parent, isMain);
};
process.argv = ['node', process.env.RUNNER_PATH, '--lane', 'migration', process.env.RUNNER_MODE];
process.env.DATABASE_URL = 'postgresql://offline.invalid/test';
require(process.env.RUNNER_PATH);
setTimeout(() => {
  if (!queries.includes('begin read only')) process.exitCode = 2;
  if (queries.some((sql) => /^(create|alter|drop|revoke|grant|insert|update|delete|set|reset)\\b/.test(sql) && sql !== 'set role cocinacore_schema_owner')) process.exitCode = 3;
  const roleAssumptions = queries.filter((sql) => sql === 'set role cocinacore_schema_owner');
  const ledgerRead = queries.findIndex((sql) => sql.includes('from public.schema_migrations'));
  const expectedAssumptions = process.env.SEPARATED === 'yes' ? 1 : 0;
  if (roleAssumptions.length !== expectedAssumptions || ledgerRead === -1 || (roleAssumptions.length === 1 && queries.indexOf(roleAssumptions[0]) > ledgerRead)) {
    console.error('read-only role ordering failed: assumptions=' + roleAssumptions.length + ' roleIndex=' + queries.indexOf(roleAssumptions[0]) + ' ledgerIndex=' + ledgerRead);
    process.exitCode = 6;
  }
  const hasAcquire = queries.some((sql) => sql.includes('pg_try_advisory_lock'));
  const hasRelease = queries.some((sql) => sql.includes('pg_advisory_unlock'));
  const hasShapeCheck = queries.some((sql) => sql.includes('from pg_catalog.pg_attribute'));
  const hasSecurityCheck = queries.some((sql) => sql.includes('relrowsecurity'));
  if (hasAcquire || hasRelease) process.exitCode = 4;
  if (!hasShapeCheck || !hasSecurityCheck) process.exitCode = 5;
}, 0);
`;
function run(mode, ledger, future013 = false, separated = false) {
  return spawnSync(process.execPath, ['-e', harness], {
    encoding: 'utf8',
    env: { RUNNER_PATH: runner, MANIFEST_PATH: path.join(root, 'db/migrations/manifest.json'), RUNNER_MODE: mode, LEDGER: ledger, FUTURE_013: future013 ? 'yes' : 'no', SEPARATED: separated ? 'yes' : 'no', COCINACORE_SEPARATED_DB_LANES_ENABLED: separated ? 'true' : 'false', DATABASE_URL: 'postgresql://offline.invalid/test', MIGRATION_DATABASE_URL: 'postgresql://offline.invalid/test' },
  });
}
for (const [ledger, expectedStatus, marker] of [
  ['complete', 0, 'Migration ledger is complete.'],
  ['pending', 1, 'Pending migration:'],
  ['missing', 1, 'Migration ledger is missing.'],
  ['unknown', 1, 'unknown applied migration'],
  ['out-of-order', 1, 'Migration ledger is out of order:'],
]) {
  const mode = '--verify-complete';
  const result = run(mode, ledger);
  if (result.status !== expectedStatus || !`${result.stdout}${result.stderr}`.includes(marker)) {
    console.error(`offline runner contract failed for ${mode}/${ledger}: status=${result.status} stdout=${result.stdout} stderr=${result.stderr}`);
    process.exit(1);
  }
}
const separatedIdentityResult = run('--verify-complete', 'pending', false, true);
if (separatedIdentityResult.status !== 1 || !`${separatedIdentityResult.stdout}${separatedIdentityResult.stderr}`.includes('Pending migration:')) {
  console.error(`offline separated identity contract failed: status=${separatedIdentityResult.status} stdout=${separatedIdentityResult.stdout} stderr=${separatedIdentityResult.stderr}`);
  process.exit(1);
}
const futureResult = run('--verify-complete', 'pending-013', true);
if (futureResult.status !== 1 || !`${futureResult.stdout}${futureResult.stderr}`.includes('Pending migration: 013_future.sql')) {
  console.error(`offline future migration contract failed: ${futureResult.stderr}`);
  process.exit(1);
}
NODE

printf '%s\n' 'pawtech step 4 contract passed'
