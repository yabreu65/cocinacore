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
leak_pattern="(echo|log|fail)[^[:cntrl:]]*\\\$DATABASE_URL"
printf '%s\n' "echo \"\$DATABASE_URL\"" | grep -Eiq "$leak_pattern" ||
  fail 'secret-output detector must reject a representative DATABASE_URL leak'
! grep -Eiq "$leak_pattern" "$SCRIPT" ||
  fail 'migration script must not print the runtime DATABASE_URL value'
secret_printf_lines=$(grep -E 'printf .*DATABASE_URL' "$SCRIPT" || true)
[ "$(printf '%s\n' "$secret_printf_lines" | grep -c .)" -eq 1 ] ||
  fail 'runtime DATABASE_URL may only be written once to a private env file'
printf '%s\n' "$secret_printf_lines" | grep -Fq 'DATABASE_ENV_FILE' ||
  fail 'runtime DATABASE_URL must only be written to the temporary env file'
printf '%s\n' "$secret_printf_lines" | grep -Fq '>' ||
  fail 'runtime DATABASE_URL must not be printed to stdout'
private_chmod_line=$(grep -E 'chmod 600.*DATABASE_ENV_FILE' "$SCRIPT" || true)
[ -n "$private_chmod_line" ] ||
  fail 'temporary database env file must be private'

printf '%s\n' 'pawtech migration contract passed'
