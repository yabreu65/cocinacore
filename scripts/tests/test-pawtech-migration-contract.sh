#!/bin/sh
# shellcheck disable=SC2016 # Static contracts intentionally match literal YAML and shell expansions.
set -eu

ROOT=$(CDPATH='' cd -- "$(dirname -- "$0")/../.." && pwd)
WORKFLOW="$ROOT/.github/workflows/migrate-production.yml"
MIGRATION="$ROOT/scripts/migrate-pawtech-production.sh"
RUNNER="$ROOT/frontend/scripts/run-migrations.js"
CI="$ROOT/.github/workflows/ci.yml"

fail() {
  printf '%s\n' "PawTech migration contract failure: $1" >&2
  exit 1
}

contains() {
  grep -Fq -- "$2" "$1" || fail "$3"
}
not_contains() {
  if grep -Eiq -- "$2" "$1"; then fail "$3"; fi
}

[ -f "$WORKFLOW" ] || fail 'manual production migration workflow is missing'
[ -f "$MIGRATION" ] || fail 'VPS migration script is missing'
sh -n "$MIGRATION" || fail 'VPS migration script syntax is invalid'

# The only trigger is manual dispatch, and the requested full SHA must be in main.
contains "$WORKFLOW" 'workflow_dispatch:' 'workflow must be manually dispatched only'
contains "$WORKFLOW" 'required: true' 'manual SHA input must be required'
contains "$WORKFLOW" 'type: string' 'manual SHA input must be a string'
contains "$WORKFLOW" 'github.ref == '\''refs/heads/main'\''' 'workflow jobs must be restricted to main'
contains "$WORKFLOW" '^[0-9a-fA-F]{40}$' 'workflow must validate an exact 40-character SHA'
contains "$WORKFLOW" 'git merge-base --is-ancestor "$MIGRATION_SHA" origin/main' 'workflow must prove the SHA is integrated in main'
! grep -Eq '^[[:space:]]+(push|pull_request|schedule):' "$WORKFLOW" || fail 'production migration must not have an automatic trigger'
contains "$WORKFLOW" 'environment: production' 'migration job must use the protected production environment'
contains "$WORKFLOW" 'group: deploy-production' 'migration must share deploy concurrency group'
contains "$WORKFLOW" 'cancel-in-progress: false' 'migration concurrency must not cancel an active run'

# Trust is pinned with a supplied known_hosts entry; SSH must fail closed.
contains "$WORKFLOW" 'VPS_SSH_KNOWN_HOSTS: ${{ secrets.VPS_SSH_KNOWN_HOSTS }}' 'workflow must use the trusted known-hosts secret'
contains "$WORKFLOW" 'ssh-keygen -F "$VPS_HOST"' 'workflow must verify VPS_HOST has a trusted host-key entry'
contains "$WORKFLOW" 'StrictHostKeyChecking=yes' 'SSH must require strict host-key checking'
contains "$WORKFLOW" 'GlobalKnownHostsFile=/dev/null' 'SSH must not trust ambient global host keys'
contains "$WORKFLOW" 'chmod 600 ~/.ssh/cocinacore_migration_key' 'SSH private key must have private permissions'
not_contains "$WORKFLOW" 'StrictHostKeyChecking=no|ssh-keyscan|echo.*VPS_SSH_KEY|printf.*VPS_SSH_KEY.*(GITHUB_OUTPUT|GITHUB_ENV)' 'workflow must not weaken host trust or expose key material'
not_contains "$WORKFLOW" 'DATABASE_URL|MIGRATION_DATABASE_URL|PGPASSWORD' 'workflow must not transfer or configure database credentials'
contains "$WORKFLOW" 'git archive --format=tar "$MIGRATION_SHA"' 'workflow must transfer an exact-SHA archive'
contains "$WORKFLOW" 'sha256sum migration-source.tar' 'workflow must checksum the source archive'
contains "$WORKFLOW" 'scp ' 'workflow must transfer the archive over SSH'
contains "$MIGRATION" 'sha256sum "$ARCHIVE" | awk '\''{print $1}'\''' 'VPS must validate the transferred archive checksum'
not_contains "$MIGRATION" '^[[:space:]]*git[[:space:]]+(fetch|checkout|switch)([[:space:]]|$)' 'VPS procedure must not fetch or checkout Git source'
not_contains "$WORKFLOW" 'DATABASE_URL.*(echo|printf|log)| (echo|printf|log).*DATABASE_URL' 'workflow must not print or transmit database credentials'

# VPS checks are fail-closed and bind to the known runtime and exact pending migration.
contains "$MIGRATION" 'EXPECTED_PENDING=015_shopping_inventory_transfer.sql' 'only migration 015 may be pending'
contains "$MIGRATION" 'EXPECTED_APP_DIR=/opt/pawtech/apps/cocinacore' 'migration must use the pinned CocinaCore app path'
contains "$MIGRATION" 'RUNTIME_ENV_FILE=/opt/pawtech/env/cocinacore.env' 'migration must use the existing VPS runtime env file'
contains "$MIGRATION" 'DATABASE_URL=$(sed -n' 'runtime database URL must come only from the existing VPS environment'
contains "$MIGRATION" 'postgresql://cocinacore_user:*@pawtech-postgres:5432/cocinacore_db*' 'runtime DB URL must match the exact PawTech database identity'
contains "$MIGRATION" 'It is never logged or passed to GitHub.' 'credential handling boundary must be explicit in source'
not_contains "$MIGRATION" '(echo|log|fail)[^[:cntrl:]]*\$DATABASE_URL' 'migration script must not print the runtime database URL'
contains "$MIGRATION" 'DATABASE_ENV_FILE=$WORK/database.env' 'runtime credential must be placed only in the private temporary env file'
contains "$MIGRATION" 'chmod 600 "$DATABASE_ENV_FILE"' 'temporary credential file must be private'
contains "$MIGRATION" 'MIGRATION_EXPECTED_PENDING="$EXPECTED_PENDING"' 'preflight and runner must enforce the exact pending ledger'
contains "$MIGRATION" 'relation.rows[0].item_count)!==0' 'baseline requires zero shopping-list items'
contains "$MIGRATION" 'relation.rows[0].bytes)>81920' 'relation footprint must not exceed 81920 bytes'
contains "$MIGRATION" 'activity.rows[0].waiting)!==0' 'preflight must stop on waiting PostgreSQL locks'
contains "$MIGRATION" 'idle.rows[0].idle)!==0' 'preflight must stop on idle-in-transaction sessions'
contains "$MIGRATION" 'lock_timeout:parseBoundedTimeout("MIGRATION_PG_LOCK_TIMEOUT_MS")' 'preflight must set actual PostgreSQL lock timeout'
contains "$MIGRATION" 'statement_timeout:parseBoundedTimeout("MIGRATION_PG_STATEMENT_TIMEOUT_MS")' 'preflight must set actual PostgreSQL statement timeout'
contains "$MIGRATION" 'MIGRATION_PG_LOCK_TIMEOUT_MS=5000' 'canonical runner must receive server-side lock timeout'
contains "$MIGRATION" 'MIGRATION_PG_STATEMENT_TIMEOUT_MS=120000' 'canonical runner must receive server-side statement timeout'
contains "$MIGRATION" 'Number.isSafeInteger(timeout)' 'timeouts must be safe integers'
contains "$MIGRATION" 'timeout>300000' 'timeouts must be bounded'
contains "$MIGRATION" 'connectionTimeoutMillis:5000' 'client connection timeout must remain distinct'
contains "$RUNNER" "parseBoundedTimeout('MIGRATION_PG_LOCK_TIMEOUT_MS')" 'canonical runner must parse the bounded PostgreSQL lock timeout'
contains "$RUNNER" "parseBoundedTimeout('MIGRATION_PG_STATEMENT_TIMEOUT_MS')" 'canonical runner must parse the bounded PostgreSQL statement timeout'
contains "$RUNNER" 'lock_timeout: pgLockTimeout' 'canonical runner must apply PostgreSQL lock_timeout to its pool'
contains "$RUNNER" 'statement_timeout: statementTimeout' 'canonical runner must apply PostgreSQL statement_timeout to its pool'

# Backup precedes DDL; only the exact-SHA CocinaCore helper is permitted.
contains "$MIGRATION" 'scripts/backup-pawtech-cocinacore-predeploy.sh' 'archive must contain the versioned backup helper'
contains "$MIGRATION" 'BACKUP=$("$SOURCE"/scripts/backup-pawtech-cocinacore-predeploy.sh "$RELEASE_SHA"' 'exact-SHA helper must run before migration'
contains "$MIGRATION" 'pg_restore --list' 'backup must be validated without restore'
contains "$MIGRATION" 'sha256sum -c' 'backup checksum must be verified'
contains "$MIGRATION" '"$BACKUP"' 'backup artifact must be retained for validation'
contains "$MIGRATION" 'stat -c '\''%a'\'' "$BACKUP"' 'backup artifact permissions must be checked'
contains "$MIGRATION" 'stat -c '\''%a'\'' "$BACKUP.sha256"' 'checksum permissions must be checked'
contains "$MIGRATION" 'stat -c '\''%a'\'' "$backup_dir"' 'backup directory permissions must be checked'
backup_line=$(grep -nF 'BACKUP=$("$SOURCE"/scripts/backup-pawtech-cocinacore-predeploy.sh' "$MIGRATION" | cut -d: -f1)
runner_line=$(grep -nF 'node scripts/run-migrations.js --lane migration "' "$MIGRATION" | cut -d: -f1 || true)
[ -n "$backup_line" ] || fail 'backup helper invocation not found'
runner_line=$(grep -nF 'node scripts/run-migrations.js --lane migration >/dev/null' "$MIGRATION" | cut -d: -f1)
[ "$backup_line" -lt "$runner_line" ] || fail 'backup must precede the mutating canonical runner'
contains "$MIGRATION" 'node scripts/run-migrations.js --lane migration --dry-run' 'canonical exact-pending dry-run must precede backup'
contains "$MIGRATION" 'node scripts/run-migrations.js --lane migration --verify-complete' 'post-migration verification must use read-only complete verification'
contains "$MIGRATION" 'log "BACKUP_VALIDATED sha=$RELEASE_SHA"' 'backup evidence must identify the selected SHA'
contains "$MIGRATION" 'log "MIGRATION_VERIFIED sha=$RELEASE_SHA migration=$EXPECTED_PENDING"' 'migration evidence must identify the SHA and migration'
contains "$MIGRATION" 'RECEIPT secretless=true database_changed=015-only backup=verified schema_verification=passed' 'final operator receipt must be secretless and include backup and verification outcomes'
contains "$MIGRATION" 'case "$WORK" in /tmp/cocinacore-migration.*)' 'cleanup must be bounded to the private migration temp directory'
contains "$MIGRATION" 'rm -rf -- "$WORK"' 'cleanup must remove only the bounded private work directory'
not_contains "$MIGRATION" 'pg_restore[^\n]*(--clean|--dbname)|pg_restore -d|pg_restore --dbname' 'migration must never automatically restore a backup'
not_contains "$MIGRATION" 'retry|provision|docker network (create|connect|disconnect)|docker (stop|rm|restart)' 'migration must not retry, provision, cut over, or mutate shared infrastructure'
not_contains "$MIGRATION" 'deploy-pawtech-production|npm run db:provision|db:provision' 'migration must not invoke deploy or provisioning'

# Keep this guard in the existing CI contract suite.
contains "$CI" 'Validate PawTech production migration contract' 'CI must register the production migration safety contract'
contains "$CI" 'test-pawtech-migration-contract.sh' 'CI must execute the production migration safety contract'

printf '%s\n' 'pawtech migration contract passed'
