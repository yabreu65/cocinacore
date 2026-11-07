#!/bin/sh
set -eu

ROOT=$(CDPATH='' cd -- "$(dirname -- "$0")/../.." && pwd)
SCRIPT="$ROOT/scripts/deploy-pawtech-production.sh"
BACKUP_VERIFIER="$ROOT/scripts/verify-pawtech-cocinacore-daily-backup.sh"
WORKFLOW="$ROOT/.github/workflows/deploy.yml"
RUNBOOK="$ROOT/docs/production/runbook.md"

fail() {
  printf '%s\n' "pawtech deploy contract failure: $1" >&2
  exit 1
}

[ -x "$SCRIPT" ] || fail 'deploy script must be executable'
sh -n "$SCRIPT" || fail 'deploy script syntax is invalid'

for expected in \
  'EXPECTED_RUNTIME_ENV_FILE=/opt/pawtech/env/cocinacore.env' \
  'RUNTIME_ENV_FILE=${2:-$EXPECTED_RUNTIME_ENV_FILE}' \
  'POSTGRES_CONTAINER=pawtech-postgres' \
  'REDIS_CONTAINER=pawtech-redis' \
  'INTERNAL_NETWORK=pawtech_internal' \
  'PUBLIC_NETWORK=pawtech_public' \
  'UPLOAD_DIR=/opt/pawtech/data/cocinacore/uploads' \
  'postgresql://cocinacore_user:*@pawtech-postgres:5432/cocinacore_db' \
  'redis://*pawtech-redis:6379*' \
  'git archive --format=tar "$RELEASE_SHA"' \
  'IMAGE="cocinacore:deploy-${RELEASE_SHA}"' \
  'CANDIDATE health=ok' \
  'CUTOVER_FAILED: restoring previous application container'; do
  grep -Fq "$expected" "$SCRIPT" || fail "missing deploy contract: $expected"
done

grep -Fq "grep -Eq '^[0-9a-f]{40}$'" "$SCRIPT" || fail 'release must be a full 40-character SHA'
grep -Fq 'git merge-base --is-ancestor "$RELEASE_SHA" origin/main' "$SCRIPT" || fail 'release SHA must belong to origin/main'
grep -Fq '[ "$RUNTIME_ENV_FILE" = "$EXPECTED_RUNTIME_ENV_FILE" ]' "$SCRIPT" || fail 'runtime env argument is not pinned to the configured path'
grep -Fq "fail 'runtime env path does not match the configured Pawtech path'" "$SCRIPT" || fail 'runtime env path mismatch must fail without echoing the supplied value'
grep -Fq 'stat -c' "$SCRIPT" || fail 'runtime env permissions are not checked'
grep -Fq 'runtime env file must have mode 600' "$SCRIPT" || fail 'runtime env must require mode 0600'
grep -Fq -- '--env-file "$RUNTIME_ENV_FILE"' "$SCRIPT" || fail 'runtime env is not passed to runtime containers'
grep -Fq 'docker network inspect "$network"' "$SCRIPT" || fail 'shared network existence is not checked'
grep -Fq 'docker inspect --format' "$SCRIPT" || fail 'shared service health is not inspected'
grep -Fq "{{if .State.Health}}{{.State.Health.Status}}{{else}}unhealthy{{end}}" "$SCRIPT" ||
  fail 'shared service health check must fail closed using State.Health.Status'
grep -Fq "[ \"\$health\" = 'healthy' ]" "$SCRIPT" || fail 'shared services must be healthy'
grep -Fq -- '-v "$UPLOAD_DIR:/app/uploads"' "$SCRIPT" || fail 'persistent local uploads bind is missing'

grep -Fq 'DB_LANES=$(sed' "$SCRIPT" || fail 'separated-lane setting is not read from runtime config'
grep -Fq "''|false|0|no|off)" "$SCRIPT" || fail 'an absent lane setting must default to disabled'
! grep -Eq 'MIGRATION_ENV_FILE|migration_admin|MIGRATION_DATABASE_URL|BOOTSTRAP_DATABASE_URL|db:provision|\.env\.migration|\.env\.production' "$SCRIPT" ||
  fail 'deploy script contains forbidden provisioning or migration-env behavior'
grep -Fq 'npm run db:migrate:verify' "$SCRIPT" || fail 'read-only migration verification is missing'
! grep -Eq 'npm run db:migrate([[:space:]]|$)' "$SCRIPT" || fail 'mutating db:migrate command is forbidden'
grep -Fq "log 'MIGRATION_EXPECTATION=NO_OP'" "$SCRIPT" || fail 'no-op migration expectation is not emitted after verification'
grep -Fq 'DATABASE_CHANGED=NO' "$SCRIPT" || fail 'database must remain unchanged'
grep -Fq "log 'DATABASE_CHANGED=NO'" "$SCRIPT" || fail 'successful read-only verify must explicitly report unchanged database'
grep -Fq "grep -Eq '^gha-[0-9]{1,20}-[0-9]{1,6}$'" "$SCRIPT" || fail 'GitHub Actions attempt ID must remain bounded and validated'
grep -Fq "grep -Eq '^manual-[0-9]{8}T[0-9]{6}Z-[0-9a-f]{16}$'" "$SCRIPT" || fail 'manual attempt ID must use its separate strict format'
grep -Fq "grep -Eq '^(gha-[0-9]{1,20}-[0-9]{1,6}|manual-[0-9]{8}T[0-9]{6}Z-[0-9a-f]{16})$'" "$SCRIPT" || fail 'rollback must accept only a valid GHA or manual attempt ID'
manual_auth_call_line=$(grep -nF '    fetch_manual_authorization' "$SCRIPT" | cut -d: -f1)
runtime_env_read_line=$(grep -nF '[ -s "$RUNTIME_ENV_FILE" ]' "$SCRIPT" | cut -d: -f1)
docker_network_read_line=$(grep -nF 'docker network inspect "$network"' "$SCRIPT" | tail -n 1 | cut -d: -f1)
[ -n "$manual_auth_call_line" ] && [ -n "$runtime_env_read_line" ] && [ -n "$docker_network_read_line" ] &&
  [ "$manual_auth_call_line" -lt "$runtime_env_read_line" ] && [ "$manual_auth_call_line" -lt "$docker_network_read_line" ] ||
  fail 'manual GitHub authorization must be verified before production config/Docker reads'
manual_fingerprint_compare_line=$(grep -nF '[ "$MANUAL_AUTH_FINGERPRINT" != "$verified_fingerprint" ]' "$SCRIPT" | cut -d: -f1)
manual_consumed_write_line=$(grep -nF "printf 'STATUS=CONSUMED\\n'" "$SCRIPT" | cut -d: -f1)
[ -n "$manual_fingerprint_compare_line" ] && [ -n "$manual_consumed_write_line" ] &&
  [ "$manual_fingerprint_compare_line" -lt "$manual_consumed_write_line" ] ||
  fail 'manual deploy must compare live owner authorization fingerprint to its reservation before consuming'
grep -Fq 'chmod 600 "$DEPLOY_STATE_FILE"' "$SCRIPT" || fail 'pre-cutover state record must be private'
grep -Fq 'if [ "$MODE" = '\''rollback'\'' ]; then' "$SCRIPT" || fail 'rollback-only mode branch is missing'
rollback_dispatch_line=$(grep -nF 'if [ "$MODE" = '\''rollback'\'' ]; then' "$SCRIPT" | head -n 1 | cut -d: -f1)
runtime_validation_line=$(grep -nF '[ "$RUNTIME_ENV_FILE" = "$EXPECTED_RUNTIME_ENV_FILE" ]' "$SCRIPT" | cut -d: -f1)
network_precondition_line=$(grep -nF 'docker network inspect "$network"' "$SCRIPT" | head -n 1 | cut -d: -f1)
shared_health_line=$(grep -nF 'docker inspect --format' "$SCRIPT" | tail -n 1 | cut -d: -f1)
ancestry_line=$(grep -nF 'git merge-base --is-ancestor "$RELEASE_SHA" origin/main' "$SCRIPT" | cut -d: -f1)
[ "$rollback_dispatch_line" -lt "$runtime_validation_line" ] &&
  [ "$rollback_dispatch_line" -lt "$network_precondition_line" ] &&
  [ "$rollback_dispatch_line" -lt "$shared_health_line" ] &&
  [ "$rollback_dispatch_line" -lt "$ancestry_line" ] ||
  fail 'app-only rollback must dispatch before deploy runtime, shared-service, network, and ancestry preconditions'
rollback_block=$(sed -n '/^rollback_mode()/,/^}/p' "$SCRIPT")
for rollback_expected in \
  '[ "$state_mode" = 600 ] && [ "$state_owner" = "$deploy_uid" ] && [ "$state_dir_mode" = 700 ] && [ "$state_dir_owner" = "$deploy_uid" ]' \
  '[ "$DEPLOY_STATE_FILE" = "$state_directory/deploy-state-${ATTEMPT_ID}.state" ]' \
  '[ "$STATE_RELEASE_SHA" = "$RELEASE_SHA" ] && [ "$STATE_ATTEMPT" = "$ATTEMPT_ID" ] &&' \
  'docker inspect "$STATE_PREVIOUS_CONTAINER"' \
  '[ "$previous_id" = "$STATE_PREVIOUS_ID" ] && [ "$previous_image" = "$STATE_PREVIOUS_IMAGE" ]' \
  '[ "$current_image" = "$STATE_IMAGE" ] && [ "$current_attempt" = "$ATTEMPT_ID" ]' \
  'container_absent "$APP_CONTAINER" || rollback_fail' \
  'docker rename "$STATE_PREVIOUS_CONTAINER" "$APP_CONTAINER"' \
  'public_health_ok || rollback_fail'; do
  printf '%s\n' "$rollback_block" | grep -Fq "$rollback_expected" ||
    fail "rollback is missing safety contract: $rollback_expected"
done
rollback_state_identity_line=$(printf '%s\n' "$rollback_block" | grep -nF '[ "$STATE_RELEASE_SHA" = "$RELEASE_SHA" ] && [ "$STATE_ATTEMPT" = "$ATTEMPT_ID" ] &&' | cut -d: -f1)
rollback_state_owner_line=$(printf '%s\n' "$rollback_block" | grep -nF '[ "$state_mode" = 600 ] && [ "$state_owner" = "$deploy_uid" ] && [ "$state_dir_mode" = 700 ] && [ "$state_dir_owner" = "$deploy_uid" ]' | cut -d: -f1)
rollback_current_identity_line=$(printf '%s\n' "$rollback_block" | grep -nF '[ "$current_image" = "$STATE_IMAGE" ] && [ "$current_attempt" = "$ATTEMPT_ID" ]' | cut -d: -f1)
rollback_remove_line=$(printf '%s\n' "$rollback_block" | grep -nF 'docker rm -f "$APP_CONTAINER"' | cut -d: -f1)
rollback_prior_identity_line=$(printf '%s\n' "$rollback_block" | grep -nF '[ "$previous_id" = "$STATE_PREVIOUS_ID" ] && [ "$previous_image" = "$STATE_PREVIOUS_IMAGE" ]' | cut -d: -f1)
rollback_rename_line=$(printf '%s\n' "$rollback_block" | grep -nF 'docker rename "$STATE_PREVIOUS_CONTAINER" "$APP_CONTAINER"' | cut -d: -f1)
rollback_start_line=$(printf '%s\n' "$rollback_block" | grep -nF 'docker start "$APP_CONTAINER"' | head -n 1 | cut -d: -f1)
rollback_public_health_line=$(printf '%s\n' "$rollback_block" | grep -nF 'public_health_ok || rollback_fail' | cut -d: -f1)
[ -n "$rollback_state_identity_line" ] && [ -n "$rollback_state_owner_line" ] &&
  [ -n "$rollback_current_identity_line" ] && [ -n "$rollback_remove_line" ] &&
  [ "$rollback_state_owner_line" -lt "$rollback_state_identity_line" ] &&
  [ "$rollback_state_identity_line" -lt "$rollback_remove_line" ] &&
  [ "$rollback_current_identity_line" -lt "$rollback_remove_line" ] &&
  [ "$rollback_prior_identity_line" -lt "$rollback_rename_line" ] &&
  [ "$rollback_rename_line" -lt "$rollback_start_line" ] &&
  [ "$rollback_start_line" -lt "$rollback_public_health_line" ] ||
  fail 'rollback identity/ownership checks must precede mutation and restoration must precede health verification'
rollback_url_validation_line=$(printf '%s\n' "$rollback_block" | grep -nF 'production_url_valid' | cut -d: -f1)
[ -n "$rollback_url_validation_line" ] && [ "$rollback_start_line" -lt "$rollback_url_validation_line" ] &&
  [ "$rollback_url_validation_line" -lt "$rollback_public_health_line" ] ||
  fail 'rollback must restore before URL validation and validate before public health'
rollback_pre_validation_block=$(printf '%s\n' "$rollback_block" | sed -n "1,$((rollback_url_validation_line - 1))p")
! printf '%s\n' "$rollback_pre_validation_block" | grep -Eq 'curl|wget|public_health_ok|PRODUCTION_URL' ||
  fail 'rollback must not make a public request before URL validation'
! printf '%s\n' "$rollback_block" | grep -Eq 'pg_restore|docker exec "\$(POSTGRES_CONTAINER|REDIS_CONTAINER)|docker (rm|stop|start|rename|network connect).*"\$(POSTGRES_CONTAINER|REDIS_CONTAINER)' ||
  fail 'rollback must not restore the database or mutate shared services'
grep -Fq 'REMOTE_DEPLOY_READY' "$SCRIPT" || fail 'remote deploy must defer final success to GitHub smoke'
! grep -Fq 'DEPLOY_OK' "$SCRIPT" || fail 'remote deploy must not emit premature final success'
grep -Fq 'public_health_ok()' "$SCRIPT" || fail 'public health check must enforce HTTP and JSON status'
grep -Fq 'git ls-tree "$RELEASE_SHA" -- scripts/verify-pawtech-cocinacore-daily-backup.sh' "$SCRIPT" || fail 'preflight must inspect the release-tree daily backup verifier'
grep -Fq '[ "$verifier_mode" = 100755 ]' "$SCRIPT" || fail 'preflight must require an executable release-tree verifier'
grep -Fq 'git cat-file -e "$RELEASE_SHA:scripts/verify-pawtech-cocinacore-daily-backup.sh"' "$SCRIPT" || fail 'preflight must validate the verifier in the release tree'
! grep -Fq 'backup-pawtech-cocinacore-predeploy.sh' "$SCRIPT" || fail 'deleted generated backup helper must not be referenced'
[ -x "$BACKUP_VERIFIER" ] || fail 'daily backup verifier must be executable'
for verifier_expected in \
  'DATABASE_NAME=cocinacore_db' \
  'POSTGRES_CONTAINER=pawtech-postgres' \
  'rclone lsf' \
  'rclone cat' \
  '| sha256sum' \
  '| docker exec -i "$POSTGRES_CONTAINER" pg_restore --list' \
  'TABLE public user_recipes' \
  'TABLE public user_recipe_versions' \
  'rolbypassrls' \
  'DAILY_BACKUP_CHECKSUM_OK' \
  'DAILY_BACKUP_SCHEMA_016_017_OK' \
  'DAILY_BACKUP_RLS_COMPATIBLE' \
  'DAILY_BACKUP_VERIFIED'; do
  grep -Fq "$verifier_expected" "$BACKUP_VERIFIER" || fail "daily verifier missing contract: $verifier_expected"
done
! grep -Eq 'pg_dump|rclone (copy|sync)|mktemp|mkdir|chmod|docker cp|pg_restore[^[:cntrl:]]*--(dbname|clean|create)' "$BACKUP_VERIFIER" ||
  fail 'daily verifier must remain read-only and must not create or restore backups'
grep -Fq 'FROM pg_roles' "$BACKUP_VERIFIER" || fail 'daily verifier must inspect role metadata only'
! grep -Eiq 'INSERT|UPDATE|DELETE|ALTER|CREATE|DROP|FROM public\.' "$BACKUP_VERIFIER" || fail 'daily verifier must not mutate or read application tables'
[ "$(grep -Fc '"$RELEASE_DIR/scripts/verify-pawtech-cocinacore-daily-backup.sh"' "$SCRIPT")" -eq 1 ] || fail 'deploy must invoke daily verifier exactly once'
preflight_log_source=$(grep -F 'PREFLIGHT_OK release=${RELEASE_SHA} storage=${STORAGE_DRIVER}' "$SCRIPT" | head -n 1)
[ -n "$preflight_log_source" ] || fail 'preflight success evidence is missing'
printf '%s\n' "$preflight_log_source" | grep -Fq 'attempt=${ATTEMPT_ID}' || fail 'preflight success evidence must include the attempt'
grep -Fq '[ -d "$MANUAL_BACKUP_ROOT" ] && [ -w "$MANUAL_BACKUP_ROOT" ]' "$SCRIPT" || fail 'preflight must require the existing writable manual snapshot root'
! grep -Fq 'command -v pg_dump' "$SCRIPT" && ! grep -Fq 'command -v pg_restore' "$SCRIPT" || fail 'deploy preflight must not prepare a generated backup'
grep -Fq 'docker inspect "$APP_CONTAINER"' "$SCRIPT" || fail 'preflight must require the existing application container'
grep -Fq '[ "$previous_running" = true ]' "$SCRIPT" || fail 'preflight must require the previous app to be running'
grep -Fq '[ -n "$PREVIOUS_IMAGE" ]' "$SCRIPT" || fail 'preflight must require a nonempty previous image'
grep -Fq 'grep -Eq '\''^[0-9a-f]{64}$'\''' "$SCRIPT" || fail 'preflight must require a full previous container ID'
grep -Fq 'git cat-file -e "$RELEASE_SHA:scripts/verify-pawtech-cocinacore-daily-backup.sh"' "$SCRIPT" || fail 'preflight must validate the read-only daily backup verifier'
grep -Fq 'container_networks_exact "$APP_CONTAINER"' "$SCRIPT" || fail 'preflight must require exact previous-app network membership'

# Exact network-set comparisons must ignore Docker's formatter-added trailing blank line
# without weakening exact membership (extra or missing networks must still fail).
network_normalization_count=$(grep -Ec "docker inspect --format .*NetworkSettings.Networks.*awk 'NF'.*LC_ALL=C sort" "$SCRIPT" || true)
[ "$network_normalization_count" -eq 3 ] ||
  fail 'all three exact network comparisons must drop blank lines before sorting'

normalize_network_fixture() {
  awk 'NF' | LC_ALL=C sort
}
expected_network_fixture=$(printf '%s\n' pawtech_internal pawtech_public | LC_ALL=C sort)
trailing_blank_fixture=$(printf '%s\n' pawtech_internal pawtech_public '')
extra_network_fixture=$(printf '%s\n' pawtech_internal pawtech_public unexpected_network '')
missing_network_fixture=$(printf '%s\n' pawtech_internal '')

[ "$(printf '%s' "$trailing_blank_fixture" | normalize_network_fixture)" = "$expected_network_fixture" ] ||
  fail 'network normalization must accept only the Docker-added trailing blank'
[ "$(printf '%s' "$extra_network_fixture" | normalize_network_fixture)" != "$expected_network_fixture" ] ||
  fail 'network normalization must still reject an extra network'
[ "$(printf '%s' "$missing_network_fixture" | normalize_network_fixture)" != "$expected_network_fixture" ] ||
  fail 'network normalization must still reject a missing required network'
grep -Fq 'previous_internal_health_ok' "$SCRIPT" && grep -Fq 'public_health_ok' "$SCRIPT" || fail 'preflight must prove prior app internal and public health'
grep -Fq '[ -n "$PREVIOUS" ] || fail' "$SCRIPT" || fail 'deploy must fail before cutover if prior app identity is unexpectedly absent'
! grep -Fq "DATABASE_CHANGED=YES" "$SCRIPT" || fail 'database-changed YES path is forbidden'
grep -Fq '[ "$BACKUP_VERIFICATION" = DAILY_BACKUP_VERIFIED ]' "$SCRIPT" || fail 'deploy must retain daily backup verification evidence'
! grep -Fq 'backup-postgres.sh' "$SCRIPT" || fail 'shared multi-database backup helper is forbidden'
! grep -Fq 'retention' "$SCRIPT" || fail 'shared backup retention must not run'
backup_verify_line=$(grep -nF '"$RELEASE_DIR/scripts/verify-pawtech-cocinacore-daily-backup.sh"' "$SCRIPT" | head -n 1 | cut -d: -f1)
verify_line=$(grep -nF 'npm run db:migrate:verify' "$SCRIPT" | cut -d: -f1)
no_op_line=$(grep -nF "log 'MIGRATION_EXPECTATION=NO_OP'" "$SCRIPT" | cut -d: -f1)
candidate_line=$(grep -nF "log 'CANDIDATE starting'" "$SCRIPT" | cut -d: -f1)
cutover_line=$(grep -nF 'docker rename "$APP_CONTAINER" "$PREVIOUS"' "$SCRIPT" | cut -d: -f1)
[ -n "$backup_verify_line" ] && [ "$(grep -Fc '"$RELEASE_DIR/scripts/verify-pawtech-cocinacore-daily-backup.sh"' "$SCRIPT")" -eq 1 ] || fail 'daily backup verifier must be invoked exactly once'
[ "$backup_verify_line" -lt "$verify_line" ] && [ "$verify_line" -lt "$no_op_line" ] &&
  [ "$no_op_line" -lt "$candidate_line" ] && [ "$candidate_line" -lt "$cutover_line" ] ||
  fail 'backup verification/migration verify/no-op/candidate/cutover order is invalid'

grep -Fq 'local)' "$SCRIPT" || fail 'local storage mode is missing'
local_storage=$(sed -n '/  local)/,/    ;;/p' "$SCRIPT")
printf '%s\n' "$local_storage" | grep -Fq '[ -d "$UPLOAD_DIR" ]' || fail 'local storage must require the uploads directory to exist'
! printf '%s\n' "$local_storage" | grep -Eq 'mkdir|chmod|chown|rm[[:space:]]|mv[[:space:]]|touch[[:space:]]|install[[:space:]]' ||
  fail 'local storage must not mutate the uploads directory'
! printf '%s\n' "$local_storage" | grep -Eq 'S3_|required_env' || fail 'local storage must not require S3 credentials'

preflight_return_line=$(grep -nF 'PREFLIGHT_OK release=${RELEASE_SHA} storage=${STORAGE_DRIVER}' "$SCRIPT" | cut -d: -f1)
preflight_previous_check_line=$(grep -nF '  check_previous_app_for_release || fail' "$SCRIPT" | cut -d: -f1)
preflight_exit_line=$(grep -nF '  exit 0' "$SCRIPT" | tail -n 1 | cut -d: -f1)
cleanup_trap_line=$(grep -nF 'trap cleanup EXIT INT TERM' "$SCRIPT" | cut -d: -f1)
[ -n "$preflight_return_line" ] && [ -n "$preflight_previous_check_line" ] && [ -n "$preflight_exit_line" ] && [ -n "$cleanup_trap_line" ] &&
  [ "$preflight_previous_check_line" -lt "$preflight_return_line" ] &&
  [ "$preflight_return_line" -lt "$preflight_exit_line" ] && [ "$preflight_exit_line" -lt "$cleanup_trap_line" ] ||
  fail 'preflight must check the prior app and return before the deploy cleanup trap is installed'
preflight_start_line=$(grep -nF 'printf '\''%s'\'' "$RELEASE_SHA"' "$SCRIPT" | head -n 1 | cut -d: -f1)
preflight_section=$(sed -n "${preflight_start_line},${preflight_exit_line}p" "$SCRIPT")
! printf '%s\n' "$preflight_section" | grep -Eq 'trap[[:space:]]+cleanup|mkdir|chmod|chown|docker (rm|run|build|stop|start|rename|network connect)|mktemp|flock|git archive|tar -xf|git checkout|git reset|git clean|touch|install' ||
  fail 'preflight must not install cleanup or perform deploy/worktree mutations'
command_check_line=$(grep -nF 'for tool in $required_tools' "$SCRIPT" | cut -d: -f1)
sha_check_line=$(grep -nF "printf '%s' \"\$RELEASE_SHA\" | grep -Eq '^[0-9a-f]{40}$'" "$SCRIPT" | head -n 1 | cut -d: -f1)
[ -n "$command_check_line" ] && [ -n "$sha_check_line" ] && [ "$command_check_line" -lt "$sha_check_line" ] ||
  fail 'required commands must be checked before preflight uses them'
grep -Fq 's3)' "$SCRIPT" || fail 'S3 storage mode is missing'
grep -Fq 'for key in S3_ENDPOINT S3_BUCKET S3_ACCESS_KEY_ID S3_SECRET_ACCESS_KEY' "$SCRIPT" ||
  fail 'S3 credentials are not scoped to S3 storage'
grep -Eq 'if .*RESEND_API_KEY.*&&.*EMAIL_FROM|if .*EMAIL_FROM.*&&.*RESEND_API_KEY' "$SCRIPT" ||
  fail 'email settings must be treated as configured only when both values are present'
email_fallback=$(sed -n '/if .*RESEND_API_KEY/,/^[[:space:]]*fi[[:space:]]*$/p' "$SCRIPT" | sed -n '/^[[:space:]]*else[[:space:]]*$/,$p')
[ -n "$email_fallback" ] || fail 'incomplete email configuration must have a nonblocking fallback branch'
! printf '%s\n' "$email_fallback" | grep -Eq 'required_env (RESEND_API_KEY|EMAIL_FROM)|fail[[:space:]]' ||
  fail 'missing or partial email settings must not be required or fail deployment'
printf '%s\n' "$email_fallback" | grep -Eq 'transactional email is not configured|^[[:space:]]*:[[:space:]]*$' ||
  fail 'incomplete email configuration must warn or explicitly no-op'
permissions_block=$(awk '
  /^permissions:$/ { in_permissions=1; print; next }
  in_permissions && /^[^[:space:]]/ { exit }
  in_permissions { print }
' "$WORKFLOW")
[ "$permissions_block" = "$(printf 'permissions:\n  contents: read')" ] ||
  fail 'workflow must grant exactly contents: read permission'
grep -Fq 'VPS_SSH_KNOWN_HOSTS: ${{ secrets.VPS_SSH_KNOWN_HOSTS }}' "$WORKFLOW" ||
  fail 'SSH known_hosts must come from the production Environment secret'
grep -Fq 'VPS_SSH_KNOWN_HOSTS' "$WORKFLOW" || fail 'required trusted SSH known_hosts secret is missing'
grep -Fq "[[ -z \"\${VPS_SSH_KNOWN_HOSTS//[[:space:]]/}\" ]]" "$WORKFLOW" ||
  fail 'empty or whitespace-only known_hosts secret must fail closed'
grep -Fq 'VPS_SSH_KNOWN_HOSTS" > ~/.ssh/known_hosts' "$WORKFLOW" ||
  fail 'trusted known_hosts secret must be written to the known_hosts file'
grep -Fq 'chmod 600 ~/.ssh/known_hosts' "$WORKFLOW" || fail 'known_hosts file must be private'
grep -Fq "ssh-keygen -F \"\$VPS_HOST\" -f ~/.ssh/known_hosts" "$WORKFLOW" ||
  fail 'configured known_hosts must be checked for VPS_HOST'
! grep -Fq 'ssh-keyscan' "$WORKFLOW" || fail 'ssh-keyscan must not establish host trust'
grep -Fq 'StrictHostKeyChecking=yes' "$WORKFLOW" || fail 'SSH host key checking must be strict'
ssh_command_count=$(grep -Fc 'ssh -o StrictHostKeyChecking=yes' "$WORKFLOW")
[ "$ssh_command_count" -eq 2 ] || fail 'deploy and rollback must both use strict SSH host verification'
ssh_trust_options_count=$(grep -Fc "ssh -o StrictHostKeyChecking=yes -o UserKnownHostsFile=\"\$HOME/.ssh/known_hosts\" -o GlobalKnownHostsFile=/dev/null" "$WORKFLOW")
[ "$ssh_trust_options_count" -eq 2 ] || fail 'deploy and rollback must use only the configured known_hosts trust source'
grep -Fq 'deploy-pawtech-production.sh' "$WORKFLOW" || fail 'workflow does not call PawTech deploy script'
grep -Fq '/opt/pawtech/env/cocinacore.env' "$WORKFLOW" || fail 'workflow runtime env path mismatch'
! grep -Eq '\.env\.production|\.env\.migration|docker compose -f docker-compose\.prod\.yml' "$WORKFLOW" ||
  fail 'workflow uses forbidden env files or standalone Compose'
! grep -Eq 'docker (compose|volume create|network create|run .*postgres|run .*redis)' "$SCRIPT" ||
  fail 'PawTech deploy path creates standalone infrastructure'
grep -Fq '/opt/pawtech/env/cocinacore.env' "$RUNBOOK" || fail 'runbook runtime env path mismatch'
grep -Fq 'STORAGE_DRIVER=local' "$RUNBOOK" || fail 'runbook local storage contract missing'
grep -Fq 'npm run db:migrate:verify' "$RUNBOOK" || fail 'runbook omits runtime migration verification'

for inspected in "$SCRIPT" "$WORKFLOW"; do
  ! grep -Eq '(^|[;&|])[[:space:]]*(env|printenv)[[:space:]]|\.Config\.Env|cat[^[:cntrl:]]*RUNTIME_ENV_FILE|source[^[:cntrl:]]*RUNTIME_ENV_FILE|^[[:space:]]*\.[[:space:]].*RUNTIME_ENV_FILE|(echo|printf)[[:space:]].*(DATABASE_URL|REDIS_URL|AUTH_SECRET|GEMINI_API_KEY|S3_SECRET_ACCESS_KEY)' "$inspected" ||
    fail 'deploy implementation may expose runtime environment values'
done
grep -Fq "MANUAL_GITHUB_TOKEN=\$manual_auth_input_token" "$SCRIPT" || fail 'manual token must be captured in the isolated shell variable'
! grep -Fq 'export MANUAL_GITHUB_TOKEN' "$SCRIPT" || fail 'manual token must never be exported to child commands'
manual_token_capture_line=$(grep -n "^    manual_auth_input_token=\${GH_TOKEN:-}" "$SCRIPT" | cut -d: -f1)
candidate_validation_line=$(grep -n '^    validate_prod017_hotfix_candidate$' "$SCRIPT" | tail -n 1 | cut -d: -f1)
[ -n "$manual_token_capture_line" ] && [ -n "$candidate_validation_line" ] &&
  [ "$manual_token_capture_line" -lt "$candidate_validation_line" ] ||
  fail 'manual token must be removed from the environment before any candidate child process'

# Exercise one-use authorization state and rollback identity using only temporary local files.
# The extracted functions do not invoke SSH, Docker, PostgreSQL, or GitHub.
manual_test_root=$(mktemp -d "${TMPDIR:-/tmp}/prod-017-manual-state-test.XXXXXXXX") || fail 'manual test temp directory unavailable'
manual_test_root=$(cd "$manual_test_root" && pwd -P) || fail 'manual test temp directory path unavailable'
trap 'rm -rf "$manual_test_root"' EXIT HUP INT TERM
chmod 700 "$manual_test_root"
manual_lock="$manual_test_root/deploy.lock"
manual_functions=$(sed -n '/^assert_manual_state_root()/,/^}/p; /^reserve_manual_authorization()/,/^}/p; /^consume_manual_authorization()/,/^}/p; /^revalidate_manual_authorization_before_cutover()/,/^}/p; /^rollback_fail()/,/^}/p; /^rollback_mode()/,/^}/p' "$SCRIPT" | sed "s|/tmp/cocinacore-production-deploy.lock|$manual_lock|g")
[ -n "$manual_functions" ] || fail 'manual authorization functions could not be extracted for isolated tests'
printf '%s\n' "$manual_functions" > "$manual_test_root/functions.sh"
cat > "$manual_test_root/driver.sh" <<'EOF'
#!/bin/sh
set -eu
fail() { printf 'TEST_FAIL:%s\n' "$*" >&2; exit 1; }
log() { :; }
docker() { printf 'docker-called\n' >> "$DOCKER_TRACE"; return 1; }
MANUAL_AUTH_COMMENT_ID_FROM_API=${MANUAL_AUTH_COMMENT_ID:-}
MANUAL_GITHUB_TOKEN=fixture-manual-token
flock() { [ "${FLOCK_FAIL:-0}" = 0 ]; }
realpath() { node -e 'process.stdout.write(require("node:fs").realpathSync(process.argv[1]))' "${2:-$1}"; }
stat() {
  case "${2:-}" in
    %a) node -e 'process.stdout.write((require("node:fs").statSync(process.argv[1]).mode & 0o777).toString(8))' "$3" ;;
    %u) node -e 'process.stdout.write(String(require("node:fs").statSync(process.argv[1]).uid))' "$3" ;;
    *) command stat "$@" ;;
  esac
}
date() {
  if [ "${1:-}" = -u ] && [ "${2:-}" = -d ]; then
    node -e 'const d = new Date(process.argv[1]); if (!Number.isFinite(d.getTime())) process.exit(1); process.stdout.write(String(Math.floor(d.getTime()/1000)))' "$3"
  elif [ "${1:-}" = -u ] && [ "${2:-}" = +%s ]; then
    node -e 'process.stdout.write(String(Math.floor(Date.now()/1000)))'
  else
    command date "$@"
  fi
}
. "$FUNCTIONS_FILE"
case "$TEST_MODE" in
  reserve) reserve_manual_authorization ;;
  consume) consume_manual_authorization ;;
  final-check)
    fetch_manual_authorization() {
      MANUAL_AUTH_COMMENT_ID_FROM_API=${FINAL_COMMENT_ID:-$MANUAL_AUTH_COMMENT_ID_FROM_API}
      MANUAL_AUTHORIZER=${FINAL_AUTHORIZER:-$MANUAL_AUTHORIZER}
      MANUAL_AUTH_EXPIRES_AT=${FINAL_EXPIRY:-$MANUAL_AUTH_EXPIRES_AT}
      MANUAL_AUTH_FINGERPRINT=${FINAL_FINGERPRINT:-$MANUAL_AUTH_FINGERPRINT}
    }
    revalidate_manual_authorization_before_cutover
    [ -z "${MANUAL_GITHUB_TOKEN:-}" ] || fail 'manual API token was not cleared after final revalidation'
    [ -z "${GH_TOKEN:-}" ] || fail 'manual GH_TOKEN was not cleared after final revalidation'
    if export -p | grep -q 'MANUAL_GITHUB_TOKEN'; then
      fail 'manual API token was exported to child processes'
    fi
    ;;
  rollback) rollback_mode ;;
  *) fail 'unknown test mode' ;;
esac
EOF
chmod 700 "$manual_test_root/driver.sh"
manual_attempt="manual-$(date -u +%Y%m%dT%H%M%SZ)-a1b2c3d4e5f60718"
manual_expiry=$(node -e 'process.stdout.write(new Date(Math.floor((Date.now()+3600000)/1000)*1000).toISOString().replace(".000Z","Z"))') || fail 'local UTC clock fixture unavailable'
run_manual_driver() {
  run_mode=$1
  run_attempt=${2:-$manual_attempt}
  run_fingerprint=${3:-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa}
  run_expiry=${4:-$manual_expiry}
  run_comment_id=${5:-987654321}
  run_backup_root=${6:-$manual_test_root}
  run_flock_fail=${7:-0}
  env \
    "FUNCTIONS_FILE=$manual_test_root/functions.sh" \
    "MANUAL_BACKUP_ROOT=$run_backup_root" \
    "RELEASE_SHA=d4a13a61cc0d24c4eda96a7baffaacfd0e47c191" \
    "ATTEMPT_ID=$run_attempt" \
    "MANUAL_AUTH_COMMENT_ID=$run_comment_id" \
    "MANUAL_AUTHORIZER=yabreu65" \
    "MANUAL_AUTH_EXPIRES_AT=$run_expiry" \
    "MANUAL_AUTH_FINGERPRINT=$run_fingerprint" \
    "DOCKER_TRACE=$manual_test_root/docker.trace" \
    "FLOCK_FAIL=$run_flock_fail" \
    "TEST_MODE=$run_mode" \
    sh "$manual_test_root/driver.sh"
}
run_manual_driver reserve || fail 'valid manual authorization reservation failed'
reserved_mode=$(node -e 'process.stdout.write((require("node:fs").statSync(process.argv[1]).mode & 0o777).toString(8))' "$manual_test_root/manual-auth-$manual_attempt.state")
[ "$reserved_mode" = 600 ] || fail 'reserved authorization must be mode 0600'
if run_manual_driver reserve >/dev/null 2>&1; then
  fail 'manual attempt replay was reserved twice'
fi
if run_manual_driver consume "$manual_attempt" cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc >/dev/null 2>&1; then
  fail 'manual deploy accepted a changed live comment fingerprint'
fi
changed_expiry=$(node -e 'process.stdout.write(new Date(Math.floor((Date.now()+7200000)/1000)*1000).toISOString().replace(".000Z","Z"))')
if run_manual_driver consume "$manual_attempt" aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa "$changed_expiry" >/dev/null 2>&1; then
  fail 'manual deploy accepted a changed live authorization expiry'
fi
run_manual_driver consume || fail 'matching manual authorization could not be consumed'
consumed_mode=$(node -e 'process.stdout.write((require("node:fs").statSync(process.argv[1]).mode & 0o777).toString(8))' "$manual_test_root/manual-auth-$manual_attempt.consumed")
[ "$consumed_mode" = 600 ] || fail 'consumed authorization must be mode 0600'
if run_manual_driver consume "$manual_attempt" aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa "$manual_expiry" 123 >/dev/null 2>&1; then
  fail 'manual authorization accepted a different comment identity'
fi
if run_manual_driver consume >/dev/null 2>&1; then
  fail 'manual authorization consumption was replayable'
fi

absent_root="$manual_test_root/absent"
mkdir "$absent_root"
chmod 700 "$absent_root"
if run_manual_driver consume "$manual_attempt" aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa "$manual_expiry" 987654321 "$absent_root" >/dev/null 2>&1; then
  fail 'manual deploy accepted a missing authorization reservation'
fi

tampered_attempt="manual-$(date -u +%Y%m%dT%H%M%SZ)-bbbbbbbbbbbbbbbb"
run_manual_driver reserve "$tampered_attempt" bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb || fail 'second valid manual authorization reservation failed'
sed -i.bak 's/COMMENT_ID=987654321/COMMENT_ID=987654322/' "$manual_test_root/manual-auth-$tampered_attempt.state"
rm -f "$manual_test_root/manual-auth-$tampered_attempt.state.bak"
if run_manual_driver consume "$tampered_attempt" bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb >/dev/null 2>&1; then
  fail 'manual deploy accepted an altered authorization reservation'
fi
if run_manual_driver reserve "$manual_attempt" aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa "$manual_expiry" 987654321 "$manual_test_root" 1 >/dev/null 2>&1; then
  fail 'manual preflight ignored a held deployment lock'
fi
run_manual_driver final-check || fail 'matching final authorization revalidation failed'
if FINAL_FINGERPRINT=cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc \
  run_manual_driver final-check >/dev/null 2>&1; then
  fail 'cutover accepted a changed owner authorization fingerprint'
fi

final_revalidation_line=$(grep -n '^  revalidate_manual_authorization_before_cutover$' "$SCRIPT" | tail -n 1 | cut -d: -f1)
state_write_line=$(grep -n '^DEPLOY_STATE_FILE=' "$SCRIPT" | tail -n 1 | cut -d: -f1)
[ -n "$final_revalidation_line" ] && [ -n "$state_write_line" ] &&
  [ "$final_revalidation_line" -lt "$state_write_line" ] ||
  fail 'manual owner authorization is not revalidated immediately before cutover state'

rollback_attempt=$manual_attempt
cat > "$manual_test_root/deploy-state-$rollback_attempt.state" <<EOF
RELEASE_SHA=d4a13a61cc0d24c4eda96a7baffaacfd0e47c191
IMAGE=cocinacore:deploy-d4a13a61cc0d24c4eda96a7baffaacfd0e47c191
PREVIOUS_CONTAINER=cocinacore-web-pre-ad99d502-20261107T020000Z
PREVIOUS_ID=$(printf '%064d' 1)
PREVIOUS_IMAGE=cocinacore:deploy-ad99d502ff19d7bb154c04c24697d2a43c1b17e8
BACKUP_VERIFICATION=DAILY_BACKUP_VERIFIED
DATABASE_CHANGED=NO
DEPLOY_STATE_ATTEMPT=manual-20261107T020000Z-1111111111111111
EOF
chmod 600 "$manual_test_root/deploy-state-$rollback_attempt.state"
if env FUNCTIONS_FILE="$manual_test_root/functions.sh" MANUAL_BACKUP_ROOT="$manual_test_root" RELEASE_SHA=d4a13a61cc0d24c4eda96a7baffaacfd0e47c191 ATTEMPT_ID="$rollback_attempt" DOCKER_TRACE="$manual_test_root/docker.trace" TEST_MODE=rollback sh "$manual_test_root/driver.sh" >/dev/null 2>&1; then
  fail 'rollback accepted a state record bound to a different attempt ID'
fi
[ ! -e "$manual_test_root/docker.trace" ] || fail 'wrong-identity rollback reached Docker'

printf '%s\n' 'pawtech production deploy contract passed'
