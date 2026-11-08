#!/bin/sh
# shellcheck disable=SC2016 # Static contracts intentionally match literal YAML and shell expansions.
set -eu

ROOT=$(CDPATH='' cd -- "$(dirname -- "$0")/../.." && pwd)
WORKFLOW="$ROOT/.github/workflows/migrate-production.yml"
MIGRATION="$ROOT/scripts/migrate-pawtech-production.sh"
RUNNER="$ROOT/frontend/scripts/run-migrations.js"
BASELINE="$ROOT/frontend/scripts/migration-baseline.js"
BASELINE_TEST="$ROOT/scripts/tests/test-pawtech-migration-baseline.js"
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
workflow_step() {
  awk -v marker="      - name: $1" '
    $0 == marker { found=1; next }
    found && /^      - name:/ { exit }
    found { print }
  ' "$WORKFLOW"
}
step_contains() {
  workflow_step "$1" | grep -Fq -- "$2" || fail "$3"
}
step_not_contains() {
  if workflow_step "$1" | grep -Eiq -- "$2"; then fail "$3"; fi
}
step_outer_shell_is_strict() {
  workflow_step "$1" | awk '
    /^[[:space:]]+run:[[:space:]]*\|[[:space:]]*$/ { in_run=1; next }
    in_run && /^[[:space:]]*$/ { next }
    in_run { found=($0 ~ /^[[:space:]]+set -euo pipefail[[:space:]]*$/); exit }
    END { exit !found }
  '
}
workflow_step_run() {
  awk -v marker="      - name: $1" '
    $0 == marker { step=1; next }
    step && /^      - name:/ { exit }
    step && /^        run: \|[[:space:]]*$/ { in_run=1; next }
    in_run && /^          / { sub(/^          /, ""); print; next }
    in_run { exit }
  ' "$WORKFLOW"
}

[ -f "$WORKFLOW" ] || fail 'manual production migration workflow is missing'
[ -f "$MIGRATION" ] || fail 'VPS migration script is missing'
sh -n "$MIGRATION" || fail 'VPS migration script syntax is invalid'
node "$BASELINE_TEST" || fail 'shopping-list migration baseline test failed'

# The only trigger is manual dispatch, and the requested full SHA must be in main.
contains "$WORKFLOW" 'workflow_dispatch:' 'workflow must be manually dispatched only'
contains "$WORKFLOW" 'required: true' 'manual SHA input must be required'
contains "$WORKFLOW" 'type: string' 'manual SHA input must be a string'
contains "$WORKFLOW" 'approval_reference:' 'operator must provide owner approval acknowledgement'
contains "$WORKFLOW" 'EXPECTED_APPROVAL_REFERENCE="M5-018-019-${MIGRATION_SHA,,}-owner-approved"' 'workflow approval receipt must be bound to M5 018/019 and the exact SHA'
contains "$WORKFLOW" 'an identity proof or a substitute for GitHub Environment reviewers' 'workflow must not misrepresent the operator receipt as enforced identity'
contains "$WORKFLOW" 'MANUAL_APPROVAL_RECEIPT=' 'workflow must log a non-secret approval receipt'
contains "$WORKFLOW" 'github.ref == '\''refs/heads/main'\''' 'workflow jobs must be restricted to main'
contains "$WORKFLOW" '^[0-9a-fA-F]{40}$' 'workflow must validate an exact 40-character SHA'
contains "$WORKFLOW" 'git merge-base --is-ancestor "$MIGRATION_SHA" origin/main' 'workflow must prove the SHA is integrated in main'
contains "$WORKFLOW" 'git show-ref --verify --quiet refs/remotes/origin/main' 'workflow must confirm authenticated checkout already has origin/main'
not_contains "$WORKFLOW" 'git fetch --no-tags origin' 'workflow must not perform an unauthenticated second fetch after checkout'
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
contains "$WORKFLOW" 'docker build --progress=plain --pull=false' 'exact-SHA image must build visibly on the GitHub runner without pulling'
contains "$WORKFLOW" '--label "org.opencontainers.image.revision=$MIGRATION_SHA"' 'runner image must carry the selected revision label'
contains "$WORKFLOW" 'docker save "$IMAGE" -o migration-image.tar' 'runner must export the built image archive'
contains "$WORKFLOW" 'sha256sum migration-image.tar' 'workflow must checksum the image archive'
contains "$WORKFLOW" 'scp ' 'workflow must transfer source and image archives over SSH'
contains "$WORKFLOW" 'docker load -i "$IMAGE_ARCHIVE"' 'image load must run in a separate non-mutating SSH step'
contains "$WORKFLOW" 'sha256sum "$IMAGE_ARCHIVE" | awk '\''{print $1}'\''' 'VPS image load must verify the transferred image checksum'
contains "$WORKFLOW" '$(awk '\''{print $1}'\'' "$IMAGE_SHA_FILE")' 'VPS image load must compare against the transferred checksum'
contains "$WORKFLOW" 'if: success()' 'Apply must be explicitly gated on prior step success'
contains "$WORKFLOW" 'ServerAliveInterval=30' 'SSH phases must configure server keepalives'
contains "$WORKFLOW" 'ServerAliveCountMax=6' 'SSH phases must bound missed server keepalives'
contains "$WORKFLOW" 'TCPKeepAlive=yes' 'SSH phases must enable TCP keepalives'
contains "$WORKFLOW" 'ConnectTimeout=15' 'SSH phases must bound connection establishment'
not_contains "$WORKFLOW" 'continue-on-error:|always\(\)|\|\|[[:space:]]*true' 'workflow must not swallow SSH failures or bypass the Apply gate'
contains "$MIGRATION" 'sha256sum "$ARCHIVE" | awk '\''{print $1}'\''' 'VPS must validate the transferred archive checksum'
contains "$MIGRATION" 'docker image inspect' 'VPS must verify the loaded image revision label'
contains "$MIGRATION" '"$RELEASE_SHA" ] || fail '\''loaded migration image revision label mismatch'\''' 'VPS must fail closed on an unexpected image revision'
contains "$WORKFLOW" 'docker image inspect --format' 'image load step must verify the revision label before Apply'
not_contains "$MIGRATION" '^[[:space:]]*docker[[:space:]]+build([[:space:]]|$)' 'VPS migration script must never build an image'
ssh_count=$(grep -Ec '^[[:space:]]*ssh ' "$WORKFLOW")
scp_count=$(grep -Ec '^[[:space:]]*scp ' "$WORKFLOW")
[ "$ssh_count" -eq 3 ] && [ "$scp_count" -eq 1 ] || fail 'expected distinct transfer-setup, load, Apply SSH phases and one SCP phase'
for option in ServerAliveInterval=30 ServerAliveCountMax=6 TCPKeepAlive=yes ConnectTimeout=15; do
  option_count=$(grep -Fc -- "-o $option" "$WORKFLOW")
  [ "$option_count" -eq 4 ] || fail "every SSH/SCP phase must specify $option"
done
build_step_line=$(grep -nF 'name: Build exact-SHA migration image on runner' "$WORKFLOW" | cut -d: -f1)
transfer_step_line=$(grep -nF 'name: Transfer exact-SHA source and image archives to VPS' "$WORKFLOW" | cut -d: -f1)
load_step_line=$(grep -nF 'name: Load and verify migration image on VPS' "$WORKFLOW" | cut -d: -f1)
apply_step_line=$(grep -nF 'name: Apply exact-SHA production migration procedure' "$WORKFLOW" | cut -d: -f1)
[ "$build_step_line" -lt "$transfer_step_line" ] && [ "$transfer_step_line" -lt "$load_step_line" ] && [ "$load_step_line" -lt "$apply_step_line" ] || fail 'build, transfer, load, and Apply workflow steps must be strictly ordered'
# A broken pipe or SSH exit 255 must stop the current step and cannot reach Apply.
step_contains 'Build exact-SHA migration image on runner' 'set -euo pipefail' 'runner build must fail closed on errors'
step_contains 'Transfer exact-SHA source and image archives to VPS' 'set -euo pipefail' 'archive transfer must fail closed on SSH errors'
step_contains 'Load and verify migration image on VPS' 'set -euo pipefail' 'image load must fail closed on SSH exit 255'
step_contains 'Apply exact-SHA production migration procedure' 'set -euo pipefail' 'Apply must fail closed on SSH errors'
for step in 'Build exact-SHA migration image on runner' 'Transfer exact-SHA source and image archives to VPS' 'Load and verify migration image on VPS' 'Apply exact-SHA production migration procedure'; do
  step_outer_shell_is_strict "$step" || fail "outer Actions shell for '$step' must begin with strict mode"
done
step_contains 'Apply exact-SHA production migration procedure' 'if: success()' 'Apply must run only after build, transfer, and load all succeed'
step_not_contains 'Load and verify migration image on VPS' 'docker build|run-migrations|backup-pawtech' 'image-load step must be non-mutating and cannot apply DDL'
step_not_contains 'Apply exact-SHA production migration procedure' 'docker build' 'SSH Apply payload must not build an orphanable image before DDL'
step_not_contains 'Build exact-SHA migration image on runner' '^[[:space:]]*(ssh|scp)[[:space:]]' 'image build must remain on the GitHub runner, not the VPS'
not_contains "$WORKFLOW" 'continue-on-error:|always\(\)|\|\|[[:space:]]*true' 'SSH/build failures must not be swallowed or bypass the Apply gate'
# Exercise the actual Load step shell with an SSH disconnect (exit 255).
# The failure must propagate; the separate Apply step is statically success-gated above.
disconnect_tmp=$(mktemp -d)
trap 'rm -rf -- "$disconnect_tmp"' EXIT HUP INT TERM
mkdir -p "$disconnect_tmp/bin" "$disconnect_tmp/home/.ssh"
printf '#!/bin/sh\nexit 255\n' > "$disconnect_tmp/bin/ssh"
chmod 700 "$disconnect_tmp/bin/ssh"
load_run=$(workflow_step_run 'Load and verify migration image on VPS')
[ -n "$load_run" ] || fail 'could not extract the actual image-load run block for disconnect test'
if PATH="$disconnect_tmp/bin:$PATH" HOME="$disconnect_tmp/home" VPS_HOST=example.invalid VPS_USER=runner MIGRATION_SHA=0123456789012345678901234567890123456789 RUN_ID=1 RUN_ATTEMPT=1 bash -euo pipefail -c "$load_run" >/dev/null 2>&1; then
  fail 'simulated SSH exit 255 must fail the image-load step'
else
  load_status=$?
fi
[ "$load_status" -eq 255 ] || fail 'SSH disconnect status must propagate unchanged and skip success-gated Apply'
rm -rf -- "$disconnect_tmp"
trap - EXIT HUP INT TERM
not_contains "$MIGRATION" '^[[:space:]]*git[[:space:]]+(fetch|checkout|switch)([[:space:]]|$)' 'VPS procedure must not fetch or checkout Git source'
not_contains "$WORKFLOW" 'DATABASE_URL.*(echo|printf|log)| (echo|printf|log).*DATABASE_URL' 'workflow must not print or transmit database credentials'

# VPS checks are fail-closed and bind to the known runtime and exact pending migration.
contains "$MIGRATION" 'EXPECTED_PENDING=018_cooking_sessions.sql,019_real_consumption_reconciliation.sql' 'only the exact ordered 018/019 migrations may be pending'
contains "$MIGRATION" 'EXPECTED_APP_DIR=/opt/pawtech/apps/cocinacore' 'migration must use the pinned CocinaCore app path'
contains "$MIGRATION" 'RUNTIME_ENV_FILE=/opt/pawtech/env/cocinacore.env' 'migration must use the existing VPS runtime env file'
contains "$MIGRATION" 'MIGRATION_ENV_FILE=/opt/pawtech/env/cocinacore.migration.env' 'migration must use a distinct pinned VPS migration env file'
contains "$MIGRATION" 'DATABASE_URL=$(sed -n' 'runtime database URL must come only from the existing VPS environment'
contains "$MIGRATION" 'postgresql://cocinacore_user:*@pawtech-postgres:5432/cocinacore_db*' 'runtime DB URL must match the exact PawTech database identity'
contains "$MIGRATION" 'postgresql://migration_admin:*@pawtech-postgres:5432/cocinacore_db*' 'migration DB URL must match the dedicated PawTech migration identity'
contains "$MIGRATION" 'stat -c '\''%a'\'' "$MIGRATION_ENV_FILE")" = 600' 'migration environment file must be mode 0600'
contains "$MIGRATION" 'MIGRATION_IDENTITY_PREFLIGHT_FAILED' 'migration identity must be explicitly checked before migration'
contains "$MIGRATION" 'COCINACORE_SEPARATED_DB_LANES_ENABLED=true' 'canonical runner must use the separated migration lane'
contains "$MIGRATION" 'It is never logged or passed to GitHub.' 'credential handling boundary must be explicit in source'
not_contains "$MIGRATION" '(echo|log|fail)[^[:cntrl:]]*\$DATABASE_URL' 'migration script must not print the runtime database URL'
contains "$MIGRATION" 'DATABASE_ENV_FILE=$WORK/database.env' 'runtime credential must be placed only in the private temporary env file'
contains "$MIGRATION" 'chmod 600 "$DATABASE_ENV_FILE"' 'temporary credential file must be private'
contains "$MIGRATION" 'MIGRATION_DATABASE_ENV_FILE=$WORK/migration-database.env' 'migration credential must use a separate private temporary env file'
contains "$MIGRATION" 'chmod 600 "$MIGRATION_DATABASE_ENV_FILE"' 'migration credential temporary file must be private'
contains "$MIGRATION" 'MIGRATION_EXPECTED_PENDING="$EXPECTED_PENDING"' 'preflight and runner must enforce the exact pending ledger'
not_contains "$MIGRATION" 'item_count\)!==0' 'baseline must not reject existing shopping-list rows'
contains "$MIGRATION" 'require("./scripts/migration-baseline")' 'preflight must use the production-image baseline helper'
contains "$MIGRATION" 'validateShoppingListBaseline(relation.rows[0])' 'preflight must validate the shopping-list query result'
contains "$MIGRATION" 'Migrations 018/019 do not touch shopping-list rows' 'bounded row-preserving baseline rationale must remain explicit'
contains "$BASELINE" 'MAX_SHOPPING_LIST_RELATION_BYTES = 81920' 'relation footprint must retain the 81920-byte ceiling'
contains "$BASELINE" 'bytes > BigInt(MAX_SHOPPING_LIST_RELATION_BYTES)' 'relation size above the ceiling must fail'
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

# The exact-SHA release-tree verifier checks the existing daily backup read-only before DDL.
contains "$MIGRATION" '[ -x "$SOURCE/scripts/verify-pawtech-cocinacore-daily-backup.sh" ]' 'archive must contain the executable daily backup verifier'
contains "$MIGRATION" 'DAILY_BACKUP_VERIFIED=$("$SOURCE"/scripts/verify-pawtech-cocinacore-daily-backup.sh 2>/dev/null)' 'exact-SHA verifier must run and capture its evidence'
contains "$MIGRATION" '[ "$DAILY_BACKUP_VERIFIED" = DAILY_BACKUP_VERIFIED ]' 'daily backup verifier evidence must be exact and fail closed'
not_contains "$MIGRATION" 'pg_dump|rclone[[:space:]]+(copy|sync)|backup-pawtech-cocinacore-predeploy\.sh|BACKUP_ROOT|pg_restore' 'migration must not create/copy backups, use the old helper/manual root, or run pg_restore'
verifier_line=$(grep -nF 'DAILY_BACKUP_VERIFIED=$("$SOURCE"/scripts/verify-pawtech-cocinacore-daily-backup.sh' "$MIGRATION" | cut -d: -f1)
runner_line=$(grep -nF 'node scripts/run-migrations.js --lane migration >/dev/null' "$MIGRATION" | cut -d: -f1)
[ -n "$verifier_line" ] || fail 'daily backup verifier invocation not found'
[ "$verifier_line" -lt "$runner_line" ] || fail 'daily backup verification must precede the mutating canonical runner'
dry_run_line=$(grep -nF 'node scripts/run-migrations.js --lane migration --dry-run' "$MIGRATION" | cut -d: -f1)
[ "$dry_run_line" -lt "$verifier_line" ] || fail 'daily backup verification must follow the canonical dry-run'
contains "$MIGRATION" 'node scripts/run-migrations.js --lane migration --dry-run' 'canonical exact-pending dry-run must precede daily backup verification'
contains "$MIGRATION" 'node scripts/run-migrations.js --lane migration --verify-complete' 'post-migration verification must use read-only complete verification'
contains "$MIGRATION" 'log "MIGRATIONS_VERIFIED sha=$RELEASE_SHA migrations=$EXPECTED_PENDING"' 'migration evidence must identify the SHA and ordered 018/019 migrations'
contains "$MIGRATION" 'RECEIPT secretless=true database_changed=018-019-only daily_backup=verified migration_role=verified runtime_acl=verified schema_verification=passed' 'final operator receipt must be secretless and include 018/019, backup, identities, runtime ACL, and verification outcomes'
contains "$MIGRATION" 'RUNTIME_M5_ACL_VERIFICATION_FAILED' 'post-migration runtime ACL verification must fail closed'
contains "$MIGRATION" 'case "$WORK" in /tmp/cocinacore-migration.*)' 'cleanup must be bounded to the private migration temp directory'
contains "$MIGRATION" 'rm -rf -- "$WORK"' 'cleanup must remove only the bounded private work directory'
not_contains "$MIGRATION" 'pg_restore[^\n]*(--clean|--dbname)|pg_restore -d|pg_restore --dbname' 'migration must never automatically restore a backup'
not_contains "$MIGRATION" 'retry|provision|docker network (create|connect|disconnect)|docker (stop|rm|restart)' 'migration must not retry, provision, cut over, or mutate shared infrastructure'
not_contains "$MIGRATION" 'deploy-pawtech-production|npm run db:provision|db:provision' 'migration must not invoke deploy or provisioning'

# Keep this guard in the existing CI contract suite.
contains "$CI" 'Validate PawTech production migration contract' 'CI must register the production migration safety contract'
contains "$CI" 'test-pawtech-migration-contract.sh' 'CI must execute the production migration safety contract'

printf '%s\n' 'pawtech migration contract passed'
