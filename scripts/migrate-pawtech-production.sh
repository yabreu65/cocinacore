#!/bin/sh
set -eu

# Runs only on the VPS. This workflow is deliberately separate from deploy/cutover.
EXPECTED_APP_DIR=/opt/pawtech/apps/cocinacore
RUNTIME_ENV_FILE=/opt/pawtech/env/cocinacore.env
MIGRATION_ENV_FILE=/opt/pawtech/env/cocinacore.migration.env
NETWORK=pawtech_internal
LOCK_FILE=/tmp/cocinacore-production-deploy.lock
EXPECTED_PENDING=018_cooking_sessions.sql,019_real_consumption_reconciliation.sql

fail() { printf 'MIGRATION_STOP: %s\n' "$1" >&2; exit 1; }
log() { printf '%s\n' "$1"; }

RELEASE_SHA=${1:-}
ARCHIVE=${2:-}
ARCHIVE_SHA256=${3:-}
[ "$(printf '%s' "$RELEASE_SHA" | grep -Ec '^[0-9a-f]{40}$')" -eq 1 ] || fail 'release SHA must be 40 lowercase hexadecimal characters'
[ "$(printf '%s' "$ARCHIVE_SHA256" | grep -Ec '^[0-9a-f]{64}$')" -eq 1 ] || fail 'archive checksum is invalid'
[ -f "$ARCHIVE" ] && [ ! -L "$ARCHIVE" ] || fail 'exact-SHA archive is not a regular file'
[ "$(sha256sum "$ARCHIVE" | awk '{print $1}')" = "$ARCHIVE_SHA256" ] || fail 'archive checksum mismatch'
command -v realpath >/dev/null 2>&1 || fail 'realpath unavailable'
[ "$(realpath -e /opt/pawtech/apps/cocinacore 2>/dev/null || true)" = "$EXPECTED_APP_DIR" ] || fail 'pinned application directory mismatch'
[ -f "$RUNTIME_ENV_FILE" ] && [ ! -L "$RUNTIME_ENV_FILE" ] || fail 'runtime environment file unavailable'
[ "$(stat -c '%a' "$RUNTIME_ENV_FILE")" = 600 ] || fail 'runtime environment permissions mismatch'

# The runtime URL remains exclusively on the VPS. It is never logged or passed to GitHub.
DATABASE_URL=$(sed -n 's/^DATABASE_URL=//p' "$RUNTIME_ENV_FILE" | tail -n 1)
[ -n "$DATABASE_URL" ] || fail 'runtime DATABASE_URL missing'
case "$DATABASE_URL" in
  postgresql://cocinacore_user:*@pawtech-postgres:5432/cocinacore_db*) ;;
  *) fail 'runtime database URL does not identify the expected PawTech database' ;;
esac
[ -f "$MIGRATION_ENV_FILE" ] && [ ! -L "$MIGRATION_ENV_FILE" ] || fail 'migration environment file unavailable'
[ "$(realpath -e "$MIGRATION_ENV_FILE" 2>/dev/null || true)" = "$MIGRATION_ENV_FILE" ] || fail 'migration environment path is not canonical'
[ "$(stat -c '%a' "$MIGRATION_ENV_FILE")" = 600 ] || fail 'migration environment permissions mismatch'
[ "$(awk 'END { print NR + 0 }' "$MIGRATION_ENV_FILE")" = 1 ] || fail 'migration environment must contain exactly one setting'
[ "$(grep -c '^MIGRATION_DATABASE_URL=' "$MIGRATION_ENV_FILE" || true)" = 1 ] || fail 'migration environment URL is missing or duplicated'
MIGRATION_DATABASE_URL=$(sed -n 's/^MIGRATION_DATABASE_URL=//p' "$MIGRATION_ENV_FILE")
case "$MIGRATION_DATABASE_URL" in
  postgresql://migration_admin:*@pawtech-postgres:5432/cocinacore_db*) ;;
  *) fail 'migration database URL does not identify the expected migration role and database' ;;
esac

exec 9>"$LOCK_FILE"
flock -n 9 || fail 'production deploy/migration lock is unavailable'
umask 077
WORK=$(mktemp -d /tmp/cocinacore-migration.XXXXXXXX) || fail 'private work directory unavailable'
cleanup() {
  status=$?
  case "$WORK" in /tmp/cocinacore-migration.*) rm -rf -- "$WORK" ;; *) log 'Cleanup skipped: work path was not canonical' ;; esac
  exit "$status"
}
trap cleanup EXIT HUP INT TERM
DATABASE_ENV_FILE=$WORK/database.env
printf 'DATABASE_URL=%s\n' "$DATABASE_URL" > "$DATABASE_ENV_FILE"
chmod 600 "$DATABASE_ENV_FILE"
MIGRATION_DATABASE_ENV_FILE=$WORK/migration-database.env
printf 'MIGRATION_DATABASE_URL=%s\nCOCINACORE_SEPARATED_DB_LANES_ENABLED=true\n' \
  "$MIGRATION_DATABASE_URL" > "$MIGRATION_DATABASE_ENV_FILE"
chmod 600 "$MIGRATION_DATABASE_ENV_FILE"
mkdir -m 700 "$WORK/source"
tar -xf "$ARCHIVE" -C "$WORK/source"
SOURCE=$WORK/source
[ -f "$SOURCE/Dockerfile" ] && [ -f "$SOURCE/frontend/scripts/run-migrations.js" ] || fail 'archive lacks canonical build/runner inputs'
[ -x "$SOURCE/scripts/verify-pawtech-cocinacore-daily-backup.sh" ] || fail 'versioned daily backup verifier missing'
[ -f "$SOURCE/db/migrations/018_cooking_sessions.sql" ] && [ -f "$SOURCE/db/migrations/019_real_consumption_reconciliation.sql" ] || fail 'versioned 018/019 migrations missing'

# The image is built on the runner from the exact-SHA archive and loaded in a prior SSH phase.
# Verify its embedded source revision before any database preflight or mutation.
IMAGE="cocinacore:migrate-$RELEASE_SHA"
[ "$(docker image inspect --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}' "$IMAGE" 2>/dev/null)" = "$RELEASE_SHA" ] || fail 'loaded migration image revision label mismatch'

# All PostgreSQL checks execute in the exact-SHA image. Output is restricted to fixed labels/counts.
preflight() {
  docker run --rm --network "$NETWORK" --env-file "$DATABASE_ENV_FILE" \
    -e COCINACORE_SKIP_DOTENV=1 -e MIGRATION_PG_LOCK_TIMEOUT_MS=5000 \
    -e MIGRATION_PG_STATEMENT_TIMEOUT_MS=120000 \
    "$IMAGE" node -e '
const { Pool } = require("pg");
const { validateShoppingListBaseline } = require("./scripts/migration-baseline");
function parseBoundedTimeout(name){const value=process.env[name];if(!/^[0-9]+$/.test(value||""))throw Error("timeout");const timeout=Number(value);if(!Number.isSafeInteger(timeout)||timeout<1||timeout>300000)throw Error("timeout");return timeout}
(async()=>{const p=new Pool({connectionString:process.env.DATABASE_URL,connectionTimeoutMillis:5000,lock_timeout:parseBoundedTimeout("MIGRATION_PG_LOCK_TIMEOUT_MS"),statement_timeout:parseBoundedTimeout("MIGRATION_PG_STATEMENT_TIMEOUT_MS")});try{
const c=await p.connect();try{
const identity=await c.query("select current_database() db, current_user usr, r.rolsuper super, r.rolbypassrls bypass from pg_catalog.pg_roles r where r.rolname=current_user");
if(identity.rows.length!==1||identity.rows[0].db!=="cocinacore_db"||identity.rows[0].usr!=="cocinacore_user"||identity.rows[0].super||identity.rows[0].bypass) throw Error("db identity");
const relation=await c.query("select count(*)::int item_count, pg_total_relation_size(\u0027public.shopping_list_items\u0027::regclass)::bigint bytes from public.shopping_list_items");
// Migrations 018/019 do not touch shopping-list rows; keep only the bounded 81920-byte safety guard.
validateShoppingListBaseline(relation.rows[0]);
const activity=await c.query("select count(*)::int waiting from pg_locks where not granted");
const idle=await c.query("select count(*)::int idle from pg_stat_activity where state=\u0027idle in transaction\u0027");
if(Number(activity.rows[0].waiting)!==0||Number(idle.rows[0].idle)!==0) throw Error("lock/activity baseline");
}finally{c.release()}}finally{await p.end()}})().catch(()=>{console.error("DATABASE_PREFLIGHT_FAILED");process.exit(1)});' >/dev/null 2>&1 || fail 'database identity, relation, lock or session preflight failed'
}
preflight
# Require the dedicated, non-privileged migration identity before any DDL.
docker run --rm --network "$NETWORK" --env-file "$MIGRATION_DATABASE_ENV_FILE" \
  -e COCINACORE_SKIP_DOTENV=1 -e MIGRATION_PG_LOCK_TIMEOUT_MS=5000 \
  -e MIGRATION_PG_STATEMENT_TIMEOUT_MS=120000 \
  "$IMAGE" node -e '
const { Pool } = require("pg");
(async()=>{const pool=new Pool({connectionString:process.env.MIGRATION_DATABASE_URL,connectionTimeoutMillis:5000,lock_timeout:5000,statement_timeout:120000});try{const c=await pool.connect();try{const r=await c.query("select current_database() db,current_user usr,rolsuper super,rolbypassrls bypass,rolcreaterole create_role,rolcreatedb create_db from pg_catalog.pg_roles where rolname=current_user");if(r.rows.length!==1||r.rows[0].db!=="cocinacore_db"||r.rows[0].usr!=="migration_admin"||r.rows[0].super||r.rows[0].bypass||r.rows[0].create_role||r.rows[0].create_db)throw Error("migration identity")}finally{c.release()}}finally{await pool.end()}})().catch(()=>{console.error("MIGRATION_IDENTITY_PREFLIGHT_FAILED");process.exit(1)});' >/dev/null 2>&1 || fail 'dedicated migration identity preflight failed'
# Canonical dry-run validates the complete ledger and exact pending set before backup verification/mutation.
docker run --rm --network "$NETWORK" --env-file "$MIGRATION_DATABASE_ENV_FILE" \
  -e COCINACORE_SKIP_DOTENV=1 -e COCINACORE_SEPARATED_DB_LANES_ENABLED=true \
  -e MIGRATION_PG_LOCK_TIMEOUT_MS=5000 -e MIGRATION_PG_STATEMENT_TIMEOUT_MS=120000 \
  -e MIGRATION_EXPECTED_PENDING="$EXPECTED_PENDING" \
  "$IMAGE" node scripts/run-migrations.js --lane migration --dry-run >/dev/null 2>&1 || fail 'canonical ledger/exact-pending preflight failed'

# Verify the existing scheduled backup read-only from the exact-SHA release tree.
DAILY_BACKUP_VERIFIED=$("$SOURCE"/scripts/verify-pawtech-cocinacore-daily-backup.sh 2>/dev/null) || fail 'daily backup verification failed'
[ "$DAILY_BACKUP_VERIFIED" = DAILY_BACKUP_VERIFIED ] || fail 'daily backup verifier returned unexpected evidence'

# Canonical runner owns its transaction/advisory lock and enforces exactly the pending migration.
docker run --rm --network "$NETWORK" --env-file "$MIGRATION_DATABASE_ENV_FILE" \
  -e COCINACORE_SKIP_DOTENV=1 -e COCINACORE_SEPARATED_DB_LANES_ENABLED=true \
  -e MIGRATION_PG_LOCK_TIMEOUT_MS=5000 -e MIGRATION_PG_STATEMENT_TIMEOUT_MS=120000 \
  -e MIGRATION_EXPECTED_PENDING="$EXPECTED_PENDING" \
  "$IMAGE" node scripts/run-migrations.js --lane migration >/dev/null 2>&1 || fail 'canonical exact-SHA migration runner failed'

# Read-only canonical complete verification after the transactional migration.
docker run --rm --network "$NETWORK" --env-file "$MIGRATION_DATABASE_ENV_FILE" \
  -e COCINACORE_SKIP_DOTENV=1 -e COCINACORE_SEPARATED_DB_LANES_ENABLED=true \
  -e MIGRATION_PG_LOCK_TIMEOUT_MS=5000 -e MIGRATION_PG_STATEMENT_TIMEOUT_MS=120000 \
  -e MIGRATION_EXPECTED_PENDING= \
  "$IMAGE" node scripts/run-migrations.js --lane migration --verify-complete >/dev/null 2>&1 || fail 'read-only schema verification failed'
# Verify runtime ACLs through the existing runtime identity, without exposing the migration URL.
docker run --rm --network "$NETWORK" --env-file "$DATABASE_ENV_FILE" \
  -e COCINACORE_SKIP_DOTENV=1 \
  "$IMAGE" node -e '
const { Pool } = require("pg");
const expected={cooking_sessions:{select:true,insert:true,update:true,delete:false},cooking_session_events:{select:true,insert:true,update:false,delete:false},real_consumption_operations:{select:true,insert:true,update:false,delete:false},meal_consumption_claims:{select:true,insert:true,update:false,delete:false},real_consumption_items:{select:true,insert:true,update:false,delete:false},real_consumption_substitutions:{select:true,insert:true,update:false,delete:false},real_consumption_movement_links:{select:true,insert:true,update:false,delete:false}};
(async()=>{const pool=new Pool({connectionString:process.env.DATABASE_URL,connectionTimeoutMillis:5000});try{const c=await pool.connect();try{const identity=await c.query("select current_database() db,current_user usr,rolsuper super,rolbypassrls bypass from pg_catalog.pg_roles where rolname=current_user");if(identity.rows.length!==1||identity.rows[0].db!=="cocinacore_db"||identity.rows[0].usr!=="cocinacore_user"||identity.rows[0].super||identity.rows[0].bypass)throw Error("runtime identity");for(const [table,privileges] of Object.entries(expected)){const actual=await c.query("select has_table_privilege(current_user,$1,$2) as select_priv,has_table_privilege(current_user,$1,$3) as insert_priv,has_table_privilege(current_user,$1,$4) as update_priv,has_table_privilege(current_user,$1,$5) as delete_priv",["public."+table,"SELECT","INSERT","UPDATE","DELETE"]);const row=actual.rows[0];if(!row||row.select_priv!==privileges.select||row.insert_priv!==privileges.insert||row.update_priv!==privileges.update||row.delete_priv!==privileges.delete)throw Error("runtime ACL "+table)}}finally{c.release()}}finally{await pool.end()}})().catch(()=>{console.error("RUNTIME_M5_ACL_VERIFICATION_FAILED");process.exit(1)});' >/dev/null 2>&1 || fail 'runtime M5 table privilege verification failed'
log "MIGRATIONS_VERIFIED sha=$RELEASE_SHA migrations=$EXPECTED_PENDING"
log 'RECEIPT secretless=true database_changed=018-019-only daily_backup=verified migration_role=verified runtime_acl=verified schema_verification=passed'
