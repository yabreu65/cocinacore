#!/usr/bin/env bash
# Private PostgreSQL only; no persistent mounts, remote daemon, image pulls or staging.
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
# shellcheck source=/dev/null
source "$NVM_DIR/nvm.sh"
nvm use 22.22.3 >/dev/null
[[ $(node -p 'process.version') == v22.22.3 ]]
node -e 'const {execFileSync}=require("node:child_process"); if(execFileSync(process.execPath,["-p","process.version"],{encoding:"utf8"}).trim()!=="v22.22.3")process.exit(1)'
check_space() {
  local available
  available=$(df -Pk "$ROOT" | awk 'END {print $4}')
  printf 'APFS available: %s KiB\n' "$available"
  [[ "$available" -gt 6291456 ]] || { echo 'STOP: free space must exceed 6 GiB' >&2; return 1; }
}
rls_state_fingerprint() {
  {
    "${DOCKER[@]}" exec "$CID" pg_dumpall -U postgres --globals-only
    "${DOCKER[@]}" exec "$CID" pg_dump -U postgres -d signup_real_disposable --schema-only
    "${DOCKER[@]}" exec "$CID" psql -X -U postgres -d signup_real_disposable -Atc \
      "select 'tenants:' || coalesce(jsonb_agg(to_jsonb(t) order by t.id)::text, '[]') from public.tenants t;
       select 'users:' || coalesce(jsonb_agg(to_jsonb(u) order by u.id)::text, '[]') from public.users u;
       select 'memberships:' || coalesce(jsonb_agg(to_jsonb(m) order by m.tenant_id, m.user_id)::text, '[]') from public.tenant_memberships m;
       select 'plans:' || coalesce(jsonb_agg(to_jsonb(p) order by p.id)::text, '[]') from public.user_meal_plans p;
       select 'history:' || coalesce(jsonb_agg(to_jsonb(h) order by h.id)::text, '[]') from public.recipe_ai_history h;
       select 'shopping:' || coalesce(jsonb_agg(to_jsonb(s) order by s.id)::text, '[]') from public.shopping_list_items s;
       select 'profiles:' || coalesce(jsonb_agg(to_jsonb(p) order by p.user_id)::text, '[]') from public.user_culinary_profiles p;
       select 'profile_terms:' || coalesce(jsonb_agg(to_jsonb(t) order by t.user_id, t.term_id, t.preference_type)::text, '[]') from public.user_culinary_profile_terms t;
       select 'tenant_books:' || coalesce(jsonb_agg(to_jsonb(b) order by b.id)::text, '[]') from public.tenant_books b;
       select 'tenant_pdfs:' || coalesce(jsonb_agg(to_jsonb(p) order by p.id)::text, '[]') from public.tenant_pdf_library p;
       select 'global_books:' || coalesce(jsonb_agg(to_jsonb(b) order by b.id)::text, '[]') from public.global_books b;
       select 'global_pdfs:' || coalesce(jsonb_agg(to_jsonb(p) order by p.id)::text, '[]') from public.global_pdf_library p;
       select 'book_chunks:' || coalesce(jsonb_agg(to_jsonb(b) order by b.id)::text, '[]') from public.book_chunks b;
       select 'premium_reports:' || coalesce(jsonb_agg(to_jsonb(r) order by r.id)::text, '[]') from public.premium_review_reports r;
       select 'platform_owners:' || coalesce(jsonb_agg(to_jsonb(o) order by o.user_id)::text, '[]') from public.platform_owners o;
       select 'premium_recipes:' || coalesce(jsonb_agg(to_jsonb(r) order by r.id)::text, '[]') from public.premium_recipes r;
       select 'recipe_history:' || coalesce(jsonb_agg(to_jsonb(r) order by r.id)::text, '[]') from public.recipe_ai_history r"
  } | sed '/^\\restrict /d; /^\\unrestrict /d' | shasum -a 256 | cut -d' ' -f1
}
check_space
# Reject remote Docker endpoints, including environment overrides.
unset DOCKER_HOST DOCKER_CONTEXT DOCKER_TLS_VERIFY DOCKER_CERT_PATH
endpoint=$(docker context inspect desktop-linux --format '{{.Endpoints.docker.Host}}')
[[ "$endpoint" == unix://* ]] || { echo 'Local Docker socket required' >&2; exit 1; }
DOCKER=(docker --context desktop-linux)
IMAGE=pgvector/pgvector:pg16
"${DOCKER[@]}" image inspect "$IMAGE" >/dev/null
NAME="cocinacore-signup-real-$(date +%s)-$$"
CID=''
cleanup() {
  local status=$?
  trap - EXIT INT TERM
  if [[ -n "$CID" ]]; then
    identity=$("${DOCKER[@]}" inspect --format '{{index .Config.Labels "cocinacore.signup.disposable"}}' "$CID")
    if [[ "$identity" == "$NAME" ]]; then
      "${DOCKER[@]}" rm -f "$CID" >/dev/null
      if "${DOCKER[@]}" inspect "$CID" >/dev/null 2>&1; then
        echo "FAIL: disposable container still exists" >&2
        status=1
      else
        echo "Removed private disposable $NAME"
      fi
    else
      echo 'Cleanup refused: ownership mismatch' >&2
      status=1
    fi
  fi
  df -h "$ROOT"
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
CID=$("${DOCKER[@]}" run --pull=never --rm -d --name "$NAME" \
  --label "cocinacore.signup.disposable=$NAME" \
  -e POSTGRES_PASSWORD=signup_disposable_only -e POSTGRES_DB=signup_real_disposable \
  --publish '127.0.0.1::5432' --tmpfs /var/lib/postgresql/data:rw,nosuid,size=512m "$IMAGE")
# Reject any bind or volume mount; the database must exist only on tmpfs.
mounts=$("${DOCKER[@]}" inspect --format '{{range .Mounts}}{{println .Type}}{{end}}' "$CID")
[[ -z "$mounts" ]] || { echo 'FAIL: unexpected persistent mount' >&2; exit 1; }
tmpfs=$("${DOCKER[@]}" inspect --format '{{index .HostConfig.Tmpfs "/var/lib/postgresql/data"}}' "$CID")
[[ "$tmpfs" == *size=512m* ]] || { echo 'FAIL: PostgreSQL data is not on expected tmpfs' >&2; exit 1; }
PORT=$("${DOCKER[@]}" port "$CID" 5432/tcp | sed -n 's/^127\.0\.0\.1://p')
[[ "$PORT" =~ ^[0-9]+$ && "$PORT" != 5435 && "$PORT" != 6381 ]]
echo "Private PostgreSQL: $NAME loopback port $PORT (tmpfs)"
for ((i=0; i<60; i++)); do
  if "${DOCKER[@]}" exec "$CID" pg_isready -U postgres -d signup_real_disposable >/dev/null 2>&1; then break; fi
  sleep 1
done
# Historical migrations 018-019 grant the legacy application role; keep it
# isolated to this fresh disposable database and never grant it a login.
"${DOCKER[@]}" exec "$CID" psql -X -U postgres -d signup_real_disposable -v ON_ERROR_STOP=1 \
  -c 'create role cocinacore_user nologin nosuperuser nobypassrls nocreatedb nocreaterole noinherit noreplication' >/dev/null
export SIGNUP_TEST_ADMIN_URL="postgresql://postgres:signup_disposable_only@127.0.0.1:$PORT/signup_real_disposable"
export COCINACORE_SEPARATED_DB_LANES_ENABLED=false COCINACORE_SKIP_DOTENV=1
unset MIGRATIONS_DIR
DATABASE_URL="$SIGNUP_TEST_ADMIN_URL" node "$ROOT/frontend/scripts/run-migrations.js"
DATABASE_URL="$SIGNUP_TEST_ADMIN_URL" node "$ROOT/frontend/scripts/run-migrations.js" --verify-complete
"${DOCKER[@]}" exec -i "$CID" psql -U postgres -d signup_real_disposable -v ON_ERROR_STOP=1 <<'SQL'
comment on database signup_real_disposable is 'cocinacore-signup-real-disposable';
SQL
# A deliberately privileged fixture must not be adopted, altered or granted access.
# This role exists only in this harness-owned cluster and is removed before provisioning.
"${DOCKER[@]}" exec -i "$CID" psql -X -U postgres -d signup_real_disposable \
  -v ON_ERROR_STOP=1 -c 'create role cocinacore_runtime_rls nologin superuser' >/dev/null
if "${DOCKER[@]}" exec -i "$CID" psql -X -U postgres -d signup_real_disposable \
  -v ON_ERROR_STOP=1 -v runtime_password=signup_disposable_only \
  < "$ROOT/scripts/provision-runtime-role.sql" >/dev/null 2>&1; then
  echo 'FAIL: provisioner adopted the privileged fixture' >&2
  exit 1
fi
unchanged=$("${DOCKER[@]}" exec "$CID" psql -X -U postgres -d signup_real_disposable -At \
  -c "select rolsuper and not rolcanlogin and rolpassword is null from pg_authid where rolname = 'cocinacore_runtime_rls'")
[[ "$unchanged" == t ]] || { echo 'FAIL: privileged fixture changed' >&2; exit 1; }
"${DOCKER[@]}" exec "$CID" psql -X -U postgres -d signup_real_disposable \
  -v ON_ERROR_STOP=1 -c 'drop role cocinacore_runtime_rls' >/dev/null
echo 'PASS: privileged existing role rejected without alteration'
"${DOCKER[@]}" exec -i "$CID" psql -X -U postgres -d signup_real_disposable \
  -v ON_ERROR_STOP=1 -c 'create role cocinacore_auth nologin superuser' >/dev/null
if "${DOCKER[@]}" exec -i "$CID" psql -X -U postgres -d signup_real_disposable \
  -v ON_ERROR_STOP=1 -v auth_password=signup_auth_disposable_only \
  < "$ROOT/scripts/provision-auth-role.sql" >/dev/null 2>&1; then
  echo 'FAIL: auth provisioner adopted the privileged fixture' >&2
  exit 1
fi
unchanged=$("${DOCKER[@]}" exec "$CID" psql -X -U postgres -d signup_real_disposable -At \
  -c "select rolsuper and not rolcanlogin and rolpassword is null from pg_authid where rolname = 'cocinacore_auth'")
[[ "$unchanged" == t ]] || { echo 'FAIL: privileged auth fixture changed' >&2; exit 1; }
"${DOCKER[@]}" exec -i "$CID" psql -X -U postgres -d signup_real_disposable \
  -v ON_ERROR_STOP=1 -c 'drop role cocinacore_auth' >/dev/null
echo 'PASS: privileged auth role rejected without alteration'
# The same reviewed provisioner is used by operators and the disposable harness.
"${DOCKER[@]}" exec "$CID" psql -X -U postgres -d signup_real_disposable -v ON_ERROR_STOP=1 \
  -c 'create role cocinacore_global_writer login superuser' >/dev/null
if "${DOCKER[@]}" exec -i "$CID" psql -X -U postgres -d signup_real_disposable \
  -v ON_ERROR_STOP=1 -v global_writer_password=signup_writer_disposable_only \
  < "$ROOT/scripts/provision-global-writer-role.sql" >/dev/null 2>&1; then
  echo 'FAIL: global writer provisioner adopted a privileged fixture' >&2
  exit 1
fi
unchanged=$("${DOCKER[@]}" exec "$CID" psql -X -U postgres -d signup_real_disposable -At \
  -c "select rolsuper and rolcanlogin and rolpassword is null from pg_authid where rolname = 'cocinacore_global_writer'")
[[ "$unchanged" == t ]] || { echo 'FAIL: privileged writer fixture changed' >&2; exit 1; }
"${DOCKER[@]}" exec "$CID" psql -X -U postgres -d signup_real_disposable \
  -v ON_ERROR_STOP=1 -c 'drop role cocinacore_global_writer' >/dev/null
echo 'PASS: privileged global writer role rejected without alteration'
for provision_attempt in 1 2; do
  echo "Official runtime provisioning pass $provision_attempt"
  "${DOCKER[@]}" exec -i "$CID" psql -X -U postgres -d signup_real_disposable \
  -v ON_ERROR_STOP=1 -v runtime_password=signup_disposable_only \
  < "$ROOT/scripts/provision-runtime-role.sql"
done
for provision_attempt in 1 2; do
  echo "Auth provisioning pass $provision_attempt"
  "${DOCKER[@]}" exec -i "$CID" psql -X -U postgres -d signup_real_disposable \
    -v ON_ERROR_STOP=1 -v auth_password=signup_auth_disposable_only \
    < "$ROOT/scripts/provision-auth-role.sql"
done
for provision_attempt in 1 2; do
  echo "Owner metrics provisioning pass $provision_attempt"
  "${DOCKER[@]}" exec -i "$CID" psql -X -U postgres -d signup_real_disposable \
    -v ON_ERROR_STOP=1 -v owner_metrics_password=signup_metrics_disposable_only \
    < "$ROOT/scripts/provision-owner-metrics-role.sql"
done
for provision_attempt in 1 2; do
  echo "Global writer provisioning pass $provision_attempt"
  "${DOCKER[@]}" exec -i "$CID" psql -X -U postgres -d signup_real_disposable \
    -v ON_ERROR_STOP=1 -v global_writer_password=signup_writer_disposable_only \
    < "$ROOT/scripts/provision-global-writer-role.sql"
done
for fixture in role_bypass role_membership view_owner view_definition view_acl source_acl public_acl; do
  case "$fixture" in
    role_bypass) change='alter role cocinacore_global_writer bypassrls'; undo='alter role cocinacore_global_writer nobypassrls' ;;
    role_membership) change='grant cocinacore_auth to cocinacore_global_writer'; undo='revoke cocinacore_auth from cocinacore_global_writer' ;;
    view_owner) change='alter view public.owner_write_global_pdfs owner to postgres'; undo='alter view public.owner_write_global_pdfs owner to cocinacore_global_writer_view_owner' ;;
    view_definition) change='create or replace view public.owner_write_global_pdfs as select global_book_id, storage_path, file_size_bytes, page_count, checksum_sha256, uploaded_by from public.global_pdf_library where true'; undo='create or replace view public.owner_write_global_pdfs as select global_book_id, storage_path, file_size_bytes, page_count, checksum_sha256, uploaded_by from public.global_pdf_library' ;;
    view_acl) change='grant update on public.owner_write_global_pdfs to cocinacore_global_writer'; undo='revoke update on public.owner_write_global_pdfs from cocinacore_global_writer' ;;
    source_acl) change='grant select on public.users to cocinacore_global_writer'; undo='revoke select on public.users from cocinacore_global_writer' ;;
    public_acl) change='grant select on public.global_books to public'; undo='revoke select on public.global_books from public' ;;
  esac
  "${DOCKER[@]}" exec "$CID" psql -X -U postgres -d signup_real_disposable -v ON_ERROR_STOP=1 -c "$change" >/dev/null
  before=$(rls_state_fingerprint)
  if "${DOCKER[@]}" exec -i "$CID" psql -X -U postgres -d signup_real_disposable \
    -v ON_ERROR_STOP=1 -v global_writer_password=signup_writer_disposable_only \
    < "$ROOT/scripts/provision-global-writer-role.sql" >/dev/null 2>&1; then
    echo "FAIL: global writer provisioner silently accepted incompatible $fixture" >&2
    exit 1
  fi
  after=$(rls_state_fingerprint)
  [[ "$before" == "$after" ]] || { echo "FAIL: writer provisioner mutated schema, roles, or data after rejecting $fixture" >&2; exit 1; }
  "${DOCKER[@]}" exec "$CID" psql -X -U postgres -d signup_real_disposable -v ON_ERROR_STOP=1 -c "$undo" >/dev/null
  echo "PASS: writer provisioner rejected $fixture without schema, role, or data mutation"
done
for provision_attempt in 1 2; do
  "${DOCKER[@]}" exec -i "$CID" psql -X -U postgres -d signup_real_disposable \
    -v ON_ERROR_STOP=1 -v global_writer_password=signup_writer_disposable_only \
    < "$ROOT/scripts/provision-global-writer-role.sql" >/dev/null
done
echo 'PASS: global writer provisioner remains idempotent after drift restoration'
check_space
cd "$ROOT/frontend"
case "${COCINACORE_DISPOSABLE_SUITE:-signup}" in
  signup) test_files=(src/app/api/auth/signup/signup-real-schema.integration.test.ts) ;;
  signup-bootstrap)
    for i in 1 2; do "${DOCKER[@]}" exec -i "$CID" psql -X -U postgres -d signup_real_disposable -v ON_ERROR_STOP=1 < "$ROOT/scripts/provision-signup-bootstrap-roles.sql"; done
    "${DOCKER[@]}" exec "$CID" psql -X -U postgres -d signup_real_disposable -v ON_ERROR_STOP=1 -c "insert into tenants(id,name) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','fixture'); insert into users(id,tenant_id,email,password_hash) values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','policy-fixture@example.test','fixture'); insert into tenant_memberships(tenant_id,user_id) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')" >/dev/null
    for fixture in login bypass membership users_select password membership_update function_execute sequence_usage schema view_owner function_owner config default_acl public_acl; do
      case "$fixture" in
        login) change='alter role cocinacore_signup_bootstrap login'; undo='alter role cocinacore_signup_bootstrap nologin' ;;
        bypass) change='alter role cocinacore_identity_probe bypassrls'; undo='alter role cocinacore_identity_probe nobypassrls' ;;
        password) change='grant select (password_hash) on public.users to cocinacore_identity_probe'; undo='revoke select (password_hash) on public.users from cocinacore_identity_probe' ;;
        users_select) change='grant select on public.users to cocinacore_identity_probe'; undo='revoke select on public.users from cocinacore_identity_probe' ;;
        membership_update) change='grant update on public.tenant_memberships to cocinacore_signup_bootstrap'; undo='revoke update on public.tenant_memberships from cocinacore_signup_bootstrap' ;;
        function_execute) change="create function public.bad_probe() returns integer language sql as 'select 1'; revoke all on function public.bad_probe() from public; grant execute on function public.bad_probe() to cocinacore_identity_probe"; undo='drop function public.bad_probe()' ;;
        sequence_usage) change='create sequence public.bad_probe_seq; grant usage on sequence public.bad_probe_seq to cocinacore_identity_probe'; undo='drop sequence public.bad_probe_seq' ;;
        view_owner) change='create view public.bad_probe_view as select 1 as id; alter view public.bad_probe_view owner to cocinacore_identity_probe'; undo='drop view public.bad_probe_view' ;;
        function_owner) change="create function public.bad_owned() returns integer language sql as 'select 1'; alter function public.bad_owned() owner to cocinacore_signup_bootstrap"; undo='drop function public.bad_owned()' ;;
        default_acl) change='alter default privileges for role cocinacore_identity_probe grant select on tables to public'; undo='alter default privileges for role cocinacore_identity_probe revoke select on tables from public' ;;
        public_acl) change='grant select on public.users to public'; undo='revoke select on public.users from public' ;;
        membership) change='grant cocinacore_auth to cocinacore_identity_probe'; undo='revoke cocinacore_auth from cocinacore_identity_probe' ;;
        schema) change='grant create on schema public to cocinacore_signup_bootstrap'; undo='revoke create on schema public from cocinacore_signup_bootstrap' ;;
        config) change="alter role cocinacore_identity_probe set search_path = public"; undo='alter role cocinacore_identity_probe reset all' ;;
      esac
      "${DOCKER[@]}" exec "$CID" psql -X -U postgres -d signup_real_disposable -v ON_ERROR_STOP=1 -c "$change" >/dev/null
      before=$({ "${DOCKER[@]}" exec "$CID" pg_dumpall -U postgres --globals-only; "${DOCKER[@]}" exec "$CID" pg_dump -U postgres -d signup_real_disposable --schema-only; "${DOCKER[@]}" exec "$CID" psql -X -U postgres -d signup_real_disposable -Atc "select row_to_json(t) from public.tenants t order by id; select row_to_json(u) from public.users u order by id; select row_to_json(m) from public.tenant_memberships m order by id"; } | sed '/^\\restrict /d; /^\\unrestrict /d' | shasum -a 256 | cut -d' ' -f1)
      if "${DOCKER[@]}" exec -i "$CID" psql -X -U postgres -d signup_real_disposable -v ON_ERROR_STOP=1 < "$ROOT/scripts/provision-signup-bootstrap-roles.sql" >/dev/null 2>&1; then echo "FAIL: accepted incompatible $fixture" >&2; exit 1; fi
      after=$({ "${DOCKER[@]}" exec "$CID" pg_dumpall -U postgres --globals-only; "${DOCKER[@]}" exec "$CID" pg_dump -U postgres -d signup_real_disposable --schema-only; "${DOCKER[@]}" exec "$CID" psql -X -U postgres -d signup_real_disposable -Atc "select row_to_json(t) from public.tenants t order by id; select row_to_json(u) from public.users u order by id; select row_to_json(m) from public.tenant_memberships m order by id"; } | sed '/^\\restrict /d; /^\\unrestrict /d' | shasum -a 256 | cut -d' ' -f1)
      [[ "$before" == "$after" ]] || { echo "FAIL: mutation after rejection $fixture" >&2; exit 1; }
      "${DOCKER[@]}" exec "$CID" psql -X -U postgres -d signup_real_disposable -v ON_ERROR_STOP=1 -c "$undo" >/dev/null
      echo "PASS: rejected incompatible $fixture"
    done
    cat "$ROOT/scripts/rls-candidates/020c-identity.sql" "$ROOT/scripts/rls-candidates/020b-inventory.sql" "$ROOT/scripts/rls-candidates/020c1-signup.sql" | "${DOCKER[@]}" exec -i "$CID" psql -X -1 -U postgres -d signup_real_disposable -v ON_ERROR_STOP=1
    for fixture in execute_public execute_runtime view_public view_insert no_force extra_users extra_members using_change check_change role_change restrictive removed command_change auth_insert partial; do
      case "$fixture" in
        execute_public) change='grant execute on function public.signup_new_account(text,text,text,timestamptz,text) to public'; undo='revoke execute on function public.signup_new_account(text,text,text,timestamptz,text) from public' ;;
        execute_runtime) change='grant execute on function public.signup_new_account(text,text,text,timestamptz,text) to cocinacore_runtime_rls'; undo='revoke execute on function public.signup_new_account(text,text,text,timestamptz,text) from cocinacore_runtime_rls' ;;
        view_public) change='grant select on public.runtime_identity_probe to public'; undo='revoke select on public.runtime_identity_probe from public' ;;
        view_insert) change='grant insert on public.runtime_identity_probe to cocinacore_runtime_rls'; undo='revoke insert on public.runtime_identity_probe from cocinacore_runtime_rls' ;;
        auth_insert) change='grant insert (tenant_id) on public.tenant_memberships to cocinacore_auth'; undo='revoke insert (tenant_id) on public.tenant_memberships from cocinacore_auth' ;;
        partial) change='alter view public.runtime_identity_probe rename to runtime_identity_probe_missing'; undo='alter view public.runtime_identity_probe_missing rename to runtime_identity_probe' ;;
        extra_users) change='create policy test_unsafe_users on public.users for select to cocinacore_runtime_rls using (true)'; undo='drop policy test_unsafe_users on public.users' ;;
        extra_members) change='create policy test_unsafe_members on public.tenant_memberships for select to public using (true)'; undo='drop policy test_unsafe_members on public.tenant_memberships' ;;
        using_change) change='alter policy identity_auth_users_read on public.users using (false)'; undo='alter policy identity_auth_users_read on public.users using (true)' ;;
        check_change) change='alter policy identity_auth_users_insert on public.users with check (false)'; undo='alter policy identity_auth_users_insert on public.users with check (true)' ;;
        role_change) change='alter policy identity_auth_users_read on public.users to public'; undo='alter policy identity_auth_users_read on public.users to cocinacore_auth' ;;
        restrictive) change='drop policy identity_auth_users_read on public.users; create policy identity_auth_users_read on public.users as restrictive for select to cocinacore_auth using (true)'; undo='drop policy identity_auth_users_read on public.users; create policy identity_auth_users_read on public.users for select to cocinacore_auth using (true)' ;;
        command_change) change='drop policy identity_auth_users_read on public.users; create policy identity_auth_users_read on public.users for delete to cocinacore_auth using (true)'; undo='drop policy identity_auth_users_read on public.users; create policy identity_auth_users_read on public.users for select to cocinacore_auth using (true)' ;;
        removed) change='drop policy identity_auth_users_read on public.users'; undo='create policy identity_auth_users_read on public.users for select to cocinacore_auth using (true)' ;;
        no_force) change='alter table public.users no force row level security'; undo='alter table public.users force row level security' ;;
      esac
      "${DOCKER[@]}" exec "$CID" psql -X -U postgres -d signup_real_disposable -v ON_ERROR_STOP=1 -c "$change" >/dev/null
      before=$({ "${DOCKER[@]}" exec "$CID" pg_dumpall -U postgres --globals-only; "${DOCKER[@]}" exec "$CID" pg_dump -U postgres -d signup_real_disposable --schema-only; "${DOCKER[@]}" exec "$CID" psql -X -U postgres -d signup_real_disposable -Atc "select row_to_json(t) from public.tenants t order by id; select row_to_json(u) from public.users u order by id; select row_to_json(m) from public.tenant_memberships m order by id"; } | sed '/^\\restrict /d; /^\\unrestrict /d' | shasum -a 256 | cut -d' ' -f1)
      if "${DOCKER[@]}" exec -i "$CID" psql -X -U postgres -d signup_real_disposable -v ON_ERROR_STOP=1 < "$ROOT/scripts/provision-signup-bootstrap-roles.sql" >/dev/null 2>&1; then echo "FAIL: accepted drift $fixture" >&2; exit 1; fi
      after=$({ "${DOCKER[@]}" exec "$CID" pg_dumpall -U postgres --globals-only; "${DOCKER[@]}" exec "$CID" pg_dump -U postgres -d signup_real_disposable --schema-only; "${DOCKER[@]}" exec "$CID" psql -X -U postgres -d signup_real_disposable -Atc "select row_to_json(t) from public.tenants t order by id; select row_to_json(u) from public.users u order by id; select row_to_json(m) from public.tenant_memberships m order by id"; } | sed '/^\\restrict /d; /^\\unrestrict /d' | shasum -a 256 | cut -d' ' -f1)
      [[ "$before" == "$after" ]] || { echo "FAIL: mutation after rejection $fixture" >&2; exit 1; }
      "${DOCKER[@]}" exec "$CID" psql -X -U postgres -d signup_real_disposable -v ON_ERROR_STOP=1 -c "$undo" >/dev/null
    done
    for i in 1 2; do "${DOCKER[@]}" exec -i "$CID" psql -X -U postgres -d signup_real_disposable -v ON_ERROR_STOP=1 < "$ROOT/scripts/provision-signup-bootstrap-roles.sql"; done
    test_files=(src/lib/db/repositories/signup-bootstrap.integration.test.ts src/lib/db/repositories/identity-rls.integration.test.ts src/lib/db/repositories/inventory-rls.integration.test.ts src/app/api/auth/signup/signup-bootstrap-http.integration.test.ts) ;;
  identity-rls)
    "${DOCKER[@]}" exec -i "$CID" psql -X -U postgres -d signup_real_disposable -v ON_ERROR_STOP=1 < "$ROOT/scripts/provision-signup-bootstrap-roles.sql"
    cat "$ROOT/scripts/rls-candidates/020c-identity.sql" "$ROOT/scripts/rls-candidates/020b-inventory.sql" |
      "${DOCKER[@]}" exec -i "$CID" psql -X -1 -U postgres -d signup_real_disposable -v ON_ERROR_STOP=1
    test_files=(src/lib/db/repositories/identity-rls.integration.test.ts src/lib/db/repositories/inventory-rls.integration.test.ts src/lib/db/repositories/shoppingListTransfer.integration.test.ts) ;;
  inventory-rls)
    "${DOCKER[@]}" exec -i "$CID" psql -X -1 -U postgres -d signup_real_disposable -v ON_ERROR_STOP=1 < "$ROOT/scripts/rls-candidates/020b-inventory.sql"
    test_files=(src/app/api/auth/signup/signup-real-schema.integration.test.ts src/lib/db/repositories/inventory-rls.integration.test.ts src/lib/db/repositories/shoppingListTransfer.integration.test.ts) ;;
  plans-history-shopping-rls)
    for i in 1 2; do
      "${DOCKER[@]}" exec -i "$CID" psql -X -U postgres -d signup_real_disposable -v ON_ERROR_STOP=1 \
        < "$ROOT/scripts/provision-signup-bootstrap-roles.sql"
    done
    cat "$ROOT/scripts/rls-candidates/020c-identity.sql" \
      "$ROOT/scripts/rls-candidates/020b-inventory.sql" \
      "$ROOT/scripts/rls-candidates/020c1-signup.sql" |
      "${DOCKER[@]}" exec -i "$CID" psql -X -1 -U postgres -d signup_real_disposable -v ON_ERROR_STOP=1
    "${DOCKER[@]}" exec "$CID" psql -X -U postgres -d signup_real_disposable -v ON_ERROR_STOP=1 \
      -c "insert into tenants(id,name) values ('99000000-0000-4000-8000-000000000001','020D1 preflight fixture');
          insert into users(id,email,password_hash,tenant_id,role) values ('99000000-0000-4000-8000-000000000002','020d1-preflight@example.test','fixture-hash','99000000-0000-4000-8000-000000000001','owner');
          insert into tenant_memberships(tenant_id,user_id,role) values ('99000000-0000-4000-8000-000000000001','99000000-0000-4000-8000-000000000002','owner');
          insert into user_meal_plans(id,tenant_id,user_id,period,mode) values ('99000000-0000-4000-8000-000000000003','99000000-0000-4000-8000-000000000001','99000000-0000-4000-8000-000000000002','week','balanced_ai');
          insert into recipe_ai_history(id,tenant_id,user_id,source,recipe_payload) values ('99000000-0000-4000-8000-000000000004','99000000-0000-4000-8000-000000000001','99000000-0000-4000-8000-000000000002','ai','{}');
          insert into shopping_list_items(id,tenant_id,user_id,source,ingredient_name) values ('99000000-0000-4000-8000-000000000005','99000000-0000-4000-8000-000000000001','99000000-0000-4000-8000-000000000002','manual','preflight fixture')" >/dev/null
    for fixture in extra_policy identity_policy runtime_delete; do
      case "$fixture" in
        extra_policy) change='create policy d1_preflight_extra on public.user_meal_plans for select to cocinacore_runtime_rls using (true)'; undo='drop policy d1_preflight_extra on public.user_meal_plans' ;;
        identity_policy) change='alter policy identity_probe_users on public.users using (true)'; undo="alter policy identity_probe_users on public.users using (id = NULLIF(current_setting('app.user_id',true),'')::uuid AND tenant_id = NULLIF(current_setting('app.tenant_id',true),'')::uuid)" ;;
        runtime_delete) change='grant delete on public.user_meal_plans to cocinacore_runtime_rls'; undo='revoke delete on public.user_meal_plans from cocinacore_runtime_rls' ;;
      esac
      "${DOCKER[@]}" exec "$CID" psql -X -U postgres -d signup_real_disposable -v ON_ERROR_STOP=1 -c "$change" >/dev/null
      before=$(rls_state_fingerprint)
      if cat "$ROOT/scripts/rls-candidates/020d1-plans-history-shopping.sql" |
        "${DOCKER[@]}" exec -i "$CID" psql -X -1 -U postgres -d signup_real_disposable -v ON_ERROR_STOP=1 >/dev/null 2>&1; then
        echo "FAIL: 020D1 accepted incompatible $fixture" >&2
        exit 1
      fi
      after=$(rls_state_fingerprint)
      [[ "$before" == "$after" ]] || { echo "FAIL: 020D1 mutated schema, roles, or fixture data after rejecting $fixture" >&2; exit 1; }
      "${DOCKER[@]}" exec "$CID" psql -X -U postgres -d signup_real_disposable -v ON_ERROR_STOP=1 -c "$undo" >/dev/null
      echo "PASS: 020D1 rejected $fixture without schema, role, or data mutation"
    done
    cat "$ROOT/scripts/rls-candidates/020d1-plans-history-shopping.sql" |
      "${DOCKER[@]}" exec -i "$CID" psql -X -1 -U postgres -d signup_real_disposable -v ON_ERROR_STOP=1
    # Re-run the identity/bootstrap preflight after D1 to verify its 17-policy
    # contract remains intact and the signup capability stays provisionable.
    for i in 1 2; do
      "${DOCKER[@]}" exec -i "$CID" psql -X -U postgres -d signup_real_disposable -v ON_ERROR_STOP=1 \
        < "$ROOT/scripts/provision-signup-bootstrap-roles.sql"
    done
    export COCINACORE_SIGNUP_BOOTSTRAP_TEST=1
    export COCINACORE_IDENTITY_RLS_TEST=1
    export COCINACORE_INVENTORY_RLS_TEST=1
    export COCINACORE_PLANS_HISTORY_SHOPPING_RLS_TEST=1
    test_files=(src/lib/db/repositories/plans-history-shopping-rls.integration.test.ts src/lib/db/repositories/identity-rls.integration.test.ts src/lib/db/repositories/inventory-rls.integration.test.ts src/lib/db/repositories/signup-bootstrap.integration.test.ts src/lib/db/repositories/shoppingListTransfer.integration.test.ts src/app/api/auth/signup/signup-bootstrap-http.integration.test.ts) ;;
  culinary-profile-rls)
    for i in 1 2; do
      "${DOCKER[@]}" exec -i "$CID" psql -X -U postgres -d signup_real_disposable -v ON_ERROR_STOP=1 \
        < "$ROOT/scripts/provision-signup-bootstrap-roles.sql"
    done
    cat "$ROOT/scripts/rls-candidates/020c-identity.sql" \
      "$ROOT/scripts/rls-candidates/020b-inventory.sql" \
      "$ROOT/scripts/rls-candidates/020c1-signup.sql" |
      "${DOCKER[@]}" exec -i "$CID" psql -X -1 -U postgres -d signup_real_disposable -v ON_ERROR_STOP=1
    cat "$ROOT/scripts/rls-candidates/020d1-plans-history-shopping.sql" |
      "${DOCKER[@]}" exec -i "$CID" psql -X -1 -U postgres -d signup_real_disposable -v ON_ERROR_STOP=1
    "${DOCKER[@]}" exec "$CID" psql -X -U postgres -d signup_real_disposable -v ON_ERROR_STOP=1 \
      -c "insert into public.tenants(id,name) values
            ('99100000-0000-4000-8000-000000000001','020D2 Tenant A'),
            ('99100000-0000-4000-8000-000000000002','020D2 Tenant B');
          insert into public.users(id,email,password_hash,tenant_id,role) values
            ('99100000-0000-4000-8000-000000000003','020d2-a1@example.test','fixture','99100000-0000-4000-8000-000000000001','owner'),
            ('99100000-0000-4000-8000-000000000004','020d2-a2@example.test','fixture','99100000-0000-4000-8000-000000000001','owner'),
            ('99100000-0000-4000-8000-000000000005','020d2-b1@example.test','fixture','99100000-0000-4000-8000-000000000002','owner'),
            ('99100000-0000-4000-8000-000000000006','020d2-a3-orphan@example.test','fixture','99100000-0000-4000-8000-000000000001','owner');
          insert into public.tenant_memberships(tenant_id,user_id,role) values
            ('99100000-0000-4000-8000-000000000001','99100000-0000-4000-8000-000000000003','owner'),
            ('99100000-0000-4000-8000-000000000001','99100000-0000-4000-8000-000000000004','owner'),
            ('99100000-0000-4000-8000-000000000002','99100000-0000-4000-8000-000000000005','owner'),
            ('99100000-0000-4000-8000-000000000001','99100000-0000-4000-8000-000000000006','owner');
          insert into public.user_culinary_profiles(user_id,tenant_id,level) values
            ('99100000-0000-4000-8000-000000000003','99100000-0000-4000-8000-000000000001','A1'),
            ('99100000-0000-4000-8000-000000000004','99100000-0000-4000-8000-000000000001','A2'),
            ('99100000-0000-4000-8000-000000000005','99100000-0000-4000-8000-000000000002','B1');
          insert into public.user_culinary_profile_terms(user_id,term_id,preference_type) values
            ('99100000-0000-4000-8000-000000000003','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','identity'),
            ('99100000-0000-4000-8000-000000000004','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaab','avoid'),
            ('99100000-0000-4000-8000-000000000005','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaac','prefer'),
            ('99100000-0000-4000-8000-000000000006','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaad','goal')" >/dev/null
    for fixture in extra_policy using_change check_change runtime_update owner_change no_force; do
      case "$fixture" in
        extra_policy) change='create policy d2_preflight_extra on public.user_culinary_profiles for select to cocinacore_runtime_rls using (true)'; undo='drop policy d2_preflight_extra on public.user_culinary_profiles' ;;
        using_change) change='alter policy identity_probe_users on public.users using (false)'; undo="alter policy identity_probe_users on public.users using (id = NULLIF(current_setting('app.user_id',true),'')::uuid AND tenant_id = NULLIF(current_setting('app.tenant_id',true),'')::uuid)" ;;
        check_change) change='alter policy identity_auth_users_insert on public.users with check (false)'; undo='alter policy identity_auth_users_insert on public.users with check (true)' ;;
        runtime_update) change='grant update (tenant_id) on public.user_culinary_profiles to cocinacore_runtime_rls'; undo='revoke update (tenant_id) on public.user_culinary_profiles from cocinacore_runtime_rls' ;;
        owner_change) change='alter table public.user_culinary_profiles owner to cocinacore_runtime_rls'; undo='alter table public.user_culinary_profiles owner to postgres' ;;
        no_force) change='alter table public.users no force row level security'; undo='alter table public.users force row level security' ;;
      esac
      "${DOCKER[@]}" exec "$CID" psql -X -U postgres -d signup_real_disposable -v ON_ERROR_STOP=1 -c "$change" >/dev/null
      before=$(rls_state_fingerprint)
      if cat "$ROOT/scripts/rls-candidates/020d2-culinary-profiles.sql" |
        "${DOCKER[@]}" exec -i "$CID" psql -X -1 -U postgres -d signup_real_disposable -v ON_ERROR_STOP=1 >/dev/null 2>&1; then
        echo "FAIL: 020D2 accepted incompatible $fixture" >&2
        exit 1
      fi
      after=$(rls_state_fingerprint)
      [[ "$before" == "$after" ]] || { echo "FAIL: 020D2 mutated schema, roles, or populated tenant/profile data after rejecting $fixture" >&2; exit 1; }
      "${DOCKER[@]}" exec "$CID" psql -X -U postgres -d signup_real_disposable -v ON_ERROR_STOP=1 -c "$undo" >/dev/null
      if [[ "$fixture" == owner_change ]]; then
        "${DOCKER[@]}" exec "$CID" psql -X -U postgres -d signup_real_disposable -v ON_ERROR_STOP=1 \
          -c 'grant select, insert on public.user_culinary_profiles to cocinacore_runtime_rls; grant update (level, available_time_minutes, disliked_ingredients, allergies, household_members, updated_at) on public.user_culinary_profiles to cocinacore_runtime_rls' >/dev/null
      fi
      echo "PASS: 020D2 rejected $fixture without schema, role, or data mutation"
    done
    cat "$ROOT/scripts/rls-candidates/020d2-culinary-profiles.sql" |
      "${DOCKER[@]}" exec -i "$CID" psql -X -1 -U postgres -d signup_real_disposable -v ON_ERROR_STOP=1
    for i in 1 2; do
      "${DOCKER[@]}" exec -i "$CID" psql -X -U postgres -d signup_real_disposable -v ON_ERROR_STOP=1 \
        < "$ROOT/scripts/provision-signup-bootstrap-roles.sql"
    done
    export COCINACORE_SIGNUP_BOOTSTRAP_TEST=1
    export COCINACORE_IDENTITY_RLS_TEST=1
    export COCINACORE_INVENTORY_RLS_TEST=1
    export COCINACORE_PLANS_HISTORY_SHOPPING_RLS_TEST=1
    export COCINACORE_CULINARY_PROFILE_RLS_TEST=1
    test_files=(src/lib/db/repositories/culinaryProfileRls.integration.test.ts src/lib/db/repositories/plans-history-shopping-rls.integration.test.ts src/lib/db/repositories/identity-rls.integration.test.ts src/lib/db/repositories/inventory-rls.integration.test.ts src/lib/db/repositories/signup-bootstrap.integration.test.ts src/app/api/auth/signup/signup-bootstrap-http.integration.test.ts src/app/api/auth/login/route.test.ts) ;;
  documents-rag-rls)
    for i in 1 2; do
      "${DOCKER[@]}" exec -i "$CID" psql -X -U postgres -d signup_real_disposable -v ON_ERROR_STOP=1 \
        < "$ROOT/scripts/provision-signup-bootstrap-roles.sql"
    done
    cat "$ROOT/scripts/rls-candidates/020c-identity.sql" \
      "$ROOT/scripts/rls-candidates/020b-inventory.sql" \
      "$ROOT/scripts/rls-candidates/020c1-signup.sql" |
      "${DOCKER[@]}" exec -i "$CID" psql -X -1 -U postgres -d signup_real_disposable -v ON_ERROR_STOP=1
    cat "$ROOT/scripts/rls-candidates/020d1-plans-history-shopping.sql" |
      "${DOCKER[@]}" exec -i "$CID" psql -X -1 -U postgres -d signup_real_disposable -v ON_ERROR_STOP=1
    cat "$ROOT/scripts/rls-candidates/020d2-culinary-profiles.sql" |
      "${DOCKER[@]}" exec -i "$CID" psql -X -1 -U postgres -d signup_real_disposable -v ON_ERROR_STOP=1
    "${DOCKER[@]}" exec "$CID" psql -X -U postgres -d signup_real_disposable -v ON_ERROR_STOP=1 -c "
      insert into public.tenants(id,name) values
        ('99100000-0000-4000-8000-000000000001','020D3 Tenant A'),
        ('99100000-0000-4000-8000-000000000002','020D3 Tenant B');
      insert into public.users(id,email,password_hash,tenant_id,role) values
        ('99100000-0000-4000-8000-000000000003','020d3-a1@example.test','fixture','99100000-0000-4000-8000-000000000001','owner'),
        ('99100000-0000-4000-8000-000000000004','020d3-a2@example.test','fixture','99100000-0000-4000-8000-000000000001','owner'),
        ('99100000-0000-4000-8000-000000000005','020d3-b1@example.test','fixture','99100000-0000-4000-8000-000000000002','owner'),
        ('99100000-0000-4000-8000-000000000006','020d3-a3-orphan@example.test','fixture','99100000-0000-4000-8000-000000000001','owner');
      insert into public.tenant_memberships(tenant_id,user_id,role) values
        ('99100000-0000-4000-8000-000000000001','99100000-0000-4000-8000-000000000003','owner'),
        ('99100000-0000-4000-8000-000000000001','99100000-0000-4000-8000-000000000004','owner'),
        ('99100000-0000-4000-8000-000000000002','99100000-0000-4000-8000-000000000005','owner'),
        ('99100000-0000-4000-8000-000000000001','99100000-0000-4000-8000-000000000006','owner');
      insert into public.user_culinary_profiles(user_id,tenant_id,level) values
        ('99100000-0000-4000-8000-000000000003','99100000-0000-4000-8000-000000000001','D3 A1'),
        ('99100000-0000-4000-8000-000000000004','99100000-0000-4000-8000-000000000001','D3 A2'),
        ('99100000-0000-4000-8000-000000000005','99100000-0000-4000-8000-000000000002','D3 B1');
      insert into public.user_culinary_profile_terms(user_id,term_id,preference_type) values
        ('99100000-0000-4000-8000-000000000003','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','identity'),
        ('99100000-0000-4000-8000-000000000004','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaab','avoid'),
        ('99100000-0000-4000-8000-000000000005','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaac','prefer'),
        ('99100000-0000-4000-8000-000000000006','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaad','goal')"
    "${DOCKER[@]}" exec "$CID" psql -X -U postgres -d signup_real_disposable -v ON_ERROR_STOP=1 -c "
      insert into public.platform_owners(user_id,requires_manual_review)
        values ('99100000-0000-4000-8000-000000000003',false);
      insert into public.recipe_ai_history(id,tenant_id,user_id,source,recipe_title,recipe_payload)
        values ('99300000-0000-4000-8000-000000000001','99100000-0000-4000-8000-000000000001',
          '99100000-0000-4000-8000-000000000003','fixture','Metrics fixture','{}');
      insert into public.premium_recipes(id,source_recipe_history_id,source_tenant_id,creator_user_id)
        values ('99300000-0000-4000-8000-000000000002','99300000-0000-4000-8000-000000000001',
          '99100000-0000-4000-8000-000000000001','99100000-0000-4000-8000-000000000003');
      insert into public.premium_review_reports(id,premium_recipe_id,reporter_user_id,reason)
        values ('99300000-0000-4000-8000-000000000003','99300000-0000-4000-8000-000000000002',
          '99100000-0000-4000-8000-000000000004','metrics fixture')" >/dev/null
    "${DOCKER[@]}" exec -i "$CID" psql -X -U postgres -d signup_real_disposable -v ON_ERROR_STOP=1 \
      < "$ROOT/scripts/tests/020d3-document-fixtures.sql"
    cat "$ROOT/scripts/rls-candidates/020d3-documents-rag.sql" |
      "${DOCKER[@]}" exec -i "$CID" psql -X -1 -U postgres -d signup_real_disposable -v ON_ERROR_STOP=1
    identity_policy_count=$(( $("${DOCKER[@]}" exec "$CID" psql -X -U postgres -d signup_real_disposable -Atc \
      "select count(*) from pg_policy where polrelid in ('public.users'::regclass,'public.tenants'::regclass,'public.tenant_memberships'::regclass)") ))
    [[ "$identity_policy_count" == 17 ]] || { echo "FAIL: expected 17 identity policies after D3, found $identity_policy_count" >&2; exit 1; }
    echo 'PASS: D3 composition retains all 17 identity/bootstrap policies'
    echo 'PASS: 020D3 initial state installed with the fixed six-policy contract'
    cat "$ROOT/scripts/rls-candidates/020d3-documents-rag.sql" |
      "${DOCKER[@]}" exec -i "$CID" psql -X -1 -U postgres -d signup_real_disposable -v ON_ERROR_STOP=1
    echo 'PASS: 020D3 exact installed state is idempotently accepted'
    for fixture in extra_policy using_change check_change role_change restrictive_policy policy_removed runtime_update owner_change no_force match_runtime match_public match_auth; do
      case "$fixture" in
        extra_policy) change='create policy d3_preflight_extra on public.tenant_books for select to cocinacore_runtime_rls using (true)'; undo='drop policy d3_preflight_extra on public.tenant_books' ;;
        using_change) change='alter policy documents_tenant_books_select on public.tenant_books using (false)'; undo="alter policy documents_tenant_books_select on public.tenant_books using (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid AND EXISTS (SELECT 1 FROM public.runtime_identity_probe))" ;;
        check_change) change='alter policy documents_private_chunks_insert on public.book_chunks with check (false)'; undo="alter policy documents_private_chunks_insert on public.book_chunks with check (source_type = 'tenant_pdf' AND tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid AND global_book_id IS NULL AND tenant_book_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.tenant_books AS parent_book WHERE parent_book.id = book_chunks.tenant_book_id AND parent_book.tenant_id = book_chunks.tenant_id) AND EXISTS (SELECT 1 FROM public.runtime_identity_probe))" ;;
        role_change) change='alter policy documents_tenant_books_select on public.tenant_books to public'; undo='alter policy documents_tenant_books_select on public.tenant_books to cocinacore_runtime_rls' ;;
        restrictive_policy) change="drop policy documents_tenant_books_select on public.tenant_books; create policy documents_tenant_books_select on public.tenant_books as restrictive for select to cocinacore_runtime_rls using (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid AND EXISTS (SELECT 1 FROM public.runtime_identity_probe))"; undo="drop policy documents_tenant_books_select on public.tenant_books; create policy documents_tenant_books_select on public.tenant_books as permissive for select to cocinacore_runtime_rls using (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid AND EXISTS (SELECT 1 FROM public.runtime_identity_probe))" ;;
        policy_removed) change='drop policy documents_tenant_books_select on public.tenant_books'; undo="create policy documents_tenant_books_select on public.tenant_books for select to cocinacore_runtime_rls using (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid AND EXISTS (SELECT 1 FROM public.runtime_identity_probe))" ;;
        runtime_update) change='grant update on public.tenant_books to cocinacore_runtime_rls'; undo='revoke update on public.tenant_books from cocinacore_runtime_rls' ;;
        owner_change) change='alter table public.tenant_books owner to cocinacore_runtime_rls'; undo='alter table public.tenant_books owner to postgres; revoke all on public.tenant_books from cocinacore_runtime_rls; grant select, delete on public.tenant_books to cocinacore_runtime_rls' ;;
        no_force) change='alter table public.book_chunks no force row level security'; undo='alter table public.book_chunks force row level security' ;;
        match_runtime) change='grant execute on function public.match_chunks(vector, double precision, integer, uuid) to cocinacore_runtime_rls'; undo='revoke execute on function public.match_chunks(vector, double precision, integer, uuid) from cocinacore_runtime_rls' ;;
        match_public) change='grant execute on function public.match_chunks(vector, double precision, integer, uuid) to public'; undo='revoke execute on function public.match_chunks(vector, double precision, integer, uuid) from public' ;;
        match_auth) change='grant execute on function public.match_chunks(vector, double precision, integer, uuid) to cocinacore_auth'; undo='revoke execute on function public.match_chunks(vector, double precision, integer, uuid) from cocinacore_auth' ;;
      esac
      "${DOCKER[@]}" exec "$CID" psql -X -U postgres -d signup_real_disposable -v ON_ERROR_STOP=1 -c "$change" >/dev/null
      before=$(rls_state_fingerprint)
      if cat "$ROOT/scripts/rls-candidates/020d3-documents-rag.sql" |
        "${DOCKER[@]}" exec -i "$CID" psql -X -1 -U postgres -d signup_real_disposable -v ON_ERROR_STOP=1 >/dev/null 2>&1; then
        echo "FAIL: 020D3 accepted incompatible $fixture" >&2
        exit 1
      fi
      after=$(rls_state_fingerprint)
      [[ "$before" == "$after" ]] || { echo "FAIL: 020D3 mutated schema, roles, or populated fixtures after rejecting $fixture" >&2; exit 1; }
      "${DOCKER[@]}" exec "$CID" psql -X -U postgres -d signup_real_disposable -v ON_ERROR_STOP=1 -c "$undo" >/dev/null
      echo "PASS: 020D3 rejected $fixture without schema, role, or populated-data mutation"
    done

    echo 'Applying 020D4-A owner metrics policy and view candidate'
    cat "$ROOT/scripts/rls-candidates/020d4a-owner-metrics.sql" |
      "${DOCKER[@]}" exec -i "$CID" psql -X -1 -U postgres -d signup_real_disposable -v ON_ERROR_STOP=1
    identity_policy_count=$(( $("${DOCKER[@]}" exec "$CID" psql -X -U postgres -d signup_real_disposable -Atc \
      "select count(*) from pg_policy where polrelid in ('public.users'::regclass,'public.tenants'::regclass,'public.tenant_memberships'::regclass)") ))
    [[ "$identity_policy_count" == 19 ]] || { echo "FAIL: expected 19 identity policies after D4-A, found $identity_policy_count" >&2; exit 1; }
    echo 'PASS: D4-A expands the identity/bootstrap contract to 19 policies'
    echo 'Rechecking complete 020D4-A installed state'
    cat "$ROOT/scripts/rls-candidates/020d4a-owner-metrics.sql" |
      "${DOCKER[@]}" exec -i "$CID" psql -X -1 -U postgres -d signup_real_disposable -v ON_ERROR_STOP=1
    echo 'PASS: 020D4-A exact installed state is idempotently accepted'
    echo 'Rechecking prior identity, signup, and D3 candidates after the 19-policy expansion'
    for i in 1 2; do
      echo "Signup role provisioner idempotence pass $i"
      if ! "${DOCKER[@]}" exec -i "$CID" psql -X -U postgres -d signup_real_disposable -v ON_ERROR_STOP=1 \
        < "$ROOT/scripts/provision-signup-bootstrap-roles.sql" >/dev/null; then
        "${DOCKER[@]}" exec "$CID" psql -X -U postgres -d signup_real_disposable -P pager=off -c \
          "select c.relname,p.polname,p.polcmd,p.polroles,p.polpermissive,coalesce(md5(pg_get_expr(p.polqual,p.polrelid)),'-') using_hash,coalesce(md5(pg_get_expr(p.polwithcheck,p.polrelid)),'-') check_hash from pg_policy p join pg_class c on c.oid=p.polrelid where c.oid in ('public.users'::regclass,'public.tenants'::regclass,'public.tenant_memberships'::regclass) order by c.relname,p.polname"
        exit 1
      fi
    done
    cat "$ROOT/scripts/rls-candidates/020d3-documents-rag.sql" |
      "${DOCKER[@]}" exec -i "$CID" psql -X -1 -U postgres -d signup_real_disposable -v ON_ERROR_STOP=1
    echo 'PASS: signup provisioner and D3 accept the complete D4-A contract'
    for provision_attempt in 1 2; do
      "${DOCKER[@]}" exec -i "$CID" psql -X -U postgres -d signup_real_disposable \
        -v ON_ERROR_STOP=1 -v owner_metrics_password=signup_metrics_disposable_only \
        < "$ROOT/scripts/provision-owner-metrics-role.sql" >/dev/null
    done
    echo 'PASS: metrics role provisioner is idempotent without replacing the guarded view'
    for fixture in missing_policy altered_policy extra_policy owner_drift no_force public_acl function_acl metrics_login_function_acl metrics_owner_function_acl view_definition guard_definition; do
      case "$fixture" in
        missing_policy) change='drop policy owner_metrics_users_select on public.users'; undo='create policy owner_metrics_users_select on public.users for select to cocinacore_metrics_view_owner using (true)' ;;
        altered_policy) change='alter policy owner_metrics_global_books_select on public.global_books using (false)'; undo='alter policy owner_metrics_global_books_select on public.global_books using (true)' ;;
        extra_policy) change='create policy d4a_unexpected_owner_select on public.platform_owners for select to cocinacore_runtime_rls using (true)'; undo='drop policy d4a_unexpected_owner_select on public.platform_owners' ;;
        owner_drift) change='alter view public.owner_global_metrics owner to postgres'; undo='alter view public.owner_global_metrics owner to cocinacore_metrics_view_owner' ;;
        no_force) change='alter table public.platform_owners no force row level security'; undo='alter table public.platform_owners force row level security' ;;
        public_acl) change='grant select on public.owner_global_metrics to public'; undo='revoke select on public.owner_global_metrics from public' ;;
        function_acl) change='grant execute on function public.match_chunks(vector, double precision, integer, uuid) to public'; undo='revoke execute on function public.match_chunks(vector, double precision, integer, uuid) from public' ;;
        metrics_login_function_acl) change='grant execute on function public.vector_dims(vector) to cocinacore_owner_metrics'; undo='revoke execute on function public.vector_dims(vector) from cocinacore_owner_metrics' ;;
        metrics_owner_function_acl) change='grant execute on function public.vector_dims(vector) to cocinacore_metrics_view_owner'; undo='revoke execute on function public.vector_dims(vector) from cocinacore_metrics_view_owner' ;;
        view_definition) change='create or replace view public.owner_global_metrics as select 0::bigint tenants, 0::bigint users, 0::bigint books, 0::bigint pdfs, 0::bigint chunks, 0::bigint reports, 0::bigint owners'; undo='__restore_view__' ;;
        guard_definition) change='create or replace view public.owner_metrics_rls_guard as select false as available'; undo='__restore_guard__' ;;
      esac
      saved_metrics_view=$({ "${DOCKER[@]}" exec "$CID" psql -X -U postgres -d signup_real_disposable -Atc "select pg_get_viewdef('public.owner_global_metrics'::regclass,true)"; } 2>/dev/null)
      saved_guard_view=$({ "${DOCKER[@]}" exec "$CID" psql -X -U postgres -d signup_real_disposable -Atc "select pg_get_viewdef('public.owner_metrics_rls_guard'::regclass,true)"; } 2>/dev/null)
      "${DOCKER[@]}" exec "$CID" psql -X -U postgres -d signup_real_disposable -v ON_ERROR_STOP=1 -c "$change" >/dev/null
      before=$(rls_state_fingerprint)
      if cat "$ROOT/scripts/rls-candidates/020d4a-owner-metrics.sql" |
        "${DOCKER[@]}" exec -i "$CID" psql -X -1 -U postgres -d signup_real_disposable -v ON_ERROR_STOP=1 >/dev/null 2>&1; then
        echo "FAIL: 020D4-A accepted incompatible $fixture" >&2
        exit 1
      fi
      after=$(rls_state_fingerprint)
      [[ "$before" == "$after" ]] || { echo "FAIL: 020D4-A mutated schema, roles, or populated metric data after rejecting $fixture" >&2; exit 1; }
      case "$undo" in
        __restore_view__)
          { printf 'create or replace view public.owner_global_metrics as\n%s;\nalter view public.owner_global_metrics owner to cocinacore_metrics_view_owner;\n' "$saved_metrics_view"; } |
            "${DOCKER[@]}" exec -i "$CID" psql -X -U postgres -d signup_real_disposable -v ON_ERROR_STOP=1 >/dev/null ;;
        __restore_guard__)
          { printf 'create or replace view public.owner_metrics_rls_guard as\n%s;\nalter view public.owner_metrics_rls_guard owner to cocinacore_metrics_view_owner;\n' "$saved_guard_view"; } |
            "${DOCKER[@]}" exec -i "$CID" psql -X -U postgres -d signup_real_disposable -v ON_ERROR_STOP=1 >/dev/null ;;
        *) "${DOCKER[@]}" exec "$CID" psql -X -U postgres -d signup_real_disposable -v ON_ERROR_STOP=1 -c "$undo" >/dev/null ;;
      esac
      echo "PASS: 020D4-A rejected $fixture without schema, role, or populated-data mutation"
    done

    echo 'Applying 020D4-B global writer policy candidate'
    cat "$ROOT/scripts/rls-candidates/020d4b-global-writer.sql" |
      "${DOCKER[@]}" exec -i "$CID" psql -X -1 -U postgres -d signup_real_disposable -v ON_ERROR_STOP=1
    echo 'PASS: D4-B initial state applied'
    cat "$ROOT/scripts/rls-candidates/020d4b-global-writer.sql" |
      "${DOCKER[@]}" exec -i "$CID" psql -X -1 -U postgres -d signup_real_disposable -v ON_ERROR_STOP=1
    writer_policy_count=$(( $("${DOCKER[@]}" exec "$CID" psql -X -U postgres -d signup_real_disposable -Atc \
      "select count(*) from pg_policy where polrelid in ('public.global_books'::regclass,'public.global_pdf_library'::regclass,'public.book_chunks'::regclass) and polname like 'owner_global_writer_%'") ))
    [[ "$writer_policy_count" == 4 ]] || { echo "FAIL: expected four D4-B writer policies, found $writer_policy_count" >&2; exit 1; }
    echo 'PASS: D4-B installs and idempotently accepts the exact four-policy writer contract'

    for candidate in 020d4a-owner-metrics.sql 020d3-documents-rag.sql; do
      cat "$ROOT/scripts/rls-candidates/$candidate" |
        "${DOCKER[@]}" exec -i "$CID" psql -X -1 -U postgres -d signup_real_disposable -v ON_ERROR_STOP=1
    done
    echo 'PASS: D4-A metrics guard and D3 documents/RAG candidate accept complete D4-B state'
    for attempt in 1 2; do
      "${DOCKER[@]}" exec -i "$CID" psql -X -U postgres -d signup_real_disposable -v ON_ERROR_STOP=1 \
        < "$ROOT/scripts/provision-signup-bootstrap-roles.sql" >/dev/null
      "${DOCKER[@]}" exec -i "$CID" psql -X -U postgres -d signup_real_disposable \
        -v ON_ERROR_STOP=1 -v owner_metrics_password=signup_metrics_disposable_only \
        < "$ROOT/scripts/provision-owner-metrics-role.sql" >/dev/null
      "${DOCKER[@]}" exec -i "$CID" psql -X -U postgres -d signup_real_disposable \
        -v ON_ERROR_STOP=1 -v global_writer_password=signup_writer_disposable_only \
        < "$ROOT/scripts/provision-global-writer-role.sql" >/dev/null
    done
    guard_available=$("${DOCKER[@]}" exec "$CID" psql -X -U postgres -d signup_real_disposable -Atc \
      'select available from public.owner_metrics_rls_guard')
    [[ "$guard_available" == t ]] || { echo 'FAIL: D4-B left owner metrics guard unavailable' >&2; exit 1; }
    echo 'PASS: identity, metrics, and writer provisioners remain idempotent after D4-B'

    for fixture in missing_policy using_change check_change role_change restrictive extra_policy no_force view_owner view_definition view_acl source_acl; do
      case "$fixture" in
        missing_policy)
          change='drop policy owner_global_writer_global_chunks_insert on public.book_chunks'
          undo="create policy owner_global_writer_global_chunks_insert on public.book_chunks for insert to cocinacore_global_writer_view_owner with check (source_type = 'global_pdf' AND tenant_id IS NULL AND tenant_book_id IS NULL AND global_book_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.global_books AS parent_book WHERE parent_book.id = book_chunks.global_book_id))" ;;
        using_change)
          change='alter policy owner_global_writer_global_books_select on public.global_books using (false)'
          undo='alter policy owner_global_writer_global_books_select on public.global_books using (true)' ;;
        check_change)
          change='alter policy owner_global_writer_global_books_insert on public.global_books with check (false)'
          undo='alter policy owner_global_writer_global_books_insert on public.global_books with check (length(btrim(title)) > 0)' ;;
        role_change)
          change='alter policy owner_global_writer_global_books_select on public.global_books to public'
          undo='alter policy owner_global_writer_global_books_select on public.global_books to cocinacore_global_writer_view_owner' ;;
        restrictive)
          change='drop policy owner_global_writer_global_books_select on public.global_books; create policy owner_global_writer_global_books_select on public.global_books as restrictive for select to cocinacore_global_writer_view_owner using (true)'
          undo='drop policy owner_global_writer_global_books_select on public.global_books; create policy owner_global_writer_global_books_select on public.global_books for select to cocinacore_global_writer_view_owner using (true)' ;;
        extra_policy)
          change='create policy d4b_unexpected_writer_policy on public.global_pdf_library for select to cocinacore_runtime_rls using (true)'
          undo='drop policy d4b_unexpected_writer_policy on public.global_pdf_library' ;;
        no_force)
          change='alter table public.book_chunks no force row level security'
          undo='alter table public.book_chunks force row level security' ;;
        view_owner)
          change='alter view public.owner_write_global_books owner to postgres'
          undo='alter view public.owner_write_global_books owner to cocinacore_global_writer_view_owner' ;;
        view_definition)
          change='create or replace view public.owner_write_global_pdfs as select global_book_id, storage_path, file_size_bytes, page_count, checksum_sha256, uploaded_by from public.global_pdf_library where true'
          undo='create or replace view public.owner_write_global_pdfs as select global_book_id, storage_path, file_size_bytes, page_count, checksum_sha256, uploaded_by from public.global_pdf_library' ;;
        view_acl)
          change='grant update on public.owner_write_global_pdfs to cocinacore_global_writer'
          undo='revoke update on public.owner_write_global_pdfs from cocinacore_global_writer' ;;
        source_acl)
          change='grant select on public.users to cocinacore_global_writer'
          undo='revoke select on public.users from cocinacore_global_writer' ;;
      esac
      "${DOCKER[@]}" exec "$CID" psql -X -U postgres -d signup_real_disposable -v ON_ERROR_STOP=1 -c "$change" >/dev/null
      before=$(rls_state_fingerprint)
      if cat "$ROOT/scripts/rls-candidates/020d4b-global-writer.sql" |
        "${DOCKER[@]}" exec -i "$CID" psql -X -1 -U postgres -d signup_real_disposable -v ON_ERROR_STOP=1 >/dev/null 2>&1; then
        echo "FAIL: D4-B accepted incompatible $fixture" >&2
        exit 1
      fi
      after=$(rls_state_fingerprint)
      [[ "$before" == "$after" ]] || { echo "FAIL: D4-B mutated schema, roles, or populated data after rejecting $fixture" >&2; exit 1; }
      "${DOCKER[@]}" exec "$CID" psql -X -U postgres -d signup_real_disposable -v ON_ERROR_STOP=1 -c "$undo" >/dev/null
      guard_available=$("${DOCKER[@]}" exec "$CID" psql -X -U postgres -d signup_real_disposable -Atc \
        'select available from public.owner_metrics_rls_guard')
      [[ "$guard_available" == t ]] || { echo "FAIL: D4-B fixture $fixture did not restore the approved state" >&2; exit 1; }
      echo "PASS: D4-B rejected $fixture without schema, role, or populated-data mutation"
    done

    echo 'Applying 020D5 tenant invitation summary boundary'
    cat "$ROOT/scripts/rls-candidates/020d5-residual-permissions.sql" |
      "${DOCKER[@]}" exec -i "$CID" psql -X -1 -U postgres -d signup_real_disposable -v ON_ERROR_STOP=1
    invitation_policy_hash=$("${DOCKER[@]}" exec "$CID" psql -X -U postgres -d signup_real_disposable -Atc \
      "select md5(pg_get_expr(polqual,polrelid)) from pg_policy where polrelid='public.tenant_invitations'::regclass")
    echo "020D5 policy expression MD5 (pin into candidate after review): $invitation_policy_hash"
    cat "$ROOT/scripts/rls-candidates/020d5-residual-permissions.sql" |
      "${DOCKER[@]}" exec -i "$CID" psql -X -1 -U postgres -d signup_real_disposable -v ON_ERROR_STOP=1
    echo 'PASS: 020D5 exact installed state is idempotently accepted'

    for fixture in using_change role_change extra_policy no_force extra_column_grant missing_summary_column unexpected_login_reader; do
      case "$fixture" in
        using_change)
          change='alter policy tenant_invitations_runtime_select on public.tenant_invitations using (true)'
          undo="alter policy tenant_invitations_runtime_select on public.tenant_invitations using (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid AND EXISTS (SELECT 1 FROM public.runtime_identity_probe))" ;;
        role_change)
          change='alter policy tenant_invitations_runtime_select on public.tenant_invitations to public'
          undo='alter policy tenant_invitations_runtime_select on public.tenant_invitations to cocinacore_runtime_rls' ;;
        extra_policy)
          change='create policy d5_unexpected_invitation_read on public.tenant_invitations for select to cocinacore_runtime_rls using (true)'
          undo='drop policy d5_unexpected_invitation_read on public.tenant_invitations' ;;
        no_force)
          change='alter table public.tenant_invitations no force row level security'
          undo='alter table public.tenant_invitations force row level security' ;;
        extra_column_grant)
          change='grant select (invited_by) on public.tenant_invitations to cocinacore_runtime_rls'
          undo='revoke select (invited_by) on public.tenant_invitations from cocinacore_runtime_rls' ;;
        missing_summary_column)
          change='revoke select (email) on public.tenant_invitations from cocinacore_runtime_rls'
          undo='grant select (email) on public.tenant_invitations to cocinacore_runtime_rls' ;;
        unexpected_login_reader)
          change='create role d5_unapproved_invitation_reader login nosuperuser nobypassrls noinherit; grant select (email) on public.tenant_invitations to d5_unapproved_invitation_reader'
          undo='revoke select (email) on public.tenant_invitations from d5_unapproved_invitation_reader; drop role d5_unapproved_invitation_reader' ;;
      esac
      "${DOCKER[@]}" exec "$CID" psql -X -U postgres -d signup_real_disposable -v ON_ERROR_STOP=1 -c "$change" >/dev/null
      before=$(rls_state_fingerprint)
      if cat "$ROOT/scripts/rls-candidates/020d5-residual-permissions.sql" |
        "${DOCKER[@]}" exec -i "$CID" psql -X -1 -U postgres -d signup_real_disposable -v ON_ERROR_STOP=1 >/dev/null 2>&1; then
        echo "FAIL: 020D5 accepted incompatible $fixture" >&2
        exit 1
      fi
      after=$(rls_state_fingerprint)
      [[ "$before" == "$after" ]] || { echo "FAIL: 020D5 mutated schema, roles, or populated invitation data after rejecting $fixture" >&2; exit 1; }
      "${DOCKER[@]}" exec "$CID" psql -X -U postgres -d signup_real_disposable -v ON_ERROR_STOP=1 -c "$undo" >/dev/null
      echo "PASS: 020D5 rejected $fixture without schema, role, or populated-data mutation"
    done

    run_auth_compatibility_tests() {
      DATABASE_URL="postgresql://cocinacore_runtime_rls:signup_disposable_only@127.0.0.1:$PORT/signup_real_disposable" \
      AUTH_DATABASE_URL="postgresql://cocinacore_auth:signup_auth_disposable_only@127.0.0.1:$PORT/signup_real_disposable" \
      COCINACORE_SEPARATE_AUTH_DB=true COCINACORE_SKIP_DOTENV=1 \
      COCINACORE_SIGNUP_BOOTSTRAP_TEST=1 COCINACORE_SIGNUP_REAL_SCHEMA_TEST=0 \
      node node_modules/vitest/vitest.mjs run \
        src/lib/db/repositories/signup-bootstrap.integration.test.ts \
        src/app/api/auth/signup/signup-bootstrap-http.integration.test.ts \
        --maxWorkers=1 --reporter=verbose
    }

    echo 'Checking signup before auth reprovisioning'
    run_auth_compatibility_tests
    echo 'PASS: secure signup, login, sessions, and password recovery before auth reprovisioning'

    echo 'Reprovisioning auth role in complete 020C1 state'
    "${DOCKER[@]}" exec -i "$CID" psql -X -U postgres -d signup_real_disposable \
      -v ON_ERROR_STOP=1 -v auth_password=signup_auth_disposable_only \
      < "$ROOT/scripts/provision-auth-role.sql" >/dev/null
    auth_secure_privileges=$("${DOCKER[@]}" exec "$CID" psql -X -U postgres -d signup_real_disposable -Atc \
      "select not has_table_privilege('cocinacore_auth','public.tenants','INSERT') and not has_table_privilege('cocinacore_auth','public.users','INSERT') and not has_table_privilege('cocinacore_auth','public.tenant_memberships','INSERT') and not has_any_column_privilege('cocinacore_auth','public.tenants','INSERT') and not has_any_column_privilege('cocinacore_auth','public.users','INSERT') and not has_any_column_privilege('cocinacore_auth','public.tenant_memberships','INSERT') and has_function_privilege('cocinacore_auth','public.signup_new_account(text,text,text,timestamptz,text)','EXECUTE') and not has_function_privilege('cocinacore_runtime_rls','public.signup_new_account(text,text,text,timestamptz,text)','EXECUTE') and not has_function_privilege('public','public.signup_new_account(text,text,text,timestamptz,text)','EXECUTE')")
    [[ "$auth_secure_privileges" == t ]] || { echo 'FAIL: auth reprovisioning restored unsafe signup INSERTs or function ACLs' >&2; exit 1; }
    echo 'PASS: auth reprovisioning preserves revoked direct INSERTs and exclusive bootstrap EXECUTE'

    echo 'Checking signup, login, sessions, and recovery after auth reprovisioning'
    run_auth_compatibility_tests
    echo 'PASS: secure signup, login, sessions, and password recovery after auth reprovisioning'

    for fixture in extra_policy using_change with_check_change role_change restrictive_policy policy_removed extra_membership_policy no_force direct_insert_acl public_function_execute; do
      case "$fixture" in
        extra_policy)
          change='create policy d5_unsafe_users_read on public.users for select to cocinacore_runtime_rls using (true)'
          undo='drop policy d5_unsafe_users_read on public.users' ;;
        using_change)
          change='alter policy identity_auth_users_read on public.users using (false)'
          undo='alter policy identity_auth_users_read on public.users using (true)' ;;
        with_check_change)
          change='alter policy identity_auth_users_insert on public.users with check (false)'
          undo='alter policy identity_auth_users_insert on public.users with check (true)' ;;
        role_change)
          change='alter policy identity_auth_tenants_read on public.tenants to public'
          undo='alter policy identity_auth_tenants_read on public.tenants to cocinacore_auth' ;;
        restrictive_policy)
          change="drop policy identity_auth_users_read on public.users; create policy identity_auth_users_read on public.users as restrictive for select to cocinacore_auth using (true)"
          undo="drop policy identity_auth_users_read on public.users; create policy identity_auth_users_read on public.users for select to cocinacore_auth using (true)" ;;
        policy_removed)
          change='drop policy identity_auth_membership_insert on public.tenant_memberships'
          undo="create policy identity_auth_membership_insert on public.tenant_memberships for insert to cocinacore_auth with check (role='owner' AND EXISTS (SELECT 1 FROM public.users u WHERE u.id=tenant_memberships.user_id AND u.tenant_id=tenant_memberships.tenant_id))" ;;
        extra_membership_policy)
          change='create policy d5_extra_membership_select on public.tenant_memberships for select to cocinacore_runtime_rls using (true)'
          undo='drop policy d5_extra_membership_select on public.tenant_memberships' ;;
        no_force)
          change='alter table public.users no force row level security'
          undo='alter table public.users force row level security' ;;
        direct_insert_acl)
          change='grant insert (name) on public.tenants to cocinacore_auth'
          undo='revoke insert (name) on public.tenants from cocinacore_auth' ;;
        public_function_execute)
          change='grant execute on function public.is_platform_owner(uuid) to public'
          undo='revoke execute on function public.is_platform_owner(uuid) from public' ;;
      esac
      "${DOCKER[@]}" exec "$CID" psql -X -U postgres -d signup_real_disposable -v ON_ERROR_STOP=1 -c "$change" >/dev/null
      before=$(rls_state_fingerprint)
      if "${DOCKER[@]}" exec -i "$CID" psql -X -U postgres -d signup_real_disposable \
        -v ON_ERROR_STOP=1 -v auth_password=signup_auth_disposable_only \
        < "$ROOT/scripts/provision-auth-role.sql" >/dev/null 2>&1; then
        echo "FAIL: auth provisioner accepted unsafe or partial $fixture" >&2
        exit 1
      fi
      after=$(rls_state_fingerprint)
      [[ "$before" == "$after" ]] || { echo "FAIL: auth provisioner mutated schema, roles, or populated identity data after rejecting $fixture" >&2; exit 1; }
      "${DOCKER[@]}" exec "$CID" psql -X -U postgres -d signup_real_disposable -v ON_ERROR_STOP=1 -c "$undo" >/dev/null
      echo "PASS: auth provisioner rejected $fixture without schema, role, or populated-data mutation"
    done
    for attempt in 1 2; do
      "${DOCKER[@]}" exec -i "$CID" psql -X -U postgres -d signup_real_disposable \
        -v ON_ERROR_STOP=1 -v auth_password=signup_auth_disposable_only \
        < "$ROOT/scripts/provision-auth-role.sql" >/dev/null
    done
    echo 'PASS: auth provisioner remains idempotent after secure reprovisioning and drift restoration'

    "${DOCKER[@]}" exec "$CID" psql -X -U postgres -d signup_real_disposable -v ON_ERROR_STOP=1 -c \
      "create role cocinacore_metrics_public_probe login password 'metrics_probe_disposable_only'; grant connect on database signup_real_disposable to cocinacore_metrics_public_probe; grant usage on schema public to cocinacore_metrics_public_probe" >/dev/null
    "${DOCKER[@]}" exec "$CID" psql -X -U postgres -d signup_real_disposable -v ON_ERROR_STOP=1 -c \
      "create role cocinacore_global_public_probe login password 'writer_probe_disposable_only'; grant connect on database signup_real_disposable to cocinacore_global_public_probe; grant usage on schema public to cocinacore_global_public_probe" >/dev/null
    metrics_owner_guard=$("${DOCKER[@]}" exec "$CID" psql -X -q -U postgres -d signup_real_disposable -Atc \
      'set role cocinacore_metrics_view_owner; select available from public.owner_metrics_rls_guard; reset role')
    [[ "$metrics_owner_guard" == t ]] || { echo 'FAIL: owner metrics guard is not true in its view-owner role context' >&2; exit 1; }
    echo 'PASS: metrics guard is valid in the restricted view-owner context'
    export COCINACORE_OWNER_METRICS_RLS_TEST=1
    export OWNER_METRICS_PUBLIC_PROBE_DATABASE_URL="postgresql://cocinacore_metrics_public_probe:metrics_probe_disposable_only@127.0.0.1:$PORT/signup_real_disposable"
    export OWNER_GLOBAL_WRITER_PUBLIC_PROBE_DATABASE_URL="postgresql://cocinacore_global_public_probe:writer_probe_disposable_only@127.0.0.1:$PORT/signup_real_disposable"
    export COCINACORE_SIGNUP_BOOTSTRAP_TEST=1
    export COCINACORE_IDENTITY_RLS_TEST=1
    export COCINACORE_INVENTORY_RLS_TEST=1
    export COCINACORE_PLANS_HISTORY_SHOPPING_RLS_TEST=1
    export COCINACORE_CULINARY_PROFILE_RLS_TEST=1
    export COCINACORE_DOCUMENTS_RAG_RLS_TEST=1
    export COCINACORE_TENANT_INVITATIONS_RLS_TEST=1
    export COCINACORE_OWNER_GLOBAL_WRITER_RLS_TEST=1
    test_files=(src/lib/db-global-writer.test.ts src/lib/owner/global-writer.integration.test.ts src/app/api/owner/global-pdfs/route.test.ts src/lib/db/repositories/documents-rag-rls.integration.test.ts src/lib/db/repositories/bookChunkRepository.test.ts src/lib/recipes/server-rag-context.test.ts src/services/__tests__/ragEngine.test.ts src/app/library/page.test.tsx src/lib/db/repositories/culinaryProfileRls.integration.test.ts src/lib/db/repositories/plans-history-shopping-rls.integration.test.ts src/lib/db/repositories/identity-rls.integration.test.ts src/lib/db/repositories/inventory-rls.integration.test.ts src/lib/db/repositories/tenant-invitations-rls.integration.test.ts src/lib/db/repositories/signup-bootstrap.integration.test.ts src/app/api/auth/signup/signup-bootstrap-http.integration.test.ts src/app/api/auth/login/route.test.ts src/lib/owner/metrics.integration.test.ts src/lib/db/repositories/platformOwnerRepository.test.ts src/app/owner/page.test.tsx) ;;
  shopping-transfer) test_files=(src/lib/db/repositories/shoppingListTransfer.integration.test.ts) ;;
  *) echo 'Unsupported disposable suite' >&2; exit 1 ;;
esac
DATABASE_URL="postgresql://cocinacore_runtime_rls:signup_disposable_only@127.0.0.1:$PORT/signup_real_disposable" \
  AUTH_DATABASE_URL="postgresql://cocinacore_auth:signup_auth_disposable_only@127.0.0.1:$PORT/signup_real_disposable" \
  COCINACORE_SEPARATE_AUTH_DB=true \
  COCINACORE_OWNER_METRICS_DB_ENABLED=true \
  COCINACORE_OWNER_GLOBAL_WRITER_ENABLED=false \
  OWNER_METRICS_DATABASE_URL="postgresql://cocinacore_owner_metrics:signup_metrics_disposable_only@127.0.0.1:$PORT/signup_real_disposable" \
  OWNER_GLOBAL_WRITER_DATABASE_URL="postgresql://cocinacore_global_writer:signup_writer_disposable_only@127.0.0.1:$PORT/signup_real_disposable" \
  COCINACORE_SIGNUP_BOOTSTRAP_TEST="${COCINACORE_SIGNUP_BOOTSTRAP_TEST:-0}" \
  COCINACORE_IDENTITY_RLS_TEST="${COCINACORE_IDENTITY_RLS_TEST:-0}" \
  COCINACORE_INVENTORY_RLS_TEST="${COCINACORE_INVENTORY_RLS_TEST:-0}" \
  COCINACORE_PLANS_HISTORY_SHOPPING_RLS_TEST="${COCINACORE_PLANS_HISTORY_SHOPPING_RLS_TEST:-0}" \
  COCINACORE_CULINARY_PROFILE_RLS_TEST="${COCINACORE_CULINARY_PROFILE_RLS_TEST:-0}" \
  COCINACORE_DOCUMENTS_RAG_RLS_TEST="${COCINACORE_DOCUMENTS_RAG_RLS_TEST:-0}" \
  COCINACORE_TENANT_INVITATIONS_RLS_TEST="${COCINACORE_TENANT_INVITATIONS_RLS_TEST:-0}" \
  COCINACORE_OWNER_GLOBAL_WRITER_RLS_TEST="${COCINACORE_OWNER_GLOBAL_WRITER_RLS_TEST:-0}" \
  COCINACORE_SIGNUP_REAL_SCHEMA_TEST=1 \
  node node_modules/vitest/vitest.mjs run "${test_files[@]}" \
  --maxWorkers=1 --reporter=verbose
if [[ "${COCINACORE_DISPOSABLE_SUITE:-signup}" == signup-bootstrap ]]; then
  echo 'Preparing an intentionally underprivileged wrong-auth-role fixture'
  "${DOCKER[@]}" exec "$CID" psql -X -U postgres -d signup_real_disposable -v ON_ERROR_STOP=1 \
    -c "create role cocinacore_wrong_auth login password 'signup_wrong_auth_disposable_only'; grant connect on database signup_real_disposable to cocinacore_wrong_auth; grant usage on schema public to cocinacore_wrong_auth; grant select on public.users to cocinacore_wrong_auth" >/dev/null
  DATABASE_URL="postgresql://cocinacore_runtime_rls:signup_disposable_only@127.0.0.1:$PORT/signup_real_disposable" \
    AUTH_DATABASE_URL="postgresql://cocinacore_wrong_auth:signup_wrong_auth_disposable_only@127.0.0.1:$PORT/signup_real_disposable" \
    COCINACORE_SEPARATE_AUTH_DB=true \
    COCINACORE_SIGNUP_BOOTSTRAP_TEST=0 \
    COCINACORE_SIGNUP_WRONG_ROLE_TEST=1 \
    COCINACORE_SIGNUP_REAL_SCHEMA_TEST=0 \
    COCINACORE_IDENTITY_RLS_TEST=0 \
    COCINACORE_INVENTORY_RLS_TEST=0 \
    node node_modules/vitest/vitest.mjs run src/app/api/auth/signup/signup-bootstrap-http.integration.test.ts \
      --maxWorkers=1 --reporter=verbose
  "${DOCKER[@]}" exec "$CID" psql -X -U postgres -d signup_real_disposable -v ON_ERROR_STOP=1 \
    -c 'revoke all on public.users from cocinacore_wrong_auth; revoke usage on schema public from cocinacore_wrong_auth; revoke connect on database signup_real_disposable from cocinacore_wrong_auth; drop role cocinacore_wrong_auth' >/dev/null
  echo 'PASS: wrong auth SQL role fails closed without fallback'
fi
if [[ "${COCINACORE_DISPOSABLE_SUITE:-signup}" == plans-history-shopping-rls ]]; then
  DATABASE_URL="postgresql://cocinacore_runtime_rls:signup_disposable_only@127.0.0.1:$PORT/signup_real_disposable" \
    AUTH_DATABASE_URL="postgresql://cocinacore_auth:signup_auth_disposable_only@127.0.0.1:$PORT/signup_real_disposable" \
    COCINACORE_SEPARATE_AUTH_DB=true \
    COCINACORE_SIGNUP_BOOTSTRAP_ENABLED=true \
    COCINACORE_SIGNUP_BOOTSTRAP_TEST=1 \
    COCINACORE_INVENTORY_RLS_TEST=1 \
    COCINACORE_SIGNUP_REAL_SCHEMA_TEST=1 \
    COCINACORE_SKIP_DOTENV=1 \
    node node_modules/vitest/vitest.mjs run src/app/api/auth/signup/signup-real-schema.integration.test.ts \
      --testNamePattern='runs M5 creation/completion and concurrent idempotent reconciliation' \
      --maxWorkers=1 --reporter=verbose
fi
check_space
