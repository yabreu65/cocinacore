#!/usr/bin/env sh
set -eu

COMPOSE_FILE=${COMPOSE_FILE:-docker-compose.prod.yml}
RETENTION_DAYS=${BACKUP_RETENTION_DAYS:-30}
BACKUP_DIR=${BACKUP_DIR:-./backups}
TIMESTAMP=$(date -u +%Y%m%dT%H%M%SZ)
FILE="${BACKUP_DIR}/cocinacore-${TIMESTAMP}.dump"

mkdir -p "$BACKUP_DIR"
docker compose -f "$COMPOSE_FILE" exec -T postgres pg_dump -U "${POSTGRES_USER:-cocinacore}" -d "${POSTGRES_DB:-cocinacore}" -Fc > "$FILE"
find "$BACKUP_DIR" -name 'cocinacore-*.dump' -mtime +"$RETENTION_DAYS" -delete
printf 'Backup written: %s\n' "$FILE"
