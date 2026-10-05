#!/usr/bin/env bash
set -euo pipefail
set +x

readonly EXPECTED_BRANCH='fix/pawtech-production-deploy'
readonly EXPECTED_COMMIT='a1e008c392c76b6d586a1b1e9cf10ef0df56b7f0'
readonly OWNER_LABEL='com.cocinacore.m1.rehearsal.id'
readonly PG_IMAGE='pgvector/pgvector:pg16'
readonly REDIS_IMAGE='redis:7-alpine'
readonly ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
readonly BAD_DB_HEALTH_TIMEOUT_MS=60000
readonly ROLLBACK_HEALTH_TIMEOUT_MS=60000

fail() { printf '%s\n' "rehearsal: FAIL ($1)" >&2; exit 1; }
status() { printf 'rehearsal: %s\n' "$1"; }

[[ $# -eq 2 && ( $1 == --run-local-only || $1 == --cleanup-local-only ) ]] || fail 'usage requires exactly one local-only mode and a run ID'
mode=$1
run_id=$2
[[ $run_id == cocinacore-m1-rehearsal-* && $run_id =~ ^[a-zA-Z0-9][a-zA-Z0-9._-]{0,96}$ ]] || fail 'invalid run ID'
[[ $run_id != *..* && $run_id != *--* ]] || fail 'invalid run ID'
readonly RUN_ID=$run_id
readonly CANDIDATE_TAG="cocinacore:rehearsal-candidate-${RUN_ID}"
readonly BUILDER_TAG="cocinacore:rehearsal-builder-${RUN_ID}"
readonly PREVIOUS_TAG="cocinacore:rehearsal-previous-${RUN_ID}"
readonly OWNER_FILTER="label=${OWNER_LABEL}=${RUN_ID}"
readonly TEMP_PARENT=/tmp
readonly TEMP_DIR="${TEMP_PARENT%/}/${RUN_ID}-work"
readonly DUMP_FILE="$TEMP_DIR/source.dump"
readonly CHECKSUM_FILE="$TEMP_DIR/source.dump.sha256"
readonly CONTAINER_DUMP_NAME="${RUN_ID}-source.dump"
readonly CONTAINER_CHECKSUM_NAME="${RUN_ID}-source.dump.sha256"
readonly BAD_DUMP="$TEMP_DIR/corrupt.dump"
readonly ENV_FILE="$TEMP_DIR/rehearsal.env"
readonly POSTGRES_ENV_FILE="$TEMP_DIR/postgres.env"
readonly RESTORE_ENV_FILE="$TEMP_DIR/restore.env"
readonly UPLOADS_DIR="$TEMP_DIR/uploads"
readonly TEST_NETWORK="${RUN_ID}-test"
readonly ISOLATED_NETWORK="${RUN_ID}-isolated"
readonly PG_NAME="${RUN_ID}-postgres"
readonly REDIS_NAME="${RUN_ID}-redis"
readonly REDIS_VOLUME="${RUN_ID}-redisdata"
readonly CANDIDATE_NAME="${RUN_ID}-candidate"
readonly PREVIOUS_NAME="${RUN_ID}-previous"
readonly PG_VOLUME="${RUN_ID}-pgdata"

if [[ $mode == --run-local-only ]]; then
  [[ ! -e $TEMP_DIR && ! -L $TEMP_DIR ]] || fail 'run temporary directory already exists'
  [[ $(git -C "$ROOT" branch --show-current 2>/dev/null) == "$EXPECTED_BRANCH" ]] || fail 'branch guard failed'
  [[ $(git -C "$ROOT" rev-parse HEAD 2>/dev/null) == "$EXPECTED_COMMIT" ]] || fail 'HEAD guard failed'
  [[ $(git -C "$ROOT" rev-parse refs/remotes/origin/main 2>/dev/null) == "$EXPECTED_COMMIT" ]] || fail 'origin/main guard failed'
fi

# Endpoint values are never emitted. Any Docker mutation passes through this gate.
docker_context_is_local() {
  local context endpoint
  context=$(docker context show 2>/dev/null) || return 1
  endpoint=$(docker context inspect "$context" --format '{{.Endpoints.docker.Host}}' 2>/dev/null) || return 1
  [[ $endpoint == unix://* ]] || return 1
  if [[ ${DOCKER_HOST+x} ]]; then
    [[ $DOCKER_HOST == unix://* && $DOCKER_HOST == "$endpoint" ]] || return 1
  fi
}
assert_local_docker() {
  docker_context_is_local || fail 'remote or unknown Docker context/DOCKER_HOST rejected'
}
docker_mutate() {
  assert_local_docker
  docker "$@" 2>/dev/null
}
docker_mutate_capture() {
  local output_file=$1
  shift
  assert_local_docker
  docker "$@" >"$output_file" 2>&1
}
docker_mutate_capture_stderr() {
  local stderr_file=$1
  shift
  assert_local_docker
  docker "$@" 2>"$stderr_file"
}
report_build_diagnostics() {
  local log_file=$1
  grep -Ei '(^|[[:space:]])(ERROR([[:space:]:]|$)|failed to solve|npm (ERR!|error) code)' "$log_file" 2>/dev/null \
    | grep -Eiv '\.env' \
    | sed -E 's#([[:alnum:]+.-]+://)[^/@[:space:]]+@#\1[REDACTED]@#g' \
    | awk '
      {
        line=$0
        lower=tolower(line)
        sensitive="(token|password|passwd|secret|authorization|api[-_ ]?key|access[-_ ]?key|client[-_ ]?secret|credential|bearer|auth|private[-_ ]?key|env[-_ ]?file)([[:alnum:]_-]*)[\"'"'"']?[[:space:]]*[:=][[:space:]]*[\"'"'"']?"
        if (match(lower, sensitive)) line=substr(line,1,RSTART+RLENGTH-1) "[REDACTED]"
        assignment="[[:alnum:]_]+[[:space:]]*=[[:space:]]*"
        if (match(lower, assignment)) line=substr(line,1,RSTART+RLENGTH-1) "[REDACTED]"
        if (length(line)>400) line=substr(line,1,400) " [TRUNCATED]"
        if (NR <= 3) print "rehearsal: BUILD_DIAGNOSTIC " line
      }
    '
  return 0
}

# Inventory reports only resource identifier hashes and counts.
inventory() {
  local kind ids
  for kind in container network volume; do
    case $kind in
      container) ids=$(docker ps -aq 2>/dev/null) || fail 'container inventory failed' ;;
      network) ids=$(docker network ls -q 2>/dev/null) || fail 'network inventory failed' ;;
      volume) ids=$(docker volume ls -q 2>/dev/null) || fail 'volume inventory failed' ;;
    esac
    printf '%s\n' "$ids" | LC_ALL=C sort | shasum -a 256 | awk '{print $1}'
    printf '%s\n' "$ids" | awk 'NF {n++} END {print n+0}'
  done
}
cleanup_local_only() {
  local id ids cleanup_failed=0 remaining=0 temp_remaining=0
  local containers networks volumes images post_inventory
  assert_local_docker
  containers=$(docker ps -aq --filter "$OWNER_FILTER" 2>/dev/null) || fail 'cleanup-only container owner query failed'
  networks=$(docker network ls -q --filter "$OWNER_FILTER" 2>/dev/null) || fail 'cleanup-only network owner query failed'
  volumes=$(docker volume ls -q --filter "$OWNER_FILTER" 2>/dev/null) || fail 'cleanup-only volume owner query failed'
  images=$(docker image ls -q --filter "$OWNER_FILTER" 2>/dev/null) || fail 'cleanup-only image owner query failed'
  for id in $(docker ps -aq --filter "$OWNER_FILTER" 2>/dev/null); do docker_mutate rm -f "$id" >/dev/null || cleanup_failed=1; done
  for id in $(docker network ls -q --filter "$OWNER_FILTER" 2>/dev/null); do docker_mutate network rm "$id" >/dev/null || cleanup_failed=1; done
  for id in $(docker volume ls -q --filter "$OWNER_FILTER" 2>/dev/null); do docker_mutate volume rm "$id" >/dev/null || cleanup_failed=1; done
  for id in $(docker image ls -q --filter "$OWNER_FILTER" 2>/dev/null | LC_ALL=C sort -u); do docker_mutate image rm "$id" >/dev/null || cleanup_failed=1; done
  if [[ -e $TEMP_DIR || -L $TEMP_DIR ]]; then
    assert_local_docker
    if [[ $TEMP_DIR == "${TEMP_PARENT%/}/${RUN_ID}-work" && $RUN_ID == cocinacore-m1-rehearsal-* ]]; then
      rm -rf -- "$TEMP_DIR" || cleanup_failed=1
    else
      cleanup_failed=1
    fi
  fi
  containers=$(docker ps -aq --filter "$OWNER_FILTER" 2>/dev/null) || cleanup_failed=1
  networks=$(docker network ls -q --filter "$OWNER_FILTER" 2>/dev/null) || cleanup_failed=1
  volumes=$(docker volume ls -q --filter "$OWNER_FILTER" 2>/dev/null) || cleanup_failed=1
  images=$(docker image ls -q --filter "$OWNER_FILTER" 2>/dev/null) || cleanup_failed=1
  [[ -z $containers ]] || remaining=$((remaining + 1))
  [[ -z $networks ]] || remaining=$((remaining + 1))
  [[ -z $volumes ]] || remaining=$((remaining + 1))
  [[ -z $images ]] || remaining=$((remaining + 1))
  [[ ! -e $TEMP_DIR && ! -L $TEMP_DIR ]] || temp_remaining=1
  post_inventory=$(inventory 2>/dev/null) || cleanup_failed=1
  [[ -n $post_inventory ]] && printf 'rehearsal: FINAL_RESOURCE_COUNTS_HASHES %s\n' "$(printf '%s' "$post_inventory" | tr '\n' ' ')"
  if (( cleanup_failed || remaining || temp_remaining )); then
    printf 'rehearsal: CLEANUP_ONLY_FAILED mutation_or_query=%s owner_resource_kinds_remaining=%s temp_remaining=%s\n' "$cleanup_failed" "$remaining" "$temp_remaining" >&2
    return 1
  fi
  status 'CLEANUP_ONLY_VERIFIED'
}
if [[ $mode == --cleanup-local-only ]]; then
  cleanup_local_only || fail 'cleanup-only verification failed'
  exit 0
fi
# Inventory is deliberately captured before any regular rehearsal mutation.
assert_local_docker
PRE_INVENTORY=$(inventory)
printf 'rehearsal: PRE_RESOURCE_COUNTS_HASHES %s\n' "$(printf '%s' "$PRE_INVENTORY" | tr '\n' ' ')"
# Reject any pre-existing collision across resource names, image tags, and owner labels.
all_resources=$(docker ps -a --no-trunc --format '{{.ID}} {{.Names}} {{.Labels}}' 2>/dev/null) || fail 'container collision inventory failed'
all_resources+=$'\n'"$(docker network ls --no-trunc --format '{{.ID}} {{.Name}} {{.Labels}}' 2>/dev/null)" || fail 'network collision inventory failed'
all_resources+=$'\n'"$(docker volume ls --format '{{.Name}} {{.Labels}}' 2>/dev/null)" || fail 'volume collision inventory failed'
all_resources+=$'\n'"$(docker image ls --no-trunc --format '{{.Repository}}:{{.Tag}}' 2>/dev/null)" || fail 'image tag inventory failed'
owned_image_ids=$(docker image ls -q --filter "$OWNER_FILTER" 2>/dev/null) || fail 'image label inventory failed'
if printf '%s' "$all_resources" | grep -Fq "$RUN_ID" || printf '%s' "$all_resources" | grep -Fq "$CANDIDATE_TAG" || printf '%s' "$all_resources" | grep -Fq "$BUILDER_TAG" || printf '%s' "$all_resources" | grep -Fq "$PREVIOUS_TAG" || [[ -n $owned_image_ids ]]; then
  fail 'run resource collision detected'
fi
unset all_resources owned_image_ids
if docker image inspect "$CANDIDATE_TAG" >/dev/null 2>&1 || docker image inspect "$BUILDER_TAG" >/dev/null 2>&1 || docker image inspect "$PREVIOUS_TAG" >/dev/null 2>&1; then
  fail 'candidate or previous image tag collision detected'
fi

made_temp=0
cleanup_done=0
cleanup() {
  local rc=$? id cleanup_rc=0 cleanup_mutation_failures=0 cleanup_owner_remaining_kinds=0 cleanup_temp_remaining=0 cleanup_inventory_mismatch=0 cleanup_query_failures=''
  local containers networks volumes images post_containers post_networks post_volumes post_images post_inventory
  (( cleanup_done )) && return "$rc"
  cleanup_done=1
  set +e
  # Exact owner-label filters are the sole source of deletion identifiers.
  docker_context_is_local || { status 'CLEANUP_FAILED_LOCAL_DOCKER_GUARD'; trap - EXIT INT TERM; exit 1; }
  if containers=$(docker ps -aq --filter "$OWNER_FILTER" 2>/dev/null); then :; else cleanup_rc=1; cleanup_query_failures+=" containers"; fi
  if networks=$(docker network ls -q --filter "$OWNER_FILTER" 2>/dev/null); then :; else cleanup_rc=1; cleanup_query_failures+=" networks"; fi
  if volumes=$(docker volume ls -q --filter "$OWNER_FILTER" 2>/dev/null); then :; else cleanup_rc=1; cleanup_query_failures+=" volumes"; fi
  if images=$(docker image ls -q --filter "$OWNER_FILTER" 2>/dev/null); then :; else cleanup_rc=1; cleanup_query_failures+=" images"; fi
  # A failed inventory is incomplete; do not delete from any partial query result.
  if (( cleanup_rc == 0 )); then
    while IFS= read -r id; do [[ -n $id ]] || continue; docker_mutate rm -f "$id" >/dev/null 2>&1 || { cleanup_rc=1; cleanup_mutation_failures=$((cleanup_mutation_failures + 1)); }; done <<< "$containers"
    while IFS= read -r id; do [[ -n $id ]] || continue; docker_mutate network rm "$id" >/dev/null 2>&1 || { cleanup_rc=1; cleanup_mutation_failures=$((cleanup_mutation_failures + 1)); }; done <<< "$networks"
    while IFS= read -r id; do [[ -n $id ]] || continue; docker_mutate volume rm "$id" >/dev/null 2>&1 || { cleanup_rc=1; cleanup_mutation_failures=$((cleanup_mutation_failures + 1)); }; done <<< "$volumes"
    while IFS= read -r id; do [[ -n $id ]] || continue; docker_mutate image rm "$id" >/dev/null 2>&1 || { cleanup_rc=1; cleanup_mutation_failures=$((cleanup_mutation_failures + 1)); }; done < <(printf '%s\n' "$images" | LC_ALL=C sort -u)
  fi
  if (( made_temp )); then
    case "$TEMP_DIR" in
      "${TEMP_PARENT%/}/${RUN_ID}-"*) [[ $TEMP_DIR == "${TEMP_PARENT%/}/${RUN_ID}-work" && $RUN_ID == cocinacore-m1-rehearsal-* ]] && rm -rf -- "$TEMP_DIR" || cleanup_rc=1 ;;
      *) cleanup_rc=1 ;;
    esac
  fi
  if post_containers=$(docker ps -aq --filter "$OWNER_FILTER" 2>/dev/null); then
    [[ -z $post_containers ]] || { cleanup_rc=1; cleanup_owner_remaining_kinds=$((cleanup_owner_remaining_kinds + 1)); }
  else cleanup_rc=1; cleanup_query_failures+=" post_containers"; fi
  if post_networks=$(docker network ls -q --filter "$OWNER_FILTER" 2>/dev/null); then
    [[ -z $post_networks ]] || { cleanup_rc=1; cleanup_owner_remaining_kinds=$((cleanup_owner_remaining_kinds + 1)); }
  else cleanup_rc=1; cleanup_query_failures+=" post_networks"; fi
  if post_volumes=$(docker volume ls -q --filter "$OWNER_FILTER" 2>/dev/null); then
    [[ -z $post_volumes ]] || { cleanup_rc=1; cleanup_owner_remaining_kinds=$((cleanup_owner_remaining_kinds + 1)); }
  else cleanup_rc=1; cleanup_query_failures+=" post_volumes"; fi
  if post_images=$(docker image ls -q --filter "$OWNER_FILTER" 2>/dev/null); then
    [[ -z $post_images ]] || { cleanup_rc=1; cleanup_owner_remaining_kinds=$((cleanup_owner_remaining_kinds + 1)); }
  else cleanup_rc=1; cleanup_query_failures+=" post_images"; fi
  [[ ! -e $TEMP_DIR && ! -L $TEMP_DIR ]] || { cleanup_rc=1; cleanup_temp_remaining=1; }
  post_inventory=$(inventory 2>/dev/null) || { cleanup_rc=1; cleanup_query_failures+=" post_inventory"; }
  [[ $post_inventory == "$PRE_INVENTORY" ]] || { cleanup_rc=1; cleanup_inventory_mismatch=1; }
  if (( cleanup_rc != 0 )); then
    printf 'rehearsal: CLEANUP_FAILURE_DETAILS mutation_failures=%s query_failures=%s owner_resource_kinds_remaining=%s temp_remaining=%s inventory_mismatch=%s\n' "$cleanup_mutation_failures" "${cleanup_query_failures# }" "$cleanup_owner_remaining_kinds" "$cleanup_temp_remaining" "$cleanup_inventory_mismatch" >&2
    status 'CLEANUP_FAILED'
    trap - EXIT INT TERM
    exit 1
  fi
  printf 'rehearsal: ZERO_REHEARSAL_GARBAGE=YES\n'
  printf 'rehearsal: POST_INVENTORY_MATCH=YES\n'
  status 'CLEANUP_VERIFIED'
  printf 'rehearsal: POST_RESOURCE_COUNTS_HASHES %s\n' "$(printf '%s' "$post_inventory" | tr '\n' ' ')"
  return "$rc"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

# The temp tree contains only synthetic credentials and artifacts; never print its contents.
mkdir -m 0700 -- "$TEMP_DIR" || fail 'cannot create private run directory'
made_temp=1
chmod 0700 "$TEMP_DIR"
mkdir -m 0700 -- "$UPLOADS_DIR"
secret() { od -An -N32 -tx1 /dev/urandom | tr -d ' \n'; }
pg_password=$(secret); db_user_password=$(secret); auth_secret=$(secret); gemini_key=$(secret); s3_access=$(secret); s3_secret=$(secret)
{
  printf 'AUTH_SECRET=%q\n' "$auth_secret"
  printf 'GEMINI_API_KEY=%q\n' "$gemini_key"
  printf 'S3_ENDPOINT=%q\n' 'http://127.0.0.1.invalid'
  printf 'S3_BUCKET=%q\n' "${RUN_ID}-synthetic"
  printf 'S3_ACCESS_KEY_ID=%q\n' "$s3_access"
  printf 'S3_SECRET_ACCESS_KEY=%q\n' "$s3_secret"
  printf 'APP_PUBLIC_URL=%q\n' 'http://127.0.0.1.invalid'
  printf 'SESSION_DAYS=30\n'
  printf 'DATABASE_URL=%q\n' "postgresql://cocinacore_user:${db_user_password}@${PG_NAME}:5432/cocinacore_db"
  printf 'REDIS_URL=%q\n' "redis://${REDIS_NAME}:6379"
} > "$ENV_FILE"
chmod 0600 "$ENV_FILE"
printf 'POSTGRES_PASSWORD=%q\n' "$pg_password" > "$POSTGRES_ENV_FILE"
chmod 0600 "$POSTGRES_ENV_FILE"
sed "s|cocinacore_db$|cocinacore_db_restore|" "$ENV_FILE" > "$RESTORE_ENV_FILE"
chmod 0600 "$RESTORE_ENV_FILE"
# Credentials remain private to this process and the mode-0600 env files.

# Snapshot the current worktree without opening any .env* paths; never reject existing edits.
CANDIDATE_CONTEXT="$TEMP_DIR/candidate-source"
mkdir -m 0700 -- "$CANDIDATE_CONTEXT"
tar -cf - --exclude='.env*' --exclude='*/.env*' --exclude='**/.env*' --exclude='node_modules' --exclude='**/node_modules' --exclude='npm-debug.log' --exclude='.next' --exclude='**/.next' --exclude='out' --exclude='coverage' --exclude='**/coverage' --exclude='*.tsbuildinfo' --exclude='playwright-report' --exclude='test-results' --exclude='*.log' --exclude='.DS_Store' --exclude='.git' --exclude='*/.git' --exclude='.github' --exclude='*.md' -C "$ROOT" . 2>/dev/null | tar -xf - -C "$CANDIDATE_CONTEXT" 2>/dev/null || fail 'candidate snapshot creation failed'
candidate_env_path=$(find "$CANDIDATE_CONTEXT" -name '.env*' -print -quit 2>/dev/null) || fail 'candidate filename scan failed'
[[ -z $candidate_env_path ]] || fail 'candidate snapshot contains an env-like filename'
unset candidate_env_path
candidate_snapshot_file_count=$(find "$CANDIDATE_CONTEXT" -type f -print 2>/dev/null | awk 'NF {n++} END {print n+0}') || fail 'candidate snapshot file inventory failed'
candidate_snapshot_path_digest=$(find "$CANDIDATE_CONTEXT" -type f -print 2>/dev/null | LC_ALL=C sort | shasum -a 256 | awk '{print $1}') || fail 'candidate snapshot filename digest failed'
# Builds have explicit ownership labels and are gated exactly like runtime mutations.
CANDIDATE_BUILD_LOG="$TEMP_DIR/candidate-build.log"
: > "$CANDIDATE_BUILD_LOG"
chmod 0600 "$CANDIDATE_BUILD_LOG"
if ! docker_mutate_capture "$CANDIDATE_BUILD_LOG" build --progress=plain --label "$OWNER_LABEL=$RUN_ID" -t "$CANDIDATE_TAG" "$CANDIDATE_CONTEXT"; then
  report_build_diagnostics "$CANDIDATE_BUILD_LOG"
  fail 'candidate image build failed'
fi
BUILDER_BUILD_LOG="$TEMP_DIR/builder-build.log"
: > "$BUILDER_BUILD_LOG"
chmod 0600 "$BUILDER_BUILD_LOG"
if ! docker_mutate_capture "$BUILDER_BUILD_LOG" build --progress=plain --target builder --label "$OWNER_LABEL=$RUN_ID" -t "$BUILDER_TAG" "$CANDIDATE_CONTEXT"; then
  fail 'candidate builder image build failed'
fi
candidate_id=$(docker image inspect --format '{{.Id}}' "$CANDIDATE_TAG" 2>/dev/null) || fail 'candidate image identity unavailable'
builder_id=$(docker image inspect --format '{{.Id}}' "$BUILDER_TAG" 2>/dev/null) || fail 'builder image identity unavailable'
readonly SECURITY_CANDIDATE_LOG="$TEMP_DIR/security-candidate.log"
readonly SECURITY_BUILDER_LOG="$TEMP_DIR/security-builder.log"
: > "$SECURITY_CANDIDATE_LOG"
: > "$SECURITY_BUILDER_LOG"
chmod 0600 "$SECURITY_CANDIDATE_LOG" "$SECURITY_BUILDER_LOG"
if ! docker_mutate_capture "$SECURITY_CANDIDATE_LOG" run --rm --read-only --network none --label "$OWNER_LABEL=$RUN_ID" --tmpfs /tmp:rw,noexec,nosuid,size=64m --entrypoint sh "$candidate_id" -lc '
  set -eu
  [ -f /app/server.js ] && [ -r /app/server.js ] && [ -d /app/.next/server ] && [ -r /app/.next/server ] || { printf "SECURITY_BUNDLE_SCAN=incomplete\\n"; exit 1; }
  if [ -d /app/node_modules/braces ]; then printf "SECURITY_BRACES_PRESENT=yes\\n"; else printf "SECURITY_BRACES_PRESENT=no\\n"; fi
  if npm ls --omit=dev braces --all --offline --cache=/tmp/npm-cache --logs-dir=/tmp/npm-logs > /tmp/npm-production-tree.log 2>&1; then npm_rc=0; else npm_rc=$?; fi
  if grep -Fq "(empty)" /tmp/npm-production-tree.log; then tree=empty
  elif [ "$npm_rc" -eq 0 ] && grep -Eq "(^|[[:space:]])braces@[^[:space:]]+" /tmp/npm-production-tree.log; then tree=nonempty
  else tree=unknown; fi
  printf "SECURITY_NPM_LS_EXIT=%s\\n" "$npm_rc"
  printf "SECURITY_NPM_PRODUCTION_BRACES=%s\\n" "$tree"
  : > /tmp/security-bundle-files
  printf "%s\\n" /app/server.js >> /tmp/security-bundle-files
  if ! find /app/.next/server -type f -name "*.js" -print >> /tmp/security-bundle-files 2>/tmp/security-find-errors; then printf "SECURITY_BUNDLE_SCAN=incomplete\\n"; exit 1; fi
  [ ! -s /tmp/security-find-errors ] || { printf "SECURITY_BUNDLE_SCAN=incomplete\\n"; exit 1; }
  [ -s /tmp/security-bundle-files ] || { printf "SECURITY_BUNDLE_SCAN=incomplete\\n"; exit 1; }
  bundle_file_count=$(wc -l < /tmp/security-bundle-files)
  [ "$bundle_file_count" -gt 1 ] || { printf "SECURITY_BUNDLE_SCAN=incomplete\\n"; exit 1; }
  for group in braces micromatch fast-glob @next/eslint-plugin-next eslint-config-next; do
    key=$(printf "%s" "$group" | tr "@/-" "___" | tr "[:lower:]" "[:upper:]")
    count=0; printed=0
    while IFS= read -r file; do
      if grep -Fq -- "$group" "$file" 2>/dev/null; then
        count=$((count + 1))
        if [ "$printed" -lt 10 ]; then printf "SECURITY_BUNDLE_%s_FILE=%s\\n" "$key" "$file"; printed=$((printed + 1)); fi
      else
        grep_rc=$?
        [ "$grep_rc" -eq 1 ] || { printf "SECURITY_BUNDLE_SCAN=incomplete\\n"; exit 1; }
      fi
    done < /tmp/security-bundle-files
    printf "SECURITY_BUNDLE_%s_COUNT=%s\\n" "$key" "$count"
  done
' ; then
  fail 'candidate image security inspection failed'
fi
if ! docker_mutate_capture "$SECURITY_BUILDER_LOG" run --rm --read-only --network none --label "$OWNER_LABEL=$RUN_ID" --tmpfs /tmp:rw,noexec,nosuid,size=64m --entrypoint sh "$builder_id" -lc '
  set -eu
  standalone=/app/.next/standalone
  standalone_nm=/app/.next/standalone/node_modules
  if [ ! -d "$standalone" ] || [ ! -r "$standalone" ] || [ ! -d "$standalone_nm" ] || [ ! -r "$standalone_nm" ]; then printf "SECURITY_STANDALONE_TRACED_NODE_MODULES=no\\n"; exit 1; fi
  printf "SECURITY_STANDALONE_TRACED_NODE_MODULES=yes\\n"
  for package in braces micromatch fast-glob @next/eslint-plugin-next eslint-config-next; do
    key=$(printf "%s" "$package" | tr "@/-" "___" | tr "[:lower:]" "[:upper:]")
    paths="/tmp/security-graph-${key}.paths"
    if ! find "$standalone_nm" -type d -path "*/node_modules/$package" -print > "$paths" 2>/tmp/security-graph-errors; then printf "SECURITY_BUILDER_GRAPH_SCAN=incomplete\\n"; exit 1; fi
    [ ! -s /tmp/security-graph-errors ] || { printf "SECURITY_BUILDER_GRAPH_SCAN=incomplete\\n"; exit 1; }
    count=$(awk "END {print NR+0}" "$paths")
    if [ "$count" -gt 0 ]; then result=yes; else result=no; fi
    printf "SECURITY_BUILDER_GRAPH_%s_TRACED=%s\\n" "$key" "$result"
    printf "SECURITY_BUILDER_GRAPH_%s_COUNT=%s\\n" "$key" "$count"
    printed_paths=0
    while IFS= read -r package_path; do
      [ "$printed_paths" -lt 10 ] || break
      printf "SECURITY_BUILDER_GRAPH_%s_PATH=%s\\n" "$key" "$package_path"
      printed_paths=$((printed_paths + 1))
    done < "$paths"
  done
' ; then
  fail 'builder dependency graph inspection failed'
fi
# Only bounded filenames and generated status keys leave private inspection logs.
grep -E '^SECURITY_(BRACES_PRESENT|NPM_LS_EXIT=|NPM_PRODUCTION_BRACES|BUNDLE_[A-Z_]+_(COUNT|FILE)=|BUNDLE_SCAN=)' "$SECURITY_CANDIDATE_LOG"
grep -E '^SECURITY_(STANDALONE_TRACED_NODE_MODULES|BUILDER_GRAPH_[A-Z_]+_(TRACED|COUNT|PATH)=|BUILDER_GRAPH_SCAN=)' "$SECURITY_BUILDER_LOG"
# Source inspection emits paths only and excludes tests/specs and __tests__ trees.
SOURCE_FILE_LIST="$TEMP_DIR/security-source-files"
if ! find "$ROOT/frontend/src" -type d -name __tests__ -prune -o -type f ! -name '*.test.*' ! -name '*.spec.*' -print > "$SOURCE_FILE_LIST"; then fail 'production source file inventory failed'; fi
for package in braces micromatch fast-glob @next/eslint-plugin-next eslint-config-next; do
  package_files=$(grep -RIlE --exclude-dir=__tests__ --exclude='*.test.*' --exclude='*.spec.*' "(^|[[:space:]])(import|export)[^;]*from[[:space:]]*[\"'\'']${package}([/\"'\'']|$)|require[[:space:]]*\\([[:space:]]*[\"'\'']${package}([/\"'\'']|$)|import[[:space:]]*\\([[:space:]]*[\"'\'']${package}([/\"'\'']|$)" "$ROOT/frontend/src" 2>/dev/null || true)
  package_count=$(printf '%s\n' "$package_files" | awk 'NF {n++} END {print n+0}')
  package_key=$(printf '%s' "$package" | tr '@/-' '___' | tr '[:lower:]' '[:upper:]')
  printf 'SECURITY_SOURCE_%s_COUNT=%s\n' "$package_key" "$package_count"
  printf '%s\n' "$package_files" | awk 'NF && n++ < 10 {print "SECURITY_SOURCE_'"$package_key"'_PATH=" $0}'
done
archive="$TEMP_DIR/head.tar"
git -C "$ROOT" archive --format=tar HEAD -- . ':(exclude).env*' ':(exclude)**/.env*' > "$archive" 2>/dev/null || fail 'HEAD archive failed'
mkdir -m 0700 -- "$TEMP_DIR/previous-source"
tar -xf "$archive" -C "$TEMP_DIR/previous-source" 2>/dev/null || fail 'previous baseline extraction failed'
PREVIOUS_BUILD_LOG="$TEMP_DIR/previous-build.log"
: > "$PREVIOUS_BUILD_LOG"
chmod 0600 "$PREVIOUS_BUILD_LOG"
if ! docker_mutate_capture "$PREVIOUS_BUILD_LOG" build --progress=plain --label "$OWNER_LABEL=$RUN_ID" -t "$PREVIOUS_TAG" "$TEMP_DIR/previous-source"; then
  report_build_diagnostics "$PREVIOUS_BUILD_LOG"
  fail 'previous HEAD baseline image build failed'
fi
rm -f -- "$archive"
candidate_id=$(docker image inspect --format '{{.Id}}' "$CANDIDATE_TAG" 2>/dev/null) || fail 'candidate image identity unavailable'
previous_image_id=$(docker image inspect --format '{{.Id}}' "$PREVIOUS_TAG" 2>/dev/null) || fail 'previous image identity unavailable'
versions=$(docker_mutate run --rm --read-only --network none --label "$OWNER_LABEL=$RUN_ID" --entrypoint sh "$candidate_id" -lc 'node --version && npm --version' 2>/dev/null) || fail 'candidate runtime version probe failed'
candidate_node=${versions%%$'\n'*}
candidate_npm=${versions#*$'\n'}
[[ $candidate_node == v22.22.3 && -n $candidate_npm && $candidate_npm != "$versions" ]] || fail 'candidate runtime must use Node v22.22.3 and report npm version'
status 'CANDIDATE_SOURCE_CURRENT_DIRTY_WORKTREE_SNAPSHOT_EXCLUDING_ENV_FILES'
printf 'rehearsal: CANDIDATE_SNAPSHOT_FILES=%s PATHS_DIGEST=%s\n' "$candidate_snapshot_file_count" "$candidate_snapshot_path_digest"
status 'PREVIOUS_IS_FIXED_HEAD_ARCHIVE_BASELINE_NOT_LIVE_PRODUCTION'
printf 'rehearsal: IMAGE_IDS candidate=%s previous=%s\n' "$candidate_id" "$previous_image_id"
printf 'rehearsal: CANDIDATE_NODE_NPM node=%s npm=%s\n' "$candidate_node" "$candidate_npm"

# All created Docker resources use the exact run ID and owner label. No DB/Redis host ports.
docker_mutate network create --internal --label "$OWNER_LABEL=$RUN_ID" "$TEST_NETWORK" >/dev/null || fail 'test network creation failed'
docker_mutate network create --internal --label "$OWNER_LABEL=$RUN_ID" "$ISOLATED_NETWORK" >/dev/null || fail 'isolated network creation failed'
docker_mutate volume create --label "$OWNER_LABEL=$RUN_ID" "$PG_VOLUME" >/dev/null || fail 'database volume creation failed'
# Redis data uses an explicit owned volume; no anonymous or unlabelled volume is allowed.
docker_mutate volume create --label "$OWNER_LABEL=$RUN_ID" "$REDIS_VOLUME" >/dev/null || fail 'Redis volume creation failed'
docker_mutate run -d --name "$PG_NAME" --label "$OWNER_LABEL=$RUN_ID" --network "$ISOLATED_NETWORK" -v "$PG_VOLUME:/var/lib/postgresql/data" --env-file "$POSTGRES_ENV_FILE" -e POSTGRES_DB=postgres "$PG_IMAGE" >/dev/null || fail 'PostgreSQL start failed'
docker_mutate run -d --name "$REDIS_NAME" --label "$OWNER_LABEL=$RUN_ID" --network "$ISOLATED_NETWORK" -v "$REDIS_VOLUME:/data" "$REDIS_IMAGE" >/dev/null || fail 'Redis start failed'

pg_exec() { docker_mutate exec -e PGPASSWORD="$db_user_password" "$@"; }
pg_admin() { docker_mutate exec -i -e PGPASSWORD="$pg_password" "$@"; }
wait_ready() {
  local i
  for i in $(seq 1 60); do
    if pg_exec "$PG_NAME" pg_isready -U postgres -d postgres >/dev/null 2>&1 && docker_mutate exec "$REDIS_NAME" redis-cli ping 2>/dev/null | grep -qx PONG; then return 0; fi
    sleep 1
  done
  fail 'database/cache readiness timeout'
}
wait_ready
# Disposable DB setup uses local admin; application connections use the non-superuser role.
printf "CREATE ROLE cocinacore_user LOGIN PASSWORD '%s';\n" "$db_user_password" | pg_admin "$PG_NAME" psql -U postgres -d postgres -v ON_ERROR_STOP=1 >/dev/null || fail 'application role setup failed'
pg_admin "$PG_NAME" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -c 'CREATE DATABASE cocinacore_db OWNER cocinacore_user;' >/dev/null 2>&1 || fail 'source database creation failed'
pg_admin "$PG_NAME" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -c 'CREATE DATABASE cocinacore_db_restore OWNER cocinacore_user;' >/dev/null 2>&1 || fail 'restore database setup failed'
pg_admin "$PG_NAME" psql -U postgres -d cocinacore_db -v ON_ERROR_STOP=1 -c 'CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA public; CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;' >/dev/null 2>&1 || fail 'disposable source extension setup failed'
# Candidate migration runner applies only the checked-in 001-012 set to the source database.
docker_mutate run --rm --network "$ISOLATED_NETWORK" --label "$OWNER_LABEL=$RUN_ID" --env-file "$ENV_FILE" -e COCINACORE_SEPARATED_DB_LANES_ENABLED=false "$candidate_id" npm run db:migrate >/dev/null 2>&1 || fail 'candidate migrations 001-012 failed'

psql_app() { pg_exec "$PG_NAME" psql -U cocinacore_user -d "$1" -v ON_ERROR_STOP=1 -Atqc "$2"; }
# Read-only verification fingerprints use local admin to bypass schema_migrations RLS.
report_fingerprint_diagnostics() {
  local log_file=$1
  grep -Ei '(^|[[:space:]:])(ERROR|FATAL)(:|[[:space:]]|$)' "$log_file" 2>/dev/null \
    | sed -E 's#([[:alnum:]_.+-]+://)[^/@[:space:]]+@#\1[REDACTED]@#g' \
    | awk '
      {
        line=$0
        lower=tolower(line)
        sensitive="(password|passwd|secret|token|api[-_ ]?key|access[-_ ]?key|client[-_ ]?secret|credential|authorization|bearer)[[:alnum:]_-]*[\"'"'"']?[[:space:]]*[:=][[:space:]]*[\"'"'"']?"
        if (match(lower, sensitive)) line=substr(line,1,RSTART-1) "[REDACTED]"
        if (length(line)>240) line=substr(line,1,240) " [TRUNCATED]"
        if (NR <= 3) print "rehearsal: FINGERPRINT_DIAGNOSTIC " line
      }
      END {
        if (NR == 0) print "rehearsal: FINGERPRINT_DIAGNOSTIC stderr contained no recognized error details"
      }
    '
  return 0
}
fingerprint() {
  local db=$1
  local FINGERPRINT_LOG="$TEMP_DIR/fingerprint-${db}-stderr.log"
  local fingerprint_digest
  : > "$FINGERPRINT_LOG"
  chmod 0600 "$FINGERPRINT_LOG"
  if fingerprint_digest=$(docker_mutate_capture_stderr "$FINGERPRINT_LOG" exec -i -e PGPASSWORD="$pg_password" "$PG_NAME" psql -U postgres -d "$db" -X -qAt -v ON_ERROR_STOP=1 <<'SQL' | shasum -a 256 | awk '{print $1}'
SELECT 'SCHEMA:' || coalesce(string_agg(table_schema||'.'||table_name||'.'||column_name||':'||data_type||':'||is_nullable||':'||coalesce(column_default,''),chr(10) ORDER BY table_schema,table_name,ordinal_position),'') FROM information_schema.columns WHERE table_schema IN ('public','internal');
SELECT 'CONSTRAINTS:' || coalesce(string_agg(conrelid::regclass||':'||conname||':'||contype::text||':'||pg_get_constraintdef(oid),chr(10) ORDER BY conrelid::regclass::text,conname),'') FROM pg_constraint WHERE connamespace IN (SELECT oid FROM pg_catalog.pg_namespace WHERE nspname IN ('public','internal'));
SELECT 'INDEXES:' || coalesce(string_agg(indexrelid::regclass||':'||pg_get_indexdef(indexrelid),chr(10) ORDER BY indexrelid::regclass::text),'') FROM pg_index WHERE indrelid IN (SELECT c.oid FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','internal'));
SELECT 'EXTENSIONS:' || coalesce(string_agg(extname||':'||extversion,',' ORDER BY extname),'') FROM pg_extension;
SELECT 'LEDGER:' || coalesce(string_agg(to_jsonb(m)::text||':'||coalesce(to_jsonb(m)->>'checksum','')||':'||encode(public.digest(convert_to(to_jsonb(m)::text,'UTF8'),'sha256'),'hex'),chr(10) ORDER BY filename),'') FROM public.schema_migrations m;
SELECT CASE WHEN n.nspname='public' AND c.relname ~ '^[a-z_][a-z0-9_]*$' THEN format('SELECT concat_ws(chr(124), %L, encode(public.digest(convert_to(coalesce(string_agg(to_jsonb(t)::text, chr(10) ORDER BY to_jsonb(t)::text), %L), %L), %L), %L)) FROM %I.%I AS t', c.relname, '', 'UTF8', 'sha256', 'hex', n.nspname, c.relname) ELSE 'SELECT 1/0' END FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p') ORDER BY c.relname
\gexec
SQL
  ); then
    printf '%s\n' "$fingerprint_digest"
  else
    report_fingerprint_diagnostics "$FINGERPRINT_LOG" >&2
    return 1
  fi
}
readonly EXPECTED_LEDGER='001_extensions_and_core.sql,002_books_and_rag.sql,003_recipes_and_inventory.sql,004_meal_plans.sql,005_premium_and_shopping.sql,006_culinary_profiles.sql,007_functions.sql,008_indexes.sql,009_seed_culinary_base.sql,010_password_reset_tokens.sql,011_canonical_email_invariant.sql,012_meal_plan_consumption.sql'
ledger_filenames() { psql_app "$1" "SELECT string_agg(filename, ',' ORDER BY filename) FROM public.schema_migrations;"; }
verify_ledger() { [[ $(ledger_filenames "$1") == "$EXPECTED_LEDGER" ]]; }
pg_admin "$PG_NAME" psql -U postgres -d cocinacore_db -v ON_ERROR_STOP=1 -c 'ALTER TABLE public.schema_migrations OWNER TO cocinacore_user; GRANT SELECT ON public.schema_migrations TO cocinacore_user;' >/dev/null 2>&1 || fail 'source migration ledger ownership setup failed'
verify_ledger cocinacore_db || fail 'source migration ledger filenames differ from exact 001-012 set'
# Stable synthetic tenant, invalid-domain user, membership, inventory/movement, meal plan and shopping item.
psql_app cocinacore_db "DO \$\$ BEGIN IF to_regclass('public.tenants') IS NULL THEN RAISE EXCEPTION 'tenant schema missing'; END IF; END \$\$;" >/dev/null || fail 'fixture schema check failed'
# Insert fixtures using schema introspection-free canonical migration-era table contract.
psql_app cocinacore_db "INSERT INTO tenants (id,name) VALUES ('a1000000-0000-4000-8000-000000000001','Synthetic Rehearsal') ON CONFLICT (id) DO NOTHING;
INSERT INTO users (id,email,password_hash,tenant_id,role) VALUES ('a1000000-0000-4000-8000-000000000002','m1-rehearsal@example.invalid','synthetic-not-a-login','a1000000-0000-4000-8000-000000000001','owner') ON CONFLICT (id) DO NOTHING;
INSERT INTO tenant_memberships (tenant_id,user_id,role) VALUES ('a1000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000002','owner') ON CONFLICT (tenant_id,user_id) DO NOTHING;
INSERT INTO recipe_inventory_items (id,tenant_id,user_id,ingredient_name,quantity,unit) VALUES ('a1000000-0000-4000-8000-000000000003','a1000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000002','Synthetic rice','2','kg');
INSERT INTO inventory_movements (tenant_id,user_id,inventory_item_id,movement_type,quantity,unit,normalized_name) VALUES ('a1000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000002','a1000000-0000-4000-8000-000000000003','purchase',2,'kg','synthetic rice');
INSERT INTO user_meal_plans (id,tenant_id,user_id,period,mode,consumption_payload) VALUES ('a1000000-0000-4000-8000-000000000004','a1000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000002','week','inventory_to_menu','{\"synthetic\":true}');
INSERT INTO shopping_list_items (tenant_id,user_id,ingredient_name) VALUES ('a1000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000002','Synthetic beans');" >/dev/null || fail 'synthetic fixture setup failed'
# Verify required migration invariants, extension/catalog capabilities and relational integrity.
[[ $(psql_app cocinacore_db "SELECT count(*) FROM pg_extension WHERE extname IN ('vector','pgcrypto');") == 2 ]] || fail 'required extension catalog capability missing'
[[ $(psql_app cocinacore_db "SELECT count(*) FROM pg_type WHERE typname='vector' AND typnamespace='public'::regnamespace;") == 1 ]] || fail 'vector type capability missing'
[[ $(psql_app cocinacore_db "SELECT count(*) FROM pg_am WHERE amname='hnsw';") == 1 ]] || fail 'vector HNSW catalog capability missing'
[[ $(psql_app cocinacore_db "SELECT count(*) FROM pg_constraint WHERE conname='users_email_canonical_check' AND contype='c' AND pg_get_constraintdef(oid) LIKE '%lower%' AND pg_get_constraintdef(oid) LIKE '%btrim%' AND pg_get_constraintdef(oid) LIKE '%email%';") == 1 ]] || fail '011 canonical constraint missing or semantically incorrect'
[[ $(psql_app cocinacore_db "SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='user_meal_plans' AND column_name='consumption_payload' AND data_type='jsonb' AND is_nullable='NO' AND column_default = chr(39)||'{}'||chr(39)||'::jsonb';") == 1 ]] || fail '012 JSONB NOT NULL DEFAULT contract missing'
[[ $(psql_app cocinacore_db "SELECT count(*) FROM pg_constraint WHERE contype = 'f' AND NOT convalidated;") == 0 ]] || fail 'foreign-key integrity check failed'
[[ $(psql_app cocinacore_db "SELECT count(*) FROM tenant_memberships m JOIN users u ON u.id=m.user_id JOIN tenants t ON t.id=m.tenant_id JOIN recipe_inventory_items i ON i.tenant_id=t.id JOIN inventory_movements v ON v.inventory_item_id=i.id JOIN user_meal_plans p ON p.tenant_id=t.id JOIN shopping_list_items s ON s.tenant_id=t.id WHERE u.email='m1-rehearsal@example.invalid';") == 1 ]] || fail 'synthetic fixture joins/counts failed'
[[ $(pg_admin "$PG_NAME" psql -U postgres -d postgres -Atqc "SELECT count(*) FROM pg_roles WHERE rolname='cocinacore_user' AND NOT rolsuper AND NOT rolcreatedb AND NOT rolcreaterole;") == 1 ]] || fail 'application role is not a non-superuser'
source_fingerprint=$(fingerprint cocinacore_db) || fail 'source database fingerprint failed'

# Only the named source database is dumped. Files and containing directory remain private.
docker_mutate exec -e PGPASSWORD="$db_user_password" "$PG_NAME" pg_dump -U cocinacore_user -d cocinacore_db -Fc --no-owner --no-acl > "$DUMP_FILE" 2>/dev/null || fail 'custom dump failed'
chmod 0600 "$DUMP_FILE"
(cd "$TEMP_DIR" && shasum -a 256 source.dump > source.dump.sha256)
chmod 0600 "$CHECKSUM_FILE"
docker_mutate cp "$DUMP_FILE" "$PG_NAME:/tmp/$CONTAINER_DUMP_NAME" >/dev/null || fail 'dump transfer to disposable database container failed'
sed "s/source.dump/$CONTAINER_DUMP_NAME/" "$CHECKSUM_FILE" > "$TEMP_DIR/$CONTAINER_CHECKSUM_NAME"
chmod 0600 "$TEMP_DIR/$CONTAINER_CHECKSUM_NAME"
docker_mutate cp "$TEMP_DIR/$CONTAINER_CHECKSUM_NAME" "$PG_NAME:/tmp/$CONTAINER_CHECKSUM_NAME" >/dev/null || fail 'checksum transfer failed'
docker_mutate exec "$PG_NAME" sh -c "cd /tmp && sha256sum -c '$CONTAINER_CHECKSUM_NAME'" >/dev/null || fail 'dump checksum validation failed inside PostgreSQL container'
docker_mutate exec -i "$PG_NAME" pg_restore --list < "$DUMP_FILE" >/dev/null || fail 'valid archive listing failed'
# Checksummed malformed archive must fail listing; altered copy must fail checksum validation.
printf 'not-a-postgres-archive\n' > "$BAD_DUMP"
chmod 0600 "$BAD_DUMP"
(cd "$TEMP_DIR" && shasum -a 256 "$(basename "$BAD_DUMP")" > invalid.sha256)
sed "s/corrupt.dump/${RUN_ID}-corrupt.dump/" "$TEMP_DIR/invalid.sha256" > "$TEMP_DIR/${RUN_ID}-invalid.sha256"
chmod 0600 "$TEMP_DIR/${RUN_ID}-invalid.sha256"
docker_mutate cp "$BAD_DUMP" "$PG_NAME:/tmp/${RUN_ID}-corrupt.dump" >/dev/null || fail 'invalid archive transfer failed'
docker_mutate cp "$TEMP_DIR/${RUN_ID}-invalid.sha256" "$PG_NAME:/tmp/${RUN_ID}-invalid.sha256" >/dev/null || fail 'invalid checksum transfer failed'
INVALID_CHECKSUM_LOG="$TEMP_DIR/invalid-checksum.log"
: > "$INVALID_CHECKSUM_LOG"
chmod 0600 "$INVALID_CHECKSUM_LOG"
docker_mutate_capture "$INVALID_CHECKSUM_LOG" exec "$PG_NAME" sh -c "cd /tmp && sha256sum -c '${RUN_ID}-invalid.sha256'" || fail 'invalid archive checksum did not validate inside PostgreSQL container'
grep -Fq "${RUN_ID}-corrupt.dump: OK" "$INVALID_CHECKSUM_LOG" || fail 'checksummed invalid archive did not produce the expected checksum OK signal'
INVALID_LIST_LOG="$TEMP_DIR/invalid-list.log"
: > "$INVALID_LIST_LOG"
chmod 0600 "$INVALID_LIST_LOG"
if docker_mutate_capture "$INVALID_LIST_LOG" exec "$PG_NAME" sh -c "pg_restore --list < '/tmp/${RUN_ID}-corrupt.dump'"; then fail 'invalid checksummed archive unexpectedly listed'; fi
grep -Fq 'pg_restore: error: input file does not appear to be a valid archive' "$INVALID_LIST_LOG" || fail 'invalid archive listing did not produce the expected pg_restore failure'
cp "$DUMP_FILE" "$TEMP_DIR/corrupt-checksum.dump"
printf 'corrupt' >> "$TEMP_DIR/corrupt-checksum.dump"
sed "s/source.dump/${RUN_ID}-corrupt-checksum.dump/" "$CHECKSUM_FILE" > "$TEMP_DIR/${RUN_ID}-corrupt-checksum.sha256"
chmod 0600 "$TEMP_DIR/${RUN_ID}-corrupt-checksum.sha256"
docker_mutate cp "$TEMP_DIR/corrupt-checksum.dump" "$PG_NAME:/tmp/${RUN_ID}-corrupt-checksum.dump" >/dev/null || fail 'corrupt dump transfer failed'
docker_mutate cp "$TEMP_DIR/${RUN_ID}-corrupt-checksum.sha256" "$PG_NAME:/tmp/${RUN_ID}-corrupt-checksum.sha256" >/dev/null || fail 'corrupt sidecar transfer failed'
CORRUPT_CHECKSUM_LOG="$TEMP_DIR/corrupt-checksum.log"
: > "$CORRUPT_CHECKSUM_LOG"
chmod 0600 "$CORRUPT_CHECKSUM_LOG"
if docker_mutate_capture "$CORRUPT_CHECKSUM_LOG" exec "$PG_NAME" sh -c "cd /tmp && sha256sum -c '${RUN_ID}-corrupt-checksum.sha256'"; then fail 'corrupt checksum copy unexpectedly validated'; fi
grep -Fq "${RUN_ID}-corrupt-checksum.dump: FAILED" "$CORRUPT_CHECKSUM_LOG" || fail 'corrupt checksum did not produce the expected FAILED signal'
# Restore to a distinct empty DB; never use --clean/--create or target the source.
docker_mutate exec -i -e PGPASSWORD="$pg_password" "$PG_NAME" pg_restore --no-owner --no-acl -U postgres -d cocinacore_db_restore < "$DUMP_FILE" >/dev/null 2>&1 || fail 'isolated restore failed'
pg_admin "$PG_NAME" psql -U postgres -d cocinacore_db_restore -v ON_ERROR_STOP=1 -c 'GRANT SELECT ON ALL TABLES IN SCHEMA public TO cocinacore_user; GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO cocinacore_user; ALTER TABLE public.schema_migrations OWNER TO cocinacore_user;' >/dev/null 2>&1 || fail 'restored read-only grants and ledger ownership failed'
verify_ledger cocinacore_db_restore || fail 'restored migration ledger filenames differ from exact 001-012 set'
[[ $(psql_app cocinacore_db_restore "SELECT count(*) FROM tenant_memberships m JOIN users u ON u.id=m.user_id JOIN tenants t ON t.id=m.tenant_id JOIN recipe_inventory_items i ON i.tenant_id=t.id JOIN inventory_movements v ON v.inventory_item_id=i.id JOIN user_meal_plans p ON p.tenant_id=t.id JOIN shopping_list_items s ON s.tenant_id=t.id WHERE u.email='m1-rehearsal@example.invalid';") == 1 ]] || fail 'restored synthetic fixture joins/counts failed'
[[ $(psql_app cocinacore_db_restore "SELECT count(*) FROM pg_extension WHERE extname IN ('vector','pgcrypto');") == 2 ]] || fail 'restored extensions missing'
[[ $(psql_app cocinacore_db_restore "SELECT count(*) FROM pg_constraint WHERE conname='users_email_canonical_check' AND contype='c' AND pg_get_constraintdef(oid) LIKE '%lower%' AND pg_get_constraintdef(oid) LIKE '%btrim%' AND pg_get_constraintdef(oid) LIKE '%email%';") == 1 ]] || fail 'restored 011 invariant missing or semantically incorrect'
[[ $(psql_app cocinacore_db_restore "SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='user_meal_plans' AND column_name='consumption_payload' AND data_type='jsonb' AND is_nullable='NO' AND column_default = chr(39)||'{}'||chr(39)||'::jsonb';") == 1 ]] || fail 'restored 012 JSONB NOT NULL DEFAULT invariant missing'
[[ $(psql_app cocinacore_db_restore "SELECT count(*) FROM pg_constraint WHERE contype='f' AND NOT convalidated;") == 0 ]] || fail 'restored foreign-key integrity check failed'

# Compare complete schema/catalog, ledger-row and every-public-table content fingerprints.
restore_fingerprint=$(fingerprint cocinacore_db_restore) || fail 'restored database fingerprint failed'
[[ $restore_fingerprint == "$source_fingerprint" ]] || fail 'restore fingerprint differs from source database fingerprint'
verify_before=$restore_fingerprint
ledger_before=$(ledger_filenames cocinacore_db_restore)
docker_mutate run --rm --network "$ISOLATED_NETWORK" --label "$OWNER_LABEL=$RUN_ID" --env-file "$RESTORE_ENV_FILE" -e COCINACORE_SEPARATED_DB_LANES_ENABLED=false "$candidate_id" npm run db:migrate:verify >/dev/null 2>&1 || fail 'restored database read-only verify failed'
[[ $(ledger_filenames cocinacore_db_restore) == "$ledger_before" && $(fingerprint cocinacore_db_restore) == "$verify_before" ]] || fail 'read-only verification changed restored database'

# Synthetic future migration in a private overlay must report pending without applying it.
mkdir -m 0700 -- "$TEMP_DIR/migrations-overlay"
cp -R "$ROOT"/db/migrations "$TEMP_DIR/migrations-overlay/"
printf 'SELECT 1;\n' > "$TEMP_DIR/migrations-overlay/migrations/013_future.sql"
chmod 0600 "$TEMP_DIR/migrations-overlay/migrations/013_future.sql"
node - "$TEMP_DIR/migrations-overlay/migrations" <<'NODE'
const fs = require('node:fs');
const crypto = require('node:crypto');
const path = require('node:path');
const dir = process.argv[2];
const filename = '013_future.sql';
const bytes = fs.readFileSync(path.join(dir, filename));
const manifestPath = path.join(dir, 'manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
manifest.migrations.push({ id: '013', filename, lane: 'migration', sha256: crypto.createHash('sha256').update(bytes).digest('hex'), byteLength: bytes.length, transactional: 'required', legacyChecksumBackfillAllowed: false });
fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
NODE
chmod 0600 "$TEMP_DIR/migrations-overlay/migrations/manifest.json"
PENDING_LOG="$TEMP_DIR/pending-013.log"
: > "$PENDING_LOG"
chmod 0600 "$PENDING_LOG"
if docker_mutate_capture "$PENDING_LOG" run --rm --network "$ISOLATED_NETWORK" --label "$OWNER_LABEL=$RUN_ID" --env-file "$RESTORE_ENV_FILE" -e COCINACORE_SEPARATED_DB_LANES_ENABLED=false -e MIGRATIONS_DIR=/app/db/migrations -v "$TEMP_DIR/migrations-overlay/migrations:/app/db/migrations:ro" "$candidate_id" npm run db:migrate:verify; then fail 'pending 013 unexpectedly passed verification'; fi
grep -Fq 'Pending migration: 013_future.sql' "$PENDING_LOG" || fail 'pending migration failure signal did not name 013_future.sql'
[[ $(ledger_filenames cocinacore_db_restore) == "$ledger_before" && $(fingerprint cocinacore_db_restore) == "$verify_before" ]] || fail 'pending-migration check changed restored database'

# Database and Redis remain only on the isolated internal network. Apps join the internal test network for the active alias.
probe_health() {
  docker_mutate exec "$1" node -e 'const host=process.argv.at(-1); fetch(`http://${host}:3000/api/health`,{signal:AbortSignal.timeout(5000)}).then(async r=>{const j=await r.json();process.stdout.write(`${r.status}|${j.status}|${j.dependencies?.database?.status}|${j.dependencies?.redis?.status}`)}).catch(()=>process.exit(2))' "$2"
}
wait_bad_db_health() {
  docker_mutate exec "$1" node -e '
const host=process.argv.at(-1);
const deadline=process.hrtime.bigint()+60000n*1000000n;
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
(async()=>{
  while (true) {
    let remainingMs=Number((deadline-process.hrtime.bigint())/1000000n);
    if (remainingMs<=0) break;
    let structured=false;
    try {
      const response=await fetch(`http://${host}:3000/api/health`,{signal:AbortSignal.timeout(Math.min(5000, remainingMs))});
      const payload=await response.json();
      structured=Number.isInteger(response.status) && typeof payload?.status==="string" && typeof payload?.dependencies?.database?.status==="string" && typeof payload?.dependencies?.redis?.status==="string";
      if (structured) {
        const signal=`${response.status}|${payload.status}|${payload.dependencies.database.status}|${payload.dependencies.redis.status}`;
        process.stdout.write(signal);
        return signal;
      }
    } catch {}
    if (!structured) { remainingMs=Number((deadline-process.hrtime.bigint())/1000000n); if (remainingMs<=0) break; await pause(Math.min(1000, remainingMs)); continue; }
  }
  process.stdout.write("rehearsal: bad-DB health readiness timeout after 60s; no structured response");
  process.exitCode=2;
})().catch(()=>{
  process.stdout.write("rehearsal: bad-DB health readiness failed; no structured response");
  process.exitCode=2;
});
' "$2"
}
wait_rollback_health() {
  docker_mutate exec "$1" node -e '
const host=process.argv.at(-1);
const deadline=process.hrtime.bigint()+60000n*1000000n;
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
(async()=>{
  while (true) {
    const remainingMs=Number((deadline-process.hrtime.bigint())/1000000n);
    if (remainingMs<=0) break;
    try {
      const response=await fetch(`http://${host}:3000/api/health`,{signal:AbortSignal.timeout(Math.min(5000, remainingMs))});
      const payload=await response.json();
      const signal=`${response.status}|${payload?.status}|${payload?.dependencies?.database?.status}|${payload?.dependencies?.redis?.status}`;
      if (signal==="200|ok|ok|ok" && process.hrtime.bigint()<deadline) {
        process.stdout.write(signal);
        return;
      }
    } catch {}
    const remainingAfterFetch=Number((deadline-process.hrtime.bigint())/1000000n);
    if (remainingAfterFetch<=0) break;
    await pause(Math.min(1000, remainingAfterFetch));
  }
  process.stdout.write("rehearsal: rollback health readiness timeout after 60s");
  process.exitCode=2;
})().catch(()=>{
  process.stdout.write("rehearsal: rollback health readiness failed");
  process.exitCode=2;
});
' "$2"
}
expect_healthy() {
  local actual
  actual=$(probe_health "$1" "$2") || return 1
  [[ $actual == '200|ok|ok|ok' ]]
}
identity_snapshot() {
  docker inspect --format '{{.Id}}|{{.Image}}|{{.State.Status}}|{{json .NetworkSettings.Networks}}' "$1" 2>/dev/null
}
network_ids() {
  docker inspect --format '{{range .NetworkSettings.Networks}}{{.NetworkID}}{{"\n"}}{{end}}' "$1" 2>/dev/null | LC_ALL=C sort
}
container_ip_on_test() {
  docker inspect --format "{{(index .NetworkSettings.Networks \"$TEST_NETWORK\").IPAddress}}" "$1" 2>/dev/null
}
resolve_inside() {
  docker_mutate exec "$1" node -e 'require("node:dns").lookup(process.argv.at(-1),(e,a)=>{if(e)process.exit(1);process.stdout.write(a)})' "$2"
}

docker_mutate run -d --name "$PREVIOUS_NAME" --label "$OWNER_LABEL=$RUN_ID" --network "$ISOLATED_NETWORK" --env-file "$RESTORE_ENV_FILE" -v "$UPLOADS_DIR:/app/uploads" "$previous_image_id" >/dev/null || fail 'previous baseline app start failed'
previous_id=$(docker inspect --format '{{.Id}}' "$PREVIOUS_NAME" 2>/dev/null) || fail 'previous app identity unavailable'
docker_mutate network connect --alias active "$TEST_NETWORK" "$PREVIOUS_NAME" >/dev/null || fail 'previous active alias attach failed'
for _ in $(seq 1 60); do expect_healthy "$PREVIOUS_NAME" active && break; sleep 1; done
expect_healthy "$PREVIOUS_NAME" active || fail 'previous app did not return HTTP 200 with database and Redis ok through active alias'
previous_alias_ip=$(resolve_inside "$PREVIOUS_NAME" active) || fail 'previous active alias did not resolve'
[[ $previous_alias_ip == "$(container_ip_on_test "$PREVIOUS_NAME")" ]] || fail 'previous active alias identity mismatch'

docker_mutate run -d --name "$CANDIDATE_NAME" --label "$OWNER_LABEL=$RUN_ID" --network "$ISOLATED_NETWORK" --env-file "$RESTORE_ENV_FILE" -v "$UPLOADS_DIR:/app/uploads" "$candidate_id" >/dev/null || fail 'candidate app start failed'
candidate_container_id=$(docker inspect --format '{{.Id}}' "$CANDIDATE_NAME" 2>/dev/null) || fail 'candidate app identity unavailable'
docker_mutate network connect --alias candidate "$TEST_NETWORK" "$CANDIDATE_NAME" >/dev/null || fail 'candidate test alias attach failed'
for _ in $(seq 1 60); do expect_healthy "$CANDIDATE_NAME" candidate && break; sleep 1; done
expect_healthy "$CANDIDATE_NAME" candidate || fail 'candidate app did not return HTTP 200 with database and Redis ok'
[[ $(fingerprint cocinacore_db_restore) == "$verify_before" ]] || fail 'candidate health scenario changed restore fingerprint'

# The mismatch path calls the real rollback identity guard and proves no container state changed.
rollback_previous() {
  local expected_id=$1 observed_id observed_image
  observed_id=$(docker inspect --format '{{.Id}}' "$PREVIOUS_NAME" 2>/dev/null) || return 42
  observed_image=$(docker inspect --format '{{.Image}}' "$PREVIOUS_NAME" 2>/dev/null) || return 42
  if [[ $expected_id != "$previous_id" || $observed_id != "$previous_id" || $observed_image != "$previous_image_id" ]]; then
    status 'MANUAL_INTERVENTION_REQUIRED'
    return 42
  fi
  docker_mutate network connect --alias active "$TEST_NETWORK" "$PREVIOUS_NAME" >/dev/null || return 1
  docker_mutate start "$PREVIOUS_NAME" >/dev/null || return 1
}
mismatch_before="$(identity_snapshot "$PREVIOUS_NAME")|$(identity_snapshot "$CANDIDATE_NAME")"
mismatch_db_before=$(fingerprint cocinacore_db_restore)
if rollback_previous 'deliberately-wrong-identity'; then fail 'identity mismatch guard unexpectedly allowed rollback'; else mismatch_rc=$?; fi
[[ $mismatch_rc == 42 ]] || fail 'identity mismatch guard returned the wrong failure signal'
mismatch_after="$(identity_snapshot "$PREVIOUS_NAME")|$(identity_snapshot "$CANDIDATE_NAME")"
[[ $mismatch_after == "$mismatch_before" ]] || fail 'identity mismatch guard mutated app identity or state'
[[ $(fingerprint cocinacore_db_restore) == "$mismatch_db_before" ]] || fail 'identity mismatch guard changed database fingerprint'
expect_healthy "$PREVIOUS_NAME" active || fail 'previous app changed during identity mismatch guard'

# Capture the complete previous-app and restore-DB baseline before the bad-DB candidate starts.
pre_cutover_previous_id=$(docker inspect --format '{{.Id}}' "$PREVIOUS_NAME" 2>/dev/null) || fail 'pre-cutover previous app identity unavailable'
pre_cutover_previous_image_id=$(docker inspect --format '{{.Image}}' "$PREVIOUS_NAME" 2>/dev/null) || fail 'pre-cutover previous image identity unavailable'
pre_cutover_previous_state=$(docker inspect --format '{{.State.Status}}' "$PREVIOUS_NAME" 2>/dev/null) || fail 'pre-cutover previous app state unavailable'
pre_cutover_previous_network_ids=$(network_ids "$PREVIOUS_NAME") || fail 'pre-cutover previous network inventory unavailable'
pre_cutover_previous_snapshot=$(identity_snapshot "$PREVIOUS_NAME") || fail 'pre-cutover previous identity snapshot unavailable'
pre_cutover_restore_fingerprint=$(fingerprint cocinacore_db_restore) || fail 'pre-cutover restore database fingerprint unavailable'
pre_cutover_previous_health=$(probe_health "$PREVIOUS_NAME" active) || fail 'pre-cutover previous health response unavailable'
[[ $pre_cutover_previous_state == running && $pre_cutover_previous_health == '200|ok|ok|ok' ]] || fail 'previous app was not healthy before bad-DB case'

# Bad-DB case must return the route's exact 503/unavailable/database + healthy Redis signal.
docker_mutate run -d --name "${RUN_ID}-bad-db" --label "$OWNER_LABEL=$RUN_ID" --network "$ISOLATED_NETWORK" --env-file "$RESTORE_ENV_FILE" -e DATABASE_URL='postgresql://invalid:invalid@127.0.0.1:1/no_db' "$candidate_id" >/dev/null || fail 'bad-DB case start failed'
bad_db_id=$(docker inspect --format '{{.Id}}' "${RUN_ID}-bad-db" 2>/dev/null) || fail 'bad-DB identity unavailable'
if ! bad_db_signal=$(wait_bad_db_health "${RUN_ID}-bad-db" 127.0.0.1); then
  fail "bad-DB health readiness failed: ${bad_db_signal:-no structured response}"
fi
[[ $bad_db_signal == '503|unavailable|unavailable|ok' ]] || fail 'bad-DB case did not return HTTP 503 with database unavailable and Redis ok'
post_bad_db_restore_fingerprint=$(fingerprint cocinacore_db_restore) || fail 'post-bad-DB restore database fingerprint unavailable'
[[ $post_bad_db_restore_fingerprint == "$pre_cutover_restore_fingerprint" && $post_bad_db_restore_fingerprint == "$verify_before" ]] || fail 'bad-DB health scenario changed restore fingerprint'
[[ $(docker inspect --format '{{.Id}}' "$PREVIOUS_NAME" 2>/dev/null) == "$pre_cutover_previous_id" ]] || fail 'previous container ID changed during bad-DB case'
[[ $(docker inspect --format '{{.Image}}' "$PREVIOUS_NAME" 2>/dev/null) == "$pre_cutover_previous_image_id" ]] || fail 'previous image ID changed during bad-DB case'
[[ $(docker inspect --format '{{.State.Status}}' "$PREVIOUS_NAME" 2>/dev/null) == "$pre_cutover_previous_state" ]] || fail 'previous running state changed during bad-DB case'
[[ $(network_ids "$PREVIOUS_NAME") == "$pre_cutover_previous_network_ids" ]] || fail 'previous network IDs changed during bad-DB case'
[[ $(identity_snapshot "$PREVIOUS_NAME") == "$pre_cutover_previous_snapshot" ]] || fail 'previous identity snapshot changed during bad-DB case'
previous_health_after=$(probe_health "$PREVIOUS_NAME" active) || fail 'previous health response unavailable after bad-DB case'
[[ $previous_health_after == '200|ok|ok|ok' && $previous_health_after == "$pre_cutover_previous_health" ]] || fail 'previous health changed during bad-DB case'
status 'PRE_CUTOVER_CANDIDATE_FAILURE_PREVIOUS_UNTOUCHED'

# Cutover simulation only: remove previous active alias, stop it, then assign active to candidate.
docker_mutate network disconnect "$TEST_NETWORK" "$PREVIOUS_NAME" >/dev/null || fail 'previous active alias detach failed'
docker_mutate stop "$PREVIOUS_NAME" >/dev/null || fail 'previous app stop at cutover failed'
docker_mutate network disconnect "$TEST_NETWORK" "$CANDIDATE_NAME" >/dev/null || fail 'candidate alias reset failed'
docker_mutate network connect --alias candidate --alias active "$TEST_NETWORK" "$CANDIDATE_NAME" >/dev/null || fail 'candidate active alias attach failed'
active_ip=$(resolve_inside "$CANDIDATE_NAME" active) || fail 'active alias did not resolve after cutover'
[[ $active_ip == "$(container_ip_on_test "$CANDIDATE_NAME")" ]] || fail 'active alias did not resolve to candidate identity'
expect_healthy "$CANDIDATE_NAME" active || fail 'candidate active alias did not return HTTP 200 with both dependencies ok'
status 'CUTOVER_SIMULATION_CANDIDATE_ACTIVE'

# Inject a post-cutover app failure and run the guarded local-only rollback.
docker_mutate stop "$CANDIDATE_NAME" >/dev/null || fail 'candidate stop injection failed'
docker_mutate network disconnect "$TEST_NETWORK" "$CANDIDATE_NAME" >/dev/null || fail 'candidate active alias detach failed'
rollback_previous "$previous_id" || fail 'guarded previous app rollback failed'
rollback_health_signal=$(wait_rollback_health "$PREVIOUS_NAME" active) || fail "previous rollback health readiness failed: ${rollback_health_signal:-no structured response}"
[[ $rollback_health_signal == '200|ok|ok|ok' ]] || fail 'previous rollback did not return the exact healthy response'
[[ $(resolve_inside "$PREVIOUS_NAME" active) == "$(container_ip_on_test "$PREVIOUS_NAME")" ]] || fail 'rollback active alias did not resolve to previous identity'
[[ $(docker inspect --format '{{.Id}}' "$PREVIOUS_NAME" 2>/dev/null) == "$previous_id" ]] || fail 'previous rollback identity changed'
[[ $(docker inspect --format '{{.Image}}' "$PREVIOUS_NAME" 2>/dev/null) == "$previous_image_id" ]] || fail 'previous rollback image changed'
[[ $(network_ids "$PREVIOUS_NAME") == "$pre_cutover_previous_network_ids" ]] || fail 'previous rollback network changed'
[[ $(fingerprint cocinacore_db_restore) == "$verify_before" ]] || fail 'rollback changed database fingerprint'
status 'POST_CUTOVER_FAILURE_PREVIOUS_RESTORED'
status 'FAILURE_MATRIX checksum_corruption=verified invalid_archive=verified pending_013=verified candidate_health=verified candidate_pre_cutover_failure=verified post_cutover_restore=verified identity_mismatch=manual'
status 'HARNESS_SIMULATION_ONLY_NOT_PRODUCTION_DEPLOY'
status "RESOURCE_IDS candidate=$candidate_container_id previous=$previous_id"
