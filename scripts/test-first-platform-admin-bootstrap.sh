#!/usr/bin/env bash
set -Eeuo pipefail

ROOT=$(cd -- "$(dirname -- "$0")/.." && pwd)
NODE_22=/Users/yoryiabreu/.nvm/versions/node/v22.22.3/bin/node
IMAGE=pgvector/pgvector:pg16
DATABASE=first_admin_disposable
PREFIX="cocinacore-first-admin-$$-$(openssl rand -hex 3)"
CONTAINER="${PREFIX}-pg"
ADMIN_PASSWORD=$(openssl rand -hex 20)
MIGRATION_PASSWORD=$(openssl rand -hex 20)
RUNTIME_PASSWORD=$(openssl rand -hex 20)
AUTH_PASSWORD=$(openssl rand -hex 20)
METRICS_PASSWORD=$(openssl rand -hex 20)
WRITER_PASSWORD=$(openssl rand -hex 20)
FIRST_ADMIN_PROVISIONER_PASSWORD=$(openssl rand -hex 32)
PORT=
STAGE=preflight

fail() {
  printf 'FAIL first-platform-admin stage=%s reason=%s\n' "$STAGE" "$1" >&2
  exit 1
}
cleanup() {
  local status=$?
  trap - EXIT INT TERM
  if [[ -n "$CONTAINER" ]]; then
    local label
    label=$(docker --context desktop-linux inspect --format '{{index .Config.Labels "cocinacore.first-admin.disposable"}}' "$CONTAINER" 2>/dev/null || true)
    if [[ "$label" == "$PREFIX" ]]; then
      docker --context desktop-linux rm -f "$CONTAINER" >/dev/null || status=1
    elif docker --context desktop-linux inspect "$CONTAINER" >/dev/null 2>&1; then
      printf '%s\n' 'FAIL cleanup refused unexpected container ownership' >&2
      status=1
    fi
  fi
  if docker --context desktop-linux ps -a --format '{{.Names}}' | grep -q "^${PREFIX}-"; then
    printf '%s\n' 'FAIL disposable container remains after cleanup' >&2
    status=1
  fi
  exit "$status"
}
trap cleanup EXIT INT TERM

[[ -x "$NODE_22" && "$($NODE_22 --version)" == v22.22.3 ]] || fail 'Node 22.22.3 is required'
[[ "$(df -Pk "$ROOT" | awk 'END {print $4}')" -gt 6291456 ]] || fail 'more than 6 GiB free space is required'
unset DOCKER_HOST DOCKER_CONTEXT DOCKER_TLS_VERIFY DOCKER_CERT_PATH
docker --context desktop-linux image inspect "$IMAGE" >/dev/null 2>&1 || fail 'cached PostgreSQL 16 image is required; image pulls are disabled'
[[ "$(docker --context desktop-linux context inspect desktop-linux --format '{{.Endpoints.docker.Host}}')" == unix://* ]] || fail 'local Docker socket required'
docker --context desktop-linux run --pull=never --rm -d --name "$CONTAINER" \
  --label "cocinacore.first-admin.disposable=$PREFIX" \
  -e POSTGRES_DB="$DATABASE" -e POSTGRES_USER=cocinacore -e POSTGRES_PASSWORD="$ADMIN_PASSWORD" \
  --tmpfs /var/lib/postgresql/data:rw,nosuid,size=512m -p 127.0.0.1::5432 "$IMAGE" >/dev/null
[[ "$(docker --context desktop-linux inspect --format '{{len .Mounts}}' "$CONTAINER")" == 0 ]] || fail 'database must have no persistent mounts'
[[ "$(docker --context desktop-linux inspect --format '{{index .HostConfig.Tmpfs "/var/lib/postgresql/data"}}' "$CONTAINER")" == 'rw,nosuid,size=512m' ]] || fail 'database must use the isolated tmpfs mount'
PORT=$(docker --context desktop-linux port "$CONTAINER" 5432/tcp | sed 's/.*://')
[[ "$PORT" =~ ^[0-9]+$ ]] || fail 'loopback port allocation failed'
ADMIN_URL="postgresql://cocinacore:$ADMIN_PASSWORD@127.0.0.1:$PORT/$DATABASE"
MIGRATION_URL="postgresql://migration_admin:$MIGRATION_PASSWORD@127.0.0.1:$PORT/$DATABASE"
RUNTIME_URL="postgresql://cocinacore_runtime_rls:$RUNTIME_PASSWORD@127.0.0.1:$PORT/$DATABASE"
AUTH_URL="postgresql://cocinacore_auth:$AUTH_PASSWORD@127.0.0.1:$PORT/$DATABASE"
PROVISIONER_URL="postgresql://cocinacore_first_admin_provisioner:$FIRST_ADMIN_PROVISIONER_PASSWORD@127.0.0.1:$PORT/$DATABASE"
for ((attempt=0; attempt<60; attempt++)); do
  if docker --context desktop-linux exec "$CONTAINER" pg_isready -h 127.0.0.1 -U cocinacore -d "$DATABASE" >/dev/null 2>&1; then break; fi
  sleep 1
done
docker --context desktop-linux exec "$CONTAINER" psql -X -v ON_ERROR_STOP=1 -U cocinacore -d "$DATABASE" \
  -c 'create role cocinacore_user nologin nosuperuser nobypassrls nocreatedb nocreaterole noinherit noreplication' >/dev/null
docker --context desktop-linux exec "$CONTAINER" psql -X -v ON_ERROR_STOP=1 -U cocinacore -d "$DATABASE" \
  -c "comment on database $DATABASE is 'cocinacore-first-admin-disposable'" >/dev/null

STAGE=database-provisioning
COCINACORE_SKIP_DOTENV=1 COCINACORE_SEPARATED_DB_LANES_ENABLED=true \
  BOOTSTRAP_DATABASE_URL="$ADMIN_URL" MIGRATION_ADMIN_PASSWORD="$MIGRATION_PASSWORD" \
  "$NODE_22" "$ROOT/frontend/scripts/provision-database.js"

run_migration() {
  if [[ -n "$1" ]]; then
    COCINACORE_SKIP_DOTENV=1 COCINACORE_SEPARATED_DB_LANES_ENABLED=true \
      MIGRATION_DATABASE_URL="$MIGRATION_URL" MIGRATION_EXPECTED_PENDING="$1" \
      "$NODE_22" "$ROOT/frontend/scripts/run-migrations.js" --lane migration "${@:2}"
  else
    COCINACORE_SKIP_DOTENV=1 COCINACORE_SEPARATED_DB_LANES_ENABLED=true \
      MIGRATION_DATABASE_URL="$MIGRATION_URL" \
      "$NODE_22" "$ROOT/frontend/scripts/run-migrations.js" --lane migration "${@:2}"
  fi
}
STAGE=migrations-001-019
run_migration '' --stop-after 019
[[ "$(docker --context desktop-linux exec "$CONTAINER" psql -X -U cocinacore -d "$DATABASE" -Atqc 'select count(*) from public.schema_migrations')" == 19 ]] || fail 'expected exact 001-019 ledger'

STAGE=restricted-role-preparation
for role_pass in runtime auth; do
  if [[ "$role_pass" == runtime ]]; then
    docker --context desktop-linux exec -i "$CONTAINER" psql -X -v ON_ERROR_STOP=1 -v "runtime_password=$RUNTIME_PASSWORD" -U cocinacore -d "$DATABASE" <"$ROOT/scripts/provision-runtime-role.sql" >/dev/null
  else
    docker --context desktop-linux exec -i "$CONTAINER" psql -X -v ON_ERROR_STOP=1 -v "auth_password=$AUTH_PASSWORD" -U cocinacore -d "$DATABASE" <"$ROOT/scripts/provision-auth-role.sql" >/dev/null
  fi
done
docker --context desktop-linux exec -i "$CONTAINER" psql -X -1 -v ON_ERROR_STOP=1 \
  -v "metrics_password=$METRICS_PASSWORD" -v "global_writer_password=$WRITER_PASSWORD" \
  -U cocinacore -d "$DATABASE" <"$ROOT/scripts/provision-020-inert-capabilities.sql" >/dev/null
docker --context desktop-linux exec -i "$CONTAINER" psql -X -v ON_ERROR_STOP=1 -U cocinacore -d "$DATABASE" \
  <"$ROOT/scripts/rls-candidates/020e-a1-inert-capability-guard.sql" >/dev/null

STAGE=migration-020
PENDING_020='020_tenant_rls_hardening.sql,021_inventory_price_reference.sql,022_real_consumption_occurrences.sql,023_inventory_movement_retention.sql,024_first_platform_admin_bootstrap.sql'
run_migration "$PENDING_020" --stop-after 020
STAGE=activation-020
COCINACORE_ACTIVATION_DATABASE_URL="$ADMIN_URL" "$NODE_22" "$ROOT/frontend/scripts/activate-020-capabilities.js"

STAGE=migrations-021-023
PENDING_021='021_inventory_price_reference.sql,022_real_consumption_occurrences.sql,023_inventory_movement_retention.sql,024_first_platform_admin_bootstrap.sql'
run_migration "$PENDING_021" --stop-after 023

STAGE=first-admin-role-preparation
# Feed only disposable fixture answers to the real psql prompt script.
docker --context desktop-linux cp "$ROOT/scripts/provision-first-platform-admin-roles.sql" \
  "$CONTAINER:/tmp/provision-first-platform-admin-roles.sql" >/dev/null
printf '%s\n%s\n%s\n' "$DATABASE" "$FIRST_ADMIN_PROVISIONER_PASSWORD" "$FIRST_ADMIN_PROVISIONER_PASSWORD" |
  docker --context desktop-linux exec -i "$CONTAINER" psql -X -v ON_ERROR_STOP=1 -U cocinacore -d "$DATABASE" \
    -f /tmp/provision-first-platform-admin-roles.sql >/dev/null

STAGE=migration-024
run_migration '024_first_platform_admin_bootstrap.sql' --stop-after 024
STAGE=verify-complete
COCINACORE_SKIP_DOTENV=1 COCINACORE_SEPARATED_DB_LANES_ENABLED=true MIGRATION_DATABASE_URL="$MIGRATION_URL" \
  "$NODE_22" "$ROOT/frontend/scripts/run-migrations.js" --lane migration --verify-complete

STAGE=provisioner-rerun
COCINACORE_SKIP_DOTENV=1 COCINACORE_SEPARATED_DB_LANES_ENABLED=true \
  BOOTSTRAP_DATABASE_URL="$ADMIN_URL" MIGRATION_ADMIN_PASSWORD="$MIGRATION_PASSWORD" \
  "$NODE_22" "$ROOT/frontend/scripts/provision-database.js"
OWNER_STATE=$(docker --context desktop-linux exec "$CONTAINER" psql -X -U cocinacore -d "$DATABASE" -Atqc \
  "select pg_catalog.pg_get_userbyid(p.proowner)||'|'||pg_catalog.pg_get_userbyid(c.relowner) from pg_catalog.pg_proc p, pg_catalog.pg_class c where p.oid='public.provision_first_platform_administrator(text,text,text,text)'::pg_catalog.regprocedure and c.oid='public.first_platform_admin_bootstrap_claim'::pg_catalog.regclass")
[[ "$OWNER_STATE" == 'cocinacore_first_admin_function_owner|cocinacore_schema_owner' ]] || fail 'provisioner re-run changed the exact 024 function/table owners'

STAGE=first-admin-integration
(
  cd "$ROOT/frontend"
  COCINACORE_SKIP_DOTENV=1 COCINACORE_SEPARATED_DB_LANES_ENABLED=true \
    COCINACORE_FIRST_ADMIN_BOOTSTRAP_TEST=1 \
    SIGNUP_TEST_ADMIN_URL="$ADMIN_URL" FIRST_ADMIN_PROVISIONER_URL="$PROVISIONER_URL" \
    AUTH_DATABASE_URL="$AUTH_URL" DATABASE_URL="$RUNTIME_URL" \
    "$NODE_22" node_modules/vitest/vitest.mjs run \
      src/lib/db/repositories/first-platform-admin-bootstrap.integration.test.ts \
      --maxWorkers=1 --reporter=dot
)
STAGE=installer-contract
"$NODE_22" --test "$ROOT/frontend/scripts/bootstrap-first-platform-admin.test.js"
printf '%s\n' 'PASS first platform-admin provisioning on canonical migrations 001-024; no persistent database or live credentials were used.'
