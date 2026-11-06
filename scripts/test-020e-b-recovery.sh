#!/usr/bin/env bash
set -Eeuo pipefail

ROOT=$(cd -- "$(dirname -- "$0")/.." && pwd)
NODE_22=/Users/yoryiabreu/.nvm/versions/node/v22.22.3/bin/node
IMAGE=pgvector/pgvector:pg16
DATABASE=signup_real_disposable
STAGE=initialization
PREFIX="cocinacore-020eb-$$-$(openssl rand -hex 3)"
TMP_ROOT=$(mktemp -d "${TMPDIR:-/tmp}/cocinacore-020eb.XXXXXXXX")
chmod 700 "$TMP_ROOT"
LOG="$TMP_ROOT/operation.log"
SOURCE_CONTAINER=
RESTORE_CONTAINER=
ADMIN_PASSWORD=$(openssl rand -hex 20)
MIGRATION_PASSWORD=$(openssl rand -hex 20)
RUNTIME_PASSWORD=$(openssl rand -hex 20)
AUTH_PASSWORD=$(openssl rand -hex 20)
METRICS_PASSWORD=$(openssl rand -hex 20)
WRITER_PASSWORD=$(openssl rand -hex 20)
RESTORE_ADMIN_PASSWORD=$(openssl rand -hex 20)
SOURCE_PORT=
RESTORE_PORT=
SOURCE_ADMIN_URL=
SOURCE_MIGRATION_URL=
RESTORE_ADMIN_URL=
RESTORE_MIGRATION_URL=
EXPECTED_020_SHA=1fbadb829792902ef19bdb0abd2c20e39409360986c9844d9cab3105df6eb33a
EXPECTED_020_BYTES=130680

fail() {
  printf 'FAIL stage=%s reason=%s\n' "$STAGE" "$1" >&2
  if [[ -f "$LOG" ]]; then
    "$NODE_22" - "$LOG" "$ADMIN_PASSWORD" "$MIGRATION_PASSWORD" "$RUNTIME_PASSWORD" \
      "$AUTH_PASSWORD" "$METRICS_PASSWORD" "$WRITER_PASSWORD" "$RESTORE_ADMIN_PASSWORD" <<'NODE' >&2
const fs = require('node:fs');
let text = fs.readFileSync(process.argv[2], 'utf8');
for (const secret of process.argv.slice(3)) text = text.split(secret).join('[redacted]');
text = text.replace(/postgres(?:ql)?:\/\/[^\s)"'`]+/g, '[database-url-redacted]');
process.stderr.write(text.split('\n').slice(-30).join('\n'));
NODE
  fi
  exit 1
}

cleanup() {
  local status=$?
  local attempt
  trap - EXIT INT TERM
  for attempt in 1 2 3 4 5; do
    [[ -z "$SOURCE_CONTAINER" ]] || docker rm -f "$SOURCE_CONTAINER" >/dev/null 2>&1 || true
    [[ -z "$RESTORE_CONTAINER" ]] || docker rm -f "$RESTORE_CONTAINER" >/dev/null 2>&1 || true
    if ! docker ps -a --format '{{.Names}}' | grep -q "^${PREFIX}-"; then break; fi
    sleep 1
  done
  local remaining=0
  if docker ps -a --format '{{.Names}}' | grep -q "^${PREFIX}-"; then remaining=1; fi
  if [[ "$TMP_ROOT" == "${TMPDIR:-/tmp}"/cocinacore-020eb.* ]]; then
    rm -rf -- "$TMP_ROOT" || remaining=1
    [[ ! -e "$TMP_ROOT" ]] || remaining=1
  else
    printf '%s\n' 'Cleanup refused an unexpected temporary directory path.' >&2
    remaining=1
  fi
  if [[ "$remaining" -ne 0 ]]; then
    printf '%s\n' 'Disposable cleanup verification failed.' >&2
    status=1
  else
    printf '%s\n' 'PASS cleanup: disposable containers and private temporary files removed'
  fi
  exit "$status"
}
trap cleanup EXIT INT TERM

[[ -x "$NODE_22" ]] || fail 'Node 22.22.3 executable missing'
[[ "$("$NODE_22" --version)" == v22.22.3 ]] || fail 'Node 22.22.3 is required'
docker image inspect "$IMAGE" >/dev/null 2>&1 || fail 'cached PostgreSQL 16 image is required; network pulls are disabled'
[[ "$(shasum -a 256 "$ROOT/db/migrations/020_tenant_rls_hardening.sql" | awk '{print $1}')" == "$EXPECTED_020_SHA" ]] || fail 'canonical 020 SHA-256 precondition changed'
[[ "$(wc -c <"$ROOT/db/migrations/020_tenant_rls_hardening.sql" | tr -d ' ')" == "$EXPECTED_020_BYTES" ]] || fail 'canonical 020 byte-length precondition changed'

set_check() { STAGE=$1; printf '020E-B stage=%s\n' "$STAGE"; }

start_cluster() {
  local suffix=$1 database=$2 username=$3 password=$4
  local container="${PREFIX}-${suffix}"
  docker run --pull=never --rm -d --name "$container" \
    --tmpfs /var/lib/postgresql/data:rw,nosuid,size=512m \
    -e POSTGRES_DB="$database" -e POSTGRES_USER="$username" -e POSTGRES_PASSWORD="$password" \
    -p 127.0.0.1::5432 "$IMAGE" >/dev/null
  [[ "$(docker inspect --format '{{index .HostConfig.Tmpfs "/var/lib/postgresql/data"}}' "$container")" == 'rw,nosuid,size=512m' ]] || fail 'disposable database storage is not tmpfs-only'
  [[ "$(docker inspect --format '{{len .Mounts}}' "$container")" == 0 ]] || fail 'disposable database unexpectedly has a persistent mount'
  STARTED_CONTAINER=$container
  case "$suffix" in
    source) SOURCE_CONTAINER=$container ;;
    restore*) RESTORE_CONTAINER=$container ;;
  esac
  local attempt=0
  until docker exec "$container" pg_isready -h 127.0.0.1 -U "$username" -d "$database" >/dev/null 2>&1; do
    attempt=$((attempt + 1))
    [[ "$attempt" -lt 60 ]] || fail 'PostgreSQL 16 disposable cluster did not become ready'
    sleep 1
  done
  [[ "$(docker exec "$container" psql -X -v ON_ERROR_STOP=1 -U "$username" -d "$database" -Atqc 'SELECT current_setting('"'"'server_version_num'"'"')::integer / 10000')" == 16 ]] || fail 'disposable container is not PostgreSQL 16'
  STARTED_PORT=$(docker port "$container" 5432/tcp | sed 's/.*://')
}

admin_sql() {
  local container=$1 database=$2; shift 2
  docker exec "$container" psql -X -v ON_ERROR_STOP=1 -U "$(admin_user_for "$container")" -d "$database" -Atqc "$*"
}

admin_user_for() {
  if [[ "$1" == "$SOURCE_CONTAINER" ]]; then printf '%s' cocinacore; else printf '%s' restore_admin; fi
}

psql_admin_file() {
  local container=$1 database=$2 file=$3; shift 3
  docker exec -i "$container" psql -X -v ON_ERROR_STOP=1 -U "$(admin_user_for "$container")" -d "$database" "$@" <"$file"
}

source_url() { printf 'postgresql://%s:%s@127.0.0.1:%s/%s' "$1" "$2" "$SOURCE_PORT" "$DATABASE"; }
restore_url() { printf 'postgresql://%s:%s@127.0.0.1:%s/%s' "$1" "$2" "$RESTORE_PORT" "$DATABASE"; }

provision_database() {
  COCINACORE_SKIP_DOTENV=1 COCINACORE_SEPARATED_DB_LANES_ENABLED=true \
    BOOTSTRAP_DATABASE_URL="$SOURCE_ADMIN_URL" MIGRATION_ADMIN_PASSWORD="$MIGRATION_PASSWORD" \
    "$NODE_22" "$ROOT/frontend/scripts/provision-database.js" >"$LOG" 2>&1 || fail 'official database provisioner rejected disposable 019 setup'
}

run_source_migration() {
  COCINACORE_SKIP_DOTENV=1 COCINACORE_SEPARATED_DB_LANES_ENABLED=true \
    MIGRATION_DATABASE_URL="$SOURCE_MIGRATION_URL" MIGRATIONS_DIR="$PRE020_DIR" \
    "$NODE_22" "$ROOT/frontend/scripts/run-migrations.js" --lane migration "$@" >"$LOG" 2>&1 || fail 'official restricted runner failed against disposable source'
}

run_source_020() {
  COCINACORE_SKIP_DOTENV=1 COCINACORE_SEPARATED_DB_LANES_ENABLED=true \
    MIGRATION_DATABASE_URL="$SOURCE_MIGRATION_URL" \
    "$NODE_22" "$ROOT/frontend/scripts/run-migrations.js" --lane migration "$@" >"$LOG" 2>&1
}

run_source_verify_complete() {
  COCINACORE_SKIP_DOTENV=1 COCINACORE_SEPARATED_DB_LANES_ENABLED=true \
    MIGRATION_DATABASE_URL="$SOURCE_MIGRATION_URL" \
    "$NODE_22" "$ROOT/frontend/scripts/run-migrations.js" --lane migration --verify-complete >"$LOG" 2>&1
}

run_restore_verify() {
  COCINACORE_SKIP_DOTENV=1 COCINACORE_SEPARATED_DB_LANES_ENABLED=true \
    MIGRATION_DATABASE_URL="$RESTORE_MIGRATION_URL" \
    "$NODE_22" "$ROOT/frontend/scripts/run-migrations.js" --lane migration --verify-complete >"$LOG" 2>&1
}

run_restore_verify_boundary() {
  COCINACORE_SKIP_DOTENV=1 COCINACORE_SEPARATED_DB_LANES_ENABLED=true \
    MIGRATION_DATABASE_URL="$RESTORE_MIGRATION_URL" MIGRATIONS_DIR="$PRE020_DIR" \
    "$NODE_22" "$ROOT/frontend/scripts/run-migrations.js" --lane migration --verify-boundary 019 >"$LOG" 2>&1
}

restore_global_roles() {
  local container=$1 globals=$2 sanitized="$TMP_ROOT/globals-restore.sql"
  grep -q '^GRANT cocinacore_schema_owner TO migration_admin' "$globals" || fail 'global dump omits expected migration-admin membership'
  grep -v '^GRANT cocinacore_schema_owner TO migration_admin' "$globals" >"$sanitized"
  chmod 600 "$sanitized"
  docker exec -i "$container" psql -X -v ON_ERROR_STOP=1 -U restore_admin -d postgres <"$sanitized" >"$LOG" 2>&1 || fail 'restoration of PostgreSQL global roles failed'
  docker exec "$container" psql -X -v ON_ERROR_STOP=1 -U restore_admin -d postgres -c \
    'GRANT cocinacore_schema_owner TO migration_admin WITH ADMIN FALSE, INHERIT FALSE, SET TRUE' >/dev/null || fail 'reviewed migration-admin membership could not be reprovisioned'
}

db_structure_fingerprint() {
  local container=$1 database=$2
  admin_sql "$container" "$database" "SELECT jsonb_build_object(
    'schemas',(SELECT coalesce(jsonb_agg(jsonb_build_array(nspname,pg_get_userbyid(nspowner)) ORDER BY nspname),'[]') FROM pg_namespace WHERE nspname='public'),
    'relations',(SELECT coalesce(jsonb_agg(jsonb_build_array(c.relname,c.relkind,c.relpersistence,c.relrowsecurity,c.relforcerowsecurity,pg_get_userbyid(c.relowner)) ORDER BY c.relname),'[]') FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m','S','f')),
    'columns',(SELECT coalesce(jsonb_agg(jsonb_build_array(c.relname,a.attnum,a.attname,format_type(a.atttypid,a.atttypmod),a.attnotnull,coalesce(pg_get_expr(d.adbin,d.adrelid),'-')) ORDER BY c.relname,a.attnum),'[]') FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace LEFT JOIN pg_attrdef d ON d.adrelid=c.oid AND d.adnum=a.attnum WHERE n.nspname='public' AND a.attnum>0 AND NOT a.attisdropped),
    'constraints',(SELECT coalesce(jsonb_agg(jsonb_build_array(c.relname,con.conname,con.contype,con.convalidated,con.condeferrable,con.condeferred,ARRAY(SELECT a.attname FROM unnest(con.conkey) WITH ORDINALITY k(attnum,ord) JOIN pg_attribute a ON a.attrelid=con.conrelid AND a.attnum=k.attnum ORDER BY k.ord),coalesce(parent.relname,'-'),ARRAY(SELECT a.attname FROM unnest(con.confkey) WITH ORDINALITY k(attnum,ord) JOIN pg_attribute a ON a.attrelid=con.confrelid AND a.attnum=k.attnum ORDER BY k.ord)) ORDER BY c.relname,con.conname),'[]') FROM pg_constraint con JOIN pg_class c ON c.oid=con.conrelid LEFT JOIN pg_class parent ON parent.oid=con.confrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public'),
    'indexes',(SELECT coalesce(jsonb_agg(jsonb_build_array(t.relname,i.relname,x.indisunique,x.indisprimary,x.indisvalid,x.indnkeyatts) ORDER BY t.relname,i.relname),'[]') FROM pg_index x JOIN pg_class t ON t.oid=x.indrelid JOIN pg_class i ON i.oid=x.indexrelid JOIN pg_namespace n ON n.oid=t.relnamespace WHERE n.nspname='public'),
    'functions',(SELECT coalesce(jsonb_agg(jsonb_build_array(p.proname,pg_get_function_identity_arguments(p.oid),l.lanname,p.prokind,p.provolatile,p.prosecdef,p.proconfig,md5(p.prosrc)) ORDER BY p.proname,pg_get_function_identity_arguments(p.oid)),'[]') FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_language l ON l.oid=p.prolang WHERE n.nspname='public'),
    'triggers',(SELECT coalesce(jsonb_agg(jsonb_build_array(c.relname,t.tgname,t.tgenabled,p.proname,md5(p.prosrc)) ORDER BY c.relname,t.tgname),'[]') FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_proc p ON p.oid=t.tgfoid WHERE n.nspname='public' AND NOT t.tgisinternal),
    'extensions',(SELECT coalesce(jsonb_agg(jsonb_build_array(e.extname,e.extversion,n.nspname) ORDER BY e.extname),'[]') FROM pg_extension e JOIN pg_namespace n ON n.oid=e.extnamespace),
    'policies',(SELECT coalesce(jsonb_agg(jsonb_build_array(c.relname,p.polname,p.polcmd,p.polpermissive,ARRAY(SELECT CASE WHEN roleid=0 THEN 'PUBLIC' ELSE r.rolname END FROM unnest(p.polroles) roleid LEFT JOIN pg_roles r ON r.oid=roleid ORDER BY 1),coalesce(pg_get_expr(p.polqual,p.polrelid),'-'),coalesce(pg_get_expr(p.polwithcheck,p.polrelid),'-')) ORDER BY c.relname,p.polname),'[]') FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public')
  )::text"
}

assert_structure_match() {
  local label=$1 left_container=$2 right_container=$3
  local left="$TMP_ROOT/${label}-left-catalog.json" right="$TMP_ROOT/${label}-right-catalog.json"
  db_structure_fingerprint "$left_container" "$DATABASE" >"$left"
  db_structure_fingerprint "$right_container" "$DATABASE" >"$right"
  if ! cmp -s "$left" "$right"; then
    python3 - "$left" "$right" >"$LOG" <<'PY'
import json, pathlib, sys
left=json.loads(pathlib.Path(sys.argv[1]).read_text())
right=json.loads(pathlib.Path(sys.argv[2]).read_text())
for key in left:
    if left[key] != right[key]:
        a,b=left[key],right[key]
        print(f"catalog component differs: {key}; source={len(a)} restored={len(b)}")
        if isinstance(a,list) and isinstance(b,list):
            for index in range(max(len(a),len(b))):
                av=a[index] if index < len(a) else None
                bv=b[index] if index < len(b) else None
                if av != bv:
                    print(f"first difference[{index}] source={json.dumps(av,sort_keys=True)[:600]} restored={json.dumps(bv,sort_keys=True)[:600]}")
                    break
PY
    fail "$label restored catalog structure differs"
  fi
}

db_owner_fingerprint() {
  local container=$1 database=$2
  admin_sql "$container" "$database" "SELECT md5(jsonb_build_object(
    'database',(SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname=current_database()),
    'relations',(SELECT coalesce(jsonb_agg(jsonb_build_array(c.relname,c.relkind,pg_get_userbyid(c.relowner)) ORDER BY c.relname),'[]') FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m','S','f')),
    'functions',(SELECT coalesce(jsonb_agg(jsonb_build_array(p.proname,pg_get_function_identity_arguments(p.oid),pg_get_userbyid(p.proowner)) ORDER BY p.proname,pg_get_function_identity_arguments(p.oid)),'[]') FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid='pg_proc'::regclass AND d.objid=p.oid AND d.refclassid='pg_extension'::regclass AND d.deptype='e')),
    'types',(SELECT coalesce(jsonb_agg(jsonb_build_array(t.typname,pg_get_userbyid(t.typowner)) ORDER BY t.typname),'[]') FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname='public' AND t.typtype IN ('e','d','c'))
  )::text)"
}

db_role_fingerprint() {
  local container=$1 database=$2
  admin_sql "$container" "$database" "SELECT md5(jsonb_build_object(
    'roles',(SELECT coalesce(jsonb_agg(jsonb_build_array(rolname,rolcanlogin,rolsuper,rolinherit,rolcreaterole,rolcreatedb,rolreplication,rolbypassrls,rolconnlimit,rolvaliduntil,rolconfig,shobj_description(oid,'pg_authid')) ORDER BY rolname),'[]') FROM pg_roles WHERE rolname<>'restore_admin'),
    'memberships',(SELECT coalesce(jsonb_agg(jsonb_build_array(role_name.rolname,member_name.rolname,m.admin_option,m.inherit_option,m.set_option) ORDER BY role_name.rolname,member_name.rolname),'[]') FROM pg_auth_members m JOIN pg_roles role_name ON role_name.oid=m.roleid JOIN pg_roles member_name ON member_name.oid=m.member WHERE role_name.rolname<>'restore_admin' AND member_name.rolname<>'restore_admin')
  )::text)"
}

db_acl_fingerprint() {
  local container=$1 database=$2
  local result
  result=$(admin_sql "$container" "$database" "WITH acl_entries AS (
    SELECT 'database'::text AS scope,d.datname AS object_name,CASE WHEN a.grantee=0 THEN 'PUBLIC' WHEN grantee.rolsuper THEN 'SUPERUSER' ELSE grantee.rolname END AS grantee,a.privilege_type AS privilege,a.is_grantable
      FROM pg_database d CROSS JOIN LATERAL aclexplode(coalesce(d.datacl,acldefault('d'::\"char\",d.datdba))) a LEFT JOIN pg_roles grantee ON grantee.oid=a.grantee WHERE d.datname=current_database()
    UNION ALL
    SELECT 'schema',n.nspname,CASE WHEN a.grantee=0 THEN 'PUBLIC' WHEN grantee.rolsuper THEN 'SUPERUSER' ELSE grantee.rolname END,a.privilege_type,a.is_grantable
      FROM pg_namespace n CROSS JOIN LATERAL aclexplode(coalesce(n.nspacl,acldefault('n'::\"char\",n.nspowner))) a LEFT JOIN pg_roles grantee ON grantee.oid=a.grantee WHERE n.nspname NOT LIKE 'pg\\_%' ESCAPE '\\' AND n.nspname<>'information_schema'
    UNION ALL
    SELECT 'relation',n.nspname||'.'||c.relname||':'||c.relkind::text,CASE WHEN a.grantee=0 THEN 'PUBLIC' WHEN grantee.rolsuper THEN 'SUPERUSER' ELSE grantee.rolname END,a.privilege_type,a.is_grantable
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace CROSS JOIN LATERAL aclexplode(coalesce(c.relacl,acldefault((CASE WHEN c.relkind='S' THEN 'S' ELSE 'r' END)::\"char\",c.relowner))) a LEFT JOIN pg_roles grantee ON grantee.oid=a.grantee WHERE n.nspname NOT LIKE 'pg\\_%' ESCAPE '\\' AND n.nspname<>'information_schema'
    UNION ALL
    SELECT 'column',n.nspname||'.'||c.relname||'.'||att.attname,CASE WHEN a.grantee=0 THEN 'PUBLIC' WHEN grantee.rolsuper THEN 'SUPERUSER' ELSE grantee.rolname END,a.privilege_type,a.is_grantable
      FROM pg_attribute att JOIN pg_class c ON c.oid=att.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace CROSS JOIN LATERAL aclexplode(att.attacl) a LEFT JOIN pg_roles grantee ON grantee.oid=a.grantee WHERE n.nspname NOT LIKE 'pg\\_%' ESCAPE '\\' AND n.nspname<>'information_schema' AND att.attnum>0 AND NOT att.attisdropped
    UNION ALL
    SELECT 'function',n.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')',CASE WHEN a.grantee=0 THEN 'PUBLIC' WHEN grantee.rolsuper THEN 'SUPERUSER' ELSE grantee.rolname END,a.privilege_type,a.is_grantable
      FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f'::\"char\",p.proowner))) a LEFT JOIN pg_roles grantee ON grantee.oid=a.grantee WHERE n.nspname NOT LIKE 'pg\\_%' ESCAPE '\\' AND n.nspname<>'information_schema'
    UNION ALL
    SELECT 'type',n.nspname||'.'||t.typname,CASE WHEN a.grantee=0 THEN 'PUBLIC' WHEN grantee.rolsuper THEN 'SUPERUSER' ELSE grantee.rolname END,a.privilege_type,a.is_grantable
      FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace CROSS JOIN LATERAL aclexplode(coalesce(t.typacl,acldefault('T'::\"char\",t.typowner))) a LEFT JOIN pg_roles grantee ON grantee.oid=a.grantee WHERE n.nspname NOT LIKE 'pg\\_%' ESCAPE '\\' AND n.nspname<>'information_schema'
    UNION ALL
    SELECT 'language',l.lanname,CASE WHEN a.grantee=0 THEN 'PUBLIC' WHEN grantee.rolsuper THEN 'SUPERUSER' ELSE grantee.rolname END,a.privilege_type,a.is_grantable
      FROM pg_language l CROSS JOIN LATERAL aclexplode(coalesce(l.lanacl,acldefault('l'::\"char\",l.lanowner))) a LEFT JOIN pg_roles grantee ON grantee.oid=a.grantee
    UNION ALL
    SELECT 'default',r.rolname||':'||coalesce(n.nspname,'-')||':'||d.defaclobjtype::text,CASE WHEN a.grantee=0 THEN 'PUBLIC' WHEN grantee.rolsuper THEN 'SUPERUSER' ELSE grantee.rolname END,a.privilege_type,a.is_grantable
      FROM pg_default_acl d JOIN pg_roles r ON r.oid=d.defaclrole LEFT JOIN pg_namespace n ON n.oid=d.defaclnamespace CROSS JOIN LATERAL aclexplode(d.defaclacl) a LEFT JOIN pg_roles grantee ON grantee.oid=a.grantee
  ) SELECT coalesce(string_agg(concat_ws('|',scope,object_name,grantee,privilege,is_grantable::text),E'\\n' ORDER BY scope,object_name,grantee,privilege,is_grantable),'') FROM acl_entries") || fail 'ACL fingerprint query failed'
  printf '%s\n' "$result"
}

db_data_fingerprint() {
  local container=$1 database=$2
  admin_sql "$container" "$database" "SELECT md5(jsonb_build_object(
    'tenants',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY id),'[]') FROM public.tenants t WHERE id::text LIKE 'e020b000-%'),
    'users',(SELECT coalesce(jsonb_agg(to_jsonb(u) ORDER BY id),'[]') FROM public.users u WHERE id::text LIKE 'e020b000-%'),
    'memberships',(SELECT coalesce(jsonb_agg(to_jsonb(m) ORDER BY tenant_id,user_id),'[]') FROM public.tenant_memberships m WHERE tenant_id::text LIKE 'e020b000-%'),
    'sessions',(SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY id),'[]') FROM public.sessions s WHERE token_hash LIKE '020eb-fixture-%'),
    'inventory',(SELECT coalesce(jsonb_agg(to_jsonb(i) ORDER BY id),'[]') FROM public.recipe_inventory_items i WHERE id::text LIKE 'e020b000-%'),
    'movements',(SELECT coalesce(jsonb_agg(to_jsonb(m) ORDER BY id),'[]') FROM public.inventory_movements m WHERE id::text LIKE 'e020b000-%'),
    'history',(SELECT coalesce(jsonb_agg(to_jsonb(h) ORDER BY id),'[]') FROM public.recipe_ai_history h WHERE id::text LIKE 'e020b000-%'),
    'recipes',(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY id),'[]') FROM public.user_recipes r WHERE id::text LIKE 'e020b000-%'),
    'versions',(SELECT coalesce(jsonb_agg(to_jsonb(v) ORDER BY id),'[]') FROM public.user_recipe_versions v WHERE id::text LIKE 'e020b000-%'),
    'plans',(SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY id),'[]') FROM public.user_meal_plans p WHERE id::text LIKE 'e020b000-%'),
    'shopping',(SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY id),'[]') FROM public.shopping_list_items s WHERE id::text LIKE 'e020b000-%'),
    'profiles',(SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY user_id),'[]') FROM public.user_culinary_profiles p WHERE user_id::text LIKE 'e020b000-%'),
    'profile_terms',(SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY user_id,term_id),'[]') FROM public.user_culinary_profile_terms p WHERE user_id::text LIKE 'e020b000-%'),
    'tenant_books',(SELECT coalesce(jsonb_agg(to_jsonb(b) ORDER BY id),'[]') FROM public.tenant_books b WHERE id::text LIKE 'e020b000-%'),
    'tenant_pdfs',(SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY id),'[]') FROM public.tenant_pdf_library p WHERE id::text LIKE 'e020b000-%'),
    'chunks',(SELECT coalesce(jsonb_agg(to_jsonb(c) ORDER BY id),'[]') FROM public.book_chunks c WHERE id::text LIKE 'e020b000-%'),
    'global_books',(SELECT coalesce(jsonb_agg(to_jsonb(b) ORDER BY id),'[]') FROM public.global_books b WHERE id::text LIKE 'e020b000-%'),
    'global_pdfs',(SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY id),'[]') FROM public.global_pdf_library p WHERE id::text LIKE 'e020b000-%'),
    'premium',(SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY id),'[]') FROM public.premium_recipes p WHERE id::text LIKE 'e020b000-%'),
    'reports',(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY id),'[]') FROM public.premium_review_reports r WHERE id::text LIKE 'e020b000-%'),
    'owners',(SELECT coalesce(jsonb_agg(to_jsonb(o) ORDER BY user_id),'[]') FROM public.platform_owners o WHERE user_id::text LIKE 'e020b000-%')
  )::text)"
}

db_all_data_fingerprint() {
  local container=$1 database=$2
  docker exec "$container" pg_dump --data-only --inserts -U "$(admin_user_for "$container")" -d "$database" \
    | sed '/^\\restrict /d; /^\\unrestrict /d' | shasum -a 256 | awk '{print $1}'
}

snapshot_fingerprint() {
  local container=$1 database=$2
  {
    docker exec "$container" pg_dumpall -U "$(admin_user_for "$container")" --globals-only
    docker exec "$container" pg_dump -U "$(admin_user_for "$container")" --data-only --inserts -d "$database"
    printf '%s\n' "$(db_structure_fingerprint "$container" "$database")" "$(db_owner_fingerprint "$container" "$database")" "$(db_data_fingerprint "$container" "$database")"
  } | sed '/^\\restrict /d; /^\\unrestrict /d' | shasum -a 256 | awk '{print $1}'
}

copy_pre020_manifest() {
  PRE020_DIR="$TMP_ROOT/manifest-019"
  mkdir -m 700 "$PRE020_DIR"
  "$NODE_22" - "$ROOT/db/migrations/manifest.json" "$ROOT/db/migrations" "$PRE020_DIR" <<'NODE'
const fs = require('node:fs');
const path = require('node:path');
const [manifestPath, sourceDir, targetDir] = process.argv.slice(2);
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const historical = manifest.migrations.filter((entry) => Number(entry.id) <= 19);
if (historical.length !== 19 || historical.at(-1)?.id !== '019') throw new Error('exact 001-019 manifest prefix required');
for (const entry of historical) fs.copyFileSync(path.join(sourceDir, entry.filename), path.join(targetDir, entry.filename));
fs.writeFileSync(path.join(targetDir, 'manifest.json'), `${JSON.stringify({...manifest, migrations: historical}, null, 2)}\n`, {mode: 0o600});
NODE
}

install_recovery_fixtures() {
  cat >"$TMP_ROOT/fixtures.sql" <<'SQL'
BEGIN;
INSERT INTO public.tenants(id,name,tenant_type,trial_started_at,trial_ends_at) VALUES
 ('e020b000-0000-4000-8000-000000000001','Recovery tenant A','home',now(),now()+interval '14 days'),
 ('e020b000-0000-4000-8000-000000000002','Recovery tenant B','professional',now(),now()+interval '14 days');
INSERT INTO public.users(id,email,password_hash,full_name,tenant_id,role,terms_accepted_at,terms_version,email_confirmed) VALUES
 ('e020b000-0000-4000-8000-000000000011','backup-a@example.test','fixture-hash-a','Backup A','e020b000-0000-4000-8000-000000000001','owner',now(),'v1',true),
 ('e020b000-0000-4000-8000-000000000012','backup-b@example.test','fixture-hash-b','Backup B','e020b000-0000-4000-8000-000000000002','owner',now(),'v1',true);
INSERT INTO public.tenant_memberships(tenant_id,user_id,role) VALUES
 ('e020b000-0000-4000-8000-000000000001','e020b000-0000-4000-8000-000000000011','owner'),
 ('e020b000-0000-4000-8000-000000000002','e020b000-0000-4000-8000-000000000012','owner');
INSERT INTO public.sessions(id,user_id,token_hash,expires_at) VALUES
 ('e020b000-0000-4000-8000-000000000021','e020b000-0000-4000-8000-000000000011','020eb-fixture-session-a',now()+interval '1 day'),
 ('e020b000-0000-4000-8000-000000000022','e020b000-0000-4000-8000-000000000012','020eb-fixture-session-b',now()+interval '1 day');
INSERT INTO public.recipe_inventory_items(id,tenant_id,user_id,ingredient_name,quantity,unit,category,normalized_name) VALUES
 ('e020b000-0000-4000-8000-000000000031','e020b000-0000-4000-8000-000000000001','e020b000-0000-4000-8000-000000000011','tomato','3','piece','produce','tomato'),
 ('e020b000-0000-4000-8000-000000000032','e020b000-0000-4000-8000-000000000002','e020b000-0000-4000-8000-000000000012','lentils','1','kg','pantry','lentils');
INSERT INTO public.inventory_movements(id,tenant_id,user_id,inventory_item_id,movement_type,quantity,unit,normalized_name) VALUES
 ('e020b000-0000-4000-8000-000000000041','e020b000-0000-4000-8000-000000000001','e020b000-0000-4000-8000-000000000011','e020b000-0000-4000-8000-000000000031','purchase',3,'piece','tomato'),
 ('e020b000-0000-4000-8000-000000000042','e020b000-0000-4000-8000-000000000002','e020b000-0000-4000-8000-000000000012','e020b000-0000-4000-8000-000000000032','purchase',1,'kg','lentils');
INSERT INTO public.recipe_ai_history(id,tenant_id,user_id,source,recipe_title,recipe_payload) VALUES
 ('e020b000-0000-4000-8000-000000000051','e020b000-0000-4000-8000-000000000001','e020b000-0000-4000-8000-000000000011','recovery-fixture','A recipe','{"title":"A recipe","steps":[]}'),
 ('e020b000-0000-4000-8000-000000000052','e020b000-0000-4000-8000-000000000002','e020b000-0000-4000-8000-000000000012','recovery-fixture','B recipe','{"title":"B recipe","steps":[]}');
INSERT INTO public.user_recipes(id,tenant_id,user_id,category,tags) VALUES
 ('e020b000-0000-4000-8000-000000000061','e020b000-0000-4000-8000-000000000001','e020b000-0000-4000-8000-000000000011','dinner',ARRAY['fixture']),
 ('e020b000-0000-4000-8000-000000000062','e020b000-0000-4000-8000-000000000002','e020b000-0000-4000-8000-000000000012','lunch',ARRAY['fixture']);
INSERT INTO public.user_recipe_versions(id,recipe_id,tenant_id,user_id,version_number,title,instructions,ingredients,source_recipe_history_id) VALUES
 ('e020b000-0000-4000-8000-000000000071','e020b000-0000-4000-8000-000000000061','e020b000-0000-4000-8000-000000000001','e020b000-0000-4000-8000-000000000011',1,'A recipe','Cook it','[{"name":"tomato"}]','e020b000-0000-4000-8000-000000000051'),
 ('e020b000-0000-4000-8000-000000000072','e020b000-0000-4000-8000-000000000062','e020b000-0000-4000-8000-000000000002','e020b000-0000-4000-8000-000000000012',1,'B recipe','Cook it','[{"name":"lentils"}]','e020b000-0000-4000-8000-000000000052');
INSERT INTO public.user_meal_plans(id,tenant_id,user_id,period,mode,base_cuisine) VALUES
 ('e020b000-0000-4000-8000-000000000081','e020b000-0000-4000-8000-000000000001','e020b000-0000-4000-8000-000000000011','week','balanced_ai','fixture-a'),
 ('e020b000-0000-4000-8000-000000000082','e020b000-0000-4000-8000-000000000002','e020b000-0000-4000-8000-000000000012','week','balanced_ai','fixture-b');
INSERT INTO public.user_meal_plan_inventory_suggestions(id,tenant_id,user_id,meal_plan_id,people_count,period,normalized_items,raw_items) VALUES
 ('e020b000-0000-4000-8000-000000000083','e020b000-0000-4000-8000-000000000001','e020b000-0000-4000-8000-000000000011','e020b000-0000-4000-8000-000000000081',2,'week','{"tomato":1}','{"tomato":1}');
INSERT INTO public.shopping_list_items(id,tenant_id,user_id,ingredient_name,quantity) VALUES
 ('e020b000-0000-4000-8000-000000000091','e020b000-0000-4000-8000-000000000001','e020b000-0000-4000-8000-000000000011','tomato','2'),
 ('e020b000-0000-4000-8000-000000000092','e020b000-0000-4000-8000-000000000002','e020b000-0000-4000-8000-000000000012','lentils','1');
INSERT INTO public.user_culinary_profiles(user_id,tenant_id,level) VALUES
 ('e020b000-0000-4000-8000-000000000011','e020b000-0000-4000-8000-000000000001','intermediate'),
 ('e020b000-0000-4000-8000-000000000012','e020b000-0000-4000-8000-000000000002','beginner');
INSERT INTO public.user_culinary_profile_terms(user_id,term_id,preference_type)
 SELECT 'e020b000-0000-4000-8000-000000000011',id,'prefer' FROM public.culinary_terms ORDER BY id LIMIT 1;
INSERT INTO public.tenant_books(id,tenant_id,title,author,description) VALUES
 ('e020b000-0000-4000-8000-000000000101','e020b000-0000-4000-8000-000000000001','Tenant A book','Author','A private book'),
 ('e020b000-0000-4000-8000-000000000102','e020b000-0000-4000-8000-000000000002','Tenant B book','Author','B private book');
INSERT INTO public.tenant_pdf_library(id,tenant_id,tenant_book_id,storage_path,uploaded_by,processing_status) VALUES
 ('e020b000-0000-4000-8000-000000000111','e020b000-0000-4000-8000-000000000001','e020b000-0000-4000-8000-000000000101','tenant-a/fixture.pdf','e020b000-0000-4000-8000-000000000011','ready'),
 ('e020b000-0000-4000-8000-000000000112','e020b000-0000-4000-8000-000000000002','e020b000-0000-4000-8000-000000000102','tenant-b/fixture.pdf','e020b000-0000-4000-8000-000000000012','ready');
INSERT INTO public.global_books(id,title,author,description,cuisine_region) VALUES
 ('e020b000-0000-4000-8000-000000000121','Global fixture book','Author','Global data','Global');
INSERT INTO public.global_pdf_library(id,global_book_id,storage_path,file_size_bytes,page_count,checksum_sha256,uploaded_by) VALUES
 ('e020b000-0000-4000-8000-000000000122','e020b000-0000-4000-8000-000000000121','global/fixture.pdf',4096,4,'fixture-checksum','e020b000-0000-4000-8000-000000000011');
INSERT INTO public.book_chunks(id,tenant_id,global_book_id,tenant_book_id,source_type,content,metadata,embedding) VALUES
 ('e020b000-0000-4000-8000-000000000131',NULL,'e020b000-0000-4000-8000-000000000121',NULL,'global_pdf','Global chunk','{"fixture":"global"}',array_fill(1::real,ARRAY[1536])::vector(1536)),
 ('e020b000-0000-4000-8000-000000000132','e020b000-0000-4000-8000-000000000001',NULL,'e020b000-0000-4000-8000-000000000101','tenant_pdf','Tenant A chunk','{"fixture":"tenant-a"}',array_fill(1::real,ARRAY[1536])::vector(1536)),
 ('e020b000-0000-4000-8000-000000000133','e020b000-0000-4000-8000-000000000002',NULL,'e020b000-0000-4000-8000-000000000102','tenant_pdf','Tenant B chunk','{"fixture":"tenant-b"}',array_fill(1::real,ARRAY[1536])::vector(1536));
INSERT INTO public.platform_owners(user_id,requires_manual_review) VALUES
 ('e020b000-0000-4000-8000-000000000011',false);
INSERT INTO public.premium_recipes(id,source_recipe_history_id,source_tenant_id,creator_user_id,creator_opted_in,status,published_at) VALUES
 ('e020b000-0000-4000-8000-000000000141','e020b000-0000-4000-8000-000000000051','e020b000-0000-4000-8000-000000000001','e020b000-0000-4000-8000-000000000011',true,'published',now());
INSERT INTO public.premium_review_reports(id,premium_recipe_id,reporter_user_id,reason) VALUES
 ('e020b000-0000-4000-8000-000000000142','e020b000-0000-4000-8000-000000000141','e020b000-0000-4000-8000-000000000012','Disposable recovery fixture');
COMMIT;
SQL
  docker exec -i "$SOURCE_CONTAINER" psql -X -v ON_ERROR_STOP=1 -U cocinacore -d "$DATABASE" <"$TMP_ROOT/fixtures.sql" >"$LOG" 2>&1 || fail 'representative pre-020 fixtures could not be inserted'
}

set_check source-019-bootstrap
start_cluster source "$DATABASE" cocinacore "$ADMIN_PASSWORD"
SOURCE_CONTAINER=$STARTED_CONTAINER
SOURCE_PORT=$STARTED_PORT
SOURCE_ADMIN_URL="postgresql://cocinacore:$ADMIN_PASSWORD@127.0.0.1:$SOURCE_PORT/$DATABASE"
SOURCE_MIGRATION_URL="postgresql://migration_admin:$MIGRATION_PASSWORD@127.0.0.1:$SOURCE_PORT/$DATABASE"
provision_database
copy_pre020_manifest
set_check source-019-migrations
run_source_migration --stop-after 019
[[ "$(admin_sql "$SOURCE_CONTAINER" "$DATABASE" "SELECT count(*) FROM public.schema_migrations")" == 19 ]] || fail 'source ledger is not exactly 001-019'
admin_sql "$SOURCE_CONTAINER" postgres "COMMENT ON DATABASE $DATABASE IS 'cocinacore-signup-real-disposable'" >/dev/null

set_check source-019-role-provisioning
docker exec -i "$SOURCE_CONTAINER" psql -X -v ON_ERROR_STOP=1 -v "runtime_password=$RUNTIME_PASSWORD" -U cocinacore -d "$DATABASE" <"$ROOT/scripts/provision-runtime-role.sql" >"$LOG" 2>&1 || fail 'runtime LOGIN provisioning failed'
docker exec -i "$SOURCE_CONTAINER" psql -X -v ON_ERROR_STOP=1 -v "auth_password=$AUTH_PASSWORD" -U cocinacore -d "$DATABASE" <"$ROOT/scripts/provision-auth-role.sql" >"$LOG" 2>&1 || fail 'auth LOGIN provisioning failed'
install_recovery_fixtures

set_check scenario-A-019-legacy-signup
run_signup_legacy_test() {
  local pattern=$1
  (cd "$ROOT/frontend" && \
    COCINACORE_SKIP_DOTENV=1 COCINACORE_SEPARATE_AUTH_DB=true \
    COCINACORE_SIGNUP_BOOTSTRAP_ENABLED=false COCINACORE_SIGNUP_MAINTENANCE=false \
    COCINACORE_SIGNUP_REAL_SCHEMA_TEST=1 \
    DATABASE_URL="postgresql://cocinacore_runtime_rls:$RUNTIME_PASSWORD@127.0.0.1:$SOURCE_PORT/$DATABASE" \
    AUTH_DATABASE_URL="postgresql://cocinacore_auth:$AUTH_PASSWORD@127.0.0.1:$SOURCE_PORT/$DATABASE" \
    SIGNUP_TEST_ADMIN_URL="$SOURCE_ADMIN_URL" \
    "$NODE_22" node_modules/vitest/vitest.mjs run src/app/api/auth/signup/signup-real-schema.integration.test.ts \
      --testNamePattern="$pattern" --maxWorkers=1 --reporter=dot) >"$LOG" 2>&1 || fail 'legacy signup on 019 failed'
  grep -E 'Test Files|Tests[[:space:]]+[0-9]+ passed' "$LOG" | tail -n 2
}
run_signup_legacy_test 'keeps legacy signup functional on the verified 019 boundary'

set_check scenario-019-backup
PRE020_DUMP="$TMP_ROOT/cocinacore-019.dump"
PRE020_GLOBALS="$TMP_ROOT/cocinacore-019-globals.sql"
PRE020_LIST="$TMP_ROOT/cocinacore-019.list"
docker exec "$SOURCE_CONTAINER" pg_dump -Fc -U cocinacore -d "$DATABASE" >"$PRE020_DUMP" || fail 'pg_dump custom backup of 019 failed'
docker exec "$SOURCE_CONTAINER" pg_dumpall --globals-only -U cocinacore >"$PRE020_GLOBALS" || fail 'global role/ACL export failed'
chmod 600 "$PRE020_DUMP" "$PRE020_GLOBALS"
PRE020_SHA=$(shasum -a 256 "$PRE020_DUMP" | awk '{print $1}')
printf '%s  %s\n' "$PRE020_SHA" "$(basename "$PRE020_DUMP")" >"$PRE020_DUMP.sha256"
chmod 600 "$PRE020_DUMP.sha256"
(cd "$TMP_ROOT" && shasum -a 256 -c "$(basename "$PRE020_DUMP").sha256") >"$LOG" 2>&1 || fail 'pre-020 archive SHA-256 verification failed'
docker cp "$PRE020_DUMP" "$SOURCE_CONTAINER:/tmp/020eb-019.dump" >/dev/null
docker exec "$SOURCE_CONTAINER" pg_restore --list /tmp/020eb-019.dump >"$PRE020_LIST" || fail 'pre-020 custom backup is unreadable by pg_restore --list'
grep -q 'TABLE public schema_migrations' "$PRE020_LIST" || fail 'pre-020 archive omits migration ledger'

set_check restore-019-independent-cluster
start_cluster restore019 postgres restore_admin "$RESTORE_ADMIN_PASSWORD"
RESTORE_CONTAINER=$STARTED_CONTAINER
RESTORE_PORT=$STARTED_PORT
RESTORE_MIGRATION_URL="postgresql://migration_admin:$MIGRATION_PASSWORD@127.0.0.1:$RESTORE_PORT/$DATABASE"
restore_global_roles "$RESTORE_CONTAINER" "$PRE020_GLOBALS"
docker exec "$RESTORE_CONTAINER" psql -X -v ON_ERROR_STOP=1 -U restore_admin -d postgres -c \
  "CREATE DATABASE $DATABASE OWNER cocinacore" >/dev/null || fail '019 restore database creation failed'
docker exec "$RESTORE_CONTAINER" psql -X -v ON_ERROR_STOP=1 -U restore_admin -d postgres -c \
  "REVOKE CREATE,TEMP ON DATABASE $DATABASE FROM PUBLIC; GRANT CONNECT ON DATABASE $DATABASE TO migration_admin,cocinacore_runtime_rls,cocinacore_auth; GRANT CREATE ON DATABASE $DATABASE TO cocinacore_schema_owner" >/dev/null || fail '019 restore database ACL bootstrap failed'
docker cp "$PRE020_DUMP" "$RESTORE_CONTAINER:/tmp/020eb-019.dump" >/dev/null
docker exec "$RESTORE_CONTAINER" pg_restore --exit-on-error -U restore_admin -d "$DATABASE" /tmp/020eb-019.dump >"$LOG" 2>&1 || fail 'pre-020 archive restore failed in independent cluster'
docker exec "$RESTORE_CONTAINER" psql -X -v ON_ERROR_STOP=1 -U restore_admin -d "$DATABASE" -c \
  "COMMENT ON DATABASE $DATABASE IS 'cocinacore-signup-real-disposable'" >/dev/null
assert_structure_match restore-019 "$SOURCE_CONTAINER" "$RESTORE_CONTAINER"
[[ "$(db_owner_fingerprint "$SOURCE_CONTAINER" "$DATABASE")" == "$(db_owner_fingerprint "$RESTORE_CONTAINER" "$DATABASE")" ]] || fail '019 restored object owners differ'
SOURCE_019_ACL=$(db_acl_fingerprint "$SOURCE_CONTAINER" "$DATABASE") || fail 'source 019 ACL fingerprint failed'
RESTORE_019_ACL=$(db_acl_fingerprint "$RESTORE_CONTAINER" "$DATABASE") || fail 'restored 019 ACL fingerprint failed'
if [[ "$SOURCE_019_ACL" != "$RESTORE_019_ACL" ]]; then
  printf '%s\n' "$SOURCE_019_ACL" >"$TMP_ROOT/source-019-acls.txt"
  printf '%s\n' "$RESTORE_019_ACL" >"$TMP_ROOT/restore-019-acls.txt"
  diff -u "$TMP_ROOT/source-019-acls.txt" "$TMP_ROOT/restore-019-acls.txt" >"$LOG" || true
  fail '019 restored database/object ACLs differ'
fi
SOURCE_019_ROLES=$(db_role_fingerprint "$SOURCE_CONTAINER" "$DATABASE") || fail 'source 019 role fingerprint failed'
RESTORE_019_ROLES=$(db_role_fingerprint "$RESTORE_CONTAINER" "$DATABASE") || fail 'restored 019 role fingerprint failed'
[[ "$SOURCE_019_ROLES" == "$RESTORE_019_ROLES" ]] || fail '019 restored role attributes, settings, comments, or memberships differ'
[[ "$(db_data_fingerprint "$SOURCE_CONTAINER" "$DATABASE")" == "$(db_data_fingerprint "$RESTORE_CONTAINER" "$DATABASE")" ]] || fail '019 restored representative data/relationship fingerprint differs'
[[ "$(db_all_data_fingerprint "$SOURCE_CONTAINER" "$DATABASE")" == "$(db_all_data_fingerprint "$RESTORE_CONTAINER" "$DATABASE")" ]] || fail '019 restored complete database data differs'
run_restore_verify_boundary || fail 'official --verify-boundary rejected independently restored 019 state'
[[ "$(admin_sql "$RESTORE_CONTAINER" "$DATABASE" "SELECT count(*) FROM public.schema_migrations")" == 19 ]] || fail '019 restored ledger is not exact'
[[ "$(admin_sql "$SOURCE_CONTAINER" "$DATABASE" "SELECT count(*) FROM pg_catalog.pg_policy")" == "$(admin_sql "$RESTORE_CONTAINER" "$DATABASE" "SELECT count(*) FROM pg_catalog.pg_policy")" ]] || fail '019 restore policy count differs from source boundary'
[[ "$(admin_sql "$RESTORE_CONTAINER" "$DATABASE" "SELECT count(*) FROM public.sessions WHERE token_hash LIKE '020eb-fixture-%'")" == 2 ]] || fail 'restored 019 session fixtures missing'
[[ "$(admin_sql "$RESTORE_CONTAINER" "$DATABASE" "SELECT count(*) FROM pg_roles WHERE rolname IN ('cocinacore_auth','cocinacore_runtime_rls','migration_admin','cocinacore_schema_owner')")" == 4 ]] || fail 'restored global identities missing'
[[ "$(admin_sql "$RESTORE_CONTAINER" "$DATABASE" "SELECT NOT rolsuper AND NOT rolbypassrls AND rolcanlogin FROM pg_roles WHERE rolname='cocinacore_auth'")" == t ]] || fail 'restored auth LOGIN role attributes changed'
[[ "$(admin_sql "$RESTORE_CONTAINER" "$DATABASE" "SELECT count(*) FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.member WHERE r.rolname IN ('cocinacore_auth','cocinacore_runtime_rls')")" == 0 ]] || fail 'restored LOGIN identities have unexpected memberships'
[[ "$(docker exec -e PGPASSWORD="$AUTH_PASSWORD" "$RESTORE_CONTAINER" psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -U cocinacore_auth -d "$DATABASE" -Atqc 'SELECT current_user')" == cocinacore_auth ]] || fail 'restored auth identity could not connect using recovered password hash'
[[ "$(docker exec -e PGPASSWORD="$RUNTIME_PASSWORD" "$RESTORE_CONTAINER" psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -U cocinacore_runtime_rls -d "$DATABASE" -Atqc 'SELECT current_user')" == cocinacore_runtime_rls ]] || fail 'restored data identity could not connect using recovered password hash'
printf '%s\n' 'PASS scenario A: 019 backup read, SHA-256, independent restore, role globals, ACLs, fixtures and ledger verified'

set_check scenario-B-a1p-transaction-rollback
BEFORE_B=$(snapshot_fingerprint "$SOURCE_CONTAINER" "$DATABASE")
admin_sql "$SOURCE_CONTAINER" "$DATABASE" "CREATE SCHEMA e020b_inject AUTHORIZATION cocinacore; CREATE FUNCTION e020b_inject.fail_a1p() RETURNS event_trigger LANGUAGE plpgsql AS \$\$ BEGIN RAISE EXCEPTION '020EB_INJECT_A1P_FAILURE'; END \$\$; CREATE EVENT TRIGGER e020b_fail_a1p ON ddl_command_start WHEN TAG IN ('CREATE VIEW') EXECUTE FUNCTION e020b_inject.fail_a1p()" >/dev/null || fail 'could not install disposable A1-P failure injection'
if docker exec -i "$SOURCE_CONTAINER" psql -X -1 -v ON_ERROR_STOP=1 -v "metrics_password=$METRICS_PASSWORD" \
  -v "global_writer_password=$WRITER_PASSWORD" -U cocinacore -d "$DATABASE" \
  <"$ROOT/scripts/provision-020-inert-capabilities.sql" >"$LOG" 2>&1; then
  fail 'A1-P failure injection unexpectedly succeeded'
fi
grep -q '020EB_INJECT_A1P_FAILURE' "$LOG" || fail 'A1-P injection did not fail inside the preparation transaction'
admin_sql "$SOURCE_CONTAINER" "$DATABASE" 'DROP EVENT TRIGGER e020b_fail_a1p; DROP SCHEMA e020b_inject CASCADE' >/dev/null
AFTER_B=$(snapshot_fingerprint "$SOURCE_CONTAINER" "$DATABASE")
[[ "$BEFORE_B" == "$AFTER_B" ]] || fail 'A1-P failure did not fully roll back roles, objects, ACL, data and ledger'
[[ "$(admin_sql "$SOURCE_CONTAINER" "$DATABASE" "SELECT count(*) FROM public.schema_migrations")" == 19 ]] || fail 'A1-P failure changed the 019 ledger'
printf '%s\n' 'PASS scenario B: injected A1-P DDL failure rolled back completely'

set_check scenario-A1p-success-and-idempotence
docker exec -i "$SOURCE_CONTAINER" psql -X -1 -v ON_ERROR_STOP=1 -v "metrics_password=$METRICS_PASSWORD" \
  -v "global_writer_password=$WRITER_PASSWORD" -U cocinacore -d "$DATABASE" \
  <"$ROOT/scripts/provision-020-inert-capabilities.sql" >"$LOG" 2>&1 || fail 'A1-P did not prepare inert capabilities'
docker exec -i "$SOURCE_CONTAINER" psql -X -v ON_ERROR_STOP=1 -U cocinacore -d "$DATABASE" \
  <"$ROOT/scripts/rls-candidates/020e-a1-inert-capability-guard.sql" >"$LOG" 2>&1 || fail 'A1-P inert guard rejected prepared state'
INERT_BEFORE=$(snapshot_fingerprint "$SOURCE_CONTAINER" "$DATABASE")
docker exec -i "$SOURCE_CONTAINER" psql -X -1 -v ON_ERROR_STOP=1 -v "metrics_password=$METRICS_PASSWORD" \
  -v "global_writer_password=$WRITER_PASSWORD" -U cocinacore -d "$DATABASE" \
  <"$ROOT/scripts/provision-020-inert-capabilities.sql" >"$LOG" 2>&1 || fail 'A1-P idempotent rerun failed'
INERT_AFTER=$(snapshot_fingerprint "$SOURCE_CONTAINER" "$DATABASE")
[[ "$INERT_BEFORE" == "$INERT_AFTER" ]] || fail 'A1-P rerun modified prepared state'
[[ "$(admin_sql "$SOURCE_CONTAINER" "$DATABASE" "SELECT count(*) FROM public.schema_migrations")" == 19 ]] || fail 'A1-P unexpectedly changed ledger'
printf '%s\n' 'PASS A1-P: inert state attested and repeated provisioner was a no-op'

set_check scenario-C-migration-020-rollback
BEFORE_C=$(snapshot_fingerprint "$SOURCE_CONTAINER" "$DATABASE")
POLICY_COUNT_BEFORE_C=$(admin_sql "$SOURCE_CONTAINER" "$DATABASE" "SELECT count(*) FROM pg_catalog.pg_policy")
admin_sql "$SOURCE_CONTAINER" "$DATABASE" "CREATE SCHEMA e020b_inject AUTHORIZATION cocinacore; CREATE FUNCTION e020b_inject.fail_migration() RETURNS event_trigger LANGUAGE plpgsql AS \$\$ BEGIN RAISE EXCEPTION '020EB_INJECT_MIGRATION_FAILURE'; END \$\$; CREATE EVENT TRIGGER e020b_fail_migration ON ddl_command_start WHEN TAG IN ('CREATE POLICY') EXECUTE FUNCTION e020b_inject.fail_migration()" >/dev/null || fail 'could not install disposable migration failure injection'
if run_source_020; then fail 'canonical 020 DDL failure injection unexpectedly succeeded'; fi
grep -q '020EB_INJECT_MIGRATION_FAILURE' "$LOG" || fail 'canonical runner did not hit the expected injected policy failure'
admin_sql "$SOURCE_CONTAINER" "$DATABASE" 'DROP EVENT TRIGGER e020b_fail_migration; DROP SCHEMA e020b_inject CASCADE' >/dev/null
AFTER_C=$(snapshot_fingerprint "$SOURCE_CONTAINER" "$DATABASE")
[[ "$BEFORE_C" == "$AFTER_C" ]] || fail '020 migration error did not roll back schema, ACL, fixtures and prepared state'
[[ "$(admin_sql "$SOURCE_CONTAINER" "$DATABASE" "SELECT count(*) FROM public.schema_migrations")" == 19 ]] || fail 'failed canonical 020 left a ledger row'
[[ "$(admin_sql "$SOURCE_CONTAINER" "$DATABASE" "SELECT count(*) FROM pg_catalog.pg_policy")" == "$POLICY_COUNT_BEFORE_C" ]] || fail 'failed canonical 020 left policies behind'
printf '%s\n' 'PASS scenario C: official runner failure rolled canonical migration 020 back to exact prepared 019'

set_check scenario-020-install-and-R4-pending
run_source_020 || fail 'canonical 020 could not apply after failure rollback'
[[ "$(admin_sql "$SOURCE_CONTAINER" "$DATABASE" "SELECT count(*) FROM public.schema_migrations")" == 20 ]] || fail 'canonical 020 ledger row missing'
if run_source_verify_complete; then fail 'verify-complete accepted activation-pending state'; fi
grep -q 'ACTIVATION_PENDING\|CAPABILITIES_PENDING\|activation' "$LOG" || fail 'verify-complete did not report R4 activation pending'
[[ "$(admin_sql "$SOURCE_CONTAINER" "$DATABASE" "SELECT NOT has_function_privilege('cocinacore_auth','public.signup_new_account(text,text,text,timestamptz,text)','EXECUTE') AND NOT has_table_privilege('cocinacore_owner_metrics','public.owner_global_metrics','SELECT') AND NOT has_table_privilege('cocinacore_global_writer','public.owner_write_global_books','INSERT')")" == t ]] || fail '020 pending state has active signup/metrics/writer grants'
BEFORE_LEGACY=$(db_data_fingerprint "$SOURCE_CONTAINER" "$DATABASE")
if docker exec -e PGPASSWORD="$AUTH_PASSWORD" "$SOURCE_CONTAINER" psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 \
  -U cocinacore_auth -d "$DATABASE" -c "INSERT INTO public.tenants(name) VALUES ('legacy rollback probe')" >"$LOG" 2>&1; then
  fail 'legacy application direct INSERT remained possible after 020'
fi
grep -Eq 'permission denied|insufficient_privilege' "$LOG" || fail 'legacy direct INSERT did not fail due to revoked SQL privilege'
[[ "$(db_data_fingerprint "$SOURCE_CONTAINER" "$DATABASE")" == "$BEFORE_LEGACY" ]] || fail 'legacy app denial changed data'
printf '%s\n' 'PASS scenario D: canonical 020 is installed with R4 pending, legacy INSERT denied, and no activation grants'

set_check scenario-D-http-maintenance
run_signup_maintenance_test() {
  (cd "$ROOT/frontend" && \
    COCINACORE_SKIP_DOTENV=1 COCINACORE_SEPARATE_AUTH_DB=true \
    COCINACORE_SIGNUP_BOOTSTRAP_TEST=1 COCINACORE_SIGNUP_MAINTENANCE=false \
    DATABASE_URL="postgresql://cocinacore_runtime_rls:$RUNTIME_PASSWORD@127.0.0.1:$SOURCE_PORT/$DATABASE" \
    AUTH_DATABASE_URL="postgresql://cocinacore_auth:$AUTH_PASSWORD@127.0.0.1:$SOURCE_PORT/$DATABASE" \
    SIGNUP_TEST_ADMIN_URL="$SOURCE_ADMIN_URL" \
    "$NODE_22" node_modules/vitest/vitest.mjs run src/app/api/auth/signup/signup-bootstrap-http.integration.test.ts \
      --testNamePattern='serves signup maintenance over HTTP' --maxWorkers=1 --reporter=dot) >"$LOG" 2>&1 || fail 'real HTTP signup maintenance or preserved login smoke failed'
  grep -E 'Test Files|Tests[[:space:]]+[0-9]+ passed' "$LOG" | tail -n 2
}

run_restored_signup_http_test() {
  (cd "$ROOT/frontend" && \
    COCINACORE_SKIP_DOTENV=1 COCINACORE_SEPARATE_AUTH_DB=true \
    COCINACORE_SIGNUP_BOOTSTRAP_TEST=1 COCINACORE_SIGNUP_MAINTENANCE=false \
    DATABASE_URL="postgresql://cocinacore_runtime_rls:$RUNTIME_PASSWORD@127.0.0.1:$RESTORE_PORT/$DATABASE" \
    AUTH_DATABASE_URL="postgresql://cocinacore_auth:$AUTH_PASSWORD@127.0.0.1:$RESTORE_PORT/$DATABASE" \
    SIGNUP_TEST_ADMIN_URL="$RESTORE_ADMIN_URL" \
    "$NODE_22" node_modules/vitest/vitest.mjs run src/app/api/auth/signup/signup-bootstrap-http.integration.test.ts \
      --testNamePattern='creates account, owner membership and session; login and duplicate work' --maxWorkers=1 --reporter=dot) >"$LOG" 2>&1 || fail 'restored post-020 HTTP signup/login/reset flow failed'
  grep -E 'Test Files|Tests[[:space:]]+[0-9]+ passed' "$LOG" | tail -n 2
}
run_signup_maintenance_test
printf '%s\n' 'PASS scenario D HTTP: signup returned generic 503 with unchanged tenant/user/membership/session counts; login still succeeded'

set_check scenario-E-R4-atomic-failure
BEFORE_E=$(admin_sql "$SOURCE_CONTAINER" "$DATABASE" "SELECT md5(concat_ws('|',has_function_privilege('cocinacore_auth','public.signup_new_account(text,text,text,timestamptz,text)','EXECUTE'),has_table_privilege('cocinacore_runtime_rls','public.runtime_identity_probe','SELECT'),has_table_privilege('cocinacore_owner_metrics','public.owner_global_metrics','SELECT'),has_table_privilege('cocinacore_global_writer','public.owner_write_global_books','INSERT'),has_table_privilege('cocinacore_global_writer','public.owner_write_global_pdfs','INSERT'),has_table_privilege('cocinacore_global_writer','public.owner_write_global_chunks','INSERT')))" )
admin_sql "$SOURCE_CONTAINER" "$DATABASE" "CREATE SCHEMA e020b_inject AUTHORIZATION cocinacore; CREATE SEQUENCE e020b_inject.grant_count; GRANT USAGE ON SCHEMA e020b_inject TO cocinacore_signup_bootstrap,cocinacore_identity_probe,cocinacore_metrics_view_owner,cocinacore_global_writer_view_owner; GRANT USAGE,SELECT,UPDATE ON SEQUENCE e020b_inject.grant_count TO cocinacore_signup_bootstrap,cocinacore_identity_probe,cocinacore_metrics_view_owner,cocinacore_global_writer_view_owner; CREATE FUNCTION e020b_inject.fail_after_first_grant() RETURNS event_trigger LANGUAGE plpgsql AS \$\$ DECLARE n bigint; BEGIN n:=nextval('e020b_inject.grant_count'); IF n >= 2 THEN RAISE EXCEPTION '020EB_INJECT_R4_FAILURE'; END IF; END \$\$; REVOKE ALL ON SCHEMA e020b_inject FROM PUBLIC; REVOKE ALL ON FUNCTION e020b_inject.fail_after_first_grant() FROM PUBLIC; CREATE EVENT TRIGGER e020b_fail_r4 ON ddl_command_end WHEN TAG IN ('GRANT') EXECUTE FUNCTION e020b_inject.fail_after_first_grant()" >/dev/null || fail 'could not install R4 failure injection'
if COCINACORE_ACTIVATION_DATABASE_URL="$SOURCE_ADMIN_URL" "$NODE_22" "$ROOT/frontend/scripts/activate-020-capabilities.js" >"$LOG" 2>&1; then
  fail 'R4 partial-grant failure injection unexpectedly succeeded'
fi
grep -q '020_CAPABILITY_ACTIVATION_REJECTED' "$LOG" || fail 'R4 failure did not reject activation'
[[ "$(admin_sql "$SOURCE_CONTAINER" "$DATABASE" 'SELECT last_value FROM e020b_inject.grant_count')" == 2 ]] || fail 'R4 injection did not fail after a grant command'
admin_sql "$SOURCE_CONTAINER" "$DATABASE" 'DROP EVENT TRIGGER e020b_fail_r4; DROP SCHEMA e020b_inject CASCADE' >/dev/null
AFTER_E=$(admin_sql "$SOURCE_CONTAINER" "$DATABASE" "SELECT md5(concat_ws('|',has_function_privilege('cocinacore_auth','public.signup_new_account(text,text,text,timestamptz,text)','EXECUTE'),has_table_privilege('cocinacore_runtime_rls','public.runtime_identity_probe','SELECT'),has_table_privilege('cocinacore_owner_metrics','public.owner_global_metrics','SELECT'),has_table_privilege('cocinacore_global_writer','public.owner_write_global_books','INSERT'),has_table_privilege('cocinacore_global_writer','public.owner_write_global_pdfs','INSERT'),has_table_privilege('cocinacore_global_writer','public.owner_write_global_chunks','INSERT')))" )
[[ "$BEFORE_E" == "$AFTER_E" ]] || fail 'R4 activation rollback retained a partial grant'
if COCINACORE_SKIP_DOTENV=1 COCINACORE_SEPARATED_DB_LANES_ENABLED=true MIGRATION_DATABASE_URL="$SOURCE_MIGRATION_URL" \
  "$NODE_22" "$ROOT/frontend/scripts/run-migrations.js" --lane migration --verify-complete >"$LOG" 2>&1; then
  fail 'verify-complete accepted failed R4 state'
fi
grep -q 'ACTIVATION_PENDING\|CAPABILITIES_PENDING\|activation' "$LOG" || fail 'post-R4-failure verification did not reject pending activation'
printf '%s\n' 'PASS scenario E: second R4 grant failed after first; activation transaction removed every partial grant'

set_check scenario-F-R4-complete
COCINACORE_ACTIVATION_DATABASE_URL="$SOURCE_ADMIN_URL" "$NODE_22" "$ROOT/frontend/scripts/activate-020-capabilities.js" >"$LOG" 2>&1 || fail 'R4 activation failed against exact canonical 020'
COCINACORE_SKIP_DOTENV=1 COCINACORE_SEPARATED_DB_LANES_ENABLED=true MIGRATION_DATABASE_URL="$SOURCE_MIGRATION_URL" \
  "$NODE_22" "$ROOT/frontend/scripts/run-migrations.js" --lane migration --verify-complete >"$LOG" 2>&1 || fail 'official verify-complete rejected activated 020'
[[ "$(admin_sql "$SOURCE_CONTAINER" "$DATABASE" "SELECT count(*) FROM pg_catalog.pg_policy")" == 71 ]] || fail 'active catalog does not contain exactly 71 policies'
[[ "$(admin_sql "$SOURCE_CONTAINER" "$DATABASE" "SELECT count(*) FROM pg_catalog.pg_class WHERE relnamespace='public'::regnamespace AND relkind='r' AND relforcerowsecurity")" == 27 ]] || fail 'active catalog does not have exactly 27 FORCE RLS tables'
[[ "$(admin_sql "$SOURCE_CONTAINER" "$DATABASE" "SELECT count(*) FROM pg_class WHERE relnamespace='public'::regnamespace AND relname IN ('runtime_identity_probe','owner_write_global_books','owner_write_global_pdfs','owner_write_global_chunks','owner_metrics_rls_guard','owner_global_metrics')")" == 6 ]] || fail 'active catalog is missing one or more of six capability relations'
[[ "$(admin_sql "$SOURCE_CONTAINER" "$DATABASE" "SELECT count(*) FROM pg_proc WHERE oid=to_regprocedure('public.signup_new_account(text,text,text,timestamptz,text)')")" == 1 ]] || fail 'active catalog is missing signup capability function'
[[ "$(admin_sql "$SOURCE_CONTAINER" "$DATABASE" "SELECT count(*) FROM pg_roles WHERE rolname IN ('cocinacore_identity_probe','cocinacore_signup_bootstrap','cocinacore_metrics_view_owner','cocinacore_global_writer_view_owner') AND NOT rolcanlogin AND NOT rolsuper AND NOT rolbypassrls AND NOT rolcreaterole AND NOT rolcreatedb")" == 4 ]] || fail 'one or more capability owners are not restricted NOLOGIN'
[[ "$(docker exec -e PGPASSWORD="$METRICS_PASSWORD" "$SOURCE_CONTAINER" psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -U cocinacore_owner_metrics -d "$DATABASE" -Atqc 'SELECT tenants>=2 AND users>=2 AND books>=1 AND pdfs>=1 AND chunks>=1 AND reports>=1 AND owners>=1 FROM public.owner_global_metrics')" == t ]] || fail 'owner metrics LOGIN could not read the seven non-null aggregate counts'
docker exec -e PGPASSWORD="$WRITER_PASSWORD" "$SOURCE_CONTAINER" psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -U cocinacore_global_writer -d "$DATABASE" -qc "BEGIN; INSERT INTO public.owner_write_global_books(title) VALUES ('020E-B writer smoke'); ROLLBACK" >"$LOG" 2>&1 || fail 'global writer LOGIN did not insert through reviewed capability view'
[[ "$(admin_sql "$SOURCE_CONTAINER" "$DATABASE" "SELECT count(*) FROM public.global_books WHERE title='020E-B writer smoke'")" == 0 ]] || fail 'global writer rollback fixture persisted'
run_signup_maintenance_test
set_check scenario-F-compatible-signup-http
(cd "$ROOT/frontend" && \
  COCINACORE_SKIP_DOTENV=1 COCINACORE_SEPARATE_AUTH_DB=true \
  COCINACORE_SIGNUP_BOOTSTRAP_TEST=1 COCINACORE_SIGNUP_MAINTENANCE=false \
  DATABASE_URL="postgresql://cocinacore_runtime_rls:$RUNTIME_PASSWORD@127.0.0.1:$SOURCE_PORT/$DATABASE" \
  AUTH_DATABASE_URL="postgresql://cocinacore_auth:$AUTH_PASSWORD@127.0.0.1:$SOURCE_PORT/$DATABASE" \
  SIGNUP_TEST_ADMIN_URL="$SOURCE_ADMIN_URL" \
  "$NODE_22" node_modules/vitest/vitest.mjs run src/app/api/auth/signup/signup-bootstrap-http.integration.test.ts \
    --testNamePattern='creates account, owner membership and session; login and duplicate work' --maxWorkers=1 --reporter=dot) >"$LOG" 2>&1 || fail 'real HTTP/signup-auth smoke did not reopen safely after verify-complete'
grep -E 'Test Files|Tests[[:space:]]+[0-9]+ passed' "$LOG" | tail -n 2
printf '%s\n' 'PASS scenario F: activation, owner aggregates, global writer, HTTP signup/login/reset and controlled re-open checks passed'

set_check scenario-G-old-app-compatibility
BEFORE_G=$(db_data_fingerprint "$SOURCE_CONTAINER" "$DATABASE")
if docker exec -e PGPASSWORD="$AUTH_PASSWORD" "$SOURCE_CONTAINER" psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 \
  -U cocinacore_auth -d "$DATABASE" -c "INSERT INTO public.tenants(name) VALUES ('old app path')" >"$LOG" 2>&1; then
  fail 'old direct-INSERT signup path remained compatible after 020'
fi
grep -Eq 'permission denied|insufficient_privilege' "$LOG" || fail 'old app compatibility probe did not hit privilege denial'
[[ "$(db_data_fingerprint "$SOURCE_CONTAINER" "$DATABASE")" == "$BEFORE_G" ]] || fail 'old application failure partially wrote data'
printf '%s\n' 'NO-GO scenario G: code-only rollback to the legacy direct-INSERT signup path is incompatible; keep maintenance and use the compatible release or isolated restore'

set_check post020-backup
POST020_DUMP="$TMP_ROOT/cocinacore-020.dump"
POST020_GLOBALS="$TMP_ROOT/cocinacore-020-globals.sql"
POST020_LIST="$TMP_ROOT/cocinacore-020.list"
docker exec "$SOURCE_CONTAINER" pg_dump -Fc -U cocinacore -d "$DATABASE" >"$POST020_DUMP" || fail 'post-020 custom-format backup failed'
docker exec "$SOURCE_CONTAINER" pg_dumpall --globals-only -U cocinacore >"$POST020_GLOBALS" || fail 'post-020 role/ACL global export failed'
chmod 600 "$POST020_DUMP" "$POST020_GLOBALS"
POST020_SHA=$(shasum -a 256 "$POST020_DUMP" | awk '{print $1}')
printf '%s  %s\n' "$POST020_SHA" "$(basename "$POST020_DUMP")" >"$POST020_DUMP.sha256"
chmod 600 "$POST020_DUMP.sha256"
(cd "$TMP_ROOT" && shasum -a 256 -c "$(basename "$POST020_DUMP").sha256") >"$LOG" 2>&1 || fail 'post-020 backup checksum failed'
docker cp "$POST020_DUMP" "$SOURCE_CONTAINER:/tmp/020eb-020.dump" >/dev/null
docker exec "$SOURCE_CONTAINER" pg_restore --list /tmp/020eb-020.dump >"$POST020_LIST" || fail 'post-020 custom backup is unreadable by pg_restore --list'
grep -q 'TABLE public schema_migrations' "$POST020_LIST" || fail 'post-020 archive omitted migration ledger'

set_check restore-020-independent-cluster
docker rm -f "$RESTORE_CONTAINER" >/dev/null 2>&1 || true
RESTORE_CONTAINER=
start_cluster restore020 postgres restore_admin "$RESTORE_ADMIN_PASSWORD"
RESTORE_CONTAINER=$STARTED_CONTAINER
RESTORE_PORT=$STARTED_PORT
RESTORE_ADMIN_URL="postgresql://restore_admin:$RESTORE_ADMIN_PASSWORD@127.0.0.1:$RESTORE_PORT/$DATABASE"
RESTORE_MIGRATION_URL="postgresql://migration_admin:$MIGRATION_PASSWORD@127.0.0.1:$RESTORE_PORT/$DATABASE"
restore_global_roles "$RESTORE_CONTAINER" "$POST020_GLOBALS"
docker exec "$RESTORE_CONTAINER" psql -X -v ON_ERROR_STOP=1 -U restore_admin -d postgres -c \
  "CREATE DATABASE $DATABASE OWNER cocinacore" >/dev/null || fail 'post-020 restore database creation failed'
docker exec "$RESTORE_CONTAINER" psql -X -v ON_ERROR_STOP=1 -U restore_admin -d postgres -c \
  "REVOKE CREATE,TEMP ON DATABASE $DATABASE FROM PUBLIC; GRANT CONNECT ON DATABASE $DATABASE TO migration_admin,cocinacore_runtime_rls,cocinacore_auth,cocinacore_owner_metrics,cocinacore_global_writer; GRANT CREATE ON DATABASE $DATABASE TO cocinacore_schema_owner" >/dev/null || fail 'post-020 restore database ACL bootstrap failed'
docker cp "$POST020_DUMP" "$RESTORE_CONTAINER:/tmp/020eb-020.dump" >/dev/null
docker exec "$RESTORE_CONTAINER" pg_restore --exit-on-error -U restore_admin -d "$DATABASE" /tmp/020eb-020.dump >"$LOG" 2>&1 || fail 'post-020 custom archive restore failed'
docker exec "$RESTORE_CONTAINER" psql -X -v ON_ERROR_STOP=1 -U restore_admin -d "$DATABASE" -c \
  "COMMENT ON DATABASE $DATABASE IS 'cocinacore-signup-real-disposable'" >/dev/null
assert_structure_match restore-020 "$SOURCE_CONTAINER" "$RESTORE_CONTAINER"
[[ "$(db_owner_fingerprint "$SOURCE_CONTAINER" "$DATABASE")" == "$(db_owner_fingerprint "$RESTORE_CONTAINER" "$DATABASE")" ]] || fail 'post-020 restored object owners differ'
SOURCE_020_ACL=$(db_acl_fingerprint "$SOURCE_CONTAINER" "$DATABASE") || fail 'source 020 ACL fingerprint failed'
RESTORE_020_ACL=$(db_acl_fingerprint "$RESTORE_CONTAINER" "$DATABASE") || fail 'restored 020 ACL fingerprint failed'
if [[ "$SOURCE_020_ACL" != "$RESTORE_020_ACL" ]]; then
  printf '%s\n' "$SOURCE_020_ACL" >"$TMP_ROOT/source-020-acls.txt"
  printf '%s\n' "$RESTORE_020_ACL" >"$TMP_ROOT/restore-020-acls.txt"
  diff -u "$TMP_ROOT/source-020-acls.txt" "$TMP_ROOT/restore-020-acls.txt" >"$LOG" || true
  fail 'post-020 restored database/object ACLs differ'
fi
SOURCE_020_ROLES=$(db_role_fingerprint "$SOURCE_CONTAINER" "$DATABASE") || fail 'source 020 role fingerprint failed'
RESTORE_020_ROLES=$(db_role_fingerprint "$RESTORE_CONTAINER" "$DATABASE") || fail 'restored 020 role fingerprint failed'
[[ "$SOURCE_020_ROLES" == "$RESTORE_020_ROLES" ]] || fail 'post-020 restored role attributes, settings, comments, or memberships differ'
[[ "$(db_data_fingerprint "$SOURCE_CONTAINER" "$DATABASE")" == "$(db_data_fingerprint "$RESTORE_CONTAINER" "$DATABASE")" ]] || fail 'post-020 restored fixture values or relationships differ'
[[ "$(db_all_data_fingerprint "$SOURCE_CONTAINER" "$DATABASE")" == "$(db_all_data_fingerprint "$RESTORE_CONTAINER" "$DATABASE")" ]] || fail 'post-020 restored complete database data differs'
run_restore_verify || fail 'official --verify-complete rejected restored post-020 catalog'
[[ "$(admin_sql "$RESTORE_CONTAINER" "$DATABASE" "SELECT count(*) FROM public.schema_migrations")" == 20 ]] || fail 'post-020 restored ledger is not 020-complete'
[[ "$(admin_sql "$RESTORE_CONTAINER" "$DATABASE" "SELECT count(*) FROM pg_policy")" == 71 ]] || fail 'restored post-020 policy count differs from 71'
[[ "$(admin_sql "$RESTORE_CONTAINER" "$DATABASE" "SELECT count(*) FROM pg_class WHERE relnamespace='public'::regnamespace AND relkind='r' AND relforcerowsecurity")" == 27 ]] || fail 'restored post-020 FORCE RLS table count differs from 27'
[[ "$(admin_sql "$RESTORE_CONTAINER" "$DATABASE" "SELECT count(*) FROM pg_roles WHERE rolname IN ('cocinacore_identity_probe','cocinacore_signup_bootstrap','cocinacore_metrics_view_owner','cocinacore_global_writer_view_owner') AND NOT rolcanlogin AND NOT rolsuper AND NOT rolbypassrls")" == 4 ]] || fail 'restored post-020 NOLOGIN owners differ'
[[ "$(admin_sql "$RESTORE_CONTAINER" "$DATABASE" "SELECT has_function_privilege('cocinacore_auth','public.signup_new_account(text,text,text,timestamptz,text)','EXECUTE') AND has_table_privilege('cocinacore_runtime_rls','public.runtime_identity_probe','SELECT') AND has_table_privilege('cocinacore_owner_metrics','public.owner_global_metrics','SELECT') AND has_table_privilege('cocinacore_global_writer','public.owner_write_global_books','INSERT') AND NOT has_table_privilege('public','public.owner_global_metrics','SELECT')")" == t ]] || fail 'restored activation ACLs or PUBLIC denial differ'
[[ "$(docker exec -e PGPASSWORD="$METRICS_PASSWORD" "$RESTORE_CONTAINER" psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -U cocinacore_owner_metrics -d "$DATABASE" -Atqc 'SELECT tenants>=2 AND users>=2 AND books>=1 AND pdfs>=1 AND chunks>=1 AND reports>=1 AND owners>=1 FROM public.owner_global_metrics')" == t ]] || fail 'restored owner metrics capability failed'
docker exec -e PGPASSWORD="$WRITER_PASSWORD" "$RESTORE_CONTAINER" psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -U cocinacore_global_writer -d "$DATABASE" -qc "BEGIN; INSERT INTO public.owner_write_global_books(title) VALUES ('020E-B restored writer smoke'); ROLLBACK" >"$LOG" 2>&1 || fail 'restored global writer capability failed'
[[ "$(docker exec -e PGPASSWORD="$RUNTIME_PASSWORD" "$RESTORE_CONTAINER" psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -U cocinacore_runtime_rls -d "$DATABASE" -Atqc "BEGIN; SELECT set_config('app.tenant_id','e020b000-0000-4000-8000-000000000001',true), set_config('app.user_id','e020b000-0000-4000-8000-000000000011',true); SELECT count(*) FROM public.recipe_inventory_items; COMMIT" | tail -n 1)" == 1 ]] || fail 'restored runtime tenant A did not see its own single inventory row'
BEFORE_RESTORED_SIGNUP=$(db_data_fingerprint "$RESTORE_CONTAINER" "$DATABASE")
if docker exec -e PGPASSWORD="$RUNTIME_PASSWORD" "$RESTORE_CONTAINER" psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -U cocinacore_runtime_rls -d "$DATABASE" -c \
  "BEGIN; SELECT set_config('app.tenant_id','e020b000-0000-4000-8000-000000000001',true), set_config('app.user_id','e020b000-0000-4000-8000-000000000011',true); INSERT INTO public.recipe_inventory_items(tenant_id,user_id,ingredient_name) VALUES ('e020b000-0000-4000-8000-000000000002','e020b000-0000-4000-8000-000000000012','cross-tenant'); COMMIT" >"$LOG" 2>&1; then
  fail 'restored runtime cross-tenant INSERT unexpectedly succeeded'
fi
grep -Eq 'row-level security|policy' "$LOG" || fail 'restored cross-tenant write was not denied by RLS'
[[ "$(admin_sql "$RESTORE_CONTAINER" "$DATABASE" "SELECT count(*) FROM public.recipe_inventory_items WHERE ingredient_name='cross-tenant'")" == 0 ]] || fail 'restored cross-tenant denial left a row'
[[ "$(admin_sql "$RESTORE_CONTAINER" "$DATABASE" "SELECT count(*) FROM public.sessions WHERE token_hash LIKE '020eb-fixture-%'")" == 2 ]] || fail 'restored auth session fixtures missing'
[[ "$(admin_sql "$RESTORE_CONTAINER" "$DATABASE" "SELECT NOT has_function_privilege('cocinacore_runtime_rls','public.signup_new_account(text,text,text,timestamptz,text)','EXECUTE') AND NOT has_table_privilege('cocinacore_runtime_rls','public.owner_global_metrics','SELECT') AND NOT has_table_privilege('cocinacore_auth','public.owner_global_metrics','SELECT')")" == t ]] || fail 'restored denial contract failed for runtime/auth capability boundaries'
docker exec -e PGPASSWORD="$AUTH_PASSWORD" "$RESTORE_CONTAINER" psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -U cocinacore_auth -d "$DATABASE" -Atqc \
  "BEGIN; WITH signup AS (SELECT user_id FROM public.signup_new_account('restored-020@example.test','fixture-password-hash','Restored Owner',now(),'v1')) INSERT INTO public.sessions(user_id,token_hash,expires_at) SELECT user_id,'020eb-restored-session',now()+interval '1 day' FROM signup; COMMIT" >/dev/null || fail 'restored safe signup capability/session path failed'
[[ "$(admin_sql "$RESTORE_CONTAINER" "$DATABASE" "SELECT count(*) FROM public.users u JOIN public.tenant_memberships m ON m.user_id=u.id AND m.tenant_id=u.tenant_id AND m.role='owner' JOIN public.sessions s ON s.user_id=u.id WHERE u.email='restored-020@example.test' AND s.token_hash='020eb-restored-session'")" == 1 ]] || fail 'restored signup, owner membership, or session relation missing'
run_restored_signup_http_test

POST020_SHA_AFTER=$(shasum -a 256 "$ROOT/db/migrations/020_tenant_rls_hardening.sql" | awk '{print $1}')
[[ "$POST020_SHA_AFTER" == "$EXPECTED_020_SHA" ]] || fail 'canonical 020 changed during recovery rehearsal'
[[ -z "$(docker ps -a --format '{{.Names}}' | grep "^${PREFIX}-" || true)" ]] && {
  printf '%s\n' 'Internal cleanup will remove disposable clusters after final checks.'
}
printf '%s\n' 'PASS: post-020 custom backup restore, globals, ledger, 71 policies, 27 FORCE RLS tables, owners, active grants, metrics, writer, tenant isolation, signup, membership, sessions and denial checks passed'
printf '%s\n' 'PASS: canonical 020 unchanged at expected SHA-256'
