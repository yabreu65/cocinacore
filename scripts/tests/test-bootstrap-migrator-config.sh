#!/bin/sh
set -eu

ROOT=$(CDPATH='' cd -- "$(dirname -- "$0")/../.." && pwd)
BASE=2069fc1f5a1ffc8407bd99cd91f9fadfbd04c6c4
PROVISIONER="$ROOT/frontend/scripts/provision-database.js"
RUNNER="$ROOT/frontend/scripts/run-migrations.js"
MANIFEST="$ROOT/db/migrations/manifest.json"
LOCK_PREFIX='cocinacore:database-change:v1:'
IMAGE='pgvector/pgvector:pg16'
CI_WORKFLOW="$ROOT/.github/workflows/ci.yml"

fail() {
  printf '%s\n' "config failure: $1" >&2
  exit 1
}

# Validate the lane opt-in in the E2E step's actual shell run block. The
# optional --check-ci-workflow mode keeps this contract testable against a
# temporary workflow copy without running the unrelated Compose checks.
check_ci_lanes_gate() {
  workflow=$1
  [ -f "$workflow" ] || fail "CI workflow is missing: $workflow"
  awk '
    /^      - name: Provision 019, prepare and activate 020, then run isolated E2E$/ {
      in_step = 1
      next
    }
    in_step && /^      - name:/ { in_step = 0 }
    in_step && /^        run: \|[[:space:]]*$/ {
      in_run = 1
      next
    }
    in_run {
      if ($0 !~ /^          / && $0 !~ /^[[:space:]]*$/) {
        in_run = 0
        next
      }
      line = substr($0, 11)
      if (line ~ /^export COCINACORE_SEPARATED_DB_LANES_ENABLED=true[[:space:]]*(#.*)?$/) enabled = NR
      if (line ~ /^npm run db:provision([[:space:]]|$)/) provision = NR
    }
    END { exit !(in_step || enabled && provision && enabled < provision) }
  ' "$workflow" || fail 'CI E2E shell must explicitly export separated DB lanes before db:provision in the same step'
}

check_ci_postgres_image_prep() {
  workflow=$1
  awk '
    /^  frontend-quality:$/ { in_job = 1; next }
    in_job && /^  [[:alnum:]_-]+:$/ { in_job = 0 }
    in_job && /^      - name: Prepare PostgreSQL integration image$/ {
      prep = NR
      in_prep = 1
      next
    }
    in_job && /^      - name:/ {
      in_prep = 0
      if ($0 == "      - name: Test bootstrap and migrator PostgreSQL boundary") bootstrap = NR
      if ($0 == "      - name: Test canonical email PostgreSQL invariant") canonical = NR
    }
    in_job && in_prep && $0 == "        run: docker pull pgvector/pgvector:pg16" { pull = NR }
    END { exit !(prep && pull && bootstrap && canonical && prep < bootstrap && pull < bootstrap && prep < canonical && pull < canonical) }
  ' "$workflow" || fail 'frontend-quality must explicitly docker pull pgvector/pgvector:pg16 before both PostgreSQL integration tests'
}

if [ "${1:-}" = '--check-ci-workflow' ]; then
  [ "$#" -eq 2 ] || fail 'usage: test-bootstrap-migrator-config.sh --check-ci-workflow WORKFLOW'
  check_ci_lanes_gate "$2"
  check_ci_postgres_image_prep "$2"
  exit 0
fi

for helper in test-bootstrap-migrator-integration.sh test-canonical-email-integration.sh; do
  helper_path="$ROOT/scripts/$helper"
  grep -Fq 'until docker exec "$CONTAINER" pg_isready -h 127.0.0.1 -U cocinacore -d "$DB"' "$helper_path" \
    || fail "$helper TCP readiness probe is missing"
  ! grep -Fq 'pg_isready -U cocinacore -d "$DB"' "$helper_path" \
    || fail "$helper retains socket-only readiness"
  grep -Fq '[ "$attempt" -lt 60 ]' "$helper_path" \
    || fail "$helper bounded readiness loop is missing"
  awk '/start_container fresh / { startup = NR } /provision >"\$LOG"/ { provision = NR } END { exit !(startup && provision && startup < provision) }' "$helper_path" \
    || fail "$helper provisions before container startup readiness"
  grep -Fq 'stop_container() {
  docker rm -fv "$CONTAINER" >/dev/null' "$helper_path" \
    || fail "$helper normal stop does not remove anonymous volumes"
  grep -Fq 'docker rm -fv "$CONTAINER" >/dev/null 2>&1 || true' "$helper_path" \
    || fail "$helper EXIT cleanup does not remove anonymous volumes"
  grep -Fq 'grep "^$PREFIX"' "$helper_path" \
    || fail "$helper leftover cleanup is not PREFIX-scoped"
  grep -Fq 'docker rm -fv "$leftover"' "$helper_path" \
    || fail "$helper PREFIX-scoped cleanup does not remove anonymous volumes"
  ! grep -Eq 'docker rm -f([[:space:]]|$)' "$helper_path" \
    || fail "$helper retains volume-unaware docker rm -f cleanup"
done

CANONICAL_HELPER="$ROOT/scripts/test-canonical-email-integration.sh"
! grep -Eq 'select count\(\*\) from schema_migrations.*=[[:space:]]*11' "$CANONICAL_HELPER" \
  || fail 'canonical fresh ledger count is hardcoded to 11'
! grep -Fq 'EXPECTED_MIGRATION_COUNT=$(node -e "const m=require('\''$ROOT/db/migrations/manifest.json'\''); console.log(m.migrations.length)")' "$CANONICAL_HELPER" \
  || fail 'canonical expected migration count incorrectly includes post-019 migrations'
grep -Fq 'EXPECTED_MIGRATION_COUNT=$(node -e "const m=require('\''$ROOT/db/migrations/manifest.json'\''); console.log(m.migrations.filter(x => Number(x.id) <= 19).length)")' "$CANONICAL_HELPER" \
  || fail 'canonical expected migration count is not derived from the manifest through 019'
grep -Fq '[ "$(admin_sql "select count(*) from schema_migrations")" = "$EXPECTED_MIGRATION_COUNT" ]' "$CANONICAL_HELPER" \
  || fail 'canonical fresh ledger count does not use manifest-derived expectation'
grep -Fq "where filename='019_real_consumption_reconciliation.sql'" "$CANONICAL_HELPER" \
  || fail 'canonical fresh and legacy upgrade paths must assert migration 019 in the ledger'
grep -Fq "where filename='020_tenant_rls_hardening.sql'" "$CANONICAL_HELPER" \
  || fail 'canonical fresh and legacy upgrade paths must assert migration 020 is absent'
awk '
  /^migrate\(\) \{$/ { in_migrate = 1; body = ""; next }
  in_migrate && /^\}$/ { found = 1; exit }
  in_migrate { body = body $0 "\n" }
  END { exit !(found && body ~ /node.*run-migrations[.]js.*--lane migration --stop-after 019/) }
' "$CANONICAL_HELPER" || fail 'canonical migration helper must invoke the runner with --stop-after 019'
grep -Fq "grep -q 'DONE 011_canonical_email_invariant.sql' \"\$LOG\"" "$CANONICAL_HELPER" \
  || fail 'canonical fresh migration completion assertion for 011 is missing'
grep -Fq 'create role cocinacore_user nologin nosuperuser nobypassrls' "$CANONICAL_HELPER" \
  || fail 'canonical email PostgreSQL test does not provision its restricted M5 runtime role'
grep -Fq "[ \"\$role_attributes\" = 'false|false|false' ]" "$CANONICAL_HELPER" \
  || fail 'canonical email PostgreSQL test does not verify restricted runtime role attributes'

node --check "$PROVISIONER"
node --check "$RUNNER"
node - "$MANIFEST" "$ROOT/db/migrations" "$BASE" <<'NODE'
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const [manifestPath, directory, base] = process.argv.slice(2);
const HISTORICAL_BASELINE_COUNT = 10;
const CURRENT_MIGRATION_COUNT = 22;
const manifestBytes = fs.readFileSync(manifestPath);
const manifest = JSON.parse(manifestBytes.toString('utf8'));
if (manifest.manifestVersion !== 1 || manifest.trustedBaseCommit !== base) process.exit(1);
if (manifest.migrationLaneVersion !== 1) process.exit(1);
if (manifest.lockContract?.namespacePrefix !== 'cocinacore:database-change:v1:') process.exit(1);
if (manifest.migrations?.length !== CURRENT_MIGRATION_COUNT) process.exit(1);
if (manifest.migrations.some((entry, index) => entry.id !== String(index + 1).padStart(3, '0'))) process.exit(1);
if (manifest.migrations[17]?.filename !== '018_cooking_sessions.sql' ||
    manifest.migrations[17]?.sha256 !== '42236a98bc3e7f5fd87da40e650a9f0b0591390bec0f9bd6cdaa6fd8f66546eb' ||
    manifest.migrations[18]?.filename !== '019_real_consumption_reconciliation.sql' ||
    manifest.migrations[18]?.sha256 !== 'cb7ecf08c252f5cbfa5e30d00351a1063e0ddb65e17b6f238281c293cbd3d373' ||
    manifest.migrations[19]?.id !== '020' ||
    manifest.migrations[19]?.filename !== '020_tenant_rls_hardening.sql' ||
    manifest.migrations[19]?.sha256 !== '1fbadb829792902ef19bdb0abd2c20e39409360986c9844d9cab3105df6eb33a' ||
    manifest.migrations[20]?.filename !== '021_inventory_price_reference.sql' ||
    manifest.migrations[20]?.sha256 !== '90f3f0c401f8383c1d073d6717fce46b1bf8cc4347216097c3c5ab653f904a19' ||
    manifest.migrations[21]?.filename !== '022_real_consumption_occurrences.sql' ||
    manifest.migrations[21]?.sha256 !== '371ad525d4081e801da81e9802a44af745b0091931be061af818f6ceabe073e3') process.exit(1);
if (manifest.baselineObjects?.transferable?.length !== 38) process.exit(1);
const kinds = manifest.baselineObjects.transferable.reduce((counts, object) => {
  counts[object.kind] = (counts[object.kind] || 0) + 1;
  if (object.targetOwner !== 'cocinacore_schema_owner') process.exit(1);
  return counts;
}, {});
if (kinds.schema !== 2 || kinds.table !== 29 || kinds.function !== 7) process.exit(1);
const names = new Set();
manifest.migrations.forEach((entry, index) => {
  if (entry.id !== String(index + 1).padStart(3, '0')) process.exit(1);
  if (names.has(entry.filename) || !/^[0-9a-f]{64}$/.test(entry.sha256)) process.exit(1);
  names.add(entry.filename);
  const bytes = fs.readFileSync(path.join(directory, entry.filename));
  const digest = crypto.createHash('sha256').update(bytes).digest('hex');
  if (entry.byteLength !== bytes.length || entry.sha256 !== digest) process.exit(1);
  if (entry.transactional !== 'required') process.exit(1);
  if (entry.legacyChecksumBackfillAllowed !== (index < HISTORICAL_BASELINE_COUNT)) process.exit(1);
  if (index < HISTORICAL_BASELINE_COUNT && entry.catalogAdditions !== undefined) process.exit(1);
});
const canonical = manifest.migrations[HISTORICAL_BASELINE_COUNT];
if (canonical.id !== '011' || canonical.filename !== '011_canonical_email_invariant.sql') process.exit(1);
if (canonical.lane !== 'migration' || canonical.transactional !== 'required') process.exit(1);
if (canonical.legacyChecksumBackfillAllowed !== false) process.exit(1);
if (JSON.stringify(canonical.catalogAdditions) !== JSON.stringify([{
  kind: 'constraint', schema: 'public', identity: 'users.users_email_canonical_check'
}])) process.exit(1);
const consumption = manifest.migrations[11];
if (consumption.id !== '012' || consumption.filename !== '012_meal_plan_consumption.sql') process.exit(1);
if (consumption.lane !== 'migration' || consumption.transactional !== 'required' || consumption.legacyChecksumBackfillAllowed !== false) process.exit(1);
if (consumption.catalogAdditions !== undefined) process.exit(1);
const sql = fs.readdirSync(directory).filter((name) => name.endsWith('.sql')).sort();
if (sql.length !== names.size || sql.some((name) => !names.has(name))) process.exit(1);
const extensions = new Map(manifest.extensions.map((entry) => [entry.name, entry]));
const vector = extensions.get('vector');
const pgcrypto = extensions.get('pgcrypto');
const plpgsql = extensions.get('plpgsql');
if (extensions.size !== 3 || !vector?.required || !vector.extensionManaged || !vector.bootstrapManaged || vector.expectedSchema !== 'public') process.exit(1);
if (!pgcrypto?.required || !pgcrypto.extensionManaged || pgcrypto.bootstrapManaged || pgcrypto.expectedSchema !== 'public') process.exit(1);
if (!plpgsql?.required || !plpgsql.extensionManaged || plpgsql.bootstrapManaged || !plpgsql.preinstalled || plpgsql.expectedSchema !== 'pg_catalog') process.exit(1);
if (manifest.bootstrapPolicy?.durableOrdinaryObjectsAllowed !== 0 || manifest.bootstrapPolicy?.autoRunOnDeploy) process.exit(1);
NODE

git -C "$ROOT" diff --quiet "$BASE" -- db/migrations/001_extensions_and_core.sql \
  db/migrations/002_books_and_rag.sql db/migrations/003_recipes_and_inventory.sql \
  db/migrations/004_meal_plans.sql db/migrations/005_premium_and_shopping.sql \
  db/migrations/006_culinary_profiles.sql db/migrations/007_functions.sql \
  db/migrations/008_indexes.sql db/migrations/009_seed_culinary_base.sql \
  db/migrations/010_password_reset_tokens.sql || fail 'historical migrations changed'

[ "$(grep -Foc "$LOCK_PREFIX" "$PROVISIONER")" -ge 1 ] || fail 'provisioner shared lock missing'
[ "$(grep -Foc "$LOCK_PREFIX" "$RUNNER")" -ge 1 ] || fail 'runner shared lock missing'
grep -q 'pg_try_advisory_lock' "$PROVISIONER" || fail 'provisioner does not use session advisory lock'
grep -q 'pg_try_advisory_lock' "$RUNNER" || fail 'runner does not use session advisory lock'
grep -q 'VECTOR_NOT_AVAILABLE' "$PROVISIONER" || fail 'vector availability error missing'
grep -q 'create extension vector with schema public' "$PROVISIONER" || fail 'vector bootstrap install missing'
grep -q 'pg_available_extension_versions' "$PROVISIONER" || fail 'server extension availability check missing'
grep -q 'legacyChecksumBackfillAllowed' "$PROVISIONER" || fail 'trusted legacy backfill missing'
grep -q 'HISTORICAL_BASELINE_COUNT = 10' "$PROVISIONER" || fail 'provisioner historical/forward boundary missing'
grep -q 'catalogAdditions' "$PROVISIONER" || fail 'provisioner forward catalog support missing'
grep -q 'HISTORICAL_BASELINE_COUNT = 10' "$RUNNER" || fail 'runner historical/forward boundary missing'
grep -q 'catalogAdditions' "$RUNNER" || fail 'runner forward catalog validation missing'
grep -q 'tokenizeTopLevelStatements' "$RUNNER" || fail 'SQL lexer missing'
grep -q 'contains prohibited top-level transaction control' "$RUNNER" || fail 'transaction-control rejection missing'
grep -q 'unsupported nontransactional operation' "$RUNNER" || fail 'nontransactional rejection missing'
grep -q 'COCINACORE_SEPARATED_DB_LANES_ENABLED' "$PROVISIONER" || fail 'provisioner gate missing'
grep -q 'COCINACORE_SEPARATED_DB_LANES_ENABLED' "$RUNNER" || fail 'runner gate missing'
! grep -qi 'reassign owned' "$PROVISIONER" || fail 'REASSIGN OWNED is forbidden'
! grep -q 'process.env.DATABASE_URL.*MIGRATION_DATABASE_URL\|MIGRATION_DATABASE_URL.*process.env.DATABASE_URL' "$RUNNER" || fail 'migration secret fallback detected'
! grep -Eq 'alter (index|type|constraint).*owner' "$PROVISIONER" || fail 'dependent object direct ownership transfer detected'
PAWTECH_DEPLOY="$ROOT/scripts/deploy-pawtech-production.sh"
! grep -Eq 'db:provision|\.env\.migration|MIGRATION_ENV_FILE|MIGRATION_DATABASE_URL|BOOTSTRAP_DATABASE_URL|migration_admin' "$PAWTECH_DEPLOY" || fail 'PawTech deploy contains forbidden provisioning or migration-env behavior'
grep -Fq 'RUNTIME_ENV_FILE=${2:-$EXPECTED_RUNTIME_ENV_FILE}' "$PAWTECH_DEPLOY" || fail 'PawTech deploy does not use the shared runtime env'
grep -Fq -- '--env-file "$RUNTIME_ENV_FILE"' "$PAWTECH_DEPLOY" || fail 'PawTech deploy does not pass the shared runtime env'
grep -Fq 'npm run db:migrate:verify' "$PAWTECH_DEPLOY" || fail 'read-only runtime migration verification missing'
! grep -Eq 'npm run db:migrate([[:space:]]|$)' "$PAWTECH_DEPLOY" || fail 'mutating runtime migration command is forbidden'
grep -Fq "$IMAGE" "$ROOT/.github/workflows/ci.yml" || fail 'CI PostgreSQL image policy is missing'
check_ci_lanes_gate "$CI_WORKFLOW"
grep -Fq 'create role cocinacore_user nologin nosuperuser nobypassrls' "$ROOT/.github/workflows/ci.yml" || fail 'E2E disposable PostgreSQL role for M5 grants is missing'
runtime_role_line=$(grep -nF 'create role cocinacore_user nologin nosuperuser nobypassrls' "$ROOT/.github/workflows/ci.yml" | cut -d: -f1)
migration_line=$(grep -nF 'npm run db:migrate -- --stop-after 019' "$ROOT/.github/workflows/ci.yml" | head -n 1 | cut -d: -f1)
[ -n "$runtime_role_line" ] && [ "$runtime_role_line" -lt "$migration_line" ] || fail 'E2E runtime role must exist before applying migrations'
grep -Fq 'revoke all privileges on table public.cooking_sessions, public.cooking_session_events' "$ROOT/db/migrations/018_cooking_sessions.sql" || fail '018 runtime grants are not preceded by a fail-closed revoke'
grep -Fq 'grant select, insert, update on table public.cooking_sessions to cocinacore_user' "$ROOT/db/migrations/018_cooking_sessions.sql" || fail '018 cooking session runtime grant is missing'
grep -Fq 'grant select, insert on table public.cooking_session_events to cocinacore_user' "$ROOT/db/migrations/018_cooking_sessions.sql" || fail '018 event runtime grant is missing'
grep -Fq 'from public, cocinacore_user;' "$ROOT/db/migrations/019_real_consumption_reconciliation.sql" || fail '019 runtime grants are not preceded by a fail-closed revoke'
grep -Fq 'to cocinacore_user;' "$ROOT/db/migrations/019_real_consumption_reconciliation.sql" || fail '019 runtime grant is missing'
pull_line=$(grep -nF 'run: docker pull pgvector/pgvector:pg16' "$ROOT/.github/workflows/ci.yml" | head -n 1 | cut -d: -f1)
contract_line=$(grep -nF 'run: sh ../scripts/tests/test-bootstrap-migrator-config.sh' "$ROOT/.github/workflows/ci.yml" | head -n 1 | cut -d: -f1)
integration_line=$(grep -nF 'run: sh ../scripts/test-bootstrap-migrator-integration.sh' "$ROOT/.github/workflows/ci.yml" | head -n 1 | cut -d: -f1)
[ -n "$pull_line" ] && [ -n "$contract_line" ] && [ -n "$integration_line" ] &&
  [ "$pull_line" -lt "$integration_line" ] ||
  fail 'CI must pull the PostgreSQL test image before the bootstrap/migrator PostgreSQL integration test'
check_ci_lanes_gate "$CI_WORKFLOW"
grep -Fq "$IMAGE" "$ROOT/docker-compose.prod.yml" || fail 'production PostgreSQL image policy is missing'
grep -q 'arm64 platform manifest' "$ROOT/docs/production/runbook.md" || fail 'portable digest risk is undocumented'

node -e "const p=require(process.argv[1]); if(p.scripts['db:provision']!=='node scripts/provision-database.js'||p.scripts['db:migrate']!=='node scripts/run-migrations.js --lane migration'||p.scripts['db:migrate:verify']!=='node scripts/run-migrations.js --lane migration --verify-complete') process.exit(1)" \
  "$ROOT/frontend/package.json" || fail 'database package commands are invalid'

TMP_ENV=$(mktemp)
TMP_MIGRATION=$(mktemp)
TMP_NO_AUTH=$(mktemp)
TMP_CONFIG=$(mktemp)
cleanup() { rm -f "$TMP_ENV" "$TMP_MIGRATION" "$TMP_NO_AUTH" "$TMP_CONFIG"; }
trap cleanup EXIT INT TERM
umask 077
cat >"$TMP_ENV" <<'ENV'
COCINACORE_SEPARATED_DB_LANES_ENABLED=false
POSTGRES_PASSWORD=placeholder-postgres
APP_PUBLIC_URL=https://example.invalid
AUTH_SECRET=placeholder-auth
GEMINI_API_KEY=placeholder-gemini
S3_ENDPOINT=https://storage.invalid
S3_BUCKET=placeholder
S3_ACCESS_KEY_ID=placeholder
S3_SECRET_ACCESS_KEY=placeholder
ENV
cat >"$TMP_MIGRATION" <<'ENV'
COCINACORE_SEPARATED_DB_LANES_ENABLED=true
BOOTSTRAP_DATABASE_URL=postgresql://bootstrap:placeholder@postgres:5432/cocinacore
MIGRATION_DATABASE_URL=postgresql://migration_admin:placeholder@postgres:5432/cocinacore
MIGRATION_ADMIN_PASSWORD=placeholder-placeholder-placeholder
ENV

env -u RESEND_API_KEY -u EMAIL_FROM docker compose -f "$ROOT/docker-compose.prod.yml" --project-directory "$ROOT" \
  --env-file "$TMP_ENV" config --format json >"$TMP_CONFIG"
node - "$TMP_CONFIG" <<'NODE'
const fs = require('fs');
const config = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const app = config.services.app.environment;
for (const secret of ['MIGRATION_DATABASE_URL','BOOTSTRAP_DATABASE_URL','MIGRATION_ADMIN_PASSWORD']) {
  if (Object.prototype.hasOwnProperty.call(app, secret)) process.exit(1);
}
if (!app.AUTH_SECRET) process.exit(1);
if (app.RESEND_API_KEY !== '' || app.EMAIL_FROM !== '') process.exit(1);
if (app.COCINACORE_SEPARATED_DB_LANES_ENABLED !== 'false') process.exit(1);
NODE

grep -v '^AUTH_SECRET=' "$TMP_ENV" >"$TMP_NO_AUTH"
if env -u AUTH_SECRET -u RESEND_API_KEY -u EMAIL_FROM docker compose -f "$ROOT/docker-compose.prod.yml" --project-directory "$ROOT" \
  --env-file "$TMP_NO_AUTH" config --format json >"$TMP_CONFIG" 2>/dev/null; then
  fail 'Compose must reject a runtime env file without required AUTH_SECRET'
fi

env -u RESEND_API_KEY -u EMAIL_FROM docker compose -f "$ROOT/docker-compose.prod.yml" --project-directory "$ROOT" \
  --env-file "$TMP_ENV" --env-file "$TMP_MIGRATION" --profile operations config --format json >"$TMP_CONFIG"
node - "$TMP_CONFIG" <<'NODE'
const fs = require('fs');
const config = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const app = config.services.app.environment;
for (const secret of ['MIGRATION_DATABASE_URL','BOOTSTRAP_DATABASE_URL','MIGRATION_ADMIN_PASSWORD']) {
  if (Object.prototype.hasOwnProperty.call(app, secret)) process.exit(1);
}
const provisioner = config.services.provisioner.environment;
const migrator = config.services.migrator.environment;
if (!provisioner.BOOTSTRAP_DATABASE_URL || !provisioner.MIGRATION_ADMIN_PASSWORD) process.exit(1);
if (Object.prototype.hasOwnProperty.call(provisioner, 'MIGRATION_DATABASE_URL')) process.exit(1);
if (!migrator.MIGRATION_DATABASE_URL) process.exit(1);
if (Object.prototype.hasOwnProperty.call(migrator, 'BOOTSTRAP_DATABASE_URL')) process.exit(1);
NODE

printf '%s\n' 'bootstrap/migrator static config passed'
