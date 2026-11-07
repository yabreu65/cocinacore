#!/bin/sh
set -eu

RELEASE_SHA=${1:-}
EXPECTED_RUNTIME_ENV_FILE=/opt/pawtech/env/cocinacore.env
RUNTIME_ENV_FILE=${2:-$EXPECTED_RUNTIME_ENV_FILE}
PRODUCTION_URL=${3:-}
MODE=${4:-deploy}
ATTEMPT_ID=${5:-}
MANUAL_AUTH_COMMENT_ID=${6:-}
TRUSTED_TOOLING_SHA=${7:-}
MANUAL_BACKUP_ROOT=/opt/pawtech/backups/postgres/cocinacore_db/manual

APP_CONTAINER=cocinacore-web
INTERNAL_NETWORK=pawtech_internal
PUBLIC_NETWORK=pawtech_public
POSTGRES_CONTAINER=pawtech-postgres
REDIS_CONTAINER=pawtech-redis
UPLOAD_DIR=/opt/pawtech/data/cocinacore/uploads
IMAGE=
CANDIDATE=
CANDIDATE_STARTED=0
PREVIOUS=
RELEASE_DIR=
RELEASE_TAR=
PREVIOUS_RENAME_ATTEMPTED=0
PREVIOUS_RENAMED=0
NEW_APP_RUN_ATTEMPTED=0
DEPLOY_SUCCEEDED=0
DATABASE_CHANGED=NO
PREVIOUS_ID=
PREVIOUS_IMAGE_ID=
DEPLOYMENT_ATTEMPT=
BACKUP_VERIFICATION=
NEW_IMAGE=
PREVIOUS_IMAGE=
PROD_017_HOTFIX_SHA=d4a13a61cc0d24c4eda96a7baffaacfd0e47c191
PROD_017_HOTFIX_PARENT=ad99d502ff19d7bb154c04c24697d2a43c1b17e8
PROD_017_PARENT_IMAGE_ID=sha256:b72d20d7c9e6634584b562837e563355c87d02439c0c64bd44d870f0056a7204
MANUAL_AUTH_STATE_FILE=
MANUAL_AUTH_CONSUMED_FILE=
MANUAL_AUTHORIZER=
MANUAL_AUTH_EXPIRES_AT=
MANUAL_AUTH_FINGERPRINT=
case "$MODE" in
  prod-017-manual-preflight|prod-017-manual-deploy)
    unset MANUAL_GITHUB_TOKEN manual_auth_input_token
    manual_auth_input_token=${GH_TOKEN:-}
    unset GH_TOKEN
    MANUAL_GITHUB_TOKEN=$manual_auth_input_token
    unset manual_auth_input_token
    ;;
  *) unset MANUAL_GITHUB_TOKEN ;;
esac

log() {
  printf '%s\n' "$*"
}

fail() {
  if [ "$MODE" = rollback ]; then
    log "MANUAL_INTERVENTION_REQUIRED application_rollback_unverified reason=$*"
  else
    printf '%s\n' "PAWTECH_DEPLOY_ERROR: $*" >&2
  fi
  exit 1
}

validate_prod017_hotfix_candidate() {
  [ "$RELEASE_SHA" = "$PROD_017_HOTFIX_SHA" ] || fail 'prod-017 exception accepts only the fixed reviewed candidate SHA'

  parents=$(git rev-list --parents -n 1 "$RELEASE_SHA" 2>/dev/null) || fail 'prod-017 candidate commit is unavailable'
  [ "$parents" = "$PROD_017_HOTFIX_SHA $PROD_017_HOTFIX_PARENT" ] || fail 'prod-017 candidate parent is not the fixed production baseline'

  expected_changes=$(printf 'M\t%s\n' \
    'frontend/e2e/specs/pdfjs-upload-compat.spec.ts' \
    'frontend/package-lock.json' \
    'frontend/package.json' \
    'frontend/src/app/api/meal-plan/shopping-suggestions/route.test.ts' | LC_ALL=C sort)
  actual_changes=$(git diff-tree --no-commit-id --name-status -r "$PROD_017_HOTFIX_PARENT" "$PROD_017_HOTFIX_SHA" 2>/dev/null | LC_ALL=C sort) ||
    fail 'prod-017 candidate change list could not be verified'
  [ "$actual_changes" = "$expected_changes" ] || fail 'prod-017 candidate diff is not the exact four-file allowlist'

  release_manifest=$(git rev-parse "$PROD_017_HOTFIX_SHA:db/migrations/manifest.json" 2>/dev/null) ||
    fail 'prod-017 candidate migration manifest is unavailable'
  parent_manifest=$(git rev-parse "$PROD_017_HOTFIX_PARENT:db/migrations/manifest.json" 2>/dev/null) ||
    fail 'production baseline migration manifest is unavailable'
  [ "$release_manifest" = "$parent_manifest" ] || fail 'prod-017 candidate changed the migration manifest'
  migration_summary=$(git show "$PROD_017_HOTFIX_SHA:db/migrations/manifest.json" | node -e 'let body="";process.stdin.on("data",chunk=>body+=chunk);process.stdin.on("end",()=>{try{const migrations=JSON.parse(body).migrations;const latest=migrations.at(-1);if(!Array.isArray(migrations))process.exit(1);process.stdout.write([migrations.length,latest?.id,latest?.filename].join("|"))}catch{process.exit(1)}})' 2>/dev/null) ||
    fail 'prod-017 candidate manifest could not be parsed'
  [ "$migration_summary" = '17|017|017_persistent_recipe_archive.sql' ] || fail 'prod-017 candidate does not describe exactly schema migrations 001-017'
  git diff --check "$PROD_017_HOTFIX_PARENT" "$PROD_017_HOTFIX_SHA" >/dev/null 2>&1 || fail 'prod-017 candidate diff-check failed'
}

container_absent() {
  names=$(docker ps -a --format '{{.Names}}') || return 1
  if printf '%s\n' "$names" | grep -Fxq "$1"; then
    return 1
  else
    match_status=$?
    [ "$match_status" -eq 1 ]
  fi
}

rollback_fail() {
  log "MANUAL_INTERVENTION_REQUIRED application_rollback_unverified reason=$1"
  exit 1
}

production_url_valid() {
  node -e "try { const url = new URL(process.argv[1]); if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password) process.exit(1); } catch { process.exit(1); }" "$PRODUCTION_URL"
}

public_health_ok() {
  public_health_body=$(curl -fsS "${PRODUCTION_URL%/}/api/health") || return 1
  printf '%s' "$public_health_body" | node -e "let b='';process.stdin.on('data',x=>b+=x);process.stdin.on('end',()=>{try{const x=JSON.parse(b);if(x.status!=='ok'||x.dependencies?.database?.status!=='ok'||x.dependencies?.redis?.status!=='ok')process.exit(1)}catch{process.exit(1)}})" >/dev/null 2>&1
}

container_networks_exact() {
  actual_networks=$(docker inspect --format '{{range $name, $_ := .NetworkSettings.Networks}}{{$name}}{{"\n"}}{{end}}' "$1" 2>/dev/null | awk 'NF' | LC_ALL=C sort) || return 1
  expected_networks=$(printf '%s\n' "$INTERNAL_NETWORK" "$PUBLIC_NETWORK" | LC_ALL=C sort)
  [ "$actual_networks" = "$expected_networks" ]
}

previous_internal_health_ok() {
  docker exec "$APP_CONTAINER" node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>{if(!r.ok)process.exit(1);return r.json()}).then(x=>{if(x.status!=='ok'||x.dependencies?.database?.status!=='ok'||x.dependencies?.redis?.status!=='ok')process.exit(1)}).catch(()=>process.exit(1))" >/dev/null 2>&1
}

check_previous_app() {
  docker inspect "$APP_CONTAINER" >/dev/null 2>&1 || return 1
  PREVIOUS_ID=$(docker inspect --format '{{.Id}}' "$APP_CONTAINER" 2>/dev/null) || return 1
  PREVIOUS_IMAGE=$(docker inspect --format '{{.Config.Image}}' "$APP_CONTAINER" 2>/dev/null) || return 1
  previous_running=$(docker inspect --format '{{.State.Running}}' "$APP_CONTAINER" 2>/dev/null) || return 1
  [ -n "$PREVIOUS_IMAGE" ] && [ "$previous_running" = true ] || return 1
  printf '%s' "$PREVIOUS_IMAGE" | grep -Eq '^[A-Za-z0-9][A-Za-z0-9._/:@-]*$' || return 1
  printf '%s' "$PREVIOUS_ID" | grep -Eq '^[0-9a-f]{64}$' || return 1
  container_networks_exact "$APP_CONTAINER" || return 1
  previous_internal_health_ok || return 1
  public_health_ok
}

check_previous_app_for_release() {
  check_previous_app || return 1
  case "$MODE" in
    prod-017-hotfix-preflight|prod-017-hotfix-deploy|prod-017-manual-preflight|prod-017-manual-deploy)
      [ "$PREVIOUS_IMAGE" = "cocinacore:deploy-${PROD_017_HOTFIX_PARENT}" ] || return 1
      PREVIOUS_IMAGE_ID=$(docker inspect --format '{{.Image}}' "$APP_CONTAINER" 2>/dev/null) || return 1
      [ "$PREVIOUS_IMAGE_ID" = "$PROD_017_PARENT_IMAGE_ID" ] || return 1
      ;;
  esac
}

assert_manual_state_root() {
  [ -d "$MANUAL_BACKUP_ROOT" ] && [ ! -L "$MANUAL_BACKUP_ROOT" ] && [ -w "$MANUAL_BACKUP_ROOT" ] ||
    fail 'manual authorization state root is unavailable'
  manual_realpath=$(realpath -e "$MANUAL_BACKUP_ROOT" 2>/dev/null) || fail 'manual authorization state root could not be verified'
  [ "$manual_realpath" = "$MANUAL_BACKUP_ROOT" ] || fail 'manual authorization state root path mismatch'
  manual_state_root_mode=$(stat -c '%a' "$MANUAL_BACKUP_ROOT" 2>/dev/null) || fail 'manual authorization state root mode unavailable'
  manual_state_root_owner=$(stat -c '%u' "$MANUAL_BACKUP_ROOT" 2>/dev/null) || fail 'manual authorization state root owner unavailable'
  manual_deploy_uid=$(id -u) || fail 'manual deployment user identity unavailable'
  [ "$manual_state_root_mode" = 700 ] && [ "$manual_state_root_owner" = "$manual_deploy_uid" ] ||
    fail 'manual authorization state root permissions or owner mismatch'
}

fetch_manual_authorization() {
  if [ -z "$MANUAL_AUTH_COMMENT_ID" ] || ! printf '%s' "$MANUAL_AUTH_COMMENT_ID" | grep -Eq '^[0-9]{1,20}$'; then
    fail 'manual authorization comment ID is invalid'
  fi
  if [ -z "$TRUSTED_TOOLING_SHA" ] || ! printf '%s' "$TRUSTED_TOOLING_SHA" | grep -Eq '^[0-9a-f]{40}$'; then
    fail 'trusted manual admission source SHA is invalid'
  fi
  unset manual_token
  manual_token=${GH_TOKEN:-${MANUAL_GITHUB_TOKEN:-}}
  [ -n "$manual_token" ] || fail 'manual GitHub authorization token is unavailable'
  git cat-file -e "${TRUSTED_TOOLING_SHA}^{commit}" || fail 'trusted manual admission source is unavailable'
  git merge-base --is-ancestor "$TRUSTED_TOOLING_SHA" origin/main || fail 'manual admission source is not integrated into origin/main'
  validator_file=$(mktemp "${TMPDIR:-/tmp}/cocinacore-manual-admission.XXXXXXXX.mjs") || fail 'manual admission verifier temp file could not be created'
  if ! (umask 077; git show "$TRUSTED_TOOLING_SHA:scripts/prod-017-hotfix-admission.mjs" >"$validator_file"); then
    rm -f "$validator_file"
    fail 'trusted manual admission verifier is unavailable'
  fi
  chmod 600 "$validator_file" || { rm -f "$validator_file"; fail 'manual admission verifier temp permissions could not be secured'; }
  manual_proof=$(GH_TOKEN="$manual_token" node "$validator_file" manual-api "$MANUAL_AUTH_COMMENT_ID" "$ATTEMPT_ID") || {
    unset GH_TOKEN MANUAL_GITHUB_TOKEN manual_token
    rm -f "$validator_file"
    fail 'owner authorization or pinned GitHub release evidence was rejected'
  }
  unset GH_TOKEN
  MANUAL_GITHUB_TOKEN=$manual_token
  unset manual_token
  rm -f "$validator_file" || fail 'manual admission verifier temp cleanup failed'
  IFS='|' read -r proof_marker MANUAL_AUTH_COMMENT_ID_FROM_API proof_attempt MANUAL_AUTHORIZER MANUAL_AUTH_EXPIRES_AT MANUAL_AUTH_FINGERPRINT <<EOF
$manual_proof
EOF
  if [ "$proof_marker" != PROD_017_MANUAL_AUTH_OK ] ||
    [ "$MANUAL_AUTH_COMMENT_ID_FROM_API" != "$MANUAL_AUTH_COMMENT_ID" ] ||
    [ "$proof_attempt" != "$ATTEMPT_ID" ] ||
    [ "$MANUAL_AUTHORIZER" != yabreu65 ] ||
    ! printf '%s' "$MANUAL_AUTH_EXPIRES_AT" | grep -Eq '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$' ||
    ! printf '%s' "$MANUAL_AUTH_FINGERPRINT" | grep -Eq '^[0-9a-f]{64}$'; then
    fail 'manual authorization evidence output is malformed'
  fi
}

revalidate_manual_authorization_before_cutover() {
  expected_comment_id=$MANUAL_AUTH_COMMENT_ID_FROM_API
  expected_authorizer=$MANUAL_AUTHORIZER
  expected_expiry=$MANUAL_AUTH_EXPIRES_AT
  expected_fingerprint=$MANUAL_AUTH_FINGERPRINT
  fetch_manual_authorization
  if [ "$MANUAL_AUTH_COMMENT_ID_FROM_API" != "$expected_comment_id" ] ||
    [ "$MANUAL_AUTHORIZER" != "$expected_authorizer" ] ||
    [ "$MANUAL_AUTH_EXPIRES_AT" != "$expected_expiry" ] ||
    [ "$MANUAL_AUTH_FINGERPRINT" != "$expected_fingerprint" ]; then
    unset GH_TOKEN MANUAL_GITHUB_TOKEN
    fail 'manual authorization changed after deployment preflight'
  fi
  unset GH_TOKEN MANUAL_GITHUB_TOKEN
  log "MANUAL_AUTH_REVALIDATED_BEFORE_CUTOVER attempt=${ATTEMPT_ID} comment=${MANUAL_AUTH_COMMENT_ID_FROM_API}"
}

reserve_manual_authorization() {
  assert_manual_state_root
  exec 9>/tmp/cocinacore-production-deploy.lock
  flock -n 9 || fail 'another CocinaCore production deployment is already running'
  MANUAL_AUTH_STATE_FILE="$MANUAL_BACKUP_ROOT/manual-auth-${ATTEMPT_ID}.state"
  [ ! -e "$MANUAL_AUTH_STATE_FILE" ] || fail 'manual authorization attempt was already reserved'
  if ! (
    umask 077
    set -C
    {
      printf 'STATUS=RESERVED\n'
      printf 'RELEASE_SHA=%s\n' "$RELEASE_SHA"
      printf 'ATTEMPT_ID=%s\n' "$ATTEMPT_ID"
      printf 'COMMENT_ID=%s\n' "$MANUAL_AUTH_COMMENT_ID"
      printf 'AUTHORIZER=%s\n' "$MANUAL_AUTHORIZER"
      printf 'EXPIRES_AT=%s\n' "$MANUAL_AUTH_EXPIRES_AT"
      printf 'FINGERPRINT=%s\n' "$MANUAL_AUTH_FINGERPRINT"
    } >"$MANUAL_AUTH_STATE_FILE"
  ); then
    fail 'manual authorization could not be atomically reserved'
  fi
  chmod 600 "$MANUAL_AUTH_STATE_FILE" || fail 'manual authorization reservation permissions could not be secured'
  manual_state_mode=$(stat -c '%a' "$MANUAL_AUTH_STATE_FILE" 2>/dev/null) || fail 'manual authorization reservation mode unavailable'
  manual_state_owner=$(stat -c '%u' "$MANUAL_AUTH_STATE_FILE" 2>/dev/null) || fail 'manual authorization reservation owner unavailable'
  [ "$manual_state_mode" = 600 ] && [ "$manual_state_owner" = "$manual_deploy_uid" ] ||
    fail 'manual authorization reservation permissions or owner mismatch'
  log "MANUAL_AUTH_RESERVED attempt=${ATTEMPT_ID} comment=${MANUAL_AUTH_COMMENT_ID} authorizer=${MANUAL_AUTHORIZER}"
}

consume_manual_authorization() {
  assert_manual_state_root
  exec 9>/tmp/cocinacore-production-deploy.lock
  flock -n 9 || fail 'another CocinaCore production deployment is already running'
  MANUAL_AUTH_STATE_FILE="$MANUAL_BACKUP_ROOT/manual-auth-${ATTEMPT_ID}.state"
  MANUAL_AUTH_CONSUMED_FILE="$MANUAL_BACKUP_ROOT/manual-auth-${ATTEMPT_ID}.consumed"
  verified_comment_id=${MANUAL_AUTH_COMMENT_ID_FROM_API:-}
  verified_authorizer=${MANUAL_AUTHORIZER:-}
  verified_expiry=${MANUAL_AUTH_EXPIRES_AT:-}
  verified_fingerprint=${MANUAL_AUTH_FINGERPRINT:-}
  [ -f "$MANUAL_AUTH_STATE_FILE" ] && [ ! -L "$MANUAL_AUTH_STATE_FILE" ] || fail 'manual authorization reservation is missing'
  manual_state_mode=$(stat -c '%a' "$MANUAL_AUTH_STATE_FILE" 2>/dev/null) || fail 'manual authorization reservation mode unavailable'
  manual_state_owner=$(stat -c '%u' "$MANUAL_AUTH_STATE_FILE" 2>/dev/null) || fail 'manual authorization reservation owner unavailable'
  [ "$manual_state_mode" = 600 ] && [ "$manual_state_owner" = "$manual_deploy_uid" ] ||
    fail 'manual authorization reservation permissions or owner mismatch'
  state_status=
  state_release_sha=
  state_attempt_id=
  state_comment_id=
  MANUAL_AUTHORIZER=
  MANUAL_AUTH_EXPIRES_AT=
  MANUAL_AUTH_FINGERPRINT=
  seen_state_status=0
  seen_state_release=0
  seen_state_attempt=0
  seen_state_comment=0
  seen_state_authorizer=0
  seen_state_expiry=0
  seen_state_fingerprint=0
  while IFS='=' read -r state_key state_value || [ -n "$state_key$state_value" ]; do
    case "$state_key" in
      STATUS) [ "$seen_state_status" -eq 0 ] || fail 'duplicate manual authorization state field'; state_status=$state_value; seen_state_status=1 ;;
      RELEASE_SHA) [ "$seen_state_release" -eq 0 ] || fail 'duplicate manual authorization state field'; state_release_sha=$state_value; seen_state_release=1 ;;
      ATTEMPT_ID) [ "$seen_state_attempt" -eq 0 ] || fail 'duplicate manual authorization state field'; state_attempt_id=$state_value; seen_state_attempt=1 ;;
      COMMENT_ID) [ "$seen_state_comment" -eq 0 ] || fail 'duplicate manual authorization state field'; state_comment_id=$state_value; seen_state_comment=1 ;;
      AUTHORIZER) [ "$seen_state_authorizer" -eq 0 ] || fail 'duplicate manual authorization state field'; MANUAL_AUTHORIZER=$state_value; seen_state_authorizer=1 ;;
      EXPIRES_AT) [ "$seen_state_expiry" -eq 0 ] || fail 'duplicate manual authorization state field'; MANUAL_AUTH_EXPIRES_AT=$state_value; seen_state_expiry=1 ;;
      FINGERPRINT) [ "$seen_state_fingerprint" -eq 0 ] || fail 'duplicate manual authorization state field'; MANUAL_AUTH_FINGERPRINT=$state_value; seen_state_fingerprint=1 ;;
      *) fail 'unknown manual authorization state field' ;;
    esac
  done < "$MANUAL_AUTH_STATE_FILE"
  if [ "$seen_state_status$seen_state_release$seen_state_attempt$seen_state_comment$seen_state_authorizer$seen_state_expiry$seen_state_fingerprint" != 1111111 ] ||
    [ "$state_status" != RESERVED ] ||
    [ "$state_release_sha" != "$RELEASE_SHA" ] ||
    [ "$state_attempt_id" != "$ATTEMPT_ID" ] ||
    [ "$state_comment_id" != "$MANUAL_AUTH_COMMENT_ID" ] ||
    [ "$state_comment_id" != "$verified_comment_id" ] ||
    [ "$MANUAL_AUTHORIZER" != yabreu65 ] ||
    [ "$MANUAL_AUTHORIZER" != "$verified_authorizer" ] ||
    [ "$MANUAL_AUTH_EXPIRES_AT" != "$verified_expiry" ] ||
    [ "$MANUAL_AUTH_FINGERPRINT" != "$verified_fingerprint" ] ||
    ! printf '%s' "$MANUAL_AUTH_EXPIRES_AT" | grep -Eq '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$' ||
    ! printf '%s' "$MANUAL_AUTH_FINGERPRINT" | grep -Eq '^[0-9a-f]{64}$'; then
    fail 'manual authorization reservation does not match the fixed release and attempt'
  fi
  manual_now=$(date -u +%s) || fail 'manual authorization clock is unavailable'
  manual_expiry=$(date -u -d "$MANUAL_AUTH_EXPIRES_AT" +%s 2>/dev/null) || fail 'manual authorization expiry is invalid'
  [ "$manual_now" -le "$manual_expiry" ] || fail 'manual authorization has expired'
  [ ! -e "$MANUAL_AUTH_CONSUMED_FILE" ] || fail 'manual authorization attempt was already consumed'
  if ! (
    umask 077
    set -C
    {
      printf 'STATUS=CONSUMED\n'
      printf 'RELEASE_SHA=%s\n' "$RELEASE_SHA"
      printf 'ATTEMPT_ID=%s\n' "$ATTEMPT_ID"
      printf 'COMMENT_ID=%s\n' "$MANUAL_AUTH_COMMENT_ID"
      printf 'AUTHORIZER=%s\n' "$MANUAL_AUTHORIZER"
      printf 'EXPIRES_AT=%s\n' "$MANUAL_AUTH_EXPIRES_AT"
      printf 'FINGERPRINT=%s\n' "$MANUAL_AUTH_FINGERPRINT"
    } >"$MANUAL_AUTH_CONSUMED_FILE"
  ); then
    fail 'manual authorization could not be atomically consumed'
  fi
  chmod 600 "$MANUAL_AUTH_CONSUMED_FILE" || fail 'manual authorization consumption permissions could not be secured'
  consumed_mode=$(stat -c '%a' "$MANUAL_AUTH_CONSUMED_FILE" 2>/dev/null) || fail 'manual authorization consumption mode unavailable'
  consumed_owner=$(stat -c '%u' "$MANUAL_AUTH_CONSUMED_FILE" 2>/dev/null) || fail 'manual authorization consumption owner unavailable'
  [ "$consumed_mode" = 600 ] && [ "$consumed_owner" = "$manual_deploy_uid" ] ||
    fail 'manual authorization consumption permissions or owner mismatch'
  log "MANUAL_AUTH_CONSUMED attempt=${ATTEMPT_ID} comment=${MANUAL_AUTH_COMMENT_ID} authorizer=${MANUAL_AUTHORIZER}"
}

rollback_mode() {
  [ -w /tmp ] || rollback_fail 'temporary directory is not writable for deploy lock'
  [ ! -e /tmp/cocinacore-production-deploy.lock ] || [ -w /tmp/cocinacore-production-deploy.lock ] || rollback_fail 'deploy lock is not writable'
  exec 9>/tmp/cocinacore-production-deploy.lock
  flock -n 9 || rollback_fail 'deploy lock unavailable'

  [ -d "$MANUAL_BACKUP_ROOT" ] || rollback_fail 'manual CocinaCore backup hierarchy unavailable'
  manual_realpath=$(realpath -e "$MANUAL_BACKUP_ROOT" 2>/dev/null) || rollback_fail 'manual backup hierarchy path could not be verified'
  [ "$manual_realpath" = "$MANUAL_BACKUP_ROOT" ] || rollback_fail 'manual backup hierarchy path mismatch'
  if ! state_matches=$(find "$MANUAL_BACKUP_ROOT" -name "deploy-state-${ATTEMPT_ID}.state" -print 2>/dev/null); then
    rollback_fail 'state record search failed'
  fi
  if ! state_count=$(printf '%s\n' "$state_matches" | awk 'NF { count += 1 } END { print count + 0 }'); then
    rollback_fail 'state record count could not be verified'
  fi
  [ "$state_count" -eq 1 ] || rollback_fail 'expected exactly one attempt state record'
  DEPLOY_STATE_FILE=$state_matches
  [ -f "$DEPLOY_STATE_FILE" ] && [ ! -L "$DEPLOY_STATE_FILE" ] || rollback_fail 'state record is not a regular file'
  state_directory=$(dirname "$DEPLOY_STATE_FILE")
  state_directory_realpath=$(realpath -e "$state_directory" 2>/dev/null) || rollback_fail 'state directory path could not be verified'
  [ "$state_directory_realpath" = "$state_directory" ] || rollback_fail 'state directory path is not canonical'
  [ "$state_directory" = "$MANUAL_BACKUP_ROOT" ] || rollback_fail 'state record is outside the manual hierarchy'
  [ "$DEPLOY_STATE_FILE" = "$state_directory/deploy-state-${ATTEMPT_ID}.state" ] || rollback_fail 'state record path does not match attempt'
  state_mode=$(stat -c '%a' "$DEPLOY_STATE_FILE" 2>/dev/null) || rollback_fail 'state record metadata unavailable'
  state_owner=$(stat -c '%u' "$DEPLOY_STATE_FILE" 2>/dev/null) || rollback_fail 'state record owner unavailable'
  state_dir_mode=$(stat -c '%a' "$state_directory" 2>/dev/null) || rollback_fail 'state directory metadata unavailable'
  state_dir_owner=$(stat -c '%u' "$state_directory" 2>/dev/null) || rollback_fail 'state directory owner unavailable'
  deploy_uid=$(id -u) || rollback_fail 'deploy user identity unavailable'
  [ "$state_mode" = 600 ] && [ "$state_owner" = "$deploy_uid" ] && [ "$state_dir_mode" = 700 ] && [ "$state_dir_owner" = "$deploy_uid" ] ||
    rollback_fail 'state record or private run directory permissions/owner mismatch'

  STATE_RELEASE_SHA=
  STATE_IMAGE=
  STATE_PREVIOUS_CONTAINER=
  STATE_PREVIOUS_ID=
  STATE_PREVIOUS_IMAGE=
  STATE_BACKUP_VERIFICATION=
  STATE_DATABASE_CHANGED=
  STATE_ATTEMPT=
  STATE_MANUAL_AUTH_COMMENT_ID=
  STATE_MANUAL_AUTHORIZER=
  STATE_MANUAL_AUTHORIZATION_EXPIRES_AT=
  STATE_MANUAL_AUTHORIZATION_FINGERPRINT=
  STATE_MANUAL_AUTH_STATUS=
  seen_release=0
  seen_image=0
  seen_previous_container=0
  seen_previous_id=0
  seen_previous_image=0
  seen_backup=0
  seen_database=0
  seen_attempt=0
  seen_manual_comment=0
  seen_manual_authorizer=0
  seen_manual_expiry=0
  seen_manual_fingerprint=0
  seen_manual_status=0
  key=
  value=
  while IFS='=' read -r key value || [ -n "$key$value" ]; do
    case "$key" in
      RELEASE_SHA) [ "$seen_release" -eq 0 ] || rollback_fail 'duplicate state field'; STATE_RELEASE_SHA=$value; seen_release=1 ;;
      IMAGE) [ "$seen_image" -eq 0 ] || rollback_fail 'duplicate state field'; STATE_IMAGE=$value; seen_image=1 ;;
      PREVIOUS_CONTAINER) [ "$seen_previous_container" -eq 0 ] || rollback_fail 'duplicate state field'; STATE_PREVIOUS_CONTAINER=$value; seen_previous_container=1 ;;
      PREVIOUS_ID) [ "$seen_previous_id" -eq 0 ] || rollback_fail 'duplicate state field'; STATE_PREVIOUS_ID=$value; seen_previous_id=1 ;;
      PREVIOUS_IMAGE) [ "$seen_previous_image" -eq 0 ] || rollback_fail 'duplicate state field'; STATE_PREVIOUS_IMAGE=$value; seen_previous_image=1 ;;
      BACKUP_VERIFICATION) [ "$seen_backup" -eq 0 ] || rollback_fail 'duplicate state field'; STATE_BACKUP_VERIFICATION=$value; seen_backup=1 ;;
      DATABASE_CHANGED) [ "$seen_database" -eq 0 ] || rollback_fail 'duplicate state field'; STATE_DATABASE_CHANGED=$value; seen_database=1 ;;
      DEPLOY_STATE_ATTEMPT) [ "$seen_attempt" -eq 0 ] || rollback_fail 'duplicate state field'; STATE_ATTEMPT=$value; seen_attempt=1 ;;
      MANUAL_AUTH_COMMENT_ID) [ "$seen_manual_comment" -eq 0 ] || rollback_fail 'duplicate manual authorization field'; STATE_MANUAL_AUTH_COMMENT_ID=$value; seen_manual_comment=1 ;;
      MANUAL_AUTHORIZER) [ "$seen_manual_authorizer" -eq 0 ] || rollback_fail 'duplicate manual authorization field'; STATE_MANUAL_AUTHORIZER=$value; seen_manual_authorizer=1 ;;
      MANUAL_AUTHORIZATION_EXPIRES_AT) [ "$seen_manual_expiry" -eq 0 ] || rollback_fail 'duplicate manual authorization field'; STATE_MANUAL_AUTHORIZATION_EXPIRES_AT=$value; seen_manual_expiry=1 ;;
      MANUAL_AUTHORIZATION_FINGERPRINT) [ "$seen_manual_fingerprint" -eq 0 ] || rollback_fail 'duplicate manual authorization field'; STATE_MANUAL_AUTHORIZATION_FINGERPRINT=$value; seen_manual_fingerprint=1 ;;
      MANUAL_AUTH_STATUS) [ "$seen_manual_status" -eq 0 ] || rollback_fail 'duplicate manual authorization field'; STATE_MANUAL_AUTH_STATUS=$value; seen_manual_status=1 ;;
      *) rollback_fail 'unknown or malformed state field' ;;
    esac
  done < "$DEPLOY_STATE_FILE"
  [ "$seen_release$seen_image$seen_previous_container$seen_previous_id$seen_previous_image$seen_backup$seen_database$seen_attempt" = 11111111 ] ||
    rollback_fail 'state record is incomplete'
  [ "$STATE_RELEASE_SHA" = "$RELEASE_SHA" ] && [ "$STATE_ATTEMPT" = "$ATTEMPT_ID" ] &&
    [ "$STATE_IMAGE" = "cocinacore:deploy-${RELEASE_SHA}" ] && [ "$STATE_BACKUP_VERIFICATION" = DAILY_BACKUP_VERIFIED ] &&
    [ "$STATE_DATABASE_CHANGED" = NO ] ||
    rollback_fail 'state release/attempt/image/database identity mismatch'
  if printf '%s' "$ATTEMPT_ID" | grep -Eq '^manual-'; then
    [ "$seen_manual_comment$seen_manual_authorizer$seen_manual_expiry$seen_manual_fingerprint$seen_manual_status" = 11111 ] ||
      rollback_fail 'manual rollback authorization state is incomplete'
    if [ "$STATE_MANUAL_AUTH_STATUS" != CONSUMED ] ||
      [ "$STATE_MANUAL_AUTHORIZER" != yabreu65 ] ||
      ! printf '%s' "$STATE_MANUAL_AUTH_COMMENT_ID" | grep -Eq '^[0-9]{1,20}$' ||
      ! printf '%s' "$STATE_MANUAL_AUTHORIZATION_EXPIRES_AT" | grep -Eq '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$' ||
      ! printf '%s' "$STATE_MANUAL_AUTHORIZATION_FINGERPRINT" | grep -Eq '^[0-9a-f]{64}$'; then
      rollback_fail 'manual rollback authorization identity is invalid'
    fi
    MANUAL_AUTH_STATE_FILE="$MANUAL_BACKUP_ROOT/manual-auth-${ATTEMPT_ID}.state"
    MANUAL_AUTH_CONSUMED_FILE="$MANUAL_BACKUP_ROOT/manual-auth-${ATTEMPT_ID}.consumed"
    [ -f "$MANUAL_AUTH_STATE_FILE" ] && [ ! -L "$MANUAL_AUTH_STATE_FILE" ] &&
      [ -f "$MANUAL_AUTH_CONSUMED_FILE" ] && [ ! -L "$MANUAL_AUTH_CONSUMED_FILE" ] ||
      rollback_fail 'manual authorization reservation or consumption evidence is missing'
    manual_auth_state_mode=$(stat -c '%a' "$MANUAL_AUTH_STATE_FILE" 2>/dev/null) || rollback_fail 'manual authorization reservation metadata unavailable'
    manual_auth_state_owner=$(stat -c '%u' "$MANUAL_AUTH_STATE_FILE" 2>/dev/null) || rollback_fail 'manual authorization reservation owner unavailable'
    manual_auth_consumed_mode=$(stat -c '%a' "$MANUAL_AUTH_CONSUMED_FILE" 2>/dev/null) || rollback_fail 'manual authorization consumption metadata unavailable'
    manual_auth_consumed_owner=$(stat -c '%u' "$MANUAL_AUTH_CONSUMED_FILE" 2>/dev/null) || rollback_fail 'manual authorization consumption owner unavailable'
    [ "$manual_auth_state_mode" = 600 ] && [ "$manual_auth_state_owner" = "$deploy_uid" ] &&
      [ "$manual_auth_consumed_mode" = 600 ] && [ "$manual_auth_consumed_owner" = "$deploy_uid" ] ||
      rollback_fail 'manual authorization evidence permissions/owner mismatch'
    if ! grep -Fxq "RELEASE_SHA=$RELEASE_SHA" "$MANUAL_AUTH_STATE_FILE" ||
      ! grep -Fxq "ATTEMPT_ID=$ATTEMPT_ID" "$MANUAL_AUTH_STATE_FILE" ||
      ! grep -Fxq "COMMENT_ID=$STATE_MANUAL_AUTH_COMMENT_ID" "$MANUAL_AUTH_STATE_FILE" ||
      ! grep -Fxq "AUTHORIZER=$STATE_MANUAL_AUTHORIZER" "$MANUAL_AUTH_STATE_FILE" ||
      ! grep -Fxq "EXPIRES_AT=$STATE_MANUAL_AUTHORIZATION_EXPIRES_AT" "$MANUAL_AUTH_STATE_FILE" ||
      ! grep -Fxq "FINGERPRINT=$STATE_MANUAL_AUTHORIZATION_FINGERPRINT" "$MANUAL_AUTH_STATE_FILE" ||
      ! grep -Fxq "RELEASE_SHA=$RELEASE_SHA" "$MANUAL_AUTH_CONSUMED_FILE" ||
      ! grep -Fxq "ATTEMPT_ID=$ATTEMPT_ID" "$MANUAL_AUTH_CONSUMED_FILE" ||
      ! grep -Fxq "COMMENT_ID=$STATE_MANUAL_AUTH_COMMENT_ID" "$MANUAL_AUTH_CONSUMED_FILE" ||
      ! grep -Fxq "AUTHORIZER=$STATE_MANUAL_AUTHORIZER" "$MANUAL_AUTH_CONSUMED_FILE" ||
      ! grep -Fxq "EXPIRES_AT=$STATE_MANUAL_AUTHORIZATION_EXPIRES_AT" "$MANUAL_AUTH_CONSUMED_FILE" ||
      ! grep -Fxq "FINGERPRINT=$STATE_MANUAL_AUTHORIZATION_FINGERPRINT" "$MANUAL_AUTH_CONSUMED_FILE" ||
      ! grep -Fxq 'STATUS=CONSUMED' "$MANUAL_AUTH_CONSUMED_FILE"; then
      rollback_fail 'manual rollback authorization identity mismatch'
    fi
  else
    [ "$seen_manual_comment$seen_manual_authorizer$seen_manual_expiry$seen_manual_fingerprint$seen_manual_status" = 00000 ] ||
      rollback_fail 'GitHub Actions rollback state unexpectedly contains manual authorization'
  fi
  printf '%s' "$STATE_PREVIOUS_CONTAINER" | grep -Eq '^cocinacore-web-pre-[0-9a-f]{8}-[0-9]{8}T[0-9]{6}Z$' || rollback_fail 'previous container name is invalid'
  printf '%s' "$STATE_PREVIOUS_ID" | grep -Eq '^[0-9a-f]{64}$' || rollback_fail 'previous container ID is invalid'
  printf '%s' "$STATE_PREVIOUS_IMAGE" | grep -Eq '^[A-Za-z0-9][A-Za-z0-9._/:@-]*$' || rollback_fail 'previous image reference is invalid'
  if docker inspect "$STATE_PREVIOUS_CONTAINER" >/dev/null 2>&1; then
    previous_id=$(docker inspect --format '{{.Id}}' "$STATE_PREVIOUS_CONTAINER" 2>/dev/null) || rollback_fail 'previous container identity unavailable'
    previous_image=$(docker inspect --format '{{.Config.Image}}' "$STATE_PREVIOUS_CONTAINER" 2>/dev/null) || rollback_fail 'previous container image unavailable'
    [ "$previous_id" = "$STATE_PREVIOUS_ID" ] && [ "$previous_image" = "$STATE_PREVIOUS_IMAGE" ] || rollback_fail 'retained previous container identity mismatch'
  else
    rollback_fail 'retained previous container is missing'
  fi

  current_exists=0
  if docker inspect "$APP_CONTAINER" >/dev/null 2>&1; then
    current_exists=1
    current_image=$(docker inspect --format '{{.Config.Image}}' "$APP_CONTAINER" 2>/dev/null) || rollback_fail 'current app image unavailable'
    current_attempt=$(docker inspect --format '{{index .Config.Labels "com.cocinacore.deploy-attempt"}}' "$APP_CONTAINER" 2>/dev/null) || rollback_fail 'current app attempt unavailable'
    [ "$current_image" = "$STATE_IMAGE" ] && [ "$current_attempt" = "$ATTEMPT_ID" ] || rollback_fail 'current app is not owned by this release attempt'
  else
    container_absent "$APP_CONTAINER" || rollback_fail 'current app absence could not be proven'
  fi

  if [ "$current_exists" -eq 1 ]; then
    docker rm -f "$APP_CONTAINER" >/dev/null 2>&1 || true
    container_absent "$APP_CONTAINER" || rollback_fail 'attempted app container could not be removed safely'
  fi
  if ! docker rename "$STATE_PREVIOUS_CONTAINER" "$APP_CONTAINER" >/dev/null 2>&1; then
    if ! docker inspect "$APP_CONTAINER" >/dev/null 2>&1 ||
       [ "$(docker inspect --format '{{.Id}}' "$APP_CONTAINER" 2>/dev/null || true)" != "$STATE_PREVIOUS_ID" ]; then
      rollback_fail 'previous app container could not be restored'
    fi
  fi
  [ "$(docker inspect --format '{{.Id}}' "$APP_CONTAINER" 2>/dev/null || true)" = "$STATE_PREVIOUS_ID" ] || rollback_fail 'restored container ID mismatch'
  [ "$(docker inspect --format '{{.Config.Image}}' "$APP_CONTAINER" 2>/dev/null || true)" = "$STATE_PREVIOUS_IMAGE" ] || rollback_fail 'restored image mismatch'
  container_absent "$STATE_PREVIOUS_CONTAINER" || rollback_fail 'previous container name remains after restoration'
  if ! docker start "$APP_CONTAINER" >/dev/null 2>&1; then
    [ "$(docker inspect --format '{{.State.Running}}' "$APP_CONTAINER" 2>/dev/null || true)" = true ] || rollback_fail 'previous app could not be started'
  fi
  [ "$(docker inspect --format '{{.State.Running}}' "$APP_CONTAINER" 2>/dev/null || true)" = true ] || rollback_fail 'previous app is not running'

  for network in "$INTERNAL_NETWORK" "$PUBLIC_NETWORK"; do
    if ! attached_networks=$(docker inspect --format '{{range $name, $_ := .NetworkSettings.Networks}}{{$name}}{{"\n"}}{{end}}' "$APP_CONTAINER" 2>/dev/null); then
      rollback_fail 'restored app network state unavailable'
    fi
    if ! printf '%s\n' "$attached_networks" | grep -Fxq "$network"; then
      docker network connect "$network" "$APP_CONTAINER" >/dev/null 2>&1 || true
      if ! attached_networks=$(docker inspect --format '{{range $name, $_ := .NetworkSettings.Networks}}{{$name}}{{"\n"}}{{end}}' "$APP_CONTAINER" 2>/dev/null) ||
         ! printf '%s\n' "$attached_networks" | grep -Fxq "$network"; then
        rollback_fail 'required network could not be restored'
      fi
    fi
  done
  attached_networks=$(docker inspect --format '{{range $name, $_ := .NetworkSettings.Networks}}{{$name}}{{"\n"}}{{end}}' "$APP_CONTAINER" 2>/dev/null | awk 'NF' | LC_ALL=C sort) || rollback_fail 'restored app network state unavailable'
  expected_networks=$(printf '%s\n' "$INTERNAL_NETWORK" "$PUBLIC_NETWORK" | LC_ALL=C sort)
  [ "$attached_networks" = "$expected_networks" ] || rollback_fail 'restored app has unexpected network membership'

  docker exec "$APP_CONTAINER" node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>{if(!r.ok)process.exit(1);return r.json()}).then(x=>{if(x.status!=='ok'||x.dependencies?.database?.status!=='ok'||x.dependencies?.redis?.status!=='ok')process.exit(1)}).catch(()=>process.exit(1))" >/dev/null 2>&1 || rollback_fail 'restored internal app/database/redis health failed'
  production_url_valid || rollback_fail 'production URL is unavailable or invalid; public health could not be verified'
  public_health_ok || rollback_fail 'restored public app/database/redis health failed'
  log "ROLLBACK_RESTORED previous_image=${STATE_PREVIOUS_IMAGE} previous_id=${STATE_PREVIOUS_ID} attempt=${ATTEMPT_ID}"
  log 'DATABASE_CHANGED=NO no_automatic_restore'
  log 'APP_ROLLBACK_SAFE previous_app_health=ok exact_networks=ok'
}

cleanup() {
  status=$?
  rollback_ok=1
  if [ "$CANDIDATE_STARTED" -eq 1 ] && [ -n "$CANDIDATE" ]; then
    if docker inspect "$CANDIDATE" >/dev/null 2>&1; then
      candidate_identity=$(docker inspect --format '{{.Config.Image}}|{{index .Config.Labels "com.cocinacore.deploy-attempt"}}' "$CANDIDATE" 2>/dev/null || true)
      if [ "$candidate_identity" = "$NEW_IMAGE|$DEPLOYMENT_ATTEMPT" ]; then
        docker rm -f "$CANDIDATE" >/dev/null 2>&1 || true
        container_absent "$CANDIDATE" || rollback_ok=0
      else
        rollback_ok=0
      fi
    else
      container_absent "$CANDIDATE" || rollback_ok=0
    fi
  fi
  rm -rf "${RELEASE_DIR:-}" "${RELEASE_TAR:-}" >/dev/null 2>&1 || true

  if [ "$DEPLOY_SUCCEEDED" -ne 1 ] && { [ "$PREVIOUS_RENAME_ATTEMPTED" -eq 1 ] || [ "$PREVIOUS_RENAMED" -eq 1 ] || [ "$NEW_APP_RUN_ATTEMPTED" -eq 1 ]; }; then
    log 'CUTOVER_FAILED: rolling back application container'

    if [ "$PREVIOUS_RENAME_ATTEMPTED" -eq 1 ] && [ "$PREVIOUS_RENAMED" -ne 1 ]; then
      if docker inspect "$PREVIOUS" >/dev/null 2>&1 &&
         [ "$(docker inspect --format '{{.Id}}' "$PREVIOUS" 2>/dev/null || true)" = "$PREVIOUS_ID" ] &&
         [ "$(docker inspect --format '{{.Config.Image}}' "$PREVIOUS" 2>/dev/null || true)" = "$PREVIOUS_IMAGE" ] &&
         container_absent "$APP_CONTAINER"; then
        PREVIOUS_RENAMED=1
      elif docker inspect "$APP_CONTAINER" >/dev/null 2>&1 &&
           [ "$(docker inspect --format '{{.Id}}' "$APP_CONTAINER" 2>/dev/null || true)" = "$PREVIOUS_ID" ] &&
           [ "$(docker inspect --format '{{.Config.Image}}' "$APP_CONTAINER" 2>/dev/null || true)" = "$PREVIOUS_IMAGE" ] &&
           container_absent "$PREVIOUS"; then
        PREVIOUS_RENAMED=0
      else
        rollback_ok=0
      fi
    fi

    if [ "$NEW_APP_RUN_ATTEMPTED" -eq 1 ]; then
      if docker inspect "$APP_CONTAINER" >/dev/null 2>&1; then
        attempted_identity=$(docker inspect --format '{{.Config.Image}}|{{index .Config.Labels "com.cocinacore.deploy-attempt"}}' "$APP_CONTAINER" 2>/dev/null || true)
        current_id=$(docker inspect --format '{{.Id}}' "$APP_CONTAINER" 2>/dev/null || true)
        if [ "$attempted_identity" = "$NEW_IMAGE|$DEPLOYMENT_ATTEMPT" ]; then
          docker rm -f "$APP_CONTAINER" >/dev/null 2>&1 || true
          container_absent "$APP_CONTAINER" || rollback_ok=0
        elif [ "$PREVIOUS_RENAMED" -ne 1 ] || [ "$current_id" != "$PREVIOUS_ID" ]; then
          rollback_ok=0
        fi
      else
        container_absent "$APP_CONTAINER" || rollback_ok=0
      fi
      [ "$PREVIOUS_RENAMED" -eq 1 ] || rollback_ok=0
    fi

    if [ "$PREVIOUS_RENAMED" -eq 1 ]; then
      log 'CUTOVER_FAILED: restoring previous application container'
      if [ -z "$PREVIOUS" ] || [ -z "$PREVIOUS_ID" ] || [ -z "$PREVIOUS_IMAGE" ]; then
        rollback_ok=0
      elif docker inspect "$APP_CONTAINER" >/dev/null 2>&1; then
        [ "$(docker inspect --format '{{.Id}}' "$APP_CONTAINER" 2>/dev/null || true)" = "$PREVIOUS_ID" ] || rollback_ok=0
      elif docker inspect "$PREVIOUS" >/dev/null 2>&1 &&
           [ "$(docker inspect --format '{{.Id}}' "$PREVIOUS" 2>/dev/null || true)" = "$PREVIOUS_ID" ] &&
           [ "$(docker inspect --format '{{.Config.Image}}' "$PREVIOUS" 2>/dev/null || true)" = "$PREVIOUS_IMAGE" ]; then
        if ! docker rename "$PREVIOUS" "$APP_CONTAINER" >/dev/null 2>&1; then
          [ "$(docker inspect --format '{{.Id}}' "$APP_CONTAINER" 2>/dev/null || true)" = "$PREVIOUS_ID" ] || rollback_ok=0
        fi
      else
        rollback_ok=0
      fi

      if [ "$rollback_ok" -eq 1 ]; then
        [ "$(docker inspect --format '{{.Id}}' "$APP_CONTAINER" 2>/dev/null || true)" = "$PREVIOUS_ID" ] || rollback_ok=0
        [ "$(docker inspect --format '{{.Config.Image}}' "$APP_CONTAINER" 2>/dev/null || true)" = "$PREVIOUS_IMAGE" ] || rollback_ok=0
      fi
      if [ "$rollback_ok" -eq 1 ]; then
        if ! docker start "$APP_CONTAINER" >/dev/null 2>&1; then
          [ "$(docker inspect --format '{{.State.Running}}' "$APP_CONTAINER" 2>/dev/null || true)" = true ] || rollback_ok=0
        fi
        [ "$(docker inspect --format '{{.State.Running}}' "$APP_CONTAINER" 2>/dev/null || true)" = true ] || rollback_ok=0
      fi

      for network in "$INTERNAL_NETWORK" "$PUBLIC_NETWORK"; do
        if [ "$rollback_ok" -eq 1 ]; then
          if ! attached_networks=$(docker inspect --format '{{range $name, $_ := .NetworkSettings.Networks}}{{$name}}{{"\n"}}{{end}}' "$APP_CONTAINER" 2>/dev/null); then
            rollback_ok=0
          elif ! printf '%s\n' "$attached_networks" | grep -Fxq "$network"; then
            docker network connect "$network" "$APP_CONTAINER" >/dev/null 2>&1 || true
            if ! attached_networks=$(docker inspect --format '{{range $name, $_ := .NetworkSettings.Networks}}{{$name}}{{"\n"}}{{end}}' "$APP_CONTAINER" 2>/dev/null) ||
               ! printf '%s\n' "$attached_networks" | grep -Fxq "$network"; then
              rollback_ok=0
            fi
          fi
        fi
      done
      if [ "$rollback_ok" -eq 1 ]; then
        attached_networks=$(docker inspect --format '{{range $name, $_ := .NetworkSettings.Networks}}{{$name}}{{"\n"}}{{end}}' "$APP_CONTAINER" 2>/dev/null | awk 'NF' | LC_ALL=C sort) || rollback_ok=0
        expected_networks=$(printf '%s\n' "$INTERNAL_NETWORK" "$PUBLIC_NETWORK" | LC_ALL=C sort)
        [ "$attached_networks" = "$expected_networks" ] || rollback_ok=0
      fi

      if [ "$rollback_ok" -eq 1 ] &&
         docker exec "$APP_CONTAINER" node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>{if(!r.ok)process.exit(1);return r.json()}).then(x=>{if(x.status!=='ok'||x.dependencies?.database?.status!=='ok'||x.dependencies?.redis?.status!=='ok')process.exit(1)}).catch(()=>process.exit(1))" >/dev/null 2>&1 &&
         public_health_ok; then
        log "ROLLBACK_RESTORED previous_image=${PREVIOUS_IMAGE} previous_id=${PREVIOUS_ID}"
        log 'APP_ROLLBACK_SAFE previous_app_health=ok'
      else
        rollback_ok=0
      fi
    fi

    if [ "$rollback_ok" -ne 1 ]; then
      log 'MANUAL_INTERVENTION_REQUIRED application_rollback_unverified'
    elif [ "$PREVIOUS_RENAMED" -ne 1 ] && [ "$NEW_APP_RUN_ATTEMPTED" -ne 1 ]; then
      log 'APP_ROLLBACK_SAFE existing_app_untouched'
    fi
  elif [ "$DEPLOY_SUCCEEDED" -ne 1 ]; then
    if [ "$rollback_ok" -eq 1 ]; then
      log 'APP_ROLLBACK_SAFE existing_app_untouched'
    else
      log 'MANUAL_INTERVENTION_REQUIRED application_cleanup_unverified'
    fi
  fi

  if [ "$DEPLOY_SUCCEEDED" -ne 1 ]; then
    log 'DATABASE_CHANGED=NO no_automatic_restore'
  fi

  exit "$status"
}

if [ "$MODE" = 'rollback' ]; then
  required_tools='docker curl node stat flock grep awk sort dirname basename id find realpath'
else
  required_tools='docker git curl node sha256sum stat flock mktemp tar grep sed tail tr awk sort date cut basename id chmod rm sleep dirname find realpath'
fi
for tool in $required_tools; do
  command -v "$tool" >/dev/null 2>&1 || fail "required command is unavailable: $tool"
done

printf '%s' "$RELEASE_SHA" | grep -Eq '^[0-9a-f]{40}$' ||
  fail 'release SHA must be exactly 40 lowercase hexadecimal characters'

case "$MODE" in
  deploy|preflight|rollback|prod-017-hotfix-preflight|prod-017-hotfix-deploy|prod-017-manual-preflight|prod-017-manual-deploy) ;;
  *) fail 'unsupported deployment mode' ;;
esac

case "$MODE" in
  prod-017-manual-preflight|prod-017-manual-deploy)
    if [ -z "$MANUAL_AUTH_COMMENT_ID" ] || [ -z "$TRUSTED_TOOLING_SHA" ]; then
      fail 'manual authorization inputs are incomplete'
    fi
    if [ "${#ATTEMPT_ID}" -gt 40 ] || ! printf '%s' "$ATTEMPT_ID" | grep -Eq '^manual-[0-9]{8}T[0-9]{6}Z-[0-9a-f]{16}$'; then
      fail 'manual deployment attempt ID is invalid'
    fi
    [ -n "${MANUAL_GITHUB_TOKEN:-}" ] || fail 'manual GitHub authorization token is unavailable'
    ;;
  rollback)
    if [ "${#ATTEMPT_ID}" -gt 40 ] || ! printf '%s' "$ATTEMPT_ID" | grep -Eq '^(gha-[0-9]{1,20}-[0-9]{1,6}|manual-[0-9]{8}T[0-9]{6}Z-[0-9a-f]{16})$'; then
      fail 'rollback attempt ID is invalid'
    fi
    ;;
  *)
    if [ "${#ATTEMPT_ID}" -gt 40 ] || ! printf '%s' "$ATTEMPT_ID" | grep -Eq '^gha-[0-9]{1,20}-[0-9]{1,6}$'; then
      fail 'GitHub Actions deployment attempt ID is invalid'
    fi
    [ -z "$MANUAL_AUTH_COMMENT_ID" ] && [ -z "$TRUSTED_TOOLING_SHA" ] ||
      fail 'GitHub Actions mode must not carry manual authorization inputs'
    ;;
esac

if [ "$MODE" = 'rollback' ]; then
  rollback_mode
  exit 0
fi

case "$MODE" in
  prod-017-manual-preflight|prod-017-manual-deploy)
    validate_prod017_hotfix_candidate
    fetch_manual_authorization
    if [ "$MODE" = 'prod-017-manual-preflight' ]; then
      reserve_manual_authorization
      unset MANUAL_GITHUB_TOKEN
    else
      consume_manual_authorization
    fi
    ;;
esac

if ! production_url_valid; then
  fail 'production URL must be an absolute HTTP(S) URL with a host'
fi
[ "$RUNTIME_ENV_FILE" = "$EXPECTED_RUNTIME_ENV_FILE" ] || fail 'runtime env path does not match the configured Pawtech path'
[ -s "$RUNTIME_ENV_FILE" ] || fail "runtime env file not found: $RUNTIME_ENV_FILE"
mode=$(stat -c '%a' "$RUNTIME_ENV_FILE") || fail 'runtime env file permissions are unavailable'
[ "$mode" = '600' ] || fail "runtime env file must have mode 600 (found $mode)"

required_env() {
  key=$1
  grep -q "^${key}=." "$RUNTIME_ENV_FILE" || fail "runtime env is missing required value: $key"
}

for key in DATABASE_URL REDIS_URL APP_PUBLIC_URL AUTH_SECRET GEMINI_API_KEY STORAGE_DRIVER; do
  required_env "$key"
done
APP_PUBLIC_URL=$(sed -n 's/^APP_PUBLIC_URL=//p' "$RUNTIME_ENV_FILE" | tail -n 1)
[ "${APP_PUBLIC_URL%/}" = "${PRODUCTION_URL%/}" ] || fail 'production URL does not match configured application URL'

DATABASE_URL=$(sed -n 's/^DATABASE_URL=//p' "$RUNTIME_ENV_FILE" | tail -n 1)
REDIS_URL=$(sed -n 's/^REDIS_URL=//p' "$RUNTIME_ENV_FILE" | tail -n 1)
STORAGE_DRIVER=$(sed -n 's/^STORAGE_DRIVER=//p' "$RUNTIME_ENV_FILE" | tail -n 1)
DB_LANES=$(sed -n 's/^COCINACORE_SEPARATED_DB_LANES_ENABLED=//p' "$RUNTIME_ENV_FILE" | tail -n 1 | tr '[:upper:]' '[:lower:]' | tr -d '\r')

case "$DATABASE_URL" in
  postgresql://cocinacore_user:*@pawtech-postgres:5432/cocinacore_db*) ;;
  *) fail 'DATABASE_URL does not target the PawTech CocinaCore runtime database' ;;
esac
case "$REDIS_URL" in
  redis://*pawtech-redis:6379*) ;;
  *) fail 'REDIS_URL does not target PawTech Redis' ;;
esac

case "$DB_LANES" in
  ''|false|0|no|off) ;;
  *) fail 'separated database lanes are not supported by this runtime deploy contract' ;;
esac

case "$STORAGE_DRIVER" in
  local)
    [ -d "$UPLOAD_DIR" ] || fail 'local uploads directory does not exist'
    ;;
  s3)
    for key in S3_ENDPOINT S3_BUCKET S3_ACCESS_KEY_ID S3_SECRET_ACCESS_KEY; do
      required_env "$key"
    done
    ;;
  *)
    fail "unsupported STORAGE_DRIVER: $STORAGE_DRIVER"
    ;;
esac

if grep -q '^RESEND_API_KEY=.' "$RUNTIME_ENV_FILE" && grep -q '^EMAIL_FROM=.' "$RUNTIME_ENV_FILE"; then
  log 'Transactional email configuration is present'
else
  log 'WARNING: transactional email is not configured; password-reset email remains unavailable'
fi

for network in "$INTERNAL_NETWORK" "$PUBLIC_NETWORK"; do
  docker network inspect "$network" >/dev/null 2>&1 || fail "required Docker network missing: $network"
done
for container in "$POSTGRES_CONTAINER" "$REDIS_CONTAINER"; do
  health=$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}unhealthy{{end}}' "$container" 2>/dev/null || true)
  [ "$health" = 'healthy' ] || fail "required shared service is not healthy: $container"
done

git cat-file -e "${RELEASE_SHA}^{commit}" || fail 'release commit is not available in deploy repository'
case "$MODE" in
  prod-017-hotfix-preflight|prod-017-hotfix-deploy|prod-017-manual-preflight|prod-017-manual-deploy)
    validate_prod017_hotfix_candidate
    ;;
  *)
    git merge-base --is-ancestor "$RELEASE_SHA" origin/main || fail 'release commit is not integrated into origin/main'
    ;;
esac

if [ "$MODE" = 'preflight' ] || [ "$MODE" = 'prod-017-hotfix-preflight' ] || [ "$MODE" = 'prod-017-manual-preflight' ]; then
  [ -d "$MANUAL_BACKUP_ROOT" ] && [ -w "$MANUAL_BACKUP_ROOT" ] || fail 'deployment state root must already exist and be writable'
  verifier_mode=$(git ls-tree "$RELEASE_SHA" -- scripts/verify-pawtech-cocinacore-daily-backup.sh | awk '{print $1}')
  [ "$verifier_mode" = 100755 ] || fail 'release daily backup verifier must have Git mode 100755'
  git cat-file -e "$RELEASE_SHA:scripts/verify-pawtech-cocinacore-daily-backup.sh" || fail 'read-only daily backup verifier is missing from release'
  check_previous_app_for_release || fail 'preflight requires the exact healthy production-017 baseline application on exactly the Pawtech networks'
  log "PREFLIGHT_OK release=${RELEASE_SHA} storage=${STORAGE_DRIVER}" "attempt=${ATTEMPT_ID}"
  exit 0
fi

trap cleanup EXIT INT TERM

if [ "$MODE" != 'prod-017-manual-preflight' ] && [ "$MODE" != 'prod-017-manual-deploy' ]; then
  exec 9>/tmp/cocinacore-production-deploy.lock
  flock -n 9 || fail 'another CocinaCore production deployment is already running'
fi

short_sha=$(printf '%s' "$RELEASE_SHA" | cut -c1-8)
IMAGE="cocinacore:deploy-${RELEASE_SHA}"
NEW_IMAGE=$IMAGE
CANDIDATE="cocinacore-candidate-${short_sha}-$$"
timestamp=$(date -u +%Y%m%dT%H%M%SZ)
PREVIOUS="${APP_CONTAINER}-pre-${short_sha}-${timestamp}"
DEPLOYMENT_ATTEMPT=$ATTEMPT_ID

RELEASE_DIR=$(mktemp -d "${TMPDIR:-/tmp}/cocinacore-release.XXXXXXXX")
RELEASE_TAR=$(mktemp "${TMPDIR:-/tmp}/cocinacore-release.XXXXXXXX.tar")
git archive --format=tar "$RELEASE_SHA" > "$RELEASE_TAR"
tar -xf "$RELEASE_TAR" -C "$RELEASE_DIR"
[ -f "$RELEASE_DIR/Dockerfile" ] || fail 'release Dockerfile is missing'

log "BUILD release=${RELEASE_SHA}"
docker build -f "$RELEASE_DIR/Dockerfile" -t "$IMAGE" "$RELEASE_DIR"

log 'DAILY_BACKUP_VERIFY starting'
BACKUP_VERIFICATION=$(
  if ! "$RELEASE_DIR/scripts/verify-pawtech-cocinacore-daily-backup.sh"; then
    fail 'scheduled daily backup verification failed'
  fi
)
[ "$BACKUP_VERIFICATION" = DAILY_BACKUP_VERIFIED ] || fail 'scheduled daily backup verification returned invalid evidence'
log 'DAILY_BACKUP_VERIFIED source=scheduled-object-storage'
backup_dir=$MANUAL_BACKUP_ROOT
deploy_uid=$(id -u)

log 'VERIFY migration state read-only'
docker run --rm \
  --network "$INTERNAL_NETWORK" \
  --env-file "$RUNTIME_ENV_FILE" \
  -e "APP_VERSION=deploy-${RELEASE_SHA}" \
  "$IMAGE" npm run db:migrate:verify
log 'MIGRATION_EXPECTATION=NO_OP'
log 'DATABASE_CHANGED=NO'

log 'CANDIDATE starting'
CANDIDATE_STARTED=1
docker run -d \
  --name "$CANDIDATE" \
  --label "com.cocinacore.deploy-attempt=$DEPLOYMENT_ATTEMPT" \
  --network "$INTERNAL_NETWORK" \
  --env-file "$RUNTIME_ENV_FILE" \
  -e "APP_VERSION=deploy-${RELEASE_SHA}" \
  -v "$UPLOAD_DIR:/app/uploads" \
  "$IMAGE" >/dev/null

candidate_ok=0
attempt=0
while [ "$attempt" -lt 30 ]; do
  if docker exec "$CANDIDATE" node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>{if(!r.ok)process.exit(1);return r.json()}).then(x=>{if(x.status!=='ok'||x.dependencies?.database?.status!=='ok'||x.dependencies?.redis?.status!=='ok')process.exit(1)}).catch(()=>process.exit(1))" >/dev/null 2>&1; then
    candidate_ok=1
    break
  fi
  attempt=$((attempt + 1))
  sleep 1
done
[ "$candidate_ok" -eq 1 ] || fail 'candidate application health check failed'
docker rm -f "$CANDIDATE" >/dev/null || fail 'candidate container cleanup failed'
container_absent "$CANDIDATE" || fail 'candidate container removal could not be confirmed'
CANDIDATE_STARTED=0
CANDIDATE=
log 'CANDIDATE health=ok'

TRAEFIK_HOST=$(printf '%s' "$PRODUCTION_URL" | sed -E 's#^https?://##; s#/.*$##')
[ -n "$TRAEFIK_HOST" ] || fail 'unable to derive Traefik host from production URL'
TRAEFIK_RULE=$(printf 'Host(`%s`)' "$TRAEFIK_HOST")

[ -n "$PREVIOUS" ] || fail 'previous application rollback container name is unavailable'
check_previous_app_for_release || fail 'previous application rollback target is not the exact healthy production-017 baseline on exact Pawtech networks'
[ -n "$PREVIOUS_ID" ] && [ -n "$PREVIOUS_IMAGE" ] || fail 'previous application rollback identity is incomplete'
if [ "$MODE" = 'prod-017-manual-deploy' ]; then
  revalidate_manual_authorization_before_cutover
fi
DEPLOY_STATE_FILE="$backup_dir/deploy-state-${ATTEMPT_ID}.state"
[ ! -e "$DEPLOY_STATE_FILE" ] || fail 'deployment attempt state record already exists'
DEPLOY_STATE_ATTEMPT=$ATTEMPT_ID
if ! (
  umask 077
  set -C
  {
    printf 'RELEASE_SHA=%s\n' "$RELEASE_SHA"
    printf 'IMAGE=%s\n' "$NEW_IMAGE"
    printf 'PREVIOUS_CONTAINER=%s\n' "$PREVIOUS"
    printf 'PREVIOUS_ID=%s\n' "$PREVIOUS_ID"
    printf 'PREVIOUS_IMAGE=%s\n' "$PREVIOUS_IMAGE"
    printf 'BACKUP_VERIFICATION=%s\n' "$BACKUP_VERIFICATION"
    printf 'DATABASE_CHANGED=%s\n' "$DATABASE_CHANGED"
    printf 'DEPLOY_STATE_ATTEMPT=%s\n' "$DEPLOY_STATE_ATTEMPT"
    if [ "$MODE" = 'prod-017-manual-deploy' ]; then
      printf 'MANUAL_AUTH_COMMENT_ID=%s\n' "$MANUAL_AUTH_COMMENT_ID"
      printf 'MANUAL_AUTHORIZER=%s\n' "$MANUAL_AUTHORIZER"
      printf 'MANUAL_AUTHORIZATION_EXPIRES_AT=%s\n' "$MANUAL_AUTH_EXPIRES_AT"
      printf 'MANUAL_AUTHORIZATION_FINGERPRINT=%s\n' "$MANUAL_AUTH_FINGERPRINT"
      printf 'MANUAL_AUTH_STATUS=CONSUMED\n'
    fi
  } >"$DEPLOY_STATE_FILE"
); then
  fail 'unable to create private deployment state record'
fi
chmod 600 "$DEPLOY_STATE_FILE" || fail 'unable to secure deployment state record'
state_mode=$(stat -c '%a' "$DEPLOY_STATE_FILE")
state_owner=$(stat -c '%u' "$DEPLOY_STATE_FILE")
[ "$state_mode" = 600 ] && [ "$state_owner" = "$deploy_uid" ] || fail 'deployment state record permissions or owner mismatch'
log "CUTOVER_EVIDENCE release=${RELEASE_SHA} new_image=${NEW_IMAGE} previous_container=${PREVIOUS:-none} previous_image=${PREVIOUS_IMAGE:-unknown} previous_id=${PREVIOUS_ID:-none} backup_verification=${BACKUP_VERIFICATION} DATABASE_CHANGED=${DATABASE_CHANGED} deployment_attempt=${DEPLOYMENT_ATTEMPT}"

if [ -n "$PREVIOUS" ]; then
  PREVIOUS_RENAME_ATTEMPTED=1
  docker rename "$APP_CONTAINER" "$PREVIOUS"
  PREVIOUS_RENAMED=1
  docker stop "$PREVIOUS" >/dev/null
fi

log "CUTOVER new_image=${IMAGE}"
NEW_APP_RUN_ATTEMPTED=1
docker run -d \
  --name "$APP_CONTAINER" \
  --restart unless-stopped \
  --network "$INTERNAL_NETWORK" \
  --env-file "$RUNTIME_ENV_FILE" \
  -e "APP_VERSION=deploy-${RELEASE_SHA}" \
  -v "$UPLOAD_DIR:/app/uploads" \
  --log-driver json-file \
  --log-opt max-size=10m \
  --log-opt max-file=5 \
  --label "com.cocinacore.deploy-attempt=$DEPLOYMENT_ATTEMPT" \
  --label traefik.enable=true \
  --label traefik.docker.network="$PUBLIC_NETWORK" \
  --label traefik.http.routers.cocinacore.entrypoints=websecure \
  --label "traefik.http.routers.cocinacore.rule=$TRAEFIK_RULE" \
  --label traefik.http.routers.cocinacore.tls=true \
  --label traefik.http.routers.cocinacore.tls.certresolver=letsencrypt \
  --label traefik.http.services.cocinacore.loadbalancer.server.port=3000 \
  "$IMAGE" >/dev/null
docker network connect "$PUBLIC_NETWORK" "$APP_CONTAINER"

app_ok=0
attempt=0
while [ "$attempt" -lt 30 ]; do
  if docker exec "$APP_CONTAINER" node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>{if(!r.ok)process.exit(1);return r.json()}).then(x=>{if(x.status!=='ok'||x.dependencies?.database?.status!=='ok'||x.dependencies?.redis?.status!=='ok')process.exit(1)}).catch(()=>process.exit(1))" >/dev/null 2>&1; then
    app_ok=1
    break
  fi
  attempt=$((attempt + 1))
  sleep 1
done
[ "$app_ok" -eq 1 ] || fail 'new production container health check failed'

public_ok=0
attempt=0
while [ "$attempt" -lt 30 ]; do
  if public_health_ok; then
    public_ok=1
    break
  fi
  attempt=$((attempt + 1))
  sleep 1
done
[ "$public_ok" -eq 1 ] || fail 'public production smoke check failed'

DEPLOY_SUCCEEDED=1
log "REMOTE_DEPLOY_READY release=${RELEASE_SHA} image=${IMAGE} DATABASE_CHANGED=${DATABASE_CHANGED} deployment_attempt=${DEPLOYMENT_ATTEMPT}"
if [ -n "$PREVIOUS" ]; then
  log "ROLLBACK_CONTAINER retained=${PREVIOUS}"
fi
