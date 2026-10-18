#!/bin/sh
set -eu

ROOT=$(CDPATH='' cd -- "$(dirname -- "$0")/../.." && pwd)
SCRIPT="$ROOT/scripts/migrate-pawtech-production.sh"

fail() {
  printf '%s\n' "PawTech migration contract failure: $1" >&2
  exit 1
}

[ -f "$SCRIPT" ] || fail 'production migration script is missing'
sh -n "$SCRIPT" || fail 'production migration script syntax is invalid'

preflight=$(sed -n '/^preflight() {/,/^}/p' "$SCRIPT")
[ -n "$preflight" ] || fail 'read-only database preflight is missing'
printf '%s\n' "$preflight" | grep -Fq 'lock_timeout:' ||
  fail 'preflight Pool must configure PostgreSQL server-side lock_timeout'
printf '%s\n' "$preflight" | grep -Fq 'statement_timeout:' ||
  fail 'preflight Pool must configure PostgreSQL server-side statement_timeout'
printf '%s\n' "$preflight" | grep -Fq 'MIGRATION_PG_LOCK_TIMEOUT_MS' ||
  fail 'preflight lock_timeout must use its canonical strict environment setting'
printf '%s\n' "$preflight" | grep -Fq 'MIGRATION_PG_STATEMENT_TIMEOUT_MS' ||
  fail 'preflight statement_timeout must use its canonical strict environment setting'
printf '%s\n' "$preflight" | grep -Fq '/^[0-9]+$/' ||
  fail 'preflight timeout values must reject non-integer environment values'
printf '%s\n' "$preflight" | grep -Fq 'Number.isSafeInteger(timeout)' ||
  fail 'preflight timeout values must be safe integers'
printf '%s\n' "$preflight" | grep -Fq 'timeout>300000' ||
  fail 'preflight timeout values must use the canonical 300000 ms maximum'
printf '%s\n' "$preflight" | grep -Fq 'connectionTimeoutMillis:5000' ||
  fail 'preflight must retain its separate client-side connection timeout'
! printf '%s\n' "$SCRIPT" | grep -Eiq '(echo|printf|log|console\.(log|error))[^[:cntrl:]]*DATABASE_URL' ||
  fail 'migration script must not expose DATABASE_URL in output'

printf '%s\n' 'pawtech migration contract passed'
