#!/usr/bin/env sh
set -eu

if [ "${1:-}" = "" ]; then
  echo "Usage: scripts/postgres-restore.sh <backup-file.dump>"
  exit 1
fi

COMPOSE_FILE=${COMPOSE_FILE:-docker-compose.prod.yml}
BACKUP_FILE=$1

if [ ! -f "$BACKUP_FILE" ]; then
  echo "Backup file not found: $BACKUP_FILE"
  exit 1
fi

cat "$BACKUP_FILE" | docker compose -f "$COMPOSE_FILE" exec -T postgres pg_restore \
  -U "${POSTGRES_USER:-cocinacore}" \
  -d "${POSTGRES_DB:-cocinacore}" \
  --clean --if-exists --no-owner
