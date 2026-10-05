#!/bin/sh
set -eu

DATABASE_NAME=cocinacore_db
POSTGRES_CONTAINER=pawtech-postgres
MANUAL_BACKUP_ROOT=/opt/pawtech/backups/postgres/cocinacore_db/manual

status() {
  printf '%s\n' "PAWTECH_BACKUP: $*" >&2
}

fail() {
  status "$*"
  exit 1
}

RELEASE_SHA=${1:-}
printf '%s' "$RELEASE_SHA" | grep -Eq '^[0-9a-f]{40}$' || fail 'release SHA must be exactly 40 lowercase hexadecimal characters'
[ -d "$MANUAL_BACKUP_ROOT" ] || fail 'established CocinaCore manual backup hierarchy is unavailable'
command -v docker >/dev/null 2>&1 || fail 'required Docker command is unavailable'
command -v sha256sum >/dev/null 2>&1 || fail 'required checksum command is unavailable'

umask 077
timestamp=$(date -u +%Y%m%dT%H%M%SZ)
run_dir=$(mktemp -d "$MANUAL_BACKUP_ROOT/predeploy-${timestamp}-${RELEASE_SHA}-XXXXXXXX") || fail 'unable to create private backup run directory'
chmod 700 "$run_dir" || fail 'unable to secure backup run directory'
dump_file="$run_dir/${DATABASE_NAME}-${timestamp}-${RELEASE_SHA}.dump"
sidecar_file="${dump_file}.sha256"

status 'creating CocinaCore custom-format dump'
if ! docker exec "$POSTGRES_CONTAINER" pg_dump -U cocinacore_user -d "$DATABASE_NAME" -Fc --no-owner --no-acl >"$dump_file" 2>/dev/null; then
  fail 'CocinaCore dump command failed; partial artifact retained'
fi
[ -s "$dump_file" ] || fail 'CocinaCore dump is empty; artifact retained'
chmod 600 "$dump_file" || fail 'unable to secure dump artifact'

if ! (cd "$run_dir" && sha256sum "$(basename "$dump_file")" >"$(basename "$sidecar_file")"); then
  fail 'unable to generate dump checksum; artifacts retained'
fi
chmod 600 "$sidecar_file" || fail 'unable to secure checksum sidecar'
if ! (cd "$run_dir" && sha256sum -c "$(basename "$sidecar_file")" >/dev/null 2>&1); then
  fail 'dump checksum verification failed; artifacts retained'
fi

status 'validating custom-format archive'
if ! docker exec -i "$POSTGRES_CONTAINER" pg_restore --list <"$dump_file" >/dev/null 2>&1; then
  fail 'dump archive validation failed; artifacts retained'
fi
status 'verified CocinaCore backup artifact'
printf '%s\n' "$dump_file"
