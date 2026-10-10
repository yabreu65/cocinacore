#!/usr/bin/env bash
set -Eeuo pipefail

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
IMAGE='pgvector/pgvector:pg16'
RUN_ID="$$-$(od -An -N4 -tx1 /dev/urandom | tr -d ' \n')"
CONTAINER="cocinacore-culinary-migration-${RUN_ID}"
LABEL_KEY='com.cocinacore.culinary-migration.run'
WORKSPACE=''
CONTAINER_CREATED=0
CONTAINER_ID=''
DOCKER_ENDPOINT=''
DOCKER=()
CONTAINER_LIST=''
CLEANUP_RUNNING=0

fail() {
  printf 'culinary migration integration failure: %s\n' "$1" >&2
  exit 1
}

refresh_container_list() {
  CONTAINER_LIST=$("${DOCKER[@]}" container ls -a --no-trunc --format '{{.ID}}|{{.Names}}')
}

container_list_has_id() {
  local wanted_id=$1
  local listed_id listed_name
  while IFS='|' read -r listed_id listed_name; do
    [[ "$listed_id" == "$wanted_id" ]] && return 0
  done <<< "$CONTAINER_LIST"
  return 1
}

container_list_name_id() {
  local wanted_name=$1
  local listed_id listed_name
  while IFS='|' read -r listed_id listed_name; do
    if [[ "$listed_name" == "$wanted_name" ]]; then
      printf '%s' "$listed_id"
      return 0
    fi
  done <<< "$CONTAINER_LIST"
  return 1
}

cleanup() {
  local status=$?
  local cleanup_failed=0
  if [[ "$CLEANUP_RUNNING" == 1 ]]; then return; fi
  CLEANUP_RUNNING=1
  trap - EXIT INT TERM
  if [[ "$CONTAINER_CREATED" == 1 ]]; then
    candidate_id=$CONTAINER_ID
    if [[ -z "$candidate_id" ]]; then
      if ! refresh_container_list; then
        printf 'cleanup failure: could not query Docker container list after failed start\n' >&2
        cleanup_failed=1
      else
        candidate_id=$(container_list_name_id "$CONTAINER" || true)
        if [[ -z "$candidate_id" ]]; then
          printf 'verified absent after successful container-list query: %s\n' "$CONTAINER"
        fi
      fi
    fi
    if [[ -n "$candidate_id" ]]; then
      if identity=$("${DOCKER[@]}" container inspect --format '{{.Config.Image}}|{{index .Config.Labels "com.cocinacore.culinary-migration.run"}}' "$candidate_id" 2>/dev/null); then
        if [[ "$identity" != "$IMAGE|$RUN_ID" ]]; then
          printf 'cleanup failure: container ID %s does not match expected image and run label; left untouched\n' "$candidate_id" >&2
          cleanup_failed=1
        else
          "${DOCKER[@]}" rm -f "$candidate_id" >/dev/null 2>&1 || true
          if ! refresh_container_list; then
            printf 'cleanup failure: could not verify removal of exact container ID %s\n' "$candidate_id" >&2
            cleanup_failed=1
          elif container_list_has_id "$candidate_id"; then
            printf 'cleanup failure: exact container ID %s remains in Docker container list\n' "$candidate_id" >&2
            cleanup_failed=1
          else
            printf 'removed and verified absent: %s\n' "$candidate_id"
          fi
        fi
      elif ! refresh_container_list; then
        printf 'cleanup failure: inspect failed and container list could not verify exact ID %s\n' "$candidate_id" >&2
        cleanup_failed=1
      elif container_list_has_id "$candidate_id"; then
        printf 'cleanup failure: inspect failed while exact container ID %s remains listed\n' "$candidate_id" >&2
        cleanup_failed=1
      else
        printf 'verified absent after successful container-list query: %s\n' "$candidate_id"
      fi
    fi
  fi
  if [[ -n "$WORKSPACE" ]]; then
    if ! rm -rf -- "$WORKSPACE"; then
      printf 'cleanup failure: could not remove exact temporary workspace\n' >&2
      cleanup_failed=1
    elif [[ -e "$WORKSPACE" || -L "$WORKSPACE" ]]; then
      printf 'cleanup failure: temporary workspace remains after removal\n' >&2
      cleanup_failed=1
    else
      printf 'removed and verified absent: temporary workspace\n'
    fi
  fi
  if [[ "$cleanup_failed" == 1 ]]; then status=1; fi
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

command -v docker >/dev/null 2>&1 || fail 'Docker CLI is unavailable.'
if [[ -n "${DOCKER_HOST+x}" || -n "${DOCKER_CONTEXT+x}" ]]; then
  fail 'DOCKER_HOST and DOCKER_CONTEXT overrides are not permitted by this local-only gate.'
fi
if ! DOCKER_CONTEXT_NAME=$(docker context show); then
  fail 'could not resolve the selected local Docker context.'
fi
if ! DOCKER_ENDPOINT=$(docker context inspect "$DOCKER_CONTEXT_NAME" --format '{{(index .Endpoints "docker").Host}}'); then
  fail 'could not inspect the selected Docker context endpoint.'
fi
[[ "$DOCKER_ENDPOINT" == unix://?* ]] || fail 'Docker context endpoint must use a local unix:// socket.'
DOCKER=(docker --host "$DOCKER_ENDPOINT")

if ! "${DOCKER[@]}" image inspect "$IMAGE" >/dev/null 2>&1; then
  fail "blocked: required local image $IMAGE is absent; this gate never pulls images or uses the network."
fi
if ! refresh_container_list; then
  fail 'could not query Docker containers before starting the integration harness.'
fi
if [[ -n "$(container_list_name_id "$CONTAINER" || true)" ]]; then
  fail "generated container name already exists: $CONTAINER"
fi

WORKSPACE=$(mktemp -d "${TMPDIR:-/tmp}/cocinacore-culinary-migration.XXXXXX")
MIGRATION_COPY="$WORKSPACE/migrations"
mkdir -p "$MIGRATION_COPY"
node - "$ROOT" "$MIGRATION_COPY" <<'NODE'
const fs = require('node:fs');
const path = require('node:path');
const [root, target] = process.argv.slice(2);
const sourceDir = path.join(root, 'db/migrations');
const manifest = JSON.parse(fs.readFileSync(path.join(sourceDir, 'manifest.json'), 'utf8'));
const historical = manifest.migrations.slice(0, 12);
if (historical.length !== 12 || historical.some((entry, index) => entry.id !== String(index + 1).padStart(3, '0'))) {
  throw new Error('Expected contiguous original migrations 001–012.');
}
for (const entry of historical) {
  const bytes = fs.readFileSync(path.join(sourceDir, entry.filename));
  if (bytes.length !== entry.byteLength || require('node:crypto').createHash('sha256').update(bytes).digest('hex') !== entry.sha256) {
    throw new Error(`Source migration integrity mismatch: ${entry.filename}`);
  }
  fs.writeFileSync(path.join(target, entry.filename), bytes);
}
fs.writeFileSync(path.join(target, 'manifest.json'), `${JSON.stringify({ ...manifest, migrations: historical }, null, 2)}\n`);
NODE

DB_ADMIN='postgres'
DB_PASSWORD='local_ephemeral_only_7c1e'
LEGACY_DB='culinary_legacy_test'
FRESH_DB='culinary_fresh_test'

CONTAINER_CREATED=1
# Arm cleanup before docker run; a failed start is discovered by exact name only if no ID was returned.
if ! CONTAINER_ID=$("${DOCKER[@]}" run --pull=never --rm --detach --name "$CONTAINER" --label "$LABEL_KEY=$RUN_ID" \
  --env "POSTGRES_USER=$DB_ADMIN" --env "POSTGRES_PASSWORD=$DB_PASSWORD" --env "POSTGRES_DB=$LEGACY_DB" \
  --publish '127.0.0.1::5432' --tmpfs '/var/lib/postgresql/data:rw,noexec,nosuid,size=1g' \
  "$IMAGE"); then
  CONTAINER_ID=''
  fail 'docker run failed before returning a container ID.'
fi
[[ -n "$CONTAINER_ID" ]] || fail 'docker run returned an empty container ID.'
identity=$("${DOCKER[@]}" container inspect --format '{{.Config.Image}}|{{index .Config.Labels "com.cocinacore.culinary-migration.run"}}' "$CONTAINER_ID")
[[ "$identity" == "$IMAGE|$RUN_ID" ]] || fail 'started container ID does not match the expected image and unique run label.'

mounts=$("${DOCKER[@]}" exec "$CONTAINER_ID" sh -c 'while read -r device destination filesystem options dump pass; do
  if [ "$destination" = "/var/lib/postgresql/data" ]; then
    printf "%s %s\n" "$filesystem" "$destination"
  fi
done < /proc/mounts')
mount_lines=()
data_mount_count=0
data_mount_type=''
while IFS= read -r mount_line; do
  [[ -z "$mount_line" ]] && continue
  mount_lines+=("$mount_line")
  read -r mount_type mount_destination <<< "$mount_line"
  if [[ "$mount_destination" == '/var/lib/postgresql/data' ]]; then
    ((data_mount_count += 1))
    data_mount_type=$mount_type
  fi
done <<< "$mounts"
if [[ "$data_mount_count" != 1 || "$data_mount_type" != 'tmpfs' ]]; then
  printf 'observed data mount records (type destination; first 10 records):\n' >&2
  if [[ "${#mount_lines[@]}" == 0 ]]; then
    printf '  no matching data mount records\n' >&2
  else
    for ((mount_index = 0; mount_index < ${#mount_lines[@]} && mount_index < 10; mount_index++)); do
      printf '  %s\n' "${mount_lines[$mount_index]}" >&2
    done
  fi
  fail 'container must have exactly one tmpfs mount at /var/lib/postgresql/data.'
fi
published=$("${DOCKER[@]}" container inspect --format '{{(index (index .NetworkSettings.Ports "5432/tcp") 0).HostIp}}:{{(index (index .NetworkSettings.Ports "5432/tcp") 0).HostPort}}' "$CONTAINER_ID")
if [[ "$published" != 127.0.0.1:* ]]; then fail 'PostgreSQL is not published exclusively on loopback.'; fi
HOST_PORT=${published##*:}

ready=0
for attempt in $(seq 1 60); do
  if "${DOCKER[@]}" exec -e "PGPASSWORD=$DB_PASSWORD" "$CONTAINER_ID" pg_isready -U "$DB_ADMIN" -d "$LEGACY_DB" >/dev/null 2>&1; then
    ready=1
    break
  fi
  sleep 1
done
[[ "$ready" == 1 ]] || fail 'temporary PostgreSQL did not become ready.'

legacy_url="postgresql://${DB_ADMIN}:${DB_PASSWORD}@127.0.0.1:${HOST_PORT}/${LEGACY_DB}"
fresh_url="postgresql://${DB_ADMIN}:${DB_PASSWORD}@127.0.0.1:${HOST_PORT}/${FRESH_DB}"

run_migrations() {
  local url=$1
  shift
  env DATABASE_URL="$url" COCINACORE_SEPARATED_DB_LANES_ENABLED=false COCINACORE_SKIP_DOTENV=1 "$@"
}

printf 'Testing legacy 001–012 migration ledger...\n'
MIGRATIONS_DIR="$MIGRATION_COPY" run_migrations "$legacy_url" node "$ROOT/frontend/scripts/run-migrations.js"
legacy_count=$("${DOCKER[@]}" exec -e "PGPASSWORD=$DB_PASSWORD" "$CONTAINER_ID" psql -At -U "$DB_ADMIN" -d "$LEGACY_DB" \
  -c 'SELECT count(*) FROM public.schema_migrations;')
[[ "$legacy_count" == 12 ]] || fail "legacy ledger should contain exactly 12 entries (observed $legacy_count)."

verify_output="$WORKSPACE/verify-pending.log"
set +e
env -u MIGRATIONS_DIR DATABASE_URL="$legacy_url" COCINACORE_SEPARATED_DB_LANES_ENABLED=false COCINACORE_SKIP_DOTENV=1 \
  node "$ROOT/frontend/scripts/run-migrations.js" --verify-complete >"$verify_output" 2>&1
verify_status=$?
set -e
if [[ "$verify_status" != 1 ]] || [[ $(grep -Fxc 'Migration failed: Pending migration: 013_culinary_profile_context.sql (migration lane).' "$verify_output" || true) != 1 ]] || \
  [[ $(grep -Fc 'Pending migration:' "$verify_output" || true) != 1 ]]; then
  printf 'Expected verify-complete to report the first pending migration 013 (before 014; exit 1); bounded diagnostic follows:\n' >&2
  tail -n 8 "$verify_output" >&2
  fail 'legacy first-pending migration assertion failed.'
fi

printf 'Applying migrations 013 and 014 to legacy ledger...\n'
env -u MIGRATIONS_DIR DATABASE_URL="$legacy_url" COCINACORE_SEPARATED_DB_LANES_ENABLED=false COCINACORE_SKIP_DOTENV=1 \
  node "$ROOT/frontend/scripts/run-migrations.js"
env -u MIGRATIONS_DIR DATABASE_URL="$legacy_url" COCINACORE_SEPARATED_DB_LANES_ENABLED=false COCINACORE_SKIP_DOTENV=1 \
  node "$ROOT/frontend/scripts/run-migrations.js" --verify-complete
env -u MIGRATIONS_DIR DATABASE_URL="$legacy_url" COCINACORE_SEPARATED_DB_LANES_ENABLED=false COCINACORE_SKIP_DOTENV=1 \
  node "$ROOT/frontend/scripts/run-migrations.js"

printf 'Testing fresh full-manifest migration path...\n'
"${DOCKER[@]}" exec -e "PGPASSWORD=$DB_PASSWORD" "$CONTAINER_ID" createdb -U "$DB_ADMIN" "$FRESH_DB"
env -u MIGRATIONS_DIR DATABASE_URL="$fresh_url" COCINACORE_SEPARATED_DB_LANES_ENABLED=false COCINACORE_SKIP_DOTENV=1 \
  node "$ROOT/frontend/scripts/run-migrations.js"
env -u MIGRATIONS_DIR DATABASE_URL="$fresh_url" COCINACORE_SEPARATED_DB_LANES_ENABLED=false COCINACORE_SKIP_DOTENV=1 \
  node "$ROOT/frontend/scripts/run-migrations.js" --verify-complete

PREFLIGHT_DB="culinary_preflight_${RUN_ID//-/_}"
PREFLIGHT_COPY="$WORKSPACE/preflight-migrations"
mkdir -p "$PREFLIGHT_COPY"
node - "$ROOT" "$PREFLIGHT_COPY" <<'NODE'
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const [root, target] = process.argv.slice(2);
const sourceDir = path.join(root, 'db/migrations');
const manifest = JSON.parse(fs.readFileSync(path.join(sourceDir, 'manifest.json'), 'utf8'));
const migrations = manifest.migrations.slice(0, 13);
if (migrations.length !== 13 || migrations.some((entry, index) => entry.id !== String(index + 1).padStart(3, '0'))) {
  throw new Error('Expected contiguous migrations 001–013.');
}
for (const entry of migrations) {
  const bytes = fs.readFileSync(path.join(sourceDir, entry.filename));
  if (bytes.length !== entry.byteLength || crypto.createHash('sha256').update(bytes).digest('hex') !== entry.sha256) {
    throw new Error(`Source migration integrity mismatch: ${entry.filename}`);
  }
  fs.writeFileSync(path.join(target, entry.filename), bytes);
}
fs.writeFileSync(path.join(target, 'manifest.json'), `${JSON.stringify({ ...manifest, migrations }, null, 2)}\n`);
NODE

printf 'Testing migration 014 fail-closed behavior on invalid pre-existing rows...\n'
"${DOCKER[@]}" exec "$CONTAINER_ID" createdb -U "$DB_ADMIN" "$PREFLIGHT_DB"
preflight_url="postgresql://${DB_ADMIN}:${DB_PASSWORD}@127.0.0.1:${HOST_PORT}/${PREFLIGHT_DB}"
MIGRATIONS_DIR="$PREFLIGHT_COPY" run_migrations "$preflight_url" node "$ROOT/frontend/scripts/run-migrations.js"
IFS=' ' read -r preflight_tenant_id preflight_user_id preflight_term_1 preflight_term_2 preflight_term_3 preflight_term_4 preflight_term_5 preflight_term_6 preflight_term_7 <<< "$(node -e "const { randomUUID } = require('node:crypto'); console.log(Array.from({ length: 9 }, () => randomUUID()).join(' '))")"
"${DOCKER[@]}" exec -i -e "PGPASSWORD=$DB_PASSWORD" "$CONTAINER_ID" psql -v ON_ERROR_STOP=1 -U "$DB_ADMIN" -d "$PREFLIGHT_DB" \
  -v tenant_id="$preflight_tenant_id" -v user_id="$preflight_user_id" \
  -v term_1="$preflight_term_1" -v term_2="$preflight_term_2" -v term_3="$preflight_term_3" -v term_4="$preflight_term_4" \
  -v term_5="$preflight_term_5" -v term_6="$preflight_term_6" -v term_7="$preflight_term_7" <<'SQL'
insert into public.tenants (id, tenant_type, name) values (:'tenant_id'::uuid, 'home', 'Migration 014 preflight fixture');
insert into public.users (id, email, password_hash, full_name, tenant_id, role, onboarding_completed)
values (:'user_id'::uuid, 'migration-preflight-' || :'user_id' || '@integration.invalid', 'integration-only', 'Preflight fixture', :'tenant_id'::uuid, 'owner', false);
insert into public.user_culinary_profiles (user_id, tenant_id, allergies)
values (:'user_id'::uuid, :'tenant_id'::uuid, array_fill('preflight-allergy'::text, array[21]));
insert into public.culinary_terms (id, dimension_id, label, is_active)
select fixture.term_id::uuid, dimensions.id, 'Migration preflight cuisine ' || fixture.ordinality, true
  from (values
    (:'term_1', 1), (:'term_2', 2), (:'term_3', 3), (:'term_4', 4),
    (:'term_5', 5), (:'term_6', 6), (:'term_7', 7)
  ) as fixture(term_id, ordinality)
  cross join public.culinary_dimensions as dimensions
 where dimensions.key = 'cuisine';
insert into public.user_culinary_profile_terms (user_id, term_id, preference_type)
select :'user_id'::uuid, fixture.term_id::uuid, 'identity'
  from (values
    (:'term_1'), (:'term_2'), (:'term_3'), (:'term_4'), (:'term_5'), (:'term_6'), (:'term_7')
  ) as fixture(term_id);
SQL
preflight_seeded_terms=$("${DOCKER[@]}" exec -i -e "PGPASSWORD=$DB_PASSWORD" "$CONTAINER_ID" psql -At -v ON_ERROR_STOP=1 -U "$DB_ADMIN" -d "$PREFLIGHT_DB" \
  -v user_id="$preflight_user_id" -v term_1="$preflight_term_1" -v term_2="$preflight_term_2" -v term_3="$preflight_term_3" \
  -v term_4="$preflight_term_4" -v term_5="$preflight_term_5" -v term_6="$preflight_term_6" -v term_7="$preflight_term_7" <<'SQL'
select count(*) from public.user_culinary_profile_terms where user_id = :'user_id'::uuid and term_id in
    (:'term_1'::uuid, :'term_2'::uuid, :'term_3'::uuid, :'term_4'::uuid, :'term_5'::uuid, :'term_6'::uuid, :'term_7'::uuid);
SQL
)
[[ "$preflight_seeded_terms" == 7 ]] || fail "could not seed all seven exact cuisine-term violations (observed $preflight_seeded_terms)."
preflight_014_log="$WORKSPACE/preflight-014-field.log"
set +e
env -u MIGRATIONS_DIR DATABASE_URL="$preflight_url" COCINACORE_SEPARATED_DB_LANES_ENABLED=false COCINACORE_SKIP_DOTENV=1 \
  node "$ROOT/frontend/scripts/run-migrations.js" >"$preflight_014_log" 2>&1
preflight_014_status=$?
set -e
if [[ "$preflight_014_status" == 0 ]] || ! grep -Fq 'user_culinary_profiles_allergies_bounds_check' "$preflight_014_log"; then
  printf 'Expected migration 014 field-bound failure (exit nonzero); bounded diagnostic follows:\n' >&2
  tail -n 8 "$preflight_014_log" >&2
  fail 'migration 014 did not fail on the pre-existing 21-item allergies array.'
fi
preflight_ledger=$("${DOCKER[@]}" exec -e "PGPASSWORD=$DB_PASSWORD" "$CONTAINER_ID" psql -At -U "$DB_ADMIN" -d "$PREFLIGHT_DB" \
  -c 'select count(*) from public.schema_migrations;')
[[ "$preflight_ledger" == 13 ]] || fail "failed migration 014 changed the 13-entry ledger (observed $preflight_ledger)."
unchanged_allergies=$("${DOCKER[@]}" exec -i -e "PGPASSWORD=$DB_PASSWORD" "$CONTAINER_ID" psql -At -v ON_ERROR_STOP=1 -U "$DB_ADMIN" -d "$PREFLIGHT_DB" \
  -v user_id="$preflight_user_id" <<'SQL'
select allergies = array_fill('preflight-allergy'::text, array[21]) from public.user_culinary_profiles where user_id = :'user_id'::uuid;
SQL
)
[[ "$unchanged_allergies" == t ]] || fail 'failed migration 014 rewrote the invalid allergies array.'
preflight_014_objects=$("${DOCKER[@]}" exec -e "PGPASSWORD=$DB_PASSWORD" "$CONTAINER_ID" psql -At -U "$DB_ADMIN" -d "$PREFLIGHT_DB" -c "
  select
    (select count(*) from pg_catalog.pg_constraint where conname in (
      'users_full_name_length_check', 'user_culinary_profiles_level_check',
      'user_culinary_profiles_allergies_bounds_check', 'user_culinary_profiles_disliked_ingredients_bounds_check',
      'user_culinary_profiles_household_members_shape_check')) +
    (select count(*) from pg_catalog.pg_proc where proname in (
      'is_valid_culinary_profile_text_list', 'is_valid_culinary_household_members',
      'enforce_culinary_profile_term_group_limit', 'prevent_culinary_profile_taxonomy_reclassification')) +
    (select count(*) from pg_catalog.pg_trigger where not tgisinternal and tgname in (
      'user_culinary_profile_terms_group_limit_trigger', 'culinary_terms_profile_dimension_immutable_trigger',
      'culinary_dimensions_profile_key_immutable_trigger'));")
[[ "$preflight_014_objects" == 0 ]] || fail "failed migration 014 left $preflight_014_objects constraints/functions/triggers behind."
"${DOCKER[@]}" exec -i -e "PGPASSWORD=$DB_PASSWORD" "$CONTAINER_ID" psql -v ON_ERROR_STOP=1 -U "$DB_ADMIN" -d "$PREFLIGHT_DB" \
  -v user_id="$preflight_user_id" <<'SQL'
update public.user_culinary_profiles set allergies = '{}' where user_id = :'user_id'::uuid;
SQL
preflight_aggregate_log="$WORKSPACE/preflight-014-aggregate.log"
set +e
env -u MIGRATIONS_DIR DATABASE_URL="$preflight_url" COCINACORE_SEPARATED_DB_LANES_ENABLED=false COCINACORE_SKIP_DOTENV=1 \
  node "$ROOT/frontend/scripts/run-migrations.js" >"$preflight_aggregate_log" 2>&1
preflight_aggregate_status=$?
set -e
if [[ "$preflight_aggregate_status" == 0 ]] || ! grep -Fq 'Existing culinary profile term group violates limit' "$preflight_aggregate_log"; then
  printf 'Expected migration 014 aggregate-preflight failure (exit nonzero); bounded diagnostic follows:\n' >&2
  tail -n 8 "$preflight_aggregate_log" >&2
  fail 'migration 014 did not fail on the pre-existing seven-term cuisine group.'
fi
preflight_ledger=$("${DOCKER[@]}" exec -e "PGPASSWORD=$DB_PASSWORD" "$CONTAINER_ID" psql -At -U "$DB_ADMIN" -d "$PREFLIGHT_DB" \
  -c 'select count(*) from public.schema_migrations;')
[[ "$preflight_ledger" == 13 ]] || fail "aggregate-preflight failure changed the 13-entry ledger (observed $preflight_ledger)."
preflight_terms=$("${DOCKER[@]}" exec -i -e "PGPASSWORD=$DB_PASSWORD" "$CONTAINER_ID" psql -At -v ON_ERROR_STOP=1 -U "$DB_ADMIN" -d "$PREFLIGHT_DB" \
  -v user_id="$preflight_user_id" -v term_1="$preflight_term_1" -v term_2="$preflight_term_2" -v term_3="$preflight_term_3" \
  -v term_4="$preflight_term_4" -v term_5="$preflight_term_5" -v term_6="$preflight_term_6" -v term_7="$preflight_term_7" <<'SQL'
select count(*) from public.user_culinary_profile_terms where user_id = :'user_id'::uuid and term_id in
    (:'term_1'::uuid, :'term_2'::uuid, :'term_3'::uuid, :'term_4'::uuid, :'term_5'::uuid, :'term_6'::uuid, :'term_7'::uuid);
SQL
)
[[ "$preflight_terms" == 7 ]] || fail "aggregate-preflight failure rewrote seven exact term selections (observed $preflight_terms)."
preflight_014_objects=$("${DOCKER[@]}" exec -e "PGPASSWORD=$DB_PASSWORD" "$CONTAINER_ID" psql -At -U "$DB_ADMIN" -d "$PREFLIGHT_DB" -c "
  select
    (select count(*) from pg_catalog.pg_constraint where conname in (
      'users_full_name_length_check', 'user_culinary_profiles_level_check',
      'user_culinary_profiles_allergies_bounds_check', 'user_culinary_profiles_disliked_ingredients_bounds_check',
      'user_culinary_profiles_household_members_shape_check')) +
    (select count(*) from pg_catalog.pg_proc where proname in (
      'is_valid_culinary_profile_text_list', 'is_valid_culinary_household_members',
      'enforce_culinary_profile_term_group_limit', 'prevent_culinary_profile_taxonomy_reclassification')) +
    (select count(*) from pg_catalog.pg_trigger where not tgisinternal and tgname in (
      'user_culinary_profile_terms_group_limit_trigger', 'culinary_terms_profile_dimension_immutable_trigger',
      'culinary_dimensions_profile_key_immutable_trigger'));")
[[ "$preflight_014_objects" == 0 ]] || fail "aggregate-preflight failure left $preflight_014_objects constraints/functions/triggers behind."

printf 'Testing PostgreSQL profile update atomicity...\n'
(
  cd "$ROOT/frontend"
  env DATABASE_URL="$fresh_url" COCINACORE_SEPARATED_DB_LANES_ENABLED=false COCINACORE_SKIP_DOTENV=1 \
    COCINACORE_RUN_PROFILE_ATOMICITY_DB_TEST=1 \
    ./node_modules/.bin/vitest run src/lib/db/repositories/profile-update-atomicity.integration.test.ts
)

printf 'Testing PostgreSQL profile field constraints integration...\n'
(
  cd "$ROOT/frontend"
  env DATABASE_URL="$fresh_url" COCINACORE_SEPARATED_DB_LANES_ENABLED=false COCINACORE_SKIP_DOTENV=1 \
    COCINACORE_RUN_PROFILE_FIELD_CONSTRAINTS_DB_TEST=1 \
    ./node_modules/.bin/vitest run src/lib/db/repositories/profile-field-constraints.integration.test.ts
)

printf 'Legacy, fresh migration, profile atomicity, and field constraints integration checks passed.\n'
