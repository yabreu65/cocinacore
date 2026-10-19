#!/bin/sh
set -eu

ROOT=$(CDPATH='' cd -- "$(dirname -- "$0")/../.." && pwd)
HELPER="$ROOT/scripts/backup-pawtech-cocinacore-predeploy.sh"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT HUP INT TERM

fail() {
  printf '%s\n' "Pawtech FORCE RLS backup scenario failure: $1" >&2
  exit 1
}

mkdir -p "$TMP/manual" "$TMP/bin"
# Substitute only the fixed artifact root so this scenario never writes to production paths.
sed "s|^MANUAL_BACKUP_ROOT=.*|MANUAL_BACKUP_ROOT=$TMP/manual|" "$HELPER" >"$TMP/helper.sh"
chmod 700 "$TMP/helper.sh"
cat >"$TMP/bin/docker" <<'DOCKER'
#!/bin/sh
set -eu
printf '%s\n' "$*" >>"$DOCKER_CALLS"
if [ "$1" = exec ] && [ "$2" = pawtech-postgres ] && [ "$3" = pg_dump ]; then
  [ "$4" = -U ] && [ "$5" = pawtech_root ] || {
    printf '%s\n' 'app role cannot bypass FORCE ROW LEVEL SECURITY' >&2
    exit 1
  }
  [ "$6" = -d ] && [ "$7" = cocinacore_db ] || exit 1
  [ "$8" = -Fc ] && [ "$9" = --no-owner ] && [ "${10}" = --no-acl ] || exit 1
  # Deterministic nonempty custom-format fixture representing the complete export.
  printf 'PGDMP COMPLETE_FORCE_RLS_EXPORT\n'
  exit 0
fi
if [ "$1" = exec ] && [ "$2" = -i ] && [ "$3" = pawtech-postgres ] && [ "$4" = pg_restore ] && [ "$5" = --list ]; then
  input=$(cat)
  [ "$input" = 'PGDMP COMPLETE_FORCE_RLS_EXPORT' ] || exit 1
  exit 0
fi
exit 1
DOCKER
chmod 700 "$TMP/bin/docker"
export DOCKER_CALLS="$TMP/docker-calls"
: >"$DOCKER_CALLS"
PATH="$TMP/bin:$PATH" "$TMP/helper.sh" 0123456789abcdef0123456789abcdef01234567 >"$TMP/result"

[ -s "$TMP/result" ] || fail 'helper did not report a backup artifact'
expected_dump="pg_dump -U pawtech_root -d \"\$DATABASE_NAME\" -Fc --no-owner --no-acl"
grep -Fq "$expected_dump" "$HELPER" ||
  fail 'helper did not invoke pg_dump as the verified backup operator'
grep -Fq 'exec pawtech-postgres pg_dump -U pawtech_root -d cocinacore_db -Fc --no-owner --no-acl' "$DOCKER_CALLS" ||
  fail 'dump did not target only the CocinaCore container/database and verified role'
grep -Fq 'exec -i pawtech-postgres pg_restore --list' "$DOCKER_CALLS" ||
  fail 'archive validation did not use pg_restore --list through stdin'
! grep -Eiq 'otherproject|other_project|other-project|shared|pawtech_db|postgres_db|template1' "$DOCKER_CALLS" ||
  fail 'Docker calls mention a non-CocinaCore resource'
[ "$(grep -c 'pg_dump' "$DOCKER_CALLS")" -eq 1 ] || fail 'helper invoked more than one dump'
[ "$(grep -c 'pg_restore --list' "$DOCKER_CALLS")" -eq 1 ] || fail 'helper did not validate exactly one archive'
! grep -Fq 'pg_dump -U cocinacore_user' "$HELPER" || fail 'helper must not use the application role for backup'
! grep -Eiq 'DISABLE ROW LEVEL SECURITY|NO FORCE ROW LEVEL SECURITY|ALTER TABLE.*ROW LEVEL SECURITY' "$HELPER" ||
  fail 'helper must not disable or alter RLS'
DEPLOY_SCRIPT="$ROOT/scripts/deploy-pawtech-production.sh"
grep -Fq "log 'DATABASE_CHANGED=NO'" "$DEPLOY_SCRIPT" || fail 'deploy must preserve no-database-change evidence'
grep -Fq 'APP_ROLLBACK_SAFE' "$DEPLOY_SCRIPT" || fail 'deploy must retain verified application rollback evidence'
grep -Fq 'MANUAL_INTERVENTION_REQUIRED' "$DEPLOY_SCRIPT" || fail 'deploy must fail closed when rollback proof is unavailable'

printf '%s\n' 'Pawtech FORCE RLS backup scenario passed'
