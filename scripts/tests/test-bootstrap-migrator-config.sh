#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
BASE=2069fc1f5a1ffc8407bd99cd91f9fadfbd04c6c4
PROVISIONER="$ROOT/frontend/scripts/provision-database.js"
RUNNER="$ROOT/frontend/scripts/run-migrations.js"
MANIFEST="$ROOT/db/migrations/manifest.json"
LOCK_PREFIX='cocinacore:database-change:v1:'
IMAGE='pgvector/pgvector:pg16'

fail() {
  printf '%s\n' "config failure: $1" >&2
  exit 1
}

node --check "$PROVISIONER"
node --check "$RUNNER"
node - "$MANIFEST" "$ROOT/db/migrations" "$BASE" <<'NODE'
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const [manifestPath, directory, base] = process.argv.slice(2);
const HISTORICAL_BASELINE_COUNT = 10;
const CURRENT_MIGRATION_COUNT = 11;
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
if (manifest.manifestVersion !== 1 || manifest.trustedBaseCommit !== base) process.exit(1);
if (manifest.migrationLaneVersion !== 1) process.exit(1);
if (manifest.lockContract?.namespacePrefix !== 'cocinacore:database-change:v1:') process.exit(1);
if (manifest.migrations?.length !== CURRENT_MIGRATION_COUNT) process.exit(1);
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
! grep -q 'provisioner npm run db:provision' "$ROOT/.github/workflows/deploy.yml" || fail 'ordinary deploy invokes bootstrap'
grep -q 'app npm run db:migrate' "$ROOT/.github/workflows/deploy.yml" || fail 'disabled legacy deploy path missing'
grep -q 'migrator npm run db:migrate' "$ROOT/.github/workflows/deploy.yml" || fail 'enabled restricted deploy path missing'
grep -q 'Invalid COCINACORE_SEPARATED_DB_LANES_ENABLED' "$ROOT/.github/workflows/deploy.yml" || fail 'deploy strict gate validation missing'
grep -Fq "$IMAGE" "$ROOT/.github/workflows/ci.yml" || fail 'CI PostgreSQL image policy is missing'
grep -q 'COCINACORE_SEPARATED_DB_LANES_ENABLED: "true"' "$ROOT/.github/workflows/ci.yml" || fail 'CI separated test gate missing'
grep -Fq "$IMAGE" "$ROOT/docker-compose.prod.yml" || fail 'production PostgreSQL image policy is missing'
grep -q 'arm64 platform manifest' "$ROOT/docs/production/runbook.md" || fail 'portable digest risk is undocumented'

node -e "const p=require(process.argv[1]); if(p.scripts['db:provision']!=='node scripts/provision-database.js'||p.scripts['db:migrate']!=='node scripts/run-migrations.js --lane migration'||p.scripts['db:migrate:verify']!=='node scripts/run-migrations.js --lane migration --verify-complete') process.exit(1)" \
  "$ROOT/frontend/package.json" || fail 'database package commands are invalid'

TMP_ENV=$(mktemp)
TMP_MIGRATION=$(mktemp)
TMP_CONFIG=$(mktemp)
cleanup() { rm -f "$TMP_ENV" "$TMP_MIGRATION" "$TMP_CONFIG"; }
trap cleanup EXIT INT TERM
umask 077
cat >"$TMP_ENV" <<'ENV'
COCINACORE_SEPARATED_DB_LANES_ENABLED=false
POSTGRES_PASSWORD=placeholder-postgres
APP_PUBLIC_URL=https://example.invalid
AUTH_SECRET=placeholder-auth
GEMINI_API_KEY=placeholder-gemini
RESEND_API_KEY=placeholder-resend
EMAIL_FROM=placeholder@example.invalid
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

docker compose -f "$ROOT/docker-compose.prod.yml" --project-directory "$ROOT" \
  --env-file "$TMP_ENV" config --format json >"$TMP_CONFIG"
node - "$TMP_CONFIG" <<'NODE'
const fs = require('fs');
const config = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const app = config.services.app.environment;
for (const secret of ['MIGRATION_DATABASE_URL','BOOTSTRAP_DATABASE_URL','MIGRATION_ADMIN_PASSWORD']) {
  if (Object.prototype.hasOwnProperty.call(app, secret)) process.exit(1);
}
if (app.COCINACORE_SEPARATED_DB_LANES_ENABLED !== 'false') process.exit(1);
NODE

docker compose -f "$ROOT/docker-compose.prod.yml" --project-directory "$ROOT" \
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
