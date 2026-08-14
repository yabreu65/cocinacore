#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
IMAGE='pgvector/pgvector:pg16'
PREFIX="cocinacore-pr0a-cp21-$$"
CONTAINER=
TMP_ROOT=$(mktemp -d)
LOG="$TMP_ROOT/operation.log"
MIGRATION_PASSWORD=$(openssl rand -hex 18)
ADMIN_PASSWORD=$(openssl rand -hex 18)
PORT=
DB=
ADMIN_URL=
MIGRATION_URL=

cleanup() {
  status=$?
  if [ "$status" -ne 0 ] && [ -s "$LOG" ]; then tail -n 200 "$LOG" >&2; fi
  if [ -n "$CONTAINER" ]; then docker rm -f "$CONTAINER" >/dev/null 2>&1 || true; fi
  for leftover in $(docker ps -a --format '{{.Names}}' | grep "^$PREFIX" || true); do
    docker rm -f "$leftover" >/dev/null 2>&1 || true
  done
  rm -rf "$TMP_ROOT"
  return "$status"
}
trap cleanup EXIT INT TERM

fail() {
  printf '%s\n' "integration failure: $1" >&2
  exit 1
}

start_container() {
  suffix=$1
  DB=$2
  CONTAINER="$PREFIX-$suffix"
  docker run -d --name "$CONTAINER" \
    -e POSTGRES_DB="$DB" -e POSTGRES_USER=cocinacore -e POSTGRES_PASSWORD="$ADMIN_PASSWORD" \
    -p 127.0.0.1::5432 "$IMAGE" >/dev/null
  attempt=0
  until docker exec "$CONTAINER" pg_isready -U cocinacore -d "$DB" >/dev/null 2>&1; do
    attempt=$((attempt + 1)); [ "$attempt" -lt 60 ] || fail 'PostgreSQL did not become ready'; sleep 1
  done
  PORT=$(docker port "$CONTAINER" 5432/tcp | sed 's/.*://')
  ADMIN_URL="postgresql://cocinacore:$ADMIN_PASSWORD@127.0.0.1:$PORT/$DB"
  MIGRATION_URL="postgresql://migration_admin:$MIGRATION_PASSWORD@127.0.0.1:$PORT/$DB"
}

stop_container() {
  docker rm -f "$CONTAINER" >/dev/null
  CONTAINER=
}

admin_sql() {
  database=$1; shift
  docker exec -i "$CONTAINER" psql -X -v ON_ERROR_STOP=1 -U cocinacore -d "$database" -Atqc "$*"
}

migrator_sql() {
  database=$1; shift
  docker exec -e PGPASSWORD="$MIGRATION_PASSWORD" -i "$CONTAINER" \
    psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -U migration_admin -d "$database" -Atqc "$*"
}

provision() {
  COCINACORE_SEPARATED_DB_LANES_ENABLED=true \
  BOOTSTRAP_DATABASE_URL="$ADMIN_URL" MIGRATION_ADMIN_PASSWORD="$MIGRATION_PASSWORD" \
  node "$ROOT/frontend/scripts/provision-database.js"
}

migrate() {
  COCINACORE_SEPARATED_DB_LANES_ENABLED=true MIGRATION_DATABASE_URL="$MIGRATION_URL" \
  node "$ROOT/frontend/scripts/run-migrations.js" --lane migration "$@"
}

expect_provision_failure() {
  expected=$1
  if COCINACORE_SEPARATED_DB_LANES_ENABLED=true \
     BOOTSTRAP_DATABASE_URL="$ADMIN_URL" MIGRATION_ADMIN_PASSWORD="$MIGRATION_PASSWORD" \
     node "$ROOT/frontend/scripts/provision-database.js" >"$LOG" 2>&1; then
    fail "provisioner accepted failure case $expected"
  fi
  grep -q "$expected" "$LOG" || fail "provisioner did not report $expected"
  grep -Fq "$ADMIN_PASSWORD" "$LOG" && fail 'administrator secret was logged'
  grep -Fq "$MIGRATION_PASSWORD" "$LOG" && fail 'migration secret was logged'
  return 0
}

make_fixture() {
  target=$1; filename=$2; source=$3
  mkdir -p "$target"
  cp "$ROOT"/db/migrations/*.sql "$target/"
  cp "$ROOT/db/migrations/manifest.json" "$target/manifest.json"
  cp "$source" "$target/$filename"
  python3 - "$target/manifest.json" "$target/$filename" "$filename" <<'PY'
import hashlib, json, pathlib, sys
manifest_path, migration_path, filename = map(pathlib.Path, sys.argv[1:])
manifest=json.loads(manifest_path.read_text())
data=migration_path.read_bytes()
manifest['migrations'].append({
  'id':'012','filename':str(filename),'lane':'migration','sha256':hashlib.sha256(data).hexdigest(),
  'byteLength':len(data),'transactional':'required','legacyChecksumBackfillAllowed':False
})
manifest_path.write_text(json.dumps(manifest,indent=2)+'\n')
PY
}

# ---------------------------------------------------------------------------
# Fresh installation, extension boundary, activation, SQL policy, and locks.
# ---------------------------------------------------------------------------
start_container fresh cocinacore_fresh

# Unavailable vector fails before roles, ledger, or migrations exist.
SHARE_DIR=$(docker exec "$CONTAINER" pg_config --sharedir)
docker exec "$CONTAINER" mv "$SHARE_DIR/extension/vector.control" "$SHARE_DIR/extension/vector.control.cp21"
expect_provision_failure VECTOR_NOT_AVAILABLE
[ "$(admin_sql "$DB" "select count(*) from pg_roles where rolname in ('migration_admin','cocinacore_schema_owner')")" = 0 ] || fail 'unavailable vector created roles'
[ "$(admin_sql "$DB" "select to_regclass('public.schema_migrations') is null")" = t ] || fail 'unavailable vector created ledger'
docker exec "$CONTAINER" mv "$SHARE_DIR/extension/vector.control.cp21" "$SHARE_DIR/extension/vector.control"

# Wrong installed vector state fails closed and is not repaired.
admin_sql "$DB" "create schema vector_wrong; create extension vector with schema vector_wrong"
expect_provision_failure VECTOR_STATE_MISMATCH
[ "$(admin_sql "$DB" "select n.nspname from pg_extension e join pg_namespace n on n.oid=e.extnamespace where e.extname='vector'")" = vector_wrong ] || fail 'wrong vector schema was repaired'
[ "$(admin_sql "$DB" "select count(*) from pg_roles where rolname in ('migration_admin','cocinacore_schema_owner')")" = 0 ] || fail 'wrong vector state created roles'
admin_sql "$DB" 'drop extension vector; drop schema vector_wrong'

provision >"$LOG" 2>&1
grep -q 'trusted ownership are provisioned' "$LOG" || fail 'fresh bootstrap did not finish'
[ "$(admin_sql "$DB" "select n.nspname||','||r.rolname||','||r.rolsuper from pg_extension e join pg_namespace n on n.oid=e.extnamespace join pg_roles r on r.oid=e.extowner where e.extname='vector'")" = 'public,cocinacore,true' ] || fail 'fresh vector state is invalid'
[ "$(admin_sql "$DB" "select count(*) from pg_extension where extname='pgcrypto'")" = 0 ] || fail 'bootstrap preinstalled pgcrypto'
[ "$(admin_sql "$DB" "select n.nspname from pg_extension e join pg_namespace n on n.oid=e.extnamespace where e.extname='plpgsql'")" = pg_catalog ] || fail 'plpgsql attestation failed'

# Exact rerun before migrations is a safe no-op, including credential state.
VECTOR_OID=$(admin_sql "$DB" "select oid from pg_extension where extname='vector'")
PASSWORD_BEFORE=$(admin_sql "$DB" "select rolpassword from pg_authid where rolname='migration_admin'")
provision >"$LOG" 2>&1
[ "$(admin_sql "$DB" "select oid from pg_extension where extname='vector'")" = "$VECTOR_OID" ] || fail 'rerun replaced vector extension'
[ "$(admin_sql "$DB" "select rolpassword from pg_authid where rolname='migration_admin'")" = "$PASSWORD_BEFORE" ] || fail 'rerun rotated migration password'

# The restricted actor cannot install vector in another prepared database.
admin_sql "$DB" 'create database vector_denied'
admin_sql vector_denied "alter schema public owner to cocinacore_schema_owner; grant create on database vector_denied to cocinacore_schema_owner"
if migrator_sql vector_denied 'set role cocinacore_schema_owner; create extension vector with schema public' >"$LOG" 2>&1; then
  fail 'migration actor installed vector'
fi
grep -Eq 'permission denied|Must be superuser' "$LOG" || fail 'vector denial was not a privilege denial'
admin_sql "$DB" 'drop database vector_denied'

# Explicit bootstrap preinstall makes unchanged 001 safe; pgcrypto remains migration-owned.
migrate >"$LOG" 2>&1
grep -q 'DONE 011_canonical_email_invariant.sql' "$LOG" || fail 'fresh 001-011 did not complete'
migrate --verify-complete >"$LOG" 2>&1
grep -q 'Migration ledger is complete' "$LOG" || fail 'fresh completeness verification failed'
[ "$(admin_sql "$DB" "select count(*) from public.schema_migrations")" = 11 ] || fail 'fresh ledger count is not 11'
[ "$(admin_sql "$DB" "select count(*) from pg_constraint where conrelid='public.users'::regclass and conname='users_email_canonical_check'")" = 1 ] || fail 'forward canonical constraint is missing'
[ "$(admin_sql "$DB" "select pg_get_userbyid(extowner) from pg_extension where extname='pgcrypto'")" = cocinacore_schema_owner ] || fail 'pgcrypto was not created by schema owner'
[ "$(admin_sql "$DB" "select pg_get_userbyid(relowner) from pg_class where oid='public.tenants'::regclass")" = cocinacore_schema_owner ] || fail 'fresh objects are not schema-owner owned'

# Established ledgers accept only a checksummed continuous manifest prefix.
CHECKSUM_010=$(admin_sql "$DB" "select checksum from schema_migrations where filename='010_password_reset_tokens.sql'")
CHECKSUM_011=$(admin_sql "$DB" "select checksum from schema_migrations where filename='011_canonical_email_invariant.sql'")
admin_sql "$DB" "delete from schema_migrations where filename='010_password_reset_tokens.sql'"
expect_provision_failure 'Established ledger migration prefix'
admin_sql "$DB" "insert into schema_migrations(filename,checksum) values ('010_password_reset_tokens.sql','$CHECKSUM_010')"
admin_sql "$DB" "update schema_migrations set checksum=repeat('0',64) where filename='011_canonical_email_invariant.sql'"
expect_provision_failure MIGRATION_CHECKSUM_MISMATCH
admin_sql "$DB" "update schema_migrations set checksum='$CHECKSUM_011' where filename='011_canonical_email_invariant.sql'"
admin_sql "$DB" "insert into schema_migrations(filename,checksum) values ('999_unknown.sql',repeat('0',64))"
expect_provision_failure 'Established ledger migration prefix'
admin_sql "$DB" "delete from schema_migrations where filename='999_unknown.sql'"

# Malformed extension membership is detected, while extension members remain outside app adoption.
VECTOR_OPERATOR=$(admin_sql "$DB" "select d.objid from pg_extension e join pg_depend d on d.refclassid='pg_extension'::regclass and d.refobjid=e.oid and d.deptype='e' where e.extname='vector' and d.classid='pg_operator'::regclass order by d.objid limit 1")
admin_sql "$DB" "delete from pg_depend where refclassid='pg_extension'::regclass and refobjid=(select oid from pg_extension where extname='vector') and deptype='e' and classid='pg_operator'::regclass and objid=$VECTOR_OPERATOR"
expect_provision_failure 'extension vector membership is outside policy'
admin_sql "$DB" "insert into pg_depend(classid,objid,objsubid,refclassid,refobjid,refobjsubid,deptype) values ('pg_operator'::regclass,$VECTOR_OPERATOR,0,'pg_extension'::regclass,(select oid from pg_extension where extname='vector'),0,'e')"
provision >"$LOG" 2>&1

# Exact extension identity detects same-count substitution, not only cardinality drift.
admin_sql "$DB" 'create function public.cp21_fake_vector_member() returns integer language sql as $$select 1$$'
admin_sql "$DB" "delete from pg_depend where refclassid='pg_extension'::regclass and refobjid=(select oid from pg_extension where extname='vector') and deptype='e' and classid='pg_operator'::regclass and objid=$VECTOR_OPERATOR;
insert into pg_depend(classid,objid,objsubid,refclassid,refobjid,refobjsubid,deptype)
values ('pg_proc'::regclass,'public.cp21_fake_vector_member()'::regprocedure,0,'pg_extension'::regclass,(select oid from pg_extension where extname='vector'),0,'e')"
expect_provision_failure 'extension vector membership is outside policy'
admin_sql "$DB" "delete from pg_depend where refclassid='pg_extension'::regclass and refobjid=(select oid from pg_extension where extname='vector') and deptype='e' and classid='pg_proc'::regclass and objid='public.cp21_fake_vector_member()'::regprocedure;
insert into pg_depend(classid,objid,objsubid,refclassid,refobjid,refobjsubid,deptype)
values ('pg_operator'::regclass,$VECTOR_OPERATOR,0,'pg_extension'::regclass,(select oid from pg_extension where extname='vector'),0,'e')"
admin_sql "$DB" 'drop function public.cp21_fake_vector_member()'

# Reserved roles cannot own or receive authority in rogue non-system schemas.
admin_sql "$DB" 'create schema cp21_rogue authorization migration_admin'
expect_provision_failure ROLE_STATE_MISMATCH
admin_sql "$DB" 'alter schema cp21_rogue owner to cocinacore; drop schema cp21_rogue'
admin_sql "$DB" 'create schema cp21_rogue; create type cp21_rogue.forbidden_enum as enum ($$forbidden$$); alter type cp21_rogue.forbidden_enum owner to migration_admin'
expect_provision_failure ROLE_STATE_MISMATCH
admin_sql "$DB" 'alter type cp21_rogue.forbidden_enum owner to cocinacore; drop schema cp21_rogue cascade'

# Independent runner rejects direct migration_admin database-object authority drift.
admin_sql "$DB" 'create schema cp21_runner_rogue; grant usage on schema cp21_runner_rogue to migration_admin'
if COCINACORE_SEPARATED_DB_LANES_ENABLED=true MIGRATION_DATABASE_URL="$MIGRATION_URL" \
   node "$ROOT/frontend/scripts/run-migrations.js" --lane migration --verify-complete >"$LOG" 2>&1; then
  fail 'runner accepted direct database-object authority drift'
fi
grep -q ROLE_STATE_MISMATCH "$LOG" || fail 'runner authority-drift failure was not explicit'
admin_sql "$DB" 'revoke usage on schema cp21_runner_rogue from migration_admin; drop schema cp21_runner_rogue'
admin_sql "$DB" 'create schema cp21_runner_rogue; grant usage on schema cp21_runner_rogue to cocinacore_schema_owner'
if COCINACORE_SEPARATED_DB_LANES_ENABLED=true MIGRATION_DATABASE_URL="$MIGRATION_URL" \
   node "$ROOT/frontend/scripts/run-migrations.js" --lane migration --verify-complete >"$LOG" 2>&1; then
  fail 'runner accepted schema-owner direct ACL drift'
fi
grep -q ROLE_STATE_MISMATCH "$LOG" || fail 'runner schema-owner drift failure was not explicit'
admin_sql "$DB" 'revoke usage on schema cp21_runner_rogue from cocinacore_schema_owner; drop schema cp21_runner_rogue'
admin_sql "$DB" 'create role cp21_foreign_owner; alter table public.tenants owner to cp21_foreign_owner'
if COCINACORE_SEPARATED_DB_LANES_ENABLED=true MIGRATION_DATABASE_URL="$MIGRATION_URL" \
   node "$ROOT/frontend/scripts/run-migrations.js" --lane migration --verify-complete >"$LOG" 2>&1; then
  fail 'runner accepted missing schema-owner manifest ownership'
fi
grep -q ROLE_STATE_MISMATCH "$LOG" || fail 'runner missing-owner failure was not explicit'
admin_sql "$DB" 'alter table public.tenants owner to cocinacore_schema_owner; drop role cp21_foreign_owner'

# Activation failure matrix.
if COCINACORE_SEPARATED_DB_LANES_ENABLED=true \
   node "$ROOT/frontend/scripts/run-migrations.js" --lane migration >"$LOG" 2>&1; then
  fail 'enabled runner accepted missing MIGRATION_DATABASE_URL'
fi
grep -q 'MIGRATION_DATABASE_URL environment variable is required' "$LOG" || fail 'missing migration secret failure was not explicit'
if COCINACORE_SEPARATED_DB_LANES_ENABLED=true MIGRATION_DATABASE_URL="$ADMIN_URL" \
   node "$ROOT/frontend/scripts/run-migrations.js" --lane migration --verify-complete >"$LOG" 2>&1; then
  fail 'enabled runner accepted the wrong identity'
fi
grep -q 'MIGRATION_IDENTITY_MISMATCH' "$LOG" || fail 'wrong migration identity failure was not explicit'
migrate --verify-complete >"$LOG" 2>&1

# Disabled/default mode retains the legacy DATABASE_URL path without privileged inputs.
admin_sql "$DB" 'create database legacy_disabled'
DISABLED_URL="postgresql://cocinacore:$ADMIN_PASSWORD@127.0.0.1:$PORT/legacy_disabled"
DATABASE_URL="$DISABLED_URL" node "$ROOT/frontend/scripts/run-migrations.js" --lane migration >"$LOG" 2>&1
grep -q 'DONE 011_canonical_email_invariant.sql' "$LOG" || fail 'missing-gate legacy mode failed'
COCINACORE_SEPARATED_DB_LANES_ENABLED=false DATABASE_URL="$DISABLED_URL" \
node "$ROOT/frontend/scripts/run-migrations.js" --lane migration --verify-complete >"$LOG" 2>&1
grep -q 'Migration ledger is complete' "$LOG" || fail 'false-gate legacy mode failed'
admin_sql "$DB" 'drop database legacy_disabled'

# Role attributes and least-privilege boundaries.
[ "$(admin_sql "$DB" "select rolcanlogin||','||rolinherit||','||rolsuper||','||rolcreatedb||','||rolcreaterole||','||rolreplication||','||rolbypassrls||','||rolconnlimit||','||(rolvaliduntil is null)||','||(rolconfig is null) from pg_roles where rolname='migration_admin'")" = 'true,false,false,false,false,false,false,-1,true,true' ] || fail 'migration_admin attributes drifted'
[ "$(admin_sql "$DB" "select rolcanlogin||','||rolinherit||','||rolsuper||','||rolcreatedb||','||rolcreaterole||','||rolreplication||','||rolbypassrls||','||rolconnlimit||','||(rolvaliduntil is null)||','||(rolconfig is null) from pg_roles where rolname='cocinacore_schema_owner'")" = 'false,false,false,false,false,false,false,-1,true,true' ] || fail 'schema owner attributes drifted'
if migrator_sql "$DB" 'create role forbidden_role' >"$LOG" 2>&1; then fail 'migration_admin created a role'; fi
if migrator_sql "$DB" 'set role cocinacore' >"$LOG" 2>&1; then fail 'migration_admin assumed bootstrap actor'; fi
[ "$(migrator_sql "$DB" "select current_user; set role cocinacore_schema_owner; select current_user")" = "migration_admin
cocinacore_schema_owner" ] || fail 'schema-owner SET ROLE contract failed'

# Negative catalog tests fail before mutation on an established DB.
admin_sql "$DB" 'create table public.unexpected_table_cp21(id integer)'
expect_provision_failure 'Managed table set mismatch'
[ "$(admin_sql "$DB" "select pg_get_userbyid(relowner) from pg_class where oid='public.unexpected_table_cp21'::regclass")" = cocinacore ] || fail 'unexpected table was adopted'
admin_sql "$DB" 'drop table public.unexpected_table_cp21'
admin_sql "$DB" "create function public.unexpected_function_cp21() returns integer language sql as 'select 1'"
expect_provision_failure 'Managed function set mismatch'
[ "$(admin_sql "$DB" "select pg_get_userbyid(proowner) from pg_proc where oid='public.unexpected_function_cp21()'::regprocedure")" = cocinacore ] || fail 'unexpected function was adopted'
admin_sql "$DB" 'drop function public.unexpected_function_cp21()'

# Role state drift always fails before repair/mutation.
admin_sql "$DB" 'alter role migration_admin connection limit 4'
expect_provision_failure ROLE_STATE_MISMATCH
admin_sql "$DB" 'alter role migration_admin connection limit -1'
admin_sql "$DB" "alter role migration_admin set statement_timeout='5s'"
expect_provision_failure ROLE_STATE_MISMATCH
admin_sql "$DB" 'alter role migration_admin reset statement_timeout'
admin_sql "$DB" "alter role migration_admin in database $DB set statement_timeout='5s'"
expect_provision_failure ROLE_STATE_MISMATCH
admin_sql "$DB" "alter role migration_admin in database $DB reset statement_timeout"
admin_sql "$DB" 'create role membership_drift; grant membership_drift to migration_admin'
expect_provision_failure 'unexpected memberships'
admin_sql "$DB" 'revoke membership_drift from migration_admin; drop role membership_drift'

# SQL analyzer fixtures are validated before any connection.
printf '%s\n' 'begin;' >"$TMP_ROOT/begin.sql"
printf '%s\n' 'commit;' >"$TMP_ROOT/commit.sql"
printf '%s\n' 'create index concurrently cp21_idx on public.tenants(id);' >"$TMP_ROOT/concurrently.sql"
printf '%s\n' 'vacuum public.tenants;' >"$TMP_ROOT/vacuum.sql"
printf '%s\n' 'release migration_savepoint;' >"$TMP_ROOT/release.sql"
printf '%s\r%s\n' '-- comment ending with carriage return' 'commit;' >"$TMP_ROOT/cr_comment.sql"
cat >"$TMP_ROOT/backslash.sql" <<'SQL'
select 'ordinary string ending in backslash\'; commit;
SQL
for spec in 'begin:BEGIN:prohibited top-level' 'commit:COMMIT:prohibited top-level' \
            'concurrently:CONCURRENTLY:unsupported nontransactional' 'vacuum:VACUUM:unsupported nontransactional' \
            'release:RELEASE:prohibited top-level' 'cr_comment:CR_COMMENT:prohibited top-level' \
            'backslash:BACKSLASH:prohibited top-level'; do
  name=${spec%%:*}; rest=${spec#*:}; label=${rest%%:*}; expected=${rest#*:}
  dir="$TMP_ROOT/fixture-$name"; make_fixture "$dir" "012_${name}_fixture.sql" "$TMP_ROOT/$name.sql"
  if MIGRATIONS_DIR="$dir" node "$ROOT/frontend/scripts/run-migrations.js" --lane migration --dry-run >"$LOG" 2>&1; then
    fail "$label fixture was accepted"
  fi
  grep -q "$expected" "$LOG" || fail "$label fixture failure was not explicit"
done
cat >"$TMP_ROOT/false-positive.sql" <<'SQL'
-- COMMIT; VACUUM;
select 'BEGIN and CREATE INDEX CONCURRENTLY are data';
create function public.cp21_lexer_probe() returns text language plpgsql as $$
begin
  return 'ROLLBACK inside a dollar body';
end
$$;
SQL
FALSE_DIR="$TMP_ROOT/fixture-false-positive"
make_fixture "$FALSE_DIR" 012_false_positive_fixture.sql "$TMP_ROOT/false-positive.sql"
MIGRATIONS_DIR="$FALSE_DIR" node "$ROOT/frontend/scripts/run-migrations.js" --lane migration --dry-run >"$LOG" 2>&1
grep -q '012_false_positive_fixture.sql' "$LOG" || fail 'lexer false-positive fixture was rejected'

# A changed historical file can never certify itself.
MUTATED_DIR="$TMP_ROOT/mutated-history"
mkdir "$MUTATED_DIR"; cp "$ROOT"/db/migrations/*.sql "$MUTATED_DIR/"; cp "$ROOT/db/migrations/manifest.json" "$MUTATED_DIR/manifest.json"
printf '%s\n' '-- unauthorized drift' >>"$MUTATED_DIR/001_extensions_and_core.sql"
if MIGRATIONS_DIR="$MUTATED_DIR" node "$ROOT/frontend/scripts/run-migrations.js" --lane migration --dry-run >"$LOG" 2>&1; then
  fail 'mutated historical migration was accepted'
fi
grep -q 'MIGRATION_CHECKSUM_MISMATCH' "$LOG" || fail 'mutated historical failure was not explicit'

# Failed normal migration and its ledger row roll back together.
cat >"$TMP_ROOT/failure.sql" <<'SQL'
create table public.cp21_must_roll_back(id integer primary key);
select public.cp21_missing_function();
SQL
FAILURE_DIR="$TMP_ROOT/fixture-failure"
make_fixture "$FAILURE_DIR" 012_atomic_failure.sql "$TMP_ROOT/failure.sql"
if COCINACORE_SEPARATED_DB_LANES_ENABLED=true MIGRATION_DATABASE_URL="$MIGRATION_URL" \
   MIGRATIONS_DIR="$FAILURE_DIR" node "$ROOT/frontend/scripts/run-migrations.js" --lane migration >"$LOG" 2>&1; then
  fail 'failed migration succeeded'
fi
[ "$(admin_sql "$DB" "select to_regclass('public.cp21_must_roll_back') is null")" = t ] || fail 'failed migration left an object'
[ "$(admin_sql "$DB" "select count(*) from schema_migrations where filename='012_atomic_failure.sql'")" = 0 ] || fail 'failed migration left a ledger row'

# Shared advisory-lock matrix. A real first actor holds the exact key while the second executable times out.
wait_for_lock() {
  attempt=0
  until [ "$(admin_sql "$DB" "select count(*) from pg_locks where locktype='advisory' and granted")" -ge 1 ]; do
    attempt=$((attempt + 1)); [ "$attempt" -lt 40 ] || fail 'lock holder did not acquire'; sleep 0.05
  done
}
start_admin_holder() {
  docker exec "$CONTAINER" psql -X -U cocinacore -d "$DB" -qc \
    "select pg_advisory_lock(hashtextextended('cocinacore:database-change:v1:'||current_database(),0)); select pg_sleep(1.5)" >/dev/null 2>&1 &
  HOLDER_PID=$!; wait_for_lock
}
start_runner_holder() {
  docker exec -e PGPASSWORD="$MIGRATION_PASSWORD" "$CONTAINER" \
    psql -X -h 127.0.0.1 -U migration_admin -d "$DB" -qc \
    "set role cocinacore_schema_owner; select pg_advisory_lock(hashtextextended('cocinacore:database-change:v1:'||current_database(),0)); select pg_sleep(1.5)" >/dev/null 2>&1 &
  HOLDER_PID=$!; wait_for_lock
}
expect_runner_lock_timeout() {
  if COCINACORE_SEPARATED_DB_LANES_ENABLED=true MIGRATION_DATABASE_URL="$MIGRATION_URL" \
     MIGRATION_LOCK_TIMEOUT_MS=120 node "$ROOT/frontend/scripts/run-migrations.js" --lane migration --verify-complete >"$LOG" 2>&1; then
    fail 'runner entered a held mutable critical section'
  fi
  grep -q LOCK_TIMEOUT "$LOG" || fail 'runner lock timeout was not explicit'
}
expect_provisioner_lock_timeout() {
  if COCINACORE_SEPARATED_DB_LANES_ENABLED=true BOOTSTRAP_DATABASE_URL="$ADMIN_URL" \
     MIGRATION_ADMIN_PASSWORD="$MIGRATION_PASSWORD" MIGRATION_LOCK_TIMEOUT_MS=120 \
     node "$ROOT/frontend/scripts/provision-database.js" >"$LOG" 2>&1; then
    fail 'provisioner entered a held mutable critical section'
  fi
  grep -q LOCK_TIMEOUT "$LOG" || fail 'provisioner lock timeout was not explicit'
}
start_runner_holder; expect_runner_lock_timeout; wait "$HOLDER_PID"
start_admin_holder; expect_runner_lock_timeout; wait "$HOLDER_PID"
start_runner_holder; expect_provisioner_lock_timeout; wait "$HOLDER_PID"
start_admin_holder; expect_provisioner_lock_timeout; wait "$HOLDER_PID"

# VALID UNTIL drift is tested last because PostgreSQL exposes no ALTER ROLE syntax restoring catalog NULL.
admin_sql "$DB" "alter role migration_admin valid until '2099-01-01'"
expect_provision_failure ROLE_STATE_MISMATCH
stop_container

# ---------------------------------------------------------------------------
# Existing trusted legacy upgrade, exact backfill, ownership, and compatibility.
# ---------------------------------------------------------------------------
ADMIN_PASSWORD=$(openssl rand -hex 18)
MIGRATION_PASSWORD=$(openssl rand -hex 18)
start_container legacy cocinacore_legacy
LEGACY_MIGRATIONS=$(node -e "const m=require(process.argv[1]); console.log(m.migrations.filter(x=>x.legacyChecksumBackfillAllowed).map(x=>x.filename).join('\\n'))" "$ROOT/db/migrations/manifest.json")
for filename in $LEGACY_MIGRATIONS; do
  migration="$ROOT/db/migrations/$filename"
  docker exec -i "$CONTAINER" psql -X -v ON_ERROR_STOP=1 -U cocinacore -d "$DB" >/dev/null <"$migration"
done
admin_sql "$DB" "create schema internal;
  create table public.schema_migrations(filename text primary key, applied_at timestamptz not null default now());
  alter table public.schema_migrations enable row level security;
  revoke all on public.schema_migrations from public;"
for filename in $LEGACY_MIGRATIONS; do
  admin_sql "$DB" "insert into public.schema_migrations(filename) values ('$filename')"
done
LEGACY_TENANT=$(admin_sql "$DB" "insert into public.tenants(name) values ('legacy-before') returning id")
admin_sql "$DB" 'create role legacy_reader nologin; grant usage on schema public to legacy_reader; grant select on public.tenants to legacy_reader'

# Complete ledger/catalog attestation happens before any adoption.
admin_sql "$DB" "insert into public.schema_migrations(filename) values ('999_unknown.sql')"
expect_provision_failure BASELINE_MISMATCH
[ "$(admin_sql "$DB" "select count(*) from pg_roles where rolname in ('migration_admin','cocinacore_schema_owner')")" = 0 ] || fail 'unknown ledger row created roles'
admin_sql "$DB" "delete from public.schema_migrations where filename='999_unknown.sql'"
admin_sql "$DB" "delete from public.schema_migrations where filename='010_password_reset_tokens.sql'"
expect_provision_failure 'Legacy ledger migration set mismatch'
[ "$(admin_sql "$DB" "select pg_get_userbyid(relowner) from pg_class where oid='public.tenants'::regclass")" = cocinacore ] || fail 'missing ledger row started ownership adoption'
admin_sql "$DB" "insert into public.schema_migrations(filename) values ('010_password_reset_tokens.sql')"
admin_sql "$DB" 'create table public.unexpected_legacy_table(id integer)'
expect_provision_failure 'Managed table set mismatch'
[ "$(admin_sql "$DB" "select pg_get_userbyid(relowner) from pg_class where oid='public.tenants'::regclass")" = cocinacore ] || fail 'unexpected table started ownership adoption'
admin_sql "$DB" 'drop table public.unexpected_legacy_table'
admin_sql "$DB" "create function public.unexpected_legacy_function() returns integer language sql as 'select 1'"
expect_provision_failure 'Managed function set mismatch'
admin_sql "$DB" 'drop function public.unexpected_legacy_function()'
admin_sql "$DB" 'create role foreign_owner; alter table public.tenants owner to foreign_owner'
expect_provision_failure 'unexpected owner'
[ "$(admin_sql "$DB" "select pg_get_userbyid(relowner) from pg_class where oid='public.tenants'::regclass")" = foreign_owner ] || fail 'unexpected owner was rewritten'
admin_sql "$DB" 'alter table public.tenants owner to cocinacore; drop role foreign_owner'

OWNER_BEFORE=$(admin_sql "$DB" "select pg_get_userbyid(relowner) from pg_class where oid='public.tenants'::regclass")
ACL_BEFORE=$(admin_sql "$DB" "select has_schema_privilege('legacy_reader','public','USAGE')||','||has_table_privilege('legacy_reader','public.tenants','SELECT')")
[ "$OWNER_BEFORE" = cocinacore ] || fail 'legacy owner baseline is wrong'
[ "$ACL_BEFORE" = 'true,true' ] || fail 'legacy explicit grant baseline is wrong'

provision >"$LOG" 2>&1
[ "$(admin_sql "$DB" "select count(*) from schema_migrations where checksum is not null")" = 10 ] || fail 'trusted legacy checksum backfill did not cover 10 rows'
EXPECTED_LEDGER=$(node -e "const m=require(process.argv[1]); console.log(m.migrations.filter(x=>x.legacyChecksumBackfillAllowed).map(x=>x.filename+'='+x.sha256).sort().join(','))" "$ROOT/db/migrations/manifest.json")
ACTUAL_LEDGER=$(admin_sql "$DB" "select string_agg(filename||'='||checksum,',' order by filename) from schema_migrations")
[ "$EXPECTED_LEDGER" = "$ACTUAL_LEDGER" ] || fail 'legacy backfill does not equal trusted manifest'

migrate >"$LOG" 2>&1
grep -q 'DONE 011_canonical_email_invariant.sql' "$LOG" || fail 'legacy upgrade did not apply forward migration 011'
[ "$(admin_sql "$DB" "select count(*) from schema_migrations")" = 11 ] || fail 'legacy upgrade ledger count is not 11'
[ "$(admin_sql "$DB" "select count(*) from pg_constraint where conrelid='public.users'::regclass and conname='users_email_canonical_check'")" = 1 ] || fail 'legacy upgrade canonical constraint is missing'
TRANSFERRED=$(admin_sql "$DB" "select
  (select count(*) from pg_namespace where nspname in ('public','internal') and pg_get_userbyid(nspowner)='cocinacore_schema_owner') +
  (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','internal') and c.relkind in ('r','p') and pg_get_userbyid(c.relowner)='cocinacore_schema_owner') +
  (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','internal') and pg_get_userbyid(p.proowner)='cocinacore_schema_owner' and not exists(select 1 from pg_depend d where d.classid='pg_proc'::regclass and d.objid=p.oid and d.deptype='e'))")
[ "$TRANSFERRED" = 38 ] || fail 'ownership transfer target count is not 38'
[ "$(admin_sql "$DB" "select count(*) from pg_depend d where d.deptype='e' and ((d.classid='pg_proc'::regclass and exists(select 1 from pg_proc p where p.oid=d.objid and pg_get_userbyid(p.proowner)='cocinacore_schema_owner')) or (d.classid='pg_type'::regclass and exists(select 1 from pg_type t where t.oid=d.objid and pg_get_userbyid(t.typowner)='cocinacore_schema_owner')))")" = 0 ] || fail 'legacy extension-managed objects were transferred'
[ "$(admin_sql "$DB" "select pg_get_userbyid(extowner) from pg_extension where extname='vector'")" = cocinacore ] || fail 'legacy vector owner changed'
[ "$(admin_sql "$DB" "select pg_get_userbyid(extowner) from pg_extension where extname='pgcrypto'")" = cocinacore ] || fail 'legacy pgcrypto owner changed'
[ "$(admin_sql "$DB" "select has_schema_privilege('legacy_reader','public','USAGE')||','||has_table_privilege('legacy_reader','public.tenants','SELECT')")" = "$ACL_BEFORE" ] || fail 'legacy explicit grants changed'
[ "$(admin_sql "$DB" "select has_schema_privilege('public','public','USAGE')||','||has_schema_privilege('public','public','CREATE')")" = 'true,false' ] || fail 'public schema ACL target is wrong'
[ "$(admin_sql "$DB" "select count(*) from tenants where id='$LEGACY_TENANT'")" = 1 ] || fail 'legacy data was lost'
admin_sql "$DB" "insert into tenants(name) values ('legacy-after')" >/dev/null
[ "$(admin_sql "$DB" "select count(*) from tenants where name in ('legacy-before','legacy-after')")" = 2 ] || fail 'legacy read/write compatibility failed'

# Exact-state provisioner rerun remains safe.
provision >"$LOG" 2>&1
[ "$(admin_sql "$DB" "select count(*) from tenants where name in ('legacy-before','legacy-after')")" = 2 ] || fail 'reprovision changed application data'

stop_container
[ "$(docker ps -a --format '{{.Names}}' | grep -c "^$PREFIX" || true)" = 0 ] || fail 'temporary containers remain'
printf '%s\n' 'bootstrap/migrator integration passed: fresh legacy extensions baseline roles locks transactions activation'
