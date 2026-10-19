#!/bin/sh
set -eu

DATABASE_NAME=cocinacore_db
POSTGRES_CONTAINER=pawtech-postgres
BACKUP_ENV_FILE=/opt/pawtech/backups/backups.env
MAX_AGE_SECONDS=93600

fail() {
  printf '%s\n' "DAILY_BACKUP_FAILED reason=$1" >&2
  exit 1
}

command -v rclone >/dev/null 2>&1 || fail 'required verifier unavailable'
command -v docker >/dev/null 2>&1 || fail 'required verifier unavailable'
command -v sha256sum >/dev/null 2>&1 || fail 'required verifier unavailable'
command -v date >/dev/null 2>&1 || fail 'required verifier unavailable'
[ -r "$BACKUP_ENV_FILE" ] || fail 'backup configuration unavailable'
# shellcheck disable=SC1090
. "$BACKUP_ENV_FILE" >/dev/null 2>&1 || fail 'backup configuration unavailable'
case ${RCLONE_REMOTE:-} in
  ''|*[!A-Za-z0-9_:/.-]*) fail 'backup configuration invalid' ;;
esac
case ${POSTGRES_USER:-} in
  ''|*[!A-Za-z0-9_]* ) fail 'backup role configuration unavailable' ;;
esac
REMOTE_DIR="${RCLONE_REMOTE%/}/$DATABASE_NAME"
listing=$(rclone lsf --recursive --format pst --separator '|' "$REMOTE_DIR" 2>/dev/null) || fail 'scheduled backup listing unavailable'
[ -n "$listing" ] || fail 'scheduled backup unavailable'
printf '%s\n' DAILY_BACKUP_FOUND >&2

newest_path=
newest_time=
newest_base=
while IFS='|' read -r object size modified; do
  case $object in
    *.dump) ;;
    *) continue ;;
  esac
  [ -n "$modified" ] || continue
  case $size in ''|*[!0-9]*) continue ;; esac
  base=${object##*/}
  [ -n "$base" ] || continue
  if [ -z "$newest_time" ] || [ "$modified" \> "$newest_time" ]; then
    newest_path=$object
    newest_time=$modified
    newest_base=$base
  fi
done <<EOF
$listing
EOF
[ -n "$newest_path" ] || fail 'scheduled backup unavailable'
now=$(date +%s) || fail 'backup freshness unavailable'
modified_epoch=$(date -d "$newest_time" +%s 2>/dev/null || date -j -z UTC -f '%Y-%m-%dT%H:%M:%SZ' "$newest_time" +%s 2>/dev/null) || fail 'backup freshness unavailable'
age=$((now - modified_epoch))
[ "$age" -ge 0 ] && [ "$age" -le "$MAX_AGE_SECONDS" ] || fail 'scheduled backup is stale'
printf '%s\n' DAILY_BACKUP_FRESH_OK >&2

sidecar_path=
while IFS='|' read -r object size modified; do
  if [ "$object" = "$newest_path.sha256" ]; then sidecar_path=$object; break; fi
done <<EOF
$listing
EOF
[ -n "$sidecar_path" ] || fail 'scheduled backup checksum unavailable'
sidecar=$(rclone cat "${REMOTE_DIR%/}/$sidecar_path" 2>/dev/null) || fail 'scheduled backup checksum unavailable'
expected_hash=$(printf '%s\n' "$sidecar" | awk 'NR == 1 { print $1 }')
case $expected_hash in
  *[!0-9a-fA-F]*|'') fail 'scheduled backup checksum invalid' ;;
esac
[ "${#expected_hash}" -eq 64 ] || fail 'scheduled backup checksum invalid'
actual_hash=$(rclone cat "${REMOTE_DIR%/}/$newest_path" 2>/dev/null | sha256sum | awk '{print $1}') || fail 'scheduled backup checksum invalid'
[ "$actual_hash" = "$expected_hash" ] || fail 'scheduled backup checksum mismatch'
printf '%s\n' DAILY_BACKUP_CHECKSUM_OK >&2

archive_listing=$(rclone cat "${REMOTE_DIR%/}/$newest_path" 2>/dev/null | docker exec -i "$POSTGRES_CONTAINER" pg_restore --list 2>/dev/null) || fail 'scheduled backup archive unreadable'
printf '%s\n' DAILY_BACKUP_ARCHIVE_READABLE >&2
printf '%s\n' "$archive_listing" | grep -Fq 'TABLE public user_recipes' || fail 'scheduled backup lacks required migrations 016/017'
printf '%s\n' "$archive_listing" | grep -Fq 'TABLE public user_recipe_versions' || fail 'scheduled backup lacks required migrations 016/017'
printf '%s\n' "$archive_listing" | grep -Fq 'INDEX public idx_user_recipes_tenant_user_archived_at' || fail 'scheduled backup lacks required migrations 016/017'
printf '%s\n' DAILY_BACKUP_SCHEMA_016_017_OK >&2

role_evidence=$(docker exec "$POSTGRES_CONTAINER" psql -X -A -t -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$DATABASE_NAME" -c "SELECT current_user || '|' || rolsuper::text || '|' || rolbypassrls::text FROM pg_roles WHERE rolname = current_user" 2>/dev/null) || fail 'scheduled backup role evidence unavailable'
case $role_evidence in
  "$POSTGRES_USER|"* ) ;;
  *) fail 'scheduled backup role evidence unavailable' ;;
esac
role_super=$(printf '%s' "$role_evidence" | awk -F'|' '{print $2}')
role_bypass=$(printf '%s' "$role_evidence" | awk -F'|' '{print $3}')
case "$role_super:$role_bypass" in
  t:t|f:t) printf '%s\n' DAILY_BACKUP_RLS_COMPATIBLE >&2 ;;
  *) fail 'scheduled backup role is not RLS-compatible' ;;
esac
printf '%s\n' DAILY_BACKUP_VERIFIED
