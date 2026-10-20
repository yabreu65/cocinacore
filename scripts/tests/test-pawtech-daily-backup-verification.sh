#!/bin/sh
set -eu

ROOT=$(CDPATH='' cd -- "$(dirname -- "$0")/../.." && pwd)
VERIFIER="$ROOT/scripts/verify-pawtech-cocinacore-daily-backup.sh"
[ -x "$VERIFIER" ] || { printf '%s\n' 'daily backup verifier is not executable' >&2; exit 1; }

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT HUP INT TERM
mkdir -p "$TMP/bin" "$TMP/objects/cocinacore_db"
export FIXTURE="$TMP/objects/cocinacore_db"
TZ=UTC
export TZ
BACKUP_ENV_FILE="$TMP/backups.env"
printf '%s\n' 'RCLONE_REMOTE=fixture:' 'POSTGRES_USER=backup_operator' >"$BACKUP_ENV_FILE"
sed "s|^BACKUP_ENV_FILE=.*|BACKUP_ENV_FILE=$BACKUP_ENV_FILE|" "$VERIFIER" >"$TMP/verifier.sh"
chmod 700 "$TMP/verifier.sh"
VERIFIER="$TMP/verifier.sh"
export VERIFIER
cat >"$TMP/bin/rclone" <<'RCLONE'
#!/bin/sh
set -eu
printf '%s\n' "$*" >>"$CALL_LOG"
case "$1" in
  lsf) [ "$7" = 'fixture:/cocinacore_db' ] || exit 1; printf '%s\n' "${FIXTURE_DUMP:-daily.dump}|$(wc -c <"$FIXTURE/daily.dump" | tr -d ' ')|${FIXTURE_TIME:-$(/bin/date -u +%Y-%m-%dT%H:%M:%SZ)}" "${FIXTURE_DUMP:-daily.dump}.sha256|64|$(/bin/date -u +%Y-%m-%dT%H:%M:%SZ)" ;;
  cat) path=${2##*/}; [ -f "$FIXTURE/$path" ] || exit 1; cat "$FIXTURE/$path" ;;
  *) exit 1 ;;
esac
RCLONE
cat >"$TMP/bin/docker" <<'DOCKER'
#!/bin/sh
set -eu
printf '%s\n' "$*" >>"$CALL_LOG"
case "$*" in
  'exec -i pawtech-postgres pg_restore --list')
    case ${ARCHIVE_MODE:-valid} in unreadable) exit 1 ;; premigration) printf '%s\n' 'TABLE public user_recipes';; *) printf '%s\n' 'TABLE public user_recipes' 'TABLE public user_recipe_versions' 'INDEX public idx_user_recipes_tenant_user_archived_at';; esac ;;
  'exec pawtech-postgres psql '*)
    case ${ROLE_MODE:-valid} in
      incompatible) printf '%s\n' 'backup_operator|false|false' ;;
      superuser) printf '%s\n' 'backup_operator|true|true' ;;
      *) printf '%s\n' 'backup_operator|false|true' ;;
    esac ;;
  *) exit 1 ;;
esac
DOCKER
chmod 700 "$TMP/bin/rclone" "$TMP/bin/docker"
export PATH="$TMP/bin:$PATH"
CALL_LOG="$TMP/calls"
export CALL_LOG
: >"$CALL_LOG"

fail() { printf '%s\n' "daily backup scenario failure: $1" >&2; exit 1; }
make_valid() {
  printf '%s\n' 'PGDMP test archive' >"$FIXTURE/daily.dump"
  hash=$(sha256sum "$FIXTURE/daily.dump" | awk '{print $1}')
  printf '%s  daily.dump\n' "$hash" >"$FIXTURE/daily.dump.sha256"
  unset FIXTURE_TIME FIXTURE_DUMP ARCHIVE_MODE ROLE_MODE
}
run_ok() {
  output=$("$VERIFIER" 2>"$TMP/error") || { printf '%s\n' "$(cat "$TMP/error")" "$(cat "$CALL_LOG")" >&2; fail 'valid scheduled backup rejected'; }
  [ "$(printf '%s\n' "$output" | tail -n 1)" = DAILY_BACKUP_VERIFIED ] || fail 'verified token missing'
  ! { printf '%s\n' "$output"; cat "$TMP/error"; } | grep -Eiq 'fixture:|daily.dump|PGDMP|backup_operator|password|secret' || fail 'verifier leaked object or secret data'
}
make_valid
FIXTURE_TIME=$(/bin/date -u +%Y-%m-%dT%H:%M:%SZ)
export FIXTURE_TIME
run_ok
ROLE_MODE=superuser; export ROLE_MODE
run_ok
unset ROLE_MODE
! grep -Eiq 'pg_dump|rclone (copy|sync)|mkdir|mktemp|chmod|docker cp|pg_restore .*--(dbname|clean|create)' "$VERIFIER" || fail 'verifier contains a forbidden write or restore operation'
! grep -Eiq 'pg_dump|rclone (copy|sync)|docker cp|pg_restore .*--(dbname|clean|create)' "$ROOT/scripts/deploy-pawtech-production.sh" || fail 'deploy contains backup creation or restore operation'
grep -Fq 'cocinacore_db' "$VERIFIER" && grep -Fq 'pawtech-postgres' "$VERIFIER" || fail 'fixed CocinaCore target isolation missing'
grep -Fq 'fixture:/cocinacore_db' "$CALL_LOG" || fail 'rclone namespace was not fixed to CocinaCore'
grep -Fq 'exec -i pawtech-postgres pg_restore --list' "$CALL_LOG" || fail 'archive listing did not use the fixed container'
grep -Fq ' -d cocinacore_db ' "$CALL_LOG" || fail 'role query did not use the fixed database'
! grep -Eiq 'otherproject|other_project|other-project|pawtech_db|postgres_db|template1|pg_restore .*--(dbname|clean|create)' "$CALL_LOG" || fail 'non-CocinaCore resource or database restore found'

FIXTURE_DUMP=absent.dump
export FIXTURE_DUMP
if "$VERIFIER" >/dev/null 2>&1; then fail 'absent object accepted'; fi
unset FIXTURE_DUMP
FIXTURE_TIME=2000-01-01T00:00:00Z; export FIXTURE_TIME
if "$VERIFIER" >/dev/null 2>&1; then fail 'stale object accepted'; fi
unset FIXTURE_TIME
printf '%s\n' "$(printf '%064d' 0)  daily.dump" >"$FIXTURE/daily.dump.sha256"
if "$VERIFIER" >/dev/null 2>&1; then fail 'corrupt checksum accepted'; fi
make_valid
ARCHIVE_MODE=unreadable; export ARCHIVE_MODE
if "$VERIFIER" >/dev/null 2>&1; then fail 'unreadable archive accepted'; fi
ARCHIVE_MODE=premigration; export ARCHIVE_MODE
if "$VERIFIER" >/dev/null 2>&1; then fail 'pre-migration archive accepted'; fi
unset ARCHIVE_MODE
ROLE_MODE=incompatible; export ROLE_MODE
if "$VERIFIER" >/dev/null 2>&1; then fail 'RLS-incompatible role accepted'; fi
printf '%s\n' 'Pawtech daily backup verification scenario passed'
