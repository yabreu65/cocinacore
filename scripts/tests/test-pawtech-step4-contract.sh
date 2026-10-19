#!/bin/sh
set -eu

ROOT=$(CDPATH='' cd -- "$(dirname -- "$0")/../.." && pwd)
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
grep -Fq 'pg_dump -U pawtech_root -d "$DATABASE_NAME" -Fc --no-owner --no-acl' "$BACKUP_HELPER" ||
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
  'if (separated) await assertAndAssumeMigrationIdentity(client, manifest, migrations, separated);' \
  'Migration ledger is missing.'; do
  grep -Fq -- "$expected" "$RUNNER" || fail "missing migration runner contract: $expected"
done

verify_begin_line=$(grep -nF "await client.query('begin read only')" "$RUNNER" | head -n 1 | cut -d: -f1)
verify_call_line=$(grep -nF 'if (separated) await assertAndAssumeMigrationIdentity(client, manifest, migrations, separated);' "$RUNNER" | tail -n 1 | cut -d: -f1)
verify_identity_line=$(grep -nF 'const identity = await client.query(`' "$RUNNER" | cut -d: -f1)
verify_authority_line=$(grep -nF 'const authority = await client.query(' "$RUNNER" | cut -d: -f1)
verify_membership_line=$(grep -nF 'const memberships = await client.query(' "$RUNNER" | cut -d: -f1)
verify_set_role_line=$(grep -nF 'await client.query(`set role ${SCHEMA_OWNER}`)' "$RUNNER" | cut -d: -f1)
verify_assumed_line=$(grep -nF 'const assumed = await client.query(`' "$RUNNER" | cut -d: -f1)
verify_ledger_line=$(grep -nF 'const hasLedger = await migrationLedgerExists(client);' "$RUNNER" | cut -d: -f1)
[ "$verify_begin_line" -lt "$verify_call_line" ] &&
  [ "$verify_identity_line" -lt "$verify_authority_line" ] &&
  [ "$verify_authority_line" -lt "$verify_membership_line" ] &&
  [ "$verify_membership_line" -lt "$verify_set_role_line" ] &&
  [ "$verify_set_role_line" -lt "$verify_assumed_line" ] &&
  [ "$verify_assumed_line" -lt "$verify_ledger_line" ] ||
  fail 'separated verification must validate and assume the migration role before reading the ledger'

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
const migrationSql = new Set(manifest.migrations.map((entry) =>
  originalReadFileSync(path.join(path.dirname(process.env.MANIFEST_PATH), entry.filename), 'utf8').trim().toLowerCase()
));
if (manifest.baselineObjects.transferable.length !== 38) {
  throw new Error('trusted baseline must contain exactly 38 transferable targets');
}
const ownerFunctions = [
  { schema: 'public', name: 'is_valid_culinary_profile_text_list', arguments: 'text[], integer' },
  { schema: 'public', name: 'is_valid_culinary_household_members', arguments: 'jsonb' },
  { schema: 'public', name: 'enforce_culinary_profile_term_group_limit', arguments: '' },
  { schema: 'public', name: 'prevent_culinary_profile_taxonomy_reclassification', arguments: '' },
  { schema: 'public', name: 'enforce_user_recipe_version_invariants', arguments: '' },
];
const functionIdentity = ({ schema, name, arguments: args }) => schema + '.' + name + '(' + args + ')';
const schemaOwner = 'cocinacore_schema_owner';
const futureSql = Buffer.from('select 1;');
if (process.env.FUTURE_018 === 'yes') {
  manifest.migrations.push({
    id: '018', filename: '018_future.sql', lane: 'migration',
    sha256: crypto.createHash('sha256').update(futureSql).digest('hex'),
    byteLength: futureSql.length, transactional: 'required', legacyChecksumBackfillAllowed: false,
  });
}
fs.readFileSync = (file, options) => {
  if (String(file) === process.env.MANIFEST_PATH) {
    const contents = Buffer.from(JSON.stringify(manifest));
    return options && typeof options === 'object' && options.encoding ? contents.toString(options.encoding) : contents;
  }
  if (String(file).endsWith('/018_future.sql')) return futureSql;
  return originalReadFileSync(file, options);
};
fs.readdirSync = (directory, options) => {
  const files = originalReaddirSync(directory, options);
  return process.env.FUTURE_018 === 'yes' && String(directory) === path.dirname(process.env.MANIFEST_PATH)
    ? [...files, '018_future.sql']
    : files;
};
const queries = [];
let currentRole = 'migration_admin';
const provisionedMembership = {
  granted_role: 'cocinacore_schema_owner', member_role: 'migration_admin',
  admin_option: false, inherit_option: false, set_option: process.env.MEMBERSHIP !== 'invalid',
};
const ledgerProvisioning = {
  owner: 'cocinacore_schema_owner', rowLevelSecurity: true, publicGrants: 0,
  directSelectGrantToMigrationAdmin: false,
};
const poolConfigs = [];
class Pool {
  constructor(config) {
    this.config = config;
    poolConfigs.push(config);
  }
  async connect() {
    return {
      async query(sql, params = []) {
        const text = String(sql).trim().toLowerCase();
        queries.push(text);
        if (text.includes('hashtextextended')) return { rows: [{ key: '1' }] };
        if (text.includes('pg_try_advisory_lock')) return { rows: [{ acquired: true }] };
        if (text.includes('pg_advisory_unlock')) return { rows: [{ released: true }] };
        if (/^set role cocinacore_schema_owner$/.test(text)) {
          if (provisionedMembership.granted_role !== 'cocinacore_schema_owner' ||
              provisionedMembership.member_role !== 'migration_admin' ||
              provisionedMembership.admin_option || provisionedMembership.inherit_option ||
              !provisionedMembership.set_option) {
            throw new Error('permission denied to set role cocinacore_schema_owner');
          }
          currentRole = 'cocinacore_schema_owner';
          return { rows: [] };
        }
        if (process.env.RUNNER_MODE === '--verify-complete' && /^(create|alter|drop|revoke|grant|insert|update|delete|set|reset)\\b/.test(text)) {
          throw new Error('unexpected mutation in read-only guard');
        }
        if (text.includes('select session_user, current_user, r.rolname')) {
          const schemaOwner = text.includes('where r.rolname = current_user');
          const sessionUser = process.env.IDENTITY === 'wrong' ? 'unexpected_role' : 'migration_admin';
          return { rows: [{
            session_user: sessionUser, current_user: currentRole,
            rolname: schemaOwner ? 'cocinacore_schema_owner' : sessionUser,
            rolcanlogin: !schemaOwner, rolinherit: false, rolsuper: false, rolcreatedb: false,
            rolcreaterole: false, rolreplication: false, rolbypassrls: false, rolconnlimit: -1,
            rolvaliduntil: null, rolconfig: null,
          }] };
        }
        if (text.includes('as database_settings')) return { rows: [{ database_settings: 0, tablespace_authority: 0, database_authority: 0 }] };
        if (text.includes('select count(*)::integer as count from authority')) return { rows: [{ count: 0 }] };
        if (text.includes('from pg_catalog.pg_proc p') && /p\.prokind\s*=\s*'f'/.test(text)) {
          const fixture = process.env.OWNER_FUNCTIONS;
          if (!fixture || fixture === 'none' || process.env.LEDGER === '014-unapplied') return { rows: [] };
          const functions = ownerFunctions
            .filter((fn) => fn.schema === params[0] && fn.name === params[1])
            .map((fn) => ({ ...fn, owner: schemaOwner }));
          if (fixture === 'wrong-owner' && params[1] === 'is_valid_culinary_profile_text_list') {
            functions[0].owner = 'cocinacore';
          }
          if (fixture === 'overload' && params[1] === 'is_valid_culinary_profile_text_list') functions.push({
            schema: params[0], name: params[1],
            arguments: 'text[], integer, boolean', owner: schemaOwner,
          });
          return { rows: functions };
        }
        if (text.includes('select kind, identity from (')) {
          const rows = manifest.baselineObjects.transferable.map((object) => ({
            kind: object.kind,
            identity: object.kind === 'schema' ? object.schema : object.kind === 'function'
              ? object.schema + '.' + object.name + '(' + object.arguments + ')'
              : object.schema + '.' + object.name,
          }));
          const fixture = process.env.OWNER_FUNCTIONS;
          if (fixture && fixture !== 'none') {
            let functions = ownerFunctions.map(functionIdentity);
            if (fixture === 'wrong-owner') functions = functions.slice(1);
            if (fixture === 'overload') functions.push('public.is_valid_culinary_profile_text_list(text[], integer, boolean)');
            if (fixture === 'undeclared') functions.push('public.untrusted_owner_function()');
            rows.push(...functions.map((identity) => ({ kind: 'function', identity })));
            const appliedFilenames = new Set(manifest.migrations.map((entry) => entry.filename));
            if (['pending', 'pending-018'].includes(process.env.LEDGER)) {
              appliedFilenames.delete(manifest.migrations.at(-1).filename);
            }
            for (const migration of manifest.migrations) {
              if (!appliedFilenames.has(migration.filename)) continue;
              for (const addition of migration.catalogAdditions || []) {
                if (addition.kind === 'table') rows.push({ kind: 'table', identity: addition.identity });
              }
            }
          }
          return { rows };
        }
        if (text.includes('select count(*)::integer as count from grants')) return { rows: [{ count: 0 }] };
        if (text.includes('pg_get_userbyid(c.relowner)')) return { rows: [{ owner: ledgerProvisioning.owner }] };
        if (text.includes('from pg_catalog.pg_auth_members')) return { rowCount: 1, rows: [provisionedMembership] };
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
          {
            relrowsecurity: ledgerProvisioning.rowLevelSecurity,
            primary_keys: 1,
            public_grants: ledgerProvisioning.publicGrants,
          },
        ] };
        if (text.includes('from public.schema_migrations')) {
          if (process.env.SEPARATED === 'yes' && currentRole === 'migration_admin' &&
              !ledgerProvisioning.directSelectGrantToMigrationAdmin) {
            throw new Error('permission denied for table schema_migrations');
          }
          let entries = manifest.migrations.map((entry, index) => ({
            filename: entry.filename, checksum: entry.sha256,
            applied_at: '2026-01-01T00:00:' + String(index).padStart(2, '0') + '.000Z',
          }));
          if (process.env.LEDGER === 'altered') entries[0].checksum = 'f'.repeat(64);
          if (process.env.LEDGER === 'pending' || process.env.LEDGER === 'pending-018') entries = entries.slice(0, -1);
          if (process.env.DRIFT_AFTER_PROVISION === 'yes' && queries.some((sql) => sql.startsWith('create table if not exists public.schema_migrations'))) {
            entries = manifest.migrations.map((entry, index) => ({
              filename: entry.filename, checksum: entry.sha256,
              applied_at: '2026-01-01T00:00:' + String(index).padStart(2, '0') + '.000Z',
            }));
          }
          if (process.env.LEDGER === '014-unapplied') {
            const firstNewMigration = manifest.migrations.findIndex((entry) => entry.filename.startsWith('014_'));
            entries = entries.slice(0, firstNewMigration);
          }
          if (process.env.LEDGER === 'unknown') entries = [...entries, { filename: '999_unexpected.sql', checksum: 'f'.repeat(64), applied_at: '2026-01-02T00:00:00.000Z' }];
          if (process.env.LEDGER === 'out-of-order') entries = [entries[1]];
          if (process.env.LEDGER.startsWith('legacy-')) {
            const canonicalPrefix = manifest.migrations.slice(0, 10).map((entry, index) => ({
              filename: entry.filename, checksum: entry.sha256,
              applied_at: '2026-01-01T00:00:' + String(index).padStart(2, '0') + '.000Z',
            }));
            const legacy = [
              { filename: '011_mfa.sql', checksum: 'a'.repeat(64), applied_at: '2026-01-02T00:00:01.000Z' },
              { filename: '012_tenant_rls_stage.sql', checksum: 'b'.repeat(64), applied_at: '2026-01-02T00:00:02.000Z' },
              { filename: '013_platform_operator_stage.sql', checksum: 'c'.repeat(64), applied_at: '2026-01-02T00:00:03.000Z' },
            ];
            if (process.env.LEDGER === 'legacy-exact') entries = [...canonicalPrefix, ...legacy];
            if (process.env.LEDGER === 'legacy-complete') entries = [...canonicalPrefix, ...legacy, ...manifest.migrations.slice(10).map((entry, index) => ({ filename: entry.filename, checksum: entry.sha256, applied_at: '2026-01-03T00:00:' + String(index).padStart(2, '0') + '.000Z' }))];
            if (process.env.LEDGER === 'legacy-canonical-before') entries = [...canonicalPrefix, { filename: manifest.migrations[10].filename, checksum: manifest.migrations[10].sha256, applied_at: '2026-01-02T00:00:00.000Z' }, ...legacy];
            if (process.env.LEDGER === 'legacy-partial') entries = [...canonicalPrefix, ...legacy.slice(0, 2)];
            if (process.env.LEDGER === 'legacy-duplicate') entries = [...canonicalPrefix, ...legacy, legacy[0]];
            if (process.env.LEDGER === 'legacy-unknown') entries = [...canonicalPrefix, ...legacy.slice(0, 2), { filename: '013_unrecognized.sql', checksum: 'd'.repeat(64), applied_at: '2026-01-02T00:00:04.000Z' }];
            if (process.env.LEDGER === 'legacy-out-of-order') {
              legacy[0].applied_at = '2026-01-02T00:00:02.000Z';
              legacy[1].applied_at = '2026-01-02T00:00:01.000Z';
              entries = [...canonicalPrefix, legacy[1], legacy[0], legacy[2]];
            }
            if (process.env.LEDGER === 'legacy-timestamp-inversion') {
              legacy[0].applied_at = '2026-01-02T00:00:02.000Z';
              legacy[1].applied_at = '2026-01-02T00:00:01.000Z';
              entries = [...canonicalPrefix, ...legacy];
            }
            if (process.env.LEDGER === 'legacy-timestamp-tie') {
              legacy[1].applied_at = legacy[0].applied_at;
              entries = [...canonicalPrefix, ...legacy];
            }
            if (process.env.LEDGER === 'legacy-canonical-prefix-out-of-order') {
              [canonicalPrefix[0].applied_at, canonicalPrefix[1].applied_at] = [canonicalPrefix[1].applied_at, canonicalPrefix[0].applied_at];
              entries = [...canonicalPrefix, ...legacy];
            }
            if (process.env.LEDGER === 'legacy-canonical-suffix-out-of-order') {
              const canonicalSuffix = manifest.migrations.slice(10).map((entry, index) => ({
                filename: entry.filename, checksum: entry.sha256,
                applied_at: '2026-01-03T00:00:' + String(index).padStart(2, '0') + '.000Z',
              }));
              [canonicalSuffix[0].applied_at, canonicalSuffix[1].applied_at] = [canonicalSuffix[1].applied_at, canonicalSuffix[0].applied_at];
              entries = [...canonicalPrefix, ...legacy, ...canonicalSuffix];
            }
          }
          if (text.includes('order by applied_at')) {
            entries.sort((left, right) => left.applied_at.localeCompare(right.applied_at) || left.filename.localeCompare(right.filename));
          }
          entries = entries.map((entry) => ({ ...entry, timestamp_count: entries.filter((candidate) => candidate.applied_at === entry.applied_at).length }));
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
if (process.env.RUNNER_MODE === '') process.exit = (code) => { process.exitCode = code; };
process.env.DATABASE_URL = 'postgresql://offline.invalid/test';
require(process.env.RUNNER_PATH);
setTimeout(() => {
  if (poolConfigs.length) console.log('POOL_CONFIG=' + JSON.stringify(poolConfigs[0]));
  const ddlQueries = queries.filter((sql) => /^(create|alter|drop|revoke|grant|insert|update|delete)\b/.test(sql));
  console.log('DDL_QUERIES=' + JSON.stringify(ddlQueries));
  console.log('MIGRATION_SQL_QUERIES=' + JSON.stringify(queries.filter((sql) => migrationSql.has(sql))));
  if (['--verify-complete', '--dry-run'].includes(process.env.RUNNER_MODE) && !queries.includes('begin read only')) process.exitCode = 2;
  if (process.env.RUNNER_MODE === '--verify-complete' && queries.some((sql) => /^(create|alter|drop|revoke|grant|insert|update|delete|set|reset)\\b/.test(sql) && sql !== 'set role cocinacore_schema_owner')) process.exitCode = 3;
  const roleAssumptions = queries.filter((sql) => sql === 'set role cocinacore_schema_owner');
  const roleVerification = queries.findIndex((sql) =>
    sql.includes('select session_user, current_user, r.rolname') && sql.includes('where r.rolname = current_user'));
  const ledgerRead = queries.findIndex((sql) => sql.includes('from public.schema_migrations'));
  const expectedAssumptions = process.env.SEPARATED === 'yes' ? 1 : 0;
  if (['--verify-complete', '--dry-run'].includes(process.env.RUNNER_MODE) &&
      (roleAssumptions.length !== expectedAssumptions || ledgerRead === -1 ||
      (roleAssumptions.length === 1 && (queries.indexOf(roleAssumptions[0]) > roleVerification || roleVerification > ledgerRead)))) {
    console.error('read-only role ordering failed: assumptions=' + roleAssumptions.length + ' roleIndex=' + queries.indexOf(roleAssumptions[0]) + ' verificationIndex=' + roleVerification + ' ledgerIndex=' + ledgerRead);
    process.exitCode = 6;
  }
  const hasAcquire = queries.some((sql) => sql.includes('pg_try_advisory_lock'));
  const hasRelease = queries.some((sql) => sql.includes('pg_advisory_unlock'));
  const hasShapeCheck = queries.some((sql) => sql.includes('from pg_catalog.pg_attribute'));
  const hasSecurityCheck = queries.some((sql) => sql.includes('relrowsecurity'));
  if (['--verify-complete', '--dry-run'].includes(process.env.RUNNER_MODE) && (hasAcquire || hasRelease)) process.exitCode = 4;
  if (['--verify-complete', '--dry-run'].includes(process.env.RUNNER_MODE) && (!hasShapeCheck || !hasSecurityCheck)) process.exitCode = 5;
}, 0);
`;
function run(mode, ledger, future018 = false, separated = false, ownerFunctions = 'none', identity = 'valid', membership = 'valid', extraEnv = {}) {
  return spawnSync(process.execPath, ['-e', harness], {
    encoding: 'utf8',
    env: { RUNNER_PATH: runner, MANIFEST_PATH: path.join(root, 'db/migrations/manifest.json'), RUNNER_MODE: mode, LEDGER: ledger, FUTURE_018: future018 ? 'yes' : 'no', SEPARATED: separated ? 'yes' : 'no', OWNER_FUNCTIONS: ownerFunctions, IDENTITY: identity, MEMBERSHIP: membership, COCINACORE_SEPARATED_DB_LANES_ENABLED: separated ? 'true' : 'false', DATABASE_URL: 'postgresql://offline.invalid/test', MIGRATION_DATABASE_URL: 'postgresql://offline.invalid/test', ...extraEnv },
  });
}
const timeoutResult = run('--verify-complete', 'complete', false, false, 'none', 'valid', 'valid', {
  MIGRATION_LOCK_TIMEOUT_MS: '1234', MIGRATION_PG_LOCK_TIMEOUT_MS: '2345', MIGRATION_PG_STATEMENT_TIMEOUT_MS: '3456',
});
const timeoutConfig = `${timeoutResult.stdout}${timeoutResult.stderr}`.match(/POOL_CONFIG=(.*)/);
if (timeoutResult.status !== 0 || !timeoutConfig ||
    JSON.parse(timeoutConfig[1]).lock_timeout !== 2345 ||
    JSON.parse(timeoutConfig[1]).statement_timeout !== 3456) {
  console.error(`offline PostgreSQL timeout configuration contract failed: status=${timeoutResult.status} stdout=${timeoutResult.stdout} stderr=${timeoutResult.stderr}`);
  process.exit(1);
}
for (const [name, value] of [['MIGRATION_PG_LOCK_TIMEOUT_MS', '0'], ['MIGRATION_PG_STATEMENT_TIMEOUT_MS', '1.5'], ['MIGRATION_PG_STATEMENT_TIMEOUT_MS', '300001']]) {
  const invalidTimeout = run('--verify-complete', 'complete', false, false, 'none', 'valid', 'valid', { [name]: value });
  if (invalidTimeout.status !== 1 || !`${invalidTimeout.stdout}${invalidTimeout.stderr}`.includes(`${name} must be an integer`)) {
    console.error(`offline invalid ${name} rejection contract failed: status=${invalidTimeout.status} stdout=${invalidTimeout.stdout} stderr=${invalidTimeout.stderr}`);
    process.exit(1);
  }
}
const malformedExpected = run('--dry-run', 'pending', false, false, 'none', 'valid', 'valid', { MIGRATION_EXPECTED_PENDING: '015_not-canonical.sql' });
if (malformedExpected.status !== 1 || !`${malformedExpected.stdout}${malformedExpected.stderr}`.includes('MIGRATION_EXPECTED_PENDING must be an exact')) {
  console.error(`offline malformed expected-pending rejection failed: status=${malformedExpected.status} stdout=${malformedExpected.stdout} stderr=${malformedExpected.stderr}`);
  process.exit(1);
}
const migrations = JSON.parse(require('node:fs').readFileSync(path.join(root, 'db/migrations/manifest.json'), 'utf8')).migrations;
const expectedPending = migrations.slice(-1)[0].filename;
const fullExpectedPending = migrations.map((migration) => migration.filename).join(',');
const verifyCompleteWithPending = run('--verify-complete', 'complete', false, false, 'none', 'valid', 'valid', {
  MIGRATION_EXPECTED_PENDING: expectedPending,
});
if (verifyCompleteWithPending.status !== 1 ||
    !`${verifyCompleteWithPending.stdout}${verifyCompleteWithPending.stderr}`.includes('MIGRATION_EXPECTED_PENDING_MISMATCH')) {
  console.error(`offline verify-complete nonempty expected-pending rejection failed: status=${verifyCompleteWithPending.status} stdout=${verifyCompleteWithPending.stdout} stderr=${verifyCompleteWithPending.stderr}`);
  process.exit(1);
}
const verifyCompleteWithEmptyExpected = run('--verify-complete', 'complete', false, false, 'none', 'valid', 'valid', {
  MIGRATION_EXPECTED_PENDING: '',
});
if (verifyCompleteWithEmptyExpected.status !== 0 ||
    !`${verifyCompleteWithEmptyExpected.stdout}${verifyCompleteWithEmptyExpected.stderr}`.includes('Migration ledger is complete.')) {
  console.error(`offline verify-complete empty expected-pending contract failed: status=${verifyCompleteWithEmptyExpected.status} stdout=${verifyCompleteWithEmptyExpected.stdout} stderr=${verifyCompleteWithEmptyExpected.stderr}`);
  process.exit(1);
}
const missingLedgerWithFullExpected = run('', 'missing', false, false, 'none', 'valid', 'valid', {
  MIGRATION_EXPECTED_PENDING: fullExpectedPending,
});
const missingLedgerOutput = `${missingLedgerWithFullExpected.stdout}${missingLedgerWithFullExpected.stderr}`;
if (missingLedgerWithFullExpected.status !== 1 ||
    !missingLedgerOutput.includes('MIGRATION_EXPECTED_PENDING requires an existing ledger') ||
    missingLedgerOutput.match(/DDL_QUERIES=(.*)/)?.[1] !== '[]') {
  console.error(`offline full expected-pending missing-ledger rejection failed: status=${missingLedgerWithFullExpected.status} stdout=${missingLedgerWithFullExpected.stdout} stderr=${missingLedgerWithFullExpected.stderr}`);
  process.exit(1);
}
for (const [ledger, marker] of [['missing', 'MIGRATION_EXPECTED_PENDING requires an existing ledger'], ['unknown', 'unknown applied migration']]) {
  const guarded = run('', ledger, false, false, 'none', 'valid', 'valid', { MIGRATION_EXPECTED_PENDING: expectedPending });
  const output = `${guarded.stdout}${guarded.stderr}`;
  const ddlQueries = output.match(/DDL_QUERIES=(.*)/)?.[1];
  if (guarded.status !== 1 || !output.includes(marker) || ddlQueries !== '[]') {
    console.error(`offline pre-provisioning expected-pending guard failed for ${ledger}: status=${guarded.status} stdout=${guarded.stdout} stderr=${guarded.stderr}`);
    process.exit(1);
  }
}
const driftedLedger = run('', 'pending', false, false, 'none', 'valid', 'valid', {
  MIGRATION_EXPECTED_PENDING: expectedPending,
  DRIFT_AFTER_PROVISION: 'yes',
});
const driftedOutput = `${driftedLedger.stdout}${driftedLedger.stderr}`;
if (driftedLedger.status !== 1 || !driftedOutput.includes('MIGRATION_EXPECTED_PENDING_MISMATCH') ||
    driftedOutput.includes('APPLY ') || driftedOutput.match(/MIGRATION_SQL_QUERIES=(.*)/)?.[1] !== '[]') {
  console.error(`offline post-provision expected-pending recheck failed: status=${driftedLedger.status} stdout=${driftedLedger.stdout} stderr=${driftedLedger.stderr}`);
  process.exit(1);
}
for (const mode of ['--dry-run', '']) {
  const guarded = run(mode, 'complete', false, false, 'none', 'valid', 'valid', { MIGRATION_EXPECTED_PENDING: expectedPending });
  const output = `${guarded.stdout}${guarded.stderr}`;
  if (guarded.status !== 1 || !output.includes('MIGRATION_EXPECTED_PENDING_MISMATCH') || output.includes('APPLY ')) {
    console.error(`offline expected-pending guard failed for ${mode || 'mutating'} mode: status=${guarded.status} stdout=${guarded.stdout} stderr=${guarded.stderr}`);
    process.exit(1);
  }
  const matching = run(mode, 'pending', false, false, 'none', 'valid', 'valid', { MIGRATION_EXPECTED_PENDING: expectedPending });
  if (matching.status !== 0 || `${matching.stdout}${matching.stderr}`.includes('MIGRATION_EXPECTED_PENDING_MISMATCH')) {
    console.error(`offline matching expected-pending set failed for ${mode || 'mutating'} mode: status=${matching.status} stdout=${matching.stdout} stderr=${matching.stderr}`);
    process.exit(1);
  }
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
const completeLegacyHistoryResult = run('--verify-complete', 'legacy-complete');
if (completeLegacyHistoryResult.status !== 0 || !`${completeLegacyHistoryResult.stdout}${completeLegacyHistoryResult.stderr}`.includes('Migration ledger is complete.')) {
  console.error(`offline complete legacy history contract failed: status=${completeLegacyHistoryResult.status} stdout=${completeLegacyHistoryResult.stdout} stderr=${completeLegacyHistoryResult.stderr}`);
  process.exit(1);
}
const exactLegacySuffixResult = run('--verify-complete', 'legacy-exact');
if (exactLegacySuffixResult.status !== 1 || !`${exactLegacySuffixResult.stdout}${exactLegacySuffixResult.stderr}`.includes('Pending migration: 011_canonical_email_invariant.sql')) {
  console.error(`offline exact legacy suffix contract failed: status=${exactLegacySuffixResult.status} stdout=${exactLegacySuffixResult.stdout} stderr=${exactLegacySuffixResult.stderr}`);
  process.exit(1);
}
const separatedLegacyResult = run('--verify-complete', 'legacy-exact', false, true, 'valid');
if (separatedLegacyResult.status === 0 || !`${separatedLegacyResult.stdout}${separatedLegacyResult.stderr}`.includes('legacy migration lineage is incompatible with separated ledger mode')) {
  console.error(`offline separated legacy lineage rejection failed: status=${separatedLegacyResult.status} stdout=${separatedLegacyResult.stdout} stderr=${separatedLegacyResult.stderr}`);
  process.exit(1);
}
for (const ledger of [
  'legacy-partial', 'legacy-unknown', 'legacy-duplicate', 'legacy-out-of-order',
  'legacy-timestamp-inversion', 'legacy-timestamp-tie', 'legacy-canonical-before',
  'legacy-canonical-prefix-out-of-order', 'legacy-canonical-suffix-out-of-order',
]) {
  const result = run('--verify-complete', ledger);
  const output = `${result.stdout}${result.stderr}`;
  if (result.status === 0 || output.includes('Pending migration:')) {
    console.error(`offline legacy suffix rejection contract failed for ${ledger}: status=${result.status} stdout=${result.stdout} stderr=${result.stderr}`);
    process.exit(1);
  }
}
const separatedIdentityResult = run('--verify-complete', 'pending', false, true, 'valid');
if (separatedIdentityResult.status !== 1 || !`${separatedIdentityResult.stdout}${separatedIdentityResult.stderr}`.includes('Pending migration:')) {
  console.error(`offline separated identity contract failed: status=${separatedIdentityResult.status} stdout=${separatedIdentityResult.stdout} stderr=${separatedIdentityResult.stderr}`);
  process.exit(1);
}
const wrongIdentityResult = run('--verify-complete', 'complete', false, true, 'none', 'wrong');
if (wrongIdentityResult.status !== 1 || !`${wrongIdentityResult.stdout}${wrongIdentityResult.stderr}`.includes('MIGRATION_IDENTITY_MISMATCH')) {
  console.error(`offline wrong migration identity contract failed: status=${wrongIdentityResult.status} stdout=${wrongIdentityResult.stdout} stderr=${wrongIdentityResult.stderr}`);
  process.exit(1);
}
const invalidMembershipResult = run('--verify-complete', 'complete', false, true, 'none', 'valid', 'invalid');
if (invalidMembershipResult.status !== 1 || !`${invalidMembershipResult.stdout}${invalidMembershipResult.stderr}`.includes('ROLE_STATE_MISMATCH: migration role membership')) {
  console.error(`offline invalid membership contract failed: status=${invalidMembershipResult.status} stdout=${invalidMembershipResult.stdout} stderr=${invalidMembershipResult.stderr}`);
  process.exit(1);
}
const alteredLedgerResult = run('--verify-complete', 'altered', false, true);
if (alteredLedgerResult.status !== 1 || !`${alteredLedgerResult.stdout}${alteredLedgerResult.stderr}`.includes('MIGRATION_CHECKSUM_MISMATCH')) {
  console.error(`offline altered ledger contract failed: status=${alteredLedgerResult.status} stdout=${alteredLedgerResult.stdout} stderr=${alteredLedgerResult.stderr}`);
  process.exit(1);
}
const appliedCatalogAdditions = run('--verify-complete', 'complete', false, true, 'valid');
const appliedCatalogOutput = `${appliedCatalogAdditions.stdout}${appliedCatalogAdditions.stderr}`;
const expectedUnmockedExtensionFailure = appliedCatalogOutput.includes('BASELINE_MISMATCH: required extension pgcrypto is absent');
if (
  !appliedCatalogAdditions.stdout.includes('Migration ledger is complete.') ||
  appliedCatalogOutput.includes('ROLE_STATE_MISMATCH') ||
  (appliedCatalogAdditions.status !== 0 && !expectedUnmockedExtensionFailure)
) {
  console.error(`offline applied catalog additions contract failed (owner check must pass before any expected unmocked extension failure): status=${appliedCatalogAdditions.status} stdout=${appliedCatalogAdditions.stdout} stderr=${appliedCatalogAdditions.stderr}`);
  process.exit(1);
}
for (const [ledger, fixture, label] of [
  ['014-unapplied', 'valid', 'unapplied migration functions'],
  ['complete', 'overload', 'function overload'],
  ['complete', 'wrong-owner', 'wrong-owner function'],
  ['complete', 'undeclared', 'undeclared owner function'],
]) {
  const result = run('--verify-complete', ledger, false, true, fixture);
  if (result.status === 0 || !`${result.stdout}${result.stderr}`.includes('ROLE_STATE_MISMATCH')) {
    console.error(`offline schema-owner rejection contract failed for ${label}: status=${result.status} stdout=${result.stdout} stderr=${result.stderr}`);
    process.exit(1);
  }
}
const futureResult = run('--verify-complete', 'pending-018', true);
if (futureResult.status !== 1 || !`${futureResult.stdout}${futureResult.stderr}`.includes('Pending migration: 018_future.sql')) {
  console.error(`offline future migration contract failed: ${futureResult.stderr}`);
  process.exit(1);
}
NODE

printf '%s\n' 'pawtech step 4 contract passed'
