#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
IMAGE='pgvector/pgvector:pg16'
PREFIX="cocinacore-pr0b-canonical-$$"
TMP_ROOT=$(mktemp -d)
LOG="$TMP_ROOT/operation.log"
CONTAINER=
DB=
PORT=
ADMIN_PASSWORD=
MIGRATION_PASSWORD=
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
  printf '%s\n' "canonical email integration failure: $1" >&2
  exit 1
}

start_container() {
  suffix=$1
  DB=$2
  CONTAINER="$PREFIX-$suffix"
  ADMIN_PASSWORD=$(openssl rand -hex 18)
  MIGRATION_PASSWORD=$(openssl rand -hex 18)
  docker run -d --name "$CONTAINER" \
    -e POSTGRES_DB="$DB" -e POSTGRES_USER=cocinacore -e POSTGRES_PASSWORD="$ADMIN_PASSWORD" \
    -p 127.0.0.1::5432 "$IMAGE" >/dev/null
  attempt=0
  until docker exec "$CONTAINER" pg_isready -U cocinacore -d "$DB" >/dev/null 2>&1; do
    attempt=$((attempt + 1))
    [ "$attempt" -lt 60 ] || fail 'PostgreSQL did not become ready'
    sleep 1
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
  docker exec -i "$CONTAINER" psql -X -v ON_ERROR_STOP=1 -U cocinacore -d "$DB" -Atqc "$*"
}

admin_psql() {
  docker exec -i "$CONTAINER" psql -X -v ON_ERROR_STOP=1 -v VERBOSITY=verbose \
    -U cocinacore -d "$DB" "$@"
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

expect_sql_failure() {
  label=$1
  sqlstate=$2
  marker=$3
  sql=$4
  if admin_psql -c "$sql" >"$LOG" 2>&1; then
    fail "$label unexpectedly succeeded"
  fi
  grep -q "$sqlstate" "$LOG" || fail "$label did not report SQLSTATE $sqlstate"
  grep -q "$marker" "$LOG" || fail "$label did not report $marker"
}

historical_migrations() {
  node -e "const m=require(process.argv[1]); console.log(m.migrations.filter(x=>x.legacyChecksumBackfillAllowed).map(x=>x.filename).join('\\n'))" \
    "$ROOT/db/migrations/manifest.json"
}

apply_historical() {
  for filename in $(historical_migrations); do
    docker exec -i "$CONTAINER" psql -X -v ON_ERROR_STOP=1 -U cocinacore -d "$DB" \
      >/dev/null <"$ROOT/db/migrations/$filename"
  done
  admin_sql "create schema internal;
    create table public.schema_migrations(filename text primary key, applied_at timestamptz not null default now());
    alter table public.schema_migrations enable row level security;
    revoke all on public.schema_migrations from public;"
  for filename in $(historical_migrations); do
    admin_sql "insert into public.schema_migrations(filename) values ('$filename')"
  done
}

assert_failed_011_is_atomic() {
  before=$1
  marker=$2
  if migrate >"$LOG" 2>&1; then fail "$marker legacy collision migration succeeded"; fi
  grep -q CANONICAL_EMAIL_COLLISION "$LOG" || fail "$marker runner failure was not explicit"
  after=$(admin_sql "select string_agg(encode(convert_to(email,'UTF8'),'hex'),',' order by id) from public.users")
  [ "$after" = "$before" ] || fail "$marker collision changed legacy emails"
  [ "$(admin_sql "select count(*) from pg_constraint where conrelid='public.users'::regclass and conname='users_email_canonical_check'")" = 0 ] || fail "$marker collision left canonical constraint"
  [ "$(admin_sql "select count(*) from schema_migrations where filename='011_canonical_email_invariant.sql'")" = 0 ] || fail "$marker collision left migration ledger row"
  if { printf '%s\n' 'begin;'; cat "$ROOT/db/migrations/011_canonical_email_invariant.sql"; printf '%s\n' 'commit;'; } | \
     admin_psql >"$LOG" 2>&1; then
    fail "$marker direct migration unexpectedly succeeded"
  fi
  grep -q 23505 "$LOG" || fail "$marker preflight did not report SQLSTATE 23505"
  grep -q CANONICAL_EMAIL_COLLISION "$LOG" || fail "$marker preflight message changed"
}

# Fresh install and runtime invariant matrix.
start_container fresh cocinacore_canonical_fresh
provision >"$LOG" 2>&1
migrate >"$LOG" 2>&1
grep -q 'DONE 011_canonical_email_invariant.sql' "$LOG" || fail 'fresh 001-011 did not complete'
[ "$(admin_sql "select count(*) from schema_migrations")" = 11 ] || fail 'fresh ledger count is not 11'
[ "$(admin_sql "select count(*) from pg_constraint where conrelid='public.users'::regclass and conname='users_email_canonical_check'")" = 1 ] || fail 'canonical check is absent'
[ "$(admin_sql "select count(*) from pg_constraint where conrelid='public.users'::regclass and conname='users_email_key' and contype='u'")" = 1 ] || fail 'users_email_key is absent'
[ "$(admin_sql "select count(*) from pg_indexes where schemaname='public' and tablename='users' and indexname='idx_users_email'")" = 1 ] || fail 'idx_users_email is absent'

admin_sql "insert into public.users(email,password_hash) values ('canonical@example.com','hash')"
expect_sql_failure exact_duplicate 23505 users_email_key \
  "insert into public.users(email,password_hash) values (pg_catalog.lower(pg_catalog.btrim('canonical@example.com')),'hash')"
expect_sql_failure case_duplicate 23505 users_email_key \
  "insert into public.users(email,password_hash) values (pg_catalog.lower(pg_catalog.btrim('Canonical@Example.COM')),'hash')"
expect_sql_failure trim_duplicate 23505 users_email_key \
  "insert into public.users(email,password_hash) values (pg_catalog.lower(pg_catalog.btrim('  canonical@example.com  ')),'hash')"

admin_sql "insert into public.users(email,password_hash) values ('update-case-a@example.com','hash'),('update-case-b@example.com','hash')"
expect_sql_failure update_case_collision 23505 users_email_key \
  "update public.users set email=pg_catalog.lower(pg_catalog.btrim('UPDATE-CASE-A@EXAMPLE.COM')) where email='update-case-b@example.com'"
admin_sql "insert into public.users(email,password_hash) values ('update-trim-a@example.com','hash'),('update-trim-b@example.com','hash')"
expect_sql_failure update_trim_collision 23505 users_email_key \
  "update public.users set email=pg_catalog.lower(pg_catalog.btrim('  update-trim-a@example.com  ')) where email='update-trim-b@example.com'"

expect_sql_failure raw_noncanonical 23514 users_email_canonical_check \
  "insert into public.users(email,password_hash) values ('Raw@Example.com','hash')"
expect_sql_failure empty_email 23514 users_email_canonical_check \
  "insert into public.users(email,password_hash) values ('','hash')"
expect_sql_failure whitespace_email 23514 users_email_canonical_check \
  "insert into public.users(email,password_hash) values ('   ','hash')"
admin_sql "insert into public.users(email,password_hash) values ('distinct-one@example.com','hash'),('distinct-two@example.com','hash')"

# Invitation recipient text remains historical, while identity matching is canonical.
INVITATION_TENANT=$(admin_sql "insert into tenants(name) values ('canonical invitation') returning id")
INVITER=$(admin_sql "insert into users(email,password_hash,tenant_id,role) values ('inviter@example.com','hash','$INVITATION_TENANT','owner') returning id")
INVITEE=$(admin_sql "insert into users(email,password_hash) values ('invitee@example.com','hash') returning id")
admin_sql "insert into tenant_invitations(tenant_id,email,invited_by,invitation_token,expires_at) values ('$INVITATION_TENANT','  Invitee@Example.COM  ','$INVITER','canonical-token',now()+interval '1 day')"
[ "$(admin_sql "select public.accept_tenant_invitation('$INVITEE','canonical-token')")" = "$INVITATION_TENANT" ] || fail 'invitation canonical matching failed'

# Two real sessions contend for the same canonical unique key.
docker exec -e PGAPPNAME=canonical-email-winner -i "$CONTAINER" \
  psql -X -v ON_ERROR_STOP=1 -U cocinacore -d "$DB" -c \
  "begin; insert into public.users(email,password_hash) values (pg_catalog.lower(pg_catalog.btrim('Concurrent@Example.com')),'hash'); select pg_sleep(2); commit;" \
  >"$TMP_ROOT/concurrent-one.log" 2>&1 &
FIRST_PID=$!
attempt=0
until [ "$(admin_sql "select count(*) from pg_stat_activity where application_name='canonical-email-winner' and wait_event_type='Timeout'")" = 1 ]; do
  attempt=$((attempt + 1)); [ "$attempt" -lt 80 ] || fail 'concurrency winner did not reach synchronization point'; sleep 0.05
done
set +e
admin_psql -c "insert into public.users(email,password_hash) values (pg_catalog.lower(pg_catalog.btrim('  concurrent@example.COM  ')),'hash')" >"$TMP_ROOT/concurrent-two.log" 2>&1
SECOND_STATUS=$?
wait "$FIRST_PID"
FIRST_STATUS=$?
set -e
[ "$FIRST_STATUS" -eq 0 ] || fail 'first concurrent insert failed'
[ "$SECOND_STATUS" -ne 0 ] || fail 'both concurrent equivalent inserts succeeded'
grep -q 23505 "$TMP_ROOT/concurrent-two.log" || fail 'concurrent loser did not report 23505'
[ "$(admin_sql "select count(*) from users where email='concurrent@example.com'")" = 1 ] || fail 'concurrency final canonical identity count is not one'
stop_container

# Non-colliding legacy data normalizes and records 011 atomically.
start_container clean-upgrade cocinacore_canonical_clean
apply_historical
admin_sql "insert into users(email,password_hash) values ('Alice@Example.com','hash'),('  bob@example.com  ','hash')"
provision >"$LOG" 2>&1
migrate >"$LOG" 2>&1
grep -q 'DONE 011_canonical_email_invariant.sql' "$LOG" || fail 'noncolliding upgrade did not apply 011'
[ "$(admin_sql "select string_agg(email,',' order by email) from users")" = 'alice@example.com,bob@example.com' ] || fail 'noncolliding legacy emails were not normalized'
[ "$(admin_sql "select count(*) from schema_migrations where filename='011_canonical_email_invariant.sql'")" = 1 ] || fail 'noncolliding upgrade did not record 011'
[ "$(admin_sql "select count(*) from pg_constraint where conrelid='public.users'::regclass and conname='users_email_canonical_check'")" = 1 ] || fail 'noncolliding upgrade did not add canonical check'
provision >"$LOG" 2>&1
stop_container

# Case-only legacy collision fails before normalization and leaves no ledger row.
start_container case-collision cocinacore_canonical_case
apply_historical
admin_sql "insert into users(email,password_hash) values ('Alice@Example.com','hash'),('alice@example.com','hash')"
CASE_BEFORE=$(admin_sql "select string_agg(encode(convert_to(email,'UTF8'),'hex'),',' order by id) from users")
provision >"$LOG" 2>&1
assert_failed_011_is_atomic "$CASE_BEFORE" case
stop_container

# Surrounding-space legacy collision has the same atomic failure contract.
start_container trim-collision cocinacore_canonical_trim
apply_historical
admin_sql "insert into users(email,password_hash) values ('  bob@example.com  ','hash'),('bob@example.com','hash')"
TRIM_BEFORE=$(admin_sql "select string_agg(encode(convert_to(email,'UTF8'),'hex'),',' order by id) from users")
provision >"$LOG" 2>&1
assert_failed_011_is_atomic "$TRIM_BEFORE" trim
stop_container

[ "$(docker ps -a --format '{{.Names}}' | grep -c "^$PREFIX" || true)" = 0 ] || fail 'temporary containers remain'
printf '%s\n' 'canonical email integration passed: fresh duplicates updates bypass empties concurrency invitations legacy rollback'
