#!/bin/sh
# Fresh database only. Never use to adopt an existing ledger or live database.
set -eu
[ "${1:-}" = '--fresh' ] && [ "$#" -eq 1 ] || { echo 'Explicit --fresh required' >&2; exit 1; }
[ -t 0 ] && [ -t 1 ] || { echo 'Standalone database bootstrap requires interactive stdin/stdout; no database changes were made.' >&2; exit 1; }
[ "${COCINACORE_SEPARATED_DB_LANES_ENABLED:-}" = true ] || exit 1
for value in "$MIGRATION_ADMIN_PASSWORD" "$CC_RUNTIME_PASSWORD" "$CC_AUTH_PASSWORD" "$CC_METRICS_PASSWORD" "$CC_WRITER_PASSWORD"; do
  case "$value" in ''|*[!a-f0-9]*) echo 'Expected generated hex role passwords' >&2; exit 1;; esac
  [ "${#value}" -ge 64 ] || exit 1
done
node <<'NODE'
const { Client } = require('pg');
(async()=>{
  for(const [key,role] of Object.entries({BOOTSTRAP_DATABASE_URL:'postgres',MIGRATION_DATABASE_URL:'migration_admin'})) {
    const u=new URL(process.env[key]);
    if(u.protocol!=='postgresql:'||u.hostname!=='postgres'||u.port!=='5432'||u.pathname!=='/cocinacore'||u.username!==role||u.search||u.hash||!u.password) throw Error('Unexpected database target');
    if(key==='MIGRATION_DATABASE_URL'&&u.password!==process.env.MIGRATION_ADMIN_PASSWORD) throw Error('Migration credential mismatch');
  }
  const c=new Client({connectionString:process.env.BOOTSTRAP_DATABASE_URL});
  await c.connect();
  try {
    const {rows:[r]}=await c.query("SELECT current_database() AS db, current_user AS role, (SELECT count(*)::int FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p')) AS tables");
    if(r.db!=='cocinacore'||r.role!=='postgres'||r.tables!==0) throw Error('Target is not an empty standalone database');
    await c.query('CREATE ROLE cocinacore_user NOLOGIN NOSUPERUSER NOBYPASSRLS');
  } finally {await c.end();}
})().catch(()=>{console.error('Fresh database preflight rejected');process.exitCode=1});
NODE
npm run db:provision
npm run db:migrate -- --stop-after 019
MIGRATION_EXPECTED_PENDING=020_tenant_rls_hardening.sql,021_inventory_price_reference.sql,022_real_consumption_occurrences.sql,023_inventory_movement_retention.sql,024_first_platform_admin_bootstrap.sql npm run db:migrate -- --verify-boundary 019
printf '\\set runtime_password %s\n\\i /app/scripts/provision-runtime-role.sql\n' "$CC_RUNTIME_PASSWORD" | psql "$BOOTSTRAP_DATABASE_URL" -X -v ON_ERROR_STOP=1
printf '\\set auth_password %s\n\\i /app/scripts/provision-auth-role.sql\n' "$CC_AUTH_PASSWORD" | psql "$BOOTSTRAP_DATABASE_URL" -X -v ON_ERROR_STOP=1
printf '\\set metrics_password %s\n\\set global_writer_password %s\n\\i /app/scripts/provision-020-inert-capabilities.sql\n' "$CC_METRICS_PASSWORD" "$CC_WRITER_PASSWORD" | psql "$BOOTSTRAP_DATABASE_URL" -X -1 -v ON_ERROR_STOP=1
node <<'NODE'
const {Client}=require('pg');const {attestPreparedCapabilities}=require('./scripts/prepared-capabilities-attestation');
(async()=>{const c=new Client({connectionString:process.env.BOOTSTRAP_DATABASE_URL});await c.connect();try{await attestPreparedCapabilities(c,{required:true});console.log('Seven inert 020 capabilities verified.');}finally{await c.end();}})().catch(()=>{console.error('Prepared attestation failed');process.exitCode=1});
NODE
psql "$BOOTSTRAP_DATABASE_URL" -X -v ON_ERROR_STOP=1 -f /app/scripts/rls-candidates/020e-a1-inert-capability-guard.sql
MIGRATION_EXPECTED_PENDING=020_tenant_rls_hardening.sql,021_inventory_price_reference.sql,022_real_consumption_occurrences.sql,023_inventory_movement_retention.sql,024_first_platform_admin_bootstrap.sql npm run db:migrate -- --stop-after 020
node <<'NODE'
const {Client}=require('pg');const {attestActivatedCapabilities}=require('./scripts/activated-capabilities-attestation');
(async()=>{const c=new Client({connectionString:process.env.MIGRATION_DATABASE_URL});await c.connect();try{if(await attestActivatedCapabilities(c)!=='pending')throw Error('Expected pending');console.log('020 activation-pending verified.');}finally{await c.end();}})().catch(()=>{console.error('Pending attestation failed');process.exitCode=1});
NODE
if result=$(npm run db:migrate:verify 2>&1); then echo 'Pending activation unexpectedly accepted' >&2; exit 1; fi
case "$result" in *ACTIVATION_PENDING*) echo 'Pending activation correctly rejected';; *) echo 'Unexpected verification failure' >&2; exit 1;; esac
COCINACORE_ACTIVATION_DATABASE_URL="$BOOTSTRAP_DATABASE_URL" node scripts/activate-020-capabilities.js
MIGRATION_EXPECTED_PENDING=021_inventory_price_reference.sql,022_real_consumption_occurrences.sql,023_inventory_movement_retention.sql,024_first_platform_admin_bootstrap.sql npm run db:migrate -- --stop-after 023
psql "$BOOTSTRAP_DATABASE_URL" -X -v ON_ERROR_STOP=1 -f /app/scripts/provision-first-platform-admin-roles.sql
MIGRATION_EXPECTED_PENDING=024_first_platform_admin_bootstrap.sql npm run db:migrate
npm run db:migrate:verify
