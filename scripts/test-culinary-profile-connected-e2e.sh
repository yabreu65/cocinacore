#!/usr/bin/env bash
set -Eeuo pipefail

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
generate_reporter() {
  cat <<'REPORTER'
import fs from 'node:fs';

const allowedFailureFiles = new Set(['today-recommendations-connected.spec.ts', 'meal-planner-connected.spec.ts']);
const allowedSelectedSpecs = new Set(['culinary-profile-connected.spec.ts', 'today-recommendations-connected.spec.ts', 'meal-planner-connected.spec.ts']);
const allowedStatuses = new Set(['passed', 'failed', 'timedout', 'interrupted']);
const maxFailures = 20;
const maxStackLength = 8192;

function validatedLocation(file, lineValue, columnValue) {
  const line = Number(lineValue);
  const column = Number(columnValue);
  if (!allowedFailureFiles.has(file) || !Number.isSafeInteger(line) || line < 1 ||
      !Number.isSafeInteger(column) || column < 1) return null;
  return { file, line, column };
}

function stackLocation(stack) {
  if (typeof stack !== 'string') return null;
  const boundedStack = stack.slice(0, maxStackLength);
  const framePattern = /(?:^|[\\/])((?:today-recommendations|meal-planner)-connected\.spec\.ts):(\d+):(\d+)(?=$|[)\s])/gm;
  let match;
  while ((match = framePattern.exec(boundedStack)) !== null) {
    const location = validatedLocation(match[1], match[2], match[3]);
    if (location) return location;
  }
  return null;
}

export default class CulinaryProfileStartReporter {
  constructor() {
    this.failureCount = 0;
    this.counts = { total: 0, passed: 0, flaky: 0, failed: 0, skipped: 0 };
    this.selectedSpec = process.env.PLAYWRIGHT_SELECTED_SPEC || '';
  }

  onTestBegin() {
    const sentinel = process.env.PLAYWRIGHT_STARTED_FILE;
    if (sentinel) fs.writeFileSync(sentinel, 'started\n', { flag: 'wx', mode: 0o600 });
  }

  onTestEnd(test, result) {
    const outcome = test.outcome();
    this.counts.total += 1;
    if (outcome === 'expected') this.counts.passed += 1;
    else if (outcome === 'flaky') this.counts.flaky += 1;
    else if (outcome === 'unexpected') this.counts.failed += 1;
    else if (outcome === 'skipped') this.counts.skipped += 1;
    const output = process.env.PLAYWRIGHT_FAILURE_METADATA_FILE;
    if (!output || !allowedStatuses.has(result.status) || this.failureCount >= maxFailures) return;
    const stack = result.error && typeof result.error.stack === 'string' ? result.error.stack : '';
    let location = stackLocation(stack);
    let source = 'stack';
    if (!location) {
      const declarationFile = test.location && test.location.file ? test.location.file.split(/[\\/]/).pop() : '';
      location = validatedLocation(declarationFile, test.location && test.location.line, test.location && test.location.column);
      source = 'declaration';
    }
    if (!location) return;
    const record = { ...location, source };
    fs.appendFileSync(output, JSON.stringify(record) + '\n', { mode: 0o600 });
    this.failureCount += 1;
  }

  onEnd(result) {
    const reporterFile = process.env.PLAYWRIGHT_ONEND_SENTINEL_PATH;
    if (reporterFile) fs.writeFileSync(reporterFile, 'observed\n', { flag: 'wx', mode: 0o600 });
    if (!allowedSelectedSpecs.has(this.selectedSpec) || !allowedStatuses.has(result.status)) return;
    const { total, passed, flaky, failed, skipped } = this.counts;
    process.stdout.write(`PLAYWRIGHT_RESULT spec=${this.selectedSpec} total=${total} passed=${passed} flaky=${flaky} failed=${failed} skipped=${skipped} status=${result.status}\n`);
  }
}
REPORTER
}

if [[ "$#" -eq 1 && "$1" == '--check-reporter' ]]; then
  command -v node >/dev/null 2>&1 || { printf 'Node.js is unavailable.\n' >&2; exit 1; }
  generate_reporter | node --check --input-type=module - || exit 1
  printf 'CULINARY_PROFILE_REPORTER_SYNTAX=PASS\n'
  exit 0
fi
if [[ "${1-}" == '--check-reporter' ]]; then
  printf 'reporter syntax preflight accepts no additional arguments.\n' >&2
  exit 1
fi

. "$ROOT/scripts/lib/connected-e2e-event-lifecycle.sh"
PG_IMAGE='pgvector/pgvector:pg16'
REDIS_IMAGE='redis:7-alpine'
DOCKER_SOCKET='unix:///Users/yoryiabreu/.docker/run/docker.sock'
RUN_ID="$$-$(od -An -N8 -tx1 /dev/urandom | tr -d ' \n')"
PG_CONTAINER="cocinacore-profile-e2e-pg-${RUN_ID}"
REDIS_CONTAINER="cocinacore-profile-e2e-redis-${RUN_ID}"
LABEL_KEY='com.cocinacore.culinary-profile-e2e.run'
WORKSPACE=''
DOCKER=(docker --host "$DOCKER_SOCKET")
PG_ID=''
REDIS_ID=''
PG_ARMED=0
REDIS_ARMED=0
CLEANUP_RUNNING=0
FAILURE_EVIDENCE_DONE=0
CONTAINER_ROWS=''
PRE_INVENTORY=''
POST_INVENTORY_MATCH='NO'
FORENSICS=''
EVENT_PID=''
EVENT_SANITIZER_PID=''
MIGRATION_PID=''
MIGRATION_SANITIZER_PID=''
MIGRATION_TEE_PID=''
MIGRATION_EXIT_CODE=''
MIGRATION_SIGNAL=''
PLAYWRIGHT_PID=''
PLAYWRIGHT_SANITIZER_PID=''
PLAYWRIGHT_START_WATCHER_PID=''
PLAYWRIGHT_EXIT_CODE=''
LOG_SANITIZATION_FAILED=NO
SANITIZATION_FAILED=0
EVENT_LIFECYCLE_FAILED=0
OWNED_PIDS=''
CLEANUP_REAP_PID=''
CLEANUP_REAP_STATUS=''
# MIGRATION_START id= is emitted during live parsing before cleanup waits for "$MIGRATION_PID".

PLAYWRIGHT_SIGNAL=''
MIGRATION_ACTIVE=''
MIGRATION_LAST_COMPLETED=''

utc_now() { node -e 'process.stdout.write(new Date().toISOString())'; }
mark() { printf '%s %s\n' "$(utc_now)" "$*"; }
sanitization_failed() { SANITIZATION_FAILED=1; LOG_SANITIZATION_FAILED=YES; mark LOG_SANITIZATION_FAILED=YES; }
process_terminated() {
  local pid=$1 state
  if ! kill -0 "$pid" 2>/dev/null; then return 0; fi
  state=$(ps -o stat= -p "$pid" 2>/dev/null) || return 1
  [[ "$state" == Z* || "$state" == *' Z'* ]]
}
cleanup_owned_children() {
  local root_pid=$1 child_pid children pgrep_status attempt owned_child=NO terminated=NO wait_status
  [[ "$root_pid" =~ ^[0-9]+$ ]] || return 0
  case "$root_pid" in
    "$EVENT_PID"|"$EVENT_SANITIZER_PID"|"$MIGRATION_PID"|"$MIGRATION_SANITIZER_PID"|"$MIGRATION_TEE_PID"|"$PLAYWRIGHT_PID"|"$PLAYWRIGHT_SANITIZER_PID"|"$PLAYWRIGHT_START_WATCHER_PID") owned_child=YES ;;
  esac
  if ! process_terminated "$root_pid"; then
    # Discover only children of this exact PID; recurse before signaling the root.
    children=$(pgrep -P "$root_pid" 2>/dev/null) || {
      pgrep_status=$?
      if [[ "$pgrep_status" != 1 ]]; then
        printf 'cleanup failure: could not discover children of owned process PID %s\\n' "$root_pid" >&2
        return 1
      fi
    }
    for child_pid in $children; do cleanup_owned_children "$child_pid" || return 1; done
    kill -TERM "$root_pid" 2>/dev/null || {
      process_terminated "$root_pid" && terminated=YES
      if [[ "$terminated" != YES ]]; then
        printf 'cleanup failure: could not TERM owned process PID %s\\n' "$root_pid" >&2
        return 1
      fi
    }
    for attempt in $(seq 1 20); do
      if process_terminated "$root_pid"; then terminated=YES; break; fi
      sleep 0.1
    done
    if [[ "$terminated" != YES ]]; then
      kill -KILL "$root_pid" 2>/dev/null || {
        process_terminated "$root_pid" && terminated=YES
        if [[ "$terminated" != YES ]]; then
          printf 'cleanup failure: could not KILL owned process PID %s\\n' "$root_pid" >&2
          return 1
        fi
      }
      for attempt in $(seq 1 20); do
        if process_terminated "$root_pid"; then terminated=YES; break; fi
        sleep 0.1
      done
    fi
  else
    terminated=YES
  fi
  # Recheck the exact PID immediately before any wait; never wait while it is live.
  if kill -0 "$root_pid" 2>/dev/null; then
    local final_state
    final_state=$(ps -o stat= -p "$root_pid" 2>/dev/null) || final_state='' # Z is a terminated zombie state
    if [[ "$final_state" == Z* || "$final_state" == *' Z'* ]]; then terminated=YES; else terminated=NO; fi
  else
    terminated=YES
  fi
  if [[ "$terminated" == YES && "$owned_child" == YES ]]; then
    # Wait only after this exact PID is confirmed absent or a zombie.
    if wait "$root_pid" 2>/dev/null; then wait_status=0; else wait_status=$?; fi
    CLEANUP_REAP_PID=$root_pid
    CLEANUP_REAP_STATUS=$wait_status
  fi
  # Descendants may not be this shell's children; verify bounded absence without waiting.
  for attempt in $(seq 1 20); do
    if ! kill -0 "$root_pid" 2>/dev/null; then
      printf 'verified absent: owned process PID %s\\n' "$root_pid"
      return 0
    fi
    sleep 0.1
  done
  printf 'cleanup failure: owned process PID %s remains after bounded TERM/KILL\\n' "$root_pid" >&2
  return 1
}
wait_signal() {
  case "$1" in
    129) printf HUP ;; 130) printf INT ;; 131) printf QUIT ;; 137) printf KILL ;;
    139) printf SEGV ;; 141) printf PIPE ;; 143) printf TERM ;;
    *) if [[ "$1" -gt 128 ]]; then printf 'SIGNAL_%s' "$(( $1 - 128 ))"; else printf NONE; fi ;;
  esac
}
fail() {
  printf 'culinary profile connected E2E failure: %s\n' "$1" >&2
  exit 1
}

if [[ "$#" -gt 1 ]]; then fail 'accepts at most one exact target selector: profile, today, or meal-planner.'; fi
TARGET=${1-profile}
case "$TARGET" in
  profile) PLAYWRIGHT_SPEC='e2e/specs/culinary-profile-connected.spec.ts' ;;
  today) PLAYWRIGHT_SPEC='e2e/specs/today-recommendations-connected.spec.ts' ;;
  meal-planner) PLAYWRIGHT_SPEC='e2e/specs/meal-planner-connected.spec.ts' ;;
  *) fail 'unknown target selector; allowed targets are profile, today, and meal-planner.' ;;
esac

filtered_containers() {
  "${DOCKER[@]}" container ls -a --no-trunc --filter "label=$LABEL_KEY=$RUN_ID" --format '{{.ID}}|{{.Names}}'
}
filtered_has_id() {
  local wanted_id=$1 listed_id listed_name
  while IFS='|' read -r listed_id listed_name; do
    [[ "$listed_id" == "$wanted_id" ]] && return 0
  done <<< "$CONTAINER_ROWS"
  return 1
}

save_inventory() {
  local phase=$1
  "${DOCKER[@]}" container ls -aq --no-trunc | LC_ALL=C sort > "$FORENSICS/${phase}_containers.txt"
  "${DOCKER[@]}" network ls --no-trunc --format '{{.ID}}|{{.Name}}' | LC_ALL=C sort > "$FORENSICS/${phase}_networks.txt"
  "${DOCKER[@]}" volume ls --format '{{.Name}}' | LC_ALL=C sort > "$FORENSICS/${phase}_volumes.txt"
}
inventory_values() {
  local phase=$1 item file count hash
  for item in CONTAINERS NETWORKS VOLUMES; do
    case "$item" in
      CONTAINERS) file="$FORENSICS/${phase}_containers.txt" ;;
      NETWORKS) file="$FORENSICS/${phase}_networks.txt" ;;
      VOLUMES) file="$FORENSICS/${phase}_volumes.txt" ;;
    esac
    count=$(awk 'END { print NR }' "$file")
    hash=$(shasum -a 256 "$file" | awk '{print $1}')
    printf '%s_%s_COUNT=%s\n%s_%s_SHA256=%s\n' "$phase" "$item" "$count" "$phase" "$item" "$hash"
  done
}
emit_inventory_values() {
  local values=$1 line
  while IFS= read -r line; do [[ -n "$line" ]] && mark "$line"; done <<< "$values"
}

cleanup_container() {
  local expected_image=$1 expected_name=$2 container_id=$3 armed=$4 identity=''
  local candidate_id=''
  [[ "$armed" == 1 ]] || return 0
  if [[ -n "$container_id" ]]; then
    candidate_id=$container_id
  else
    if ! CONTAINER_ROWS=$(filtered_containers); then
      printf 'cleanup failure: could not query exact run-label filtered containers\n' >&2
      return 1
    fi
    local listed_id listed_name matches=0
    while IFS='|' read -r listed_id listed_name; do
      if [[ "$listed_name" == "$expected_name" ]]; then
        candidate_id=$listed_id
        ((matches += 1))
      fi
    done <<< "$CONTAINER_ROWS"
    if [[ "$matches" == 0 ]]; then
      printf 'verified absent after exact run-label filtered query: %s\n' "$expected_name"
      return 0
    fi
    if [[ "$matches" != 1 ]]; then
      printf 'cleanup failure: multiple exact-name containers found for %s\n' "$expected_name" >&2
      return 1
    fi
  fi
  if identity=$("${DOCKER[@]}" container inspect --format '{{.Config.Image}}|{{.Name}}|{{index .Config.Labels "com.cocinacore.culinary-profile-e2e.run"}}' "$candidate_id" 2>/dev/null); then
    if [[ "$identity" != "$expected_image|/$expected_name|$RUN_ID" ]]; then
      printf 'cleanup failure: exact ID %s failed expected image/name/run-label validation; left untouched\n' "$candidate_id" >&2
      return 1
    fi
    "${DOCKER[@]}" rm -f "$candidate_id" >/dev/null 2>&1 || true
  fi
  if ! CONTAINER_ROWS=$(filtered_containers); then
    printf 'cleanup failure: could not verify exact run-label filtered absence for %s\n' "$expected_name" >&2
    return 1
  fi
  if filtered_has_id "$candidate_id"; then
    printf 'cleanup failure: exact owned ID %s remains in filtered container list\n' "$candidate_id" >&2
    return 1
  fi
  printf 'removed and verified absent by exact run-label filter: %s\n' "$candidate_id"
}

capture_owned_events() {
  local producer_pid=$EVENT_PID sanitizer_pid=$EVENT_SANITIZER_PID
  [[ -n "$FORENSICS" ]] || return 0
  if [[ -n "$producer_pid" || -n "$sanitizer_pid" ]]; then
    if connected_e2e_event_lifecycle "${producer_pid:-}" "${sanitizer_pid:-}"; then
      :
    else
      EVENT_LIFECYCLE_FAILED=1
      if [[ "$CONNECTED_E2E_EVENT_CAUSE" == sanitizer-error ]]; then sanitization_failed; fi
    fi
    EVENT_PID=''
    EVENT_SANITIZER_PID=''
  fi
  # Keep every byte already emitted by the sanitizer, including a bounded
  # timeout/termination partial stream; this file has never received raw input.
  if [[ -f "$FORENSICS/events.log" ]]; then
    cp "$FORENSICS/events.log" "$FORENSICS/owned-events.log" || { : > "$FORENSICS/owned-events.log"; sanitization_failed; }
  else
    : > "$FORENSICS/owned-events.log"
  fi
}
capture_sanitized_state() {
  local container_id=$1
  [[ -n "$container_id" ]] || return 0
  "${DOCKER[@]}" container inspect --format 'ID={{.Id}} State.Status={{.State.Status}} State.Running={{.State.Running}} State.Restarting={{.State.Restarting}} State.ExitCode={{.State.ExitCode}} State.OOMKilled={{.State.OOMKilled}} State.Error=secret={{.State.Error}} State.StartedAt={{.State.StartedAt}} State.FinishedAt={{.State.FinishedAt}} RestartCount={{.RestartCount}}' "$container_id" 2>/dev/null | node "$ROOT/scripts/lib/redact-diagnostic-stream.mjs" || printf 'sanitized inspect unavailable for owned ID %s\n' "$container_id"
}
capture_container_logs() {
  local container_id=$1 output
  [[ -n "$container_id" && -n "$FORENSICS" ]] || return 0
  if [[ "$container_id" == "$PG_ID" ]]; then output="$FORENSICS/postgres.log"; else output="$FORENSICS/redis.log"; fi
  if ! "${DOCKER[@]}" logs --timestamps "$container_id" 2>&1 | node "$ROOT/scripts/lib/redact-diagnostic-stream.mjs" > "$output"; then
    : > "$output"
    sanitization_failed
    return 1
  fi
}
print_bounded_summary() {
  local file=$1
  [[ -f "$file" ]] || return 0
  node "$ROOT/scripts/lib/redact-diagnostic-stream.mjs" --summary < "$file"
}
print_playwright_failure_metadata() {
  local file=$1
  [[ -f "$file" ]] || return 0
  node - "$file" <<'NODE'
const fs = require('node:fs');
const allowedFailureFiles = new Set(['today-recommendations-connected.spec.ts', 'meal-planner-connected.spec.ts']);
const allowedSources = new Set(['stack', 'declaration']);
const records = fs.readFileSync(process.argv[2], 'utf8').split('\n').filter(Boolean).slice(0, 20);
for (const line of records) {
  try {
    const item = JSON.parse(line);
    if (!item || Object.keys(item).sort().join(',') !== 'column,file,line,source' ||
        !allowedSources.has(item.source) || !allowedFailureFiles.has(item.file) ||
        !Number.isSafeInteger(item.line) || item.line < 1 ||
        !Number.isSafeInteger(item.column) || item.column < 1) continue;
    process.stdout.write(`PLAYWRIGHT_FAILURE source=${item.file}:${item.line}:${item.column}\n`);
  } catch {}
}
NODE
}
capture_failure_evidence() {
  [[ "$FAILURE_EVIDENCE_DONE" == 1 ]] && return 0
  FAILURE_EVIDENCE_DONE=1
  [[ -n "$FORENSICS" ]] || return 0
  # Migration/Node and Playwright codes/signals are captured before evidence collection.
  capture_owned_events
  capture_sanitized_state "$PG_ID" > "$FORENSICS/postgres-state.txt"
  capture_sanitized_state "$REDIS_ID" > "$FORENSICS/redis-state.txt"
  capture_container_logs "$PG_ID" || true
  capture_container_logs "$REDIS_ID" || true
  local summary_line summary_count=0 event_count=0
  for log in "$FORENSICS/postgres-state.txt" "$FORENSICS/redis-state.txt" "$FORENSICS/owned-events.log" "$FORENSICS/postgres.log" "$FORENSICS/redis.log" "$FORENSICS/migration.trace.log"; do
    [[ -f "$log" ]] || continue
    print_bounded_summary "$log" > "$WORKSPACE/summary.tmp"
    while IFS= read -r summary_line; do
      [[ "$summary_count" -lt 10 ]] || break
      printf '%s\n' "$summary_line"
      ((summary_count += 1))
    done < "$WORKSPACE/summary.tmp"
    [[ "$summary_count" -lt 10 ]] || break
  done
  print_playwright_failure_metadata "$FORENSICS/playwright-failures.jsonl"
  if [[ -f "$FORENSICS/owned-events.log" ]]; then event_count=$(awk 'END { print NR+0 }' "$FORENSICS/owned-events.log"); fi
  mark "OWNED_EVENT_COUNT=$event_count"
  mark M2_E2E_FAILURE
}

cleanup() {
  local status=$? cleanup_failed=0 inventory_post inventory_expected
  [[ "$CLEANUP_RUNNING" == 1 ]] && return
  CLEANUP_RUNNING=1
  trap - EXIT INT TERM
  if [[ "$status" != 0 ]]; then capture_failure_evidence || true; fi
  mark CLEANUP_START
  mark M2_E2E_CLEANUP_START
  # capture_owned_events owns the ordered producer-stop, sanitizer-drain, and escalation lifecycle.
  # cleanup_owned_children bounds kill "${MIGRATION_PID}"; ps -o stat= -p "${MIGRATION_PID}" Z or kill -0 absence gates wait "${MIGRATION_PID}" and final verification.
  if [[ -n "$MIGRATION_PID" ]]; then cleanup_owned_children "$MIGRATION_PID" || cleanup_failed=1; MIGRATION_PID=''; fi
  if [[ -n "$MIGRATION_SANITIZER_PID" ]]; then cleanup_owned_children "$MIGRATION_SANITIZER_PID" || cleanup_failed=1; MIGRATION_SANITIZER_PID=''; fi
  if [[ -n "$MIGRATION_TEE_PID" ]]; then cleanup_owned_children "$MIGRATION_TEE_PID" || cleanup_failed=1; MIGRATION_TEE_PID=''; fi
  # cleanup_owned_children bounds kill "${PLAYWRIGHT_PID}"; ps -o stat= -p "${PLAYWRIGHT_PID}" Z or kill -0 absence gates wait "${PLAYWRIGHT_PID}" and final verification.
  if [[ -n "$PLAYWRIGHT_PID" ]]; then cleanup_owned_children "$PLAYWRIGHT_PID" || cleanup_failed=1; PLAYWRIGHT_PID=''; fi
  if [[ -n "$PLAYWRIGHT_SANITIZER_PID" ]]; then cleanup_owned_children "$PLAYWRIGHT_SANITIZER_PID" || cleanup_failed=1; PLAYWRIGHT_SANITIZER_PID=''; fi
  if [[ -n "$PLAYWRIGHT_START_WATCHER_PID" ]]; then cleanup_owned_children "$PLAYWRIGHT_START_WATCHER_PID" || cleanup_failed=1; PLAYWRIGHT_START_WATCHER_PID=''; fi
  capture_owned_events || true
  cleanup_container "$PG_IMAGE" "$PG_CONTAINER" "$PG_ID" "$PG_ARMED" || cleanup_failed=1
  cleanup_container "$REDIS_IMAGE" "$REDIS_CONTAINER" "$REDIS_ID" "$REDIS_ARMED" || cleanup_failed=1
  if [[ "$PG_ARMED" == 1 || "$REDIS_ARMED" == 1 ]]; then
    if ! CONTAINER_ROWS=$(filtered_containers); then
      printf 'cleanup failure: could not verify final exact run-label filtered container absence\n' >&2
      cleanup_failed=1
    elif [[ -n "$CONTAINER_ROWS" ]]; then
      printf 'cleanup failure: containers remain with this exact run label:\n%s\n' "$CONTAINER_ROWS" >&2
      cleanup_failed=1
    else
      printf 'verified absent: no containers remain with the exact unique run label\n'
    fi
  fi
  if [[ -n "$PRE_INVENTORY" ]]; then
    mark M2_E2E_POST_INVENTORY_START
    if save_inventory POST && inventory_post=$(inventory_values POST); then
      emit_inventory_values "$inventory_post"
      inventory_expected=$(printf '%s\n' "$PRE_INVENTORY" | awk '{ sub(/^PRE_/, "POST_"); print }')
      if [[ "$inventory_post" != "$inventory_expected" ]] ||
         ! cmp -s "$FORENSICS/PRE_containers.txt" "$FORENSICS/POST_containers.txt" ||
         ! cmp -s "$FORENSICS/PRE_networks.txt" "$FORENSICS/POST_networks.txt" ||
         ! cmp -s "$FORENSICS/PRE_volumes.txt" "$FORENSICS/POST_volumes.txt"; then
        POST_INVENTORY_MATCH='NO'
        cleanup_failed=1
      else
        POST_INVENTORY_MATCH='YES'
      fi
    else
      POST_INVENTORY_MATCH='NO'
      cleanup_failed=1
    fi
    mark M2_E2E_POST_INVENTORY_COMPLETE
    mark "POST_INVENTORY_MATCH=$POST_INVENTORY_MATCH"
  fi
  if [[ -n "$WORKSPACE" ]]; then
    if ! rm -rf -- "$WORKSPACE"; then
      printf 'cleanup failure: could not remove exact temporary workspace\n' >&2
      cleanup_failed=1
    elif [[ -e "$WORKSPACE" || -L "$WORKSPACE" ]]; then
      printf 'cleanup failure: temporary workspace remains after removal\n' >&2
      cleanup_failed=1
    else
      printf 'removed and verified absent: temporary workspace and forensics\n'
    fi
  fi
  if [[ "$cleanup_failed" == 0 && -n "$PRE_INVENTORY" && -z "$CONTAINER_ROWS" && ( -z "$WORKSPACE" || ( ! -e "$WORKSPACE" && ! -L "$WORKSPACE" ) ) && "$POST_INVENTORY_MATCH" == YES ]]; then
    mark ZERO_M2_TEST_GARBAGE=YES
  else
    mark ZERO_M2_TEST_GARBAGE=NO
  fi
  [[ "$cleanup_failed" == 0 ]] || status=1
  if [[ "$SANITIZATION_FAILED" == 1 || "$EVENT_LIFECYCLE_FAILED" == 1 ]]; then status=1; fi
  mark CLEANUP_COMPLETE
  mark M2_E2E_CLEANUP_COMPLETE
  mark "RUNNER_EXIT_STATUS=$status"
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

mark HARNESS_START
mark M2_E2E_HARNESS_START
command -v node >/dev/null 2>&1 || fail 'Node.js is unavailable.'
command -v npm >/dev/null 2>&1 || fail 'npm is unavailable.'
[[ "$(node --version)" == 'v22.22.3' ]] || fail 'Node.js v22.22.3 is required.'
[[ "$(npm --version)" == '12.2.0' ]] || fail 'npm 12.2.0 is required.'
command -v docker >/dev/null 2>&1 || fail 'Docker CLI is unavailable.'
[[ -S "${DOCKER_SOCKET#unix://}" ]] || fail 'the pinned local Docker socket is unavailable.'

if ! "${DOCKER[@]}" image inspect "$PG_IMAGE" >/dev/null 2>&1; then fail "required exact local image $PG_IMAGE is absent; images are never pulled."; fi
if ! "${DOCKER[@]}" image inspect "$REDIS_IMAGE" >/dev/null 2>&1; then fail "required exact local image $REDIS_IMAGE is absent; images are never pulled."; fi
PG_IMAGE_DETAILS=$("${DOCKER[@]}" image inspect --format 'ID={{.Id}} RepoDigests={{join .RepoDigests ","}}' "$PG_IMAGE")
REDIS_IMAGE_DETAILS=$("${DOCKER[@]}" image inspect --format 'ID={{.Id}} RepoDigests={{join .RepoDigests ","}}' "$REDIS_IMAGE")
mark "DOCKER_IMAGE_SELECTION PostgreSQL=$PG_IMAGE_DETAILS Redis=$REDIS_IMAGE_DETAILS"
mark "DOCKER_SERVER_VERSION $(${DOCKER[@]} version --format '{{.Server.Version}}')"

WORKSPACE=$(mktemp -d "${TMPDIR:-/tmp}/cocinacore-profile-e2e.XXXXXX")
FORENSICS="$WORKSPACE/forensics"
mkdir -m 700 "$FORENSICS"
chmod 700 "$FORENSICS"
SOURCE="$WORKSPACE/source"
mkdir -p "$SOURCE"
tar -cf - \
  --exclude='.env*' --exclude='*/.env*' \
  --exclude='.git' --exclude='*/.git' \
  --exclude='node_modules' --exclude='*/node_modules' \
  --exclude='.next' --exclude='*/.next' \
  -C "$ROOT" frontend db/migrations | tar -xf - -C "$SOURCE"
if find "$SOURCE" -name '.env*' -print | grep -q .; then fail 'sanitized source copy contains a forbidden .env* filename.'; fi
[[ -d "$ROOT/frontend/node_modules" ]] || fail 'existing frontend/node_modules is required; this runner never installs dependencies.'
package_json_source=$(shasum -a 256 "$ROOT/frontend/package.json" | awk '{print $1}')
package_json_copy=$(shasum -a 256 "$SOURCE/frontend/package.json" | awk '{print $1}')
package_lock_source=$(shasum -a 256 "$ROOT/frontend/package-lock.json" | awk '{print $1}')
package_lock_copy=$(shasum -a 256 "$SOURCE/frontend/package-lock.json" | awk '{print $1}')
[[ "$package_json_source" == "$package_json_copy" && "$package_lock_source" == "$package_lock_copy" ]] || fail 'package manifests differ before dependency copy.'
cp -cR "$ROOT/frontend/node_modules" "$SOURCE/frontend/node_modules" || fail 'APFS copy-on-write dependency clone failed; refusing external links or install fallback.'
package_json_source_after=$(shasum -a 256 "$ROOT/frontend/package.json" | awk '{print $1}')
package_json_after=$(shasum -a 256 "$SOURCE/frontend/package.json" | awk '{print $1}')
package_lock_source_after=$(shasum -a 256 "$ROOT/frontend/package-lock.json" | awk '{print $1}')
package_lock_after=$(shasum -a 256 "$SOURCE/frontend/package-lock.json" | awk '{print $1}')
[[ "$package_json_source" == "$package_json_source_after" && "$package_json_source" == "$package_json_after" ]] || fail 'package.json changed during dependency copy.'
[[ "$package_lock_source" == "$package_lock_source_after" && "$package_lock_source" == "$package_lock_after" ]] || fail 'package-lock.json changed during dependency copy.'
mark "PACKAGE_JSON_MATCH=YES SHA256=$package_json_after"
mark "PACKAGE_LOCK_MATCH=YES SHA256=$package_lock_after"
[[ -d "$WORKSPACE" ]] && mark WORKSPACE_EXISTS=YES || fail 'workspace is absent.'
[[ -d "$SOURCE/frontend/node_modules" ]] && mark NODE_MODULES_EXISTS=YES || fail 'workspace node_modules is absent.'
[[ ! -L "$SOURCE/frontend/node_modules" ]] && mark NODE_MODULES_IS_SYMLINK=NO || fail 'workspace node_modules must not be a symlink.'
NODE_MODULES_REALPATH=$(node -e 'process.stdout.write(require("node:fs").realpathSync(process.argv[1]))' "$SOURCE/frontend/node_modules")
WORKSPACE_REALPATH=$(node -e 'process.stdout.write(require("node:fs").realpathSync(process.argv[1]))' "$WORKSPACE")
case "$NODE_MODULES_REALPATH/" in "$WORKSPACE_REALPATH/"*) mark NODE_MODULES_INSIDE_WORKSPACE=YES ;; *) fail 'canonical node_modules realpath escaped workspace.' ;; esac
mark "NODE_MODULES_REALPATH=$NODE_MODULES_REALPATH"
find "$SOURCE/frontend/node_modules" -type l -print > "$FORENSICS/node-module-links.txt"
while IFS= read -r dependency_link; do
  [[ -n "$dependency_link" ]] || continue
  dependency_realpath=$(node -e 'process.stdout.write(require("node:fs").realpathSync(process.argv[1]))' "$dependency_link") || fail 'dependency tree contains a dangling symlink.'
  case "$dependency_realpath/" in "$WORKSPACE_REALPATH/"*) ;; *) fail 'dependency symlink resolves outside the temporary workspace.' ;; esac
done < "$FORENSICS/node-module-links.txt"

APP_PORT=$(node -e 'const net=require("node:net");const s=net.createServer();s.listen(0,"127.0.0.1",()=>{console.log(s.address().port);s.close()})')
PROVIDER_PORT=$(node -e 'const net=require("node:net");const s=net.createServer();s.listen(0,"127.0.0.1",()=>{console.log(s.address().port);s.close()})')
for candidate in "$APP_PORT" "$PROVIDER_PORT"; do [[ "$candidate" =~ ^[0-9]+$ ]] || fail 'could not select random free local host ports.'; done
ports_seen=' '
for candidate in "$APP_PORT" "$PROVIDER_PORT"; do
  case "$ports_seen" in *" $candidate "*) fail 'random free-port selection collided; refusing to continue.' ;; esac
  ports_seen="$ports_seen$candidate "
done
CONFIG_COPY="$SOURCE/frontend/playwright.config.ts"
cp "$ROOT/frontend/playwright.config.ts" "$CONFIG_COPY"
PLAYWRIGHT_REPORTER="$SOURCE/frontend/culinary-profile-start-reporter.mjs"
generate_reporter > "$PLAYWRIGHT_REPORTER"
node - "$CONFIG_COPY" "$APP_PORT" "$PROVIDER_PORT" <<'NODE'
const fs = require('node:fs');
const file = process.argv[2];
const appPort = process.argv[3];
const providerPort = process.argv[4];
let config = fs.readFileSync(file, 'utf8');
const replacements = [
  ["PORT=3000 HOSTNAME=0.0.0.0", `PORT=${appPort} HOSTNAME=127.0.0.1`],
  ["http://localhost:3000", `http://127.0.0.1:${appPort}`],
  ["http://127.0.0.1:4319", `http://127.0.0.1:${providerPort}`],
  ["reporter: 'html',", "reporter: [['html'], ['./culinary-profile-start-reporter.mjs']],"],
];
for (const [before, after] of replacements) {
  const count = config.split(before).length - 1;
  if (count === 0) throw new Error(`Copied Playwright config did not contain expected literal: ${before}`);
  config = config.split(before).join(after);
}
fs.writeFileSync(file, config);
NODE

DB_USER='profile_e2e'
DB_PASSWORD='isolated_profile_e2e_password'
DB_NAME='profile_e2e'
mark M2_E2E_PRE_INVENTORY_START
if ! save_inventory PRE; then fail 'could not capture private PRE Docker inventory.'; fi
PRE_INVENTORY=$(inventory_values PRE)
emit_inventory_values "$PRE_INVENTORY"
mark M2_E2E_PRE_INVENTORY_COMPLETE
POST_INVENTORY_MATCH='NO'
: > "$FORENSICS/events.log"
mkfifo "$WORKSPACE/events.raw.fifo"
"${DOCKER[@]}" events --filter type=container --filter "label=$LABEL_KEY=$RUN_ID" --format '{{.TimeNano}} {{.Type}} {{.Action}} {{.Actor.ID}} {{.Actor.Attributes.name}}' > "$WORKSPACE/events.raw.fifo" 2>/dev/null &
EVENT_PID=$!
node "$ROOT/scripts/lib/redact-diagnostic-stream.mjs" --input-file "$WORKSPACE/events.raw.fifo" > "$FORENSICS/events.log" &
EVENT_SANITIZER_PID=$!

PG_ARMED=1
if ! PG_ID=$("${DOCKER[@]}" run --pull=never --detach --name "$PG_CONTAINER" --label "$LABEL_KEY=$RUN_ID" \
  --env "POSTGRES_USER=$DB_USER" --env "POSTGRES_PASSWORD=$DB_PASSWORD" --env "POSTGRES_DB=$DB_NAME" \
  --publish '127.0.0.1::5432' --tmpfs '/var/lib/postgresql/data:rw,noexec,nosuid,size=1g' "$PG_IMAGE"); then PG_ID=''; fail 'PostgreSQL container start failed.'; fi
[[ -n "$PG_ID" ]] || fail 'PostgreSQL docker run returned an empty container ID.'
mark "POSTGRES_CONTAINER_CREATED id=$PG_ID"
mark "M2_E2E_POSTGRES_CONTAINER_CREATED id=$PG_ID"
REDIS_ARMED=1
if ! REDIS_ID=$("${DOCKER[@]}" run --pull=never --detach --name "$REDIS_CONTAINER" --label "$LABEL_KEY=$RUN_ID" \
  --publish '127.0.0.1::6379' --tmpfs '/data:rw,noexec,nosuid,size=256m' "$REDIS_IMAGE"); then REDIS_ID=''; fail 'Redis container start failed.'; fi
[[ -n "$REDIS_ID" ]] || fail 'Redis docker run returned an empty container ID.'
mark "REDIS_CONTAINER_CREATED id=$REDIS_ID"
mark "M2_E2E_REDIS_CONTAINER_CREATED id=$REDIS_ID"

verify_tmpfs_mount() {
  local container_id=$1 destination=$2 mounts count=0 filesystem found_destination=''
  mounts=$("${DOCKER[@]}" exec "$container_id" sh -c "while read device mountpoint filesystem options dump pass; do if [ \"\$mountpoint\" = \"$destination\" ]; then printf '%s %s\\n' \"\$filesystem\" \"\$mountpoint\"; fi; done < /proc/mounts")
  while read -r filesystem found_destination; do
    [[ -n "$filesystem" ]] || continue
    ((count += 1))
    [[ "$filesystem" == tmpfs && "$found_destination" == "$destination" ]] || return 1
  done <<< "$mounts"
  [[ "$count" == 1 ]]
}
if verify_tmpfs_mount "$PG_ID" '/var/lib/postgresql/data'; then mark POSTGRES_TMPFS=YES; else mark POSTGRES_TMPFS=NO; fail 'unexpected PostgreSQL tmpfs mount.'; fi
if verify_tmpfs_mount "$REDIS_ID" '/data'; then mark REDIS_TMPFS=YES; else mark REDIS_TMPFS=NO; fail 'unexpected Redis tmpfs mount.'; fi
published_port() {
  local container_id=$1 container_port=$2 published
  published=$("${DOCKER[@]}" port "$container_id" "${container_port}/tcp")
  [[ "$published" == 127.0.0.1:* ]] || return 1
  printf '%s' "${published##*:}"
}
if PG_HOST_PORT=$(published_port "$PG_ID" 5432); then mark POSTGRES_LOOPBACK=YES; else mark POSTGRES_LOOPBACK=NO; fail 'PostgreSQL port is not loopback-only.'; fi
if REDIS_HOST_PORT=$(published_port "$REDIS_ID" 6379); then mark REDIS_LOOPBACK=YES; else mark REDIS_LOOPBACK=NO; fail 'Redis port is not loopback-only.'; fi
mark M2_E2E_POSTGRES_ISOLATION_VERIFIED
mark M2_E2E_REDIS_ISOLATION_VERIFIED

ready=0
for attempt in $(seq 1 60); do
  if "${DOCKER[@]}" exec -e "PGPASSWORD=$DB_PASSWORD" "$PG_ID" pg_isready -h 127.0.0.1 -p 5432 -U "$DB_USER" -d "$DB_NAME" >/dev/null 2>&1; then ready=1; break; fi
  sleep 1
done
[[ "$ready" == 1 ]] || fail 'temporary PostgreSQL did not become ready.'
mark POSTGRES_READY
mark M2_E2E_POSTGRES_READY
ready=0
for attempt in $(seq 1 60); do
  if "${DOCKER[@]}" exec "$REDIS_ID" redis-cli ping 2>/dev/null | grep -qx PONG; then ready=1; break; fi
  sleep 1
done
[[ "$ready" == 1 ]] || fail 'temporary Redis did not become ready.'
mark REDIS_READY
mark M2_E2E_REDIS_READY

mark POSTGRES_PROBE_ENDPOINT=tcp://127.0.0.1:5432
postgres_probe() {
  local label=$1
  if "${DOCKER[@]}" exec -e "PGPASSWORD=$DB_PASSWORD" "$PG_ID" psql -h 127.0.0.1 -p 5432 -U "$DB_USER" -d "$DB_NAME" -tAc 'SELECT 1' | grep -qx 1; then
    mark "$label=YES"
  else
    mark "$label=NO"
    return 1
  fi
}
redis_probe() {
  local label=$1
  if "${DOCKER[@]}" exec "$REDIS_ID" redis-cli ping | grep -qx PONG; then mark "$label=YES"; else mark "$label=NO"; return 1; fi
}
postgres_probe POSTGRES_PRE_MIGRATION_SELECT || fail 'PostgreSQL pre-migration SELECT 1 probe failed.'
redis_probe REDIS_PRE_MIGRATION_PING || fail 'Redis pre-migration PING failed.'

DATABASE_URL="postgresql://${DB_USER}:${DB_PASSWORD}@127.0.0.1:${PG_HOST_PORT}/${DB_NAME}"
REDIS_URL="redis://127.0.0.1:${REDIS_HOST_PORT}/0"
mark MIGRATION_PROCESS_START
mark M2_E2E_MIGRATION_PROCESS_START
mkfifo "$WORKSPACE/migration.raw.fifo" "$WORKSPACE/migration.safe.fifo" "$FORENSICS/migration.log"
env MIGRATIONS_DIR="$SOURCE/db/migrations" DATABASE_URL="$DATABASE_URL" COCINACORE_SEPARATED_DB_LANES_ENABLED=false COCINACORE_SKIP_DOTENV=1 \
  node "$SOURCE/frontend/scripts/run-migrations.js" > "$WORKSPACE/migration.raw.fifo" 2>&1 &
MIGRATION_PID=$!
node "$ROOT/scripts/lib/redact-diagnostic-stream.mjs" --input-file "$WORKSPACE/migration.raw.fifo" > "$WORKSPACE/migration.safe.fifo" &
MIGRATION_SANITIZER_PID=$!
tee "$FORENSICS/migration.trace.log" < "$WORKSPACE/migration.safe.fifo" > "$FORENSICS/migration.log" &
MIGRATION_TEE_PID=$!
mark "M2_E2E_MIGRATION_PROCESS_PID=$MIGRATION_PID"
MIGRATION_ID=0
# MIGRATION_START id= and MIGRATION_OK id= are emitted before wait "$MIGRATION_PID"; migration.log feeds the done loop.
while IFS= read -r migration_line || [[ -n "$migration_line" ]]; do # streamed safe migration.log FIFO
  case "$migration_line" in
    APPLY\ *)
      MIGRATION_ID=$((MIGRATION_ID + 1))
      MIGRATION_ACTIVE=${migration_line#APPLY }
      MIGRATION_ACTIVE=${MIGRATION_ACTIVE%% *}
      mark "MIGRATION_START id=$(printf '%03d' "$MIGRATION_ID") file=$MIGRATION_ACTIVE"
      ;;
    DONE\ *)
      migration_file=${migration_line#DONE }
      migration_file=${migration_file%% *}
      mark "MIGRATION_OK id=$(printf '%03d' "$MIGRATION_ID") file=$migration_file"
      MIGRATION_LAST_COMPLETED=$(printf '%03d' "$MIGRATION_ID"):$migration_file
      MIGRATION_ACTIVE=''
      ;;
    *'Connection terminated unexpectedly'*) mark 'M2_E2E_CONNECTION_TERMINATED_UNEXPECTEDLY' ;;
  esac
done < "$FORENSICS/migration.log"
if wait "$MIGRATION_TEE_PID"; then MIGRATION_TEE_EXIT_CODE=0; else MIGRATION_TEE_EXIT_CODE=$?; sanitization_failed; fi
MIGRATION_TEE_SIGNAL=$(wait_signal "$MIGRATION_TEE_EXIT_CODE")
mark "MIGRATION_TEE_EXIT MIGRATION_TEE_PID=$MIGRATION_TEE_PID MIGRATION_TEE_EXIT_CODE=$MIGRATION_TEE_EXIT_CODE MIGRATION_TEE_SIGNAL=$MIGRATION_TEE_SIGNAL"
MIGRATION_EXIT_CODE=0
wait "$MIGRATION_PID" || MIGRATION_EXIT_CODE=$?
if wait "$MIGRATION_SANITIZER_PID"; then MIGRATION_SANITIZER_EXIT_CODE=0; else MIGRATION_SANITIZER_EXIT_CODE=$?; sanitization_failed; fi
MIGRATION_SANITIZER_SIGNAL=$(wait_signal "$MIGRATION_SANITIZER_EXIT_CODE")
mark "MIGRATION_SANITIZER_EXIT MIGRATION_SANITIZER_PID=$MIGRATION_SANITIZER_PID MIGRATION_SANITIZER_EXIT_CODE=$MIGRATION_SANITIZER_EXIT_CODE MIGRATION_SANITIZER_SIGNAL=$MIGRATION_SANITIZER_SIGNAL"
[[ -n "$MIGRATION_EXIT_CODE" ]] || MIGRATION_EXIT_CODE=0
MIGRATION_SIGNAL=$(wait_signal "$MIGRATION_EXIT_CODE")
mark "MIGRATION_PROCESS_EXIT MIGRATION_PID=$MIGRATION_PID MIGRATION_EXIT_CODE=$MIGRATION_EXIT_CODE MIGRATION_SIGNAL=$MIGRATION_SIGNAL last_completed=$MIGRATION_LAST_COMPLETED active=$MIGRATION_ACTIVE"
mark "M2_E2E_MIGRATION_PROCESS_EXIT MIGRATION_PID=$MIGRATION_PID MIGRATION_EXIT_CODE=$MIGRATION_EXIT_CODE MIGRATION_SIGNAL=$MIGRATION_SIGNAL last_completed=$MIGRATION_LAST_COMPLETED active=$MIGRATION_ACTIVE"
MIGRATION_PID=''; MIGRATION_SANITIZER_PID=''; MIGRATION_TEE_PID=''
if [[ "$MIGRATION_EXIT_CODE" != 0 ]]; then fail 'migration process failed.'; fi
verify_migration_ledger() {
  local source_count ledger_count filename_match=NO migration_file
  find "$SOURCE/db/migrations" -type f -name '[0-9][0-9][0-9]_*.sql' -exec basename {} \; | LC_ALL=C sort > "$FORENSICS/expected_migrations.txt" || {
    mark MIGRATION_SOURCE_COUNT=UNAVAILABLE
    mark MIGRATION_LEDGER_COUNT=UNAVAILABLE
    mark MIGRATION_FILENAME_MATCH=NO
    return 1
  }
  source_count=$(awk 'END { print NR+0 }' "$FORENSICS/expected_migrations.txt")
  mark "MIGRATION_SOURCE_COUNT=$source_count"
  if ! "${DOCKER[@]}" exec -e "PGPASSWORD=$DB_PASSWORD" "$PG_ID" psql -h 127.0.0.1 -p 5432 -U "$DB_USER" -d "$DB_NAME" -tAc "SELECT filename FROM public.schema_migrations ORDER BY filename" > "$FORENSICS/ledger_migrations.txt"; then
    mark MIGRATION_LEDGER_COUNT=UNAVAILABLE
    mark MIGRATION_FILENAME_MATCH=NO
    return 1
  fi
  ledger_count=$(awk 'END { print NR+0 }' "$FORENSICS/ledger_migrations.txt")
  mark "MIGRATION_LEDGER_COUNT=$ledger_count"
  if cmp -s "$FORENSICS/expected_migrations.txt" "$FORENSICS/ledger_migrations.txt"; then
    filename_match=YES
  fi
  mark "MIGRATION_FILENAME_MATCH=$filename_match"
  [[ "$ledger_count" == "$source_count" && "$filename_match" == YES ]] || return 1
  while IFS= read -r migration_file; do
    [[ -n "$migration_file" ]] || continue
    mark "MIGRATION_${migration_file%.sql}=PASS"
  done < "$FORENSICS/expected_migrations.txt"
  mark DB_MIGRATE_VERIFY=PASS
  mark MIGRATION_VERIFY_PASS
}
verify_migration_ledger || fail 'isolated PostgreSQL migration ledger verification failed.'
postgres_probe POSTGRES_POST_MIGRATION_SELECT || fail 'PostgreSQL post-migration SELECT 1 probe failed.'
redis_probe REDIS_PRE_PLAYWRIGHT_PING || fail 'Redis pre-Playwright PING failed.'

cd "$SOURCE/frontend"
PLAYWRIGHT_RAW="$WORKSPACE/playwright-raw.log"
PLAYWRIGHT_SAFE="$FORENSICS/playwright.log"
PLAYWRIGHT_FAILURE_METADATA="$FORENSICS/playwright-failures.jsonl"
: > "$PLAYWRIGHT_FAILURE_METADATA"
chmod 600 "$PLAYWRIGHT_FAILURE_METADATA"
mark PLAYWRIGHT_START
mark M2_E2E_PLAYWRIGHT_START
PLAYWRIGHT_STARTED_FILE="$WORKSPACE/playwright-started-$RUN_ID"
DATABASE_URL="$DATABASE_URL" REDIS_URL="$REDIS_URL" E2E_REDIS_URL="$REDIS_URL" \
AUTH_SECRET='isolated-profile-e2e-auth-secret-only' \
GEMINI_API_KEY='isolated-local-provider-key' GEMINI_BASE_URL="http://127.0.0.1:${PROVIDER_PORT}/v1beta" \
STORAGE_DRIVER='local' LOCAL_UPLOAD_DIR="$WORKSPACE/uploads" \
E2E_PROVIDER_PORT="$PROVIDER_PORT" COCINACORE_ISOLATED_E2E=1 NEXT_TELEMETRY_DISABLED=1 \
PLAYWRIGHT_STARTED_FILE="$PLAYWRIGHT_STARTED_FILE" \
PLAYWRIGHT_FAILURE_METADATA_FILE="$PLAYWRIGHT_FAILURE_METADATA" \
PLAYWRIGHT_ONEND_SENTINEL_PATH="$WORKSPACE/playwright-result-reporter-observed" \
PLAYWRIGHT_SELECTED_SPEC="${PLAYWRIGHT_SPEC##*/}" \
env -u E2E_USER_EMAIL -u E2E_USER_PASSWORD ./node_modules/.bin/playwright test "$PLAYWRIGHT_SPEC" --config=playwright.config.ts > "$PLAYWRIGHT_RAW" 2>&1 &
PLAYWRIGHT_PID=$!
(
  attempt=0
  while [[ "$attempt" -lt 1800 && ! -f "$PLAYWRIGHT_STARTED_FILE" ]] && kill -0 "$PLAYWRIGHT_PID" 2>/dev/null; do
    if [[ -f "$PLAYWRIGHT_STARTED_FILE" ]]; then
      mark PLAYWRIGHT_STARTED=YES
      break
    fi
    attempt=$((attempt + 1))
    sleep 0.1
  done
  if [[ -f "$PLAYWRIGHT_STARTED_FILE" ]]; then
    mark PLAYWRIGHT_STARTED=YES
  else
    mark PLAYWRIGHT_STARTED=NO
  fi
) &
 PLAYWRIGHT_START_WATCHER_PID=$!
PLAYWRIGHT_STARTED=NO
PLAYWRIGHT_EXIT_CODE=0
wait "$PLAYWRIGHT_PID" || PLAYWRIGHT_EXIT_CODE=$?
# Close the watcher/process-exit race without inspecting post-exit reporter output.
if [[ -f "$PLAYWRIGHT_STARTED_FILE" ]]; then PLAYWRIGHT_STARTED=YES; fi
[[ -n "$PLAYWRIGHT_EXIT_CODE" ]] || PLAYWRIGHT_EXIT_CODE=0
PLAYWRIGHT_SIGNAL=$(wait_signal "$PLAYWRIGHT_EXIT_CODE")
mark "PLAYWRIGHT_EXIT PLAYWRIGHT_PID=$PLAYWRIGHT_PID PLAYWRIGHT_EXIT_CODE=$PLAYWRIGHT_EXIT_CODE PLAYWRIGHT_SIGNAL=$PLAYWRIGHT_SIGNAL"
mark "M2_E2E_PLAYWRIGHT_EXIT PLAYWRIGHT_PID=$PLAYWRIGHT_PID PLAYWRIGHT_EXIT_CODE=$PLAYWRIGHT_EXIT_CODE PLAYWRIGHT_SIGNAL=$PLAYWRIGHT_SIGNAL"
PLAYWRIGHT_PID=''
if wait "$PLAYWRIGHT_START_WATCHER_PID"; then PLAYWRIGHT_START_WATCHER_EXIT_CODE=0; else PLAYWRIGHT_START_WATCHER_EXIT_CODE=$?; sanitization_failed; fi
PLAYWRIGHT_START_WATCHER_SIGNAL=$(wait_signal "$PLAYWRIGHT_START_WATCHER_EXIT_CODE")
mark "PLAYWRIGHT_START_WATCHER_EXIT PLAYWRIGHT_START_WATCHER_PID=$PLAYWRIGHT_START_WATCHER_PID PLAYWRIGHT_START_WATCHER_EXIT_CODE=$PLAYWRIGHT_START_WATCHER_EXIT_CODE PLAYWRIGHT_START_WATCHER_SIGNAL=$PLAYWRIGHT_START_WATCHER_SIGNAL"
PLAYWRIGHT_START_WATCHER_PID=''
if ! node "$ROOT/scripts/lib/redact-diagnostic-stream.mjs" < "$PLAYWRIGHT_RAW" > "$PLAYWRIGHT_SAFE"; then
  : > "$PLAYWRIGHT_SAFE"
  sanitization_failed
fi
PLAYWRIGHT_VALIDATED_RESULT=''
PLAYWRIGHT_RESULT_DIAGNOSTIC_FILE="$WORKSPACE/playwright-result-diagnostic.txt"
PLAYWRIGHT_REPORTER_OBSERVED_FILE="$WORKSPACE/playwright-result-reporter-observed"
if ! node - "$PLAYWRIGHT_RAW" "$PLAYWRIGHT_SAFE" "${PLAYWRIGHT_SPEC##*/}" "$PLAYWRIGHT_REPORTER_OBSERVED_FILE" "$PLAYWRIGHT_RESULT_DIAGNOSTIC_FILE" <<'NODE' > "$WORKSPACE/playwright-result.txt"
const fs = require('node:fs');
const rawPath = process.argv[2];
const safePath = process.argv[3];
const selectedSpec = process.argv[4];
const reporterObservedPath = process.argv[5];
const diagnosticPath = process.argv[6];
const allowedSelectedSpecs = new Set(['culinary-profile-connected.spec.ts', 'today-recommendations-connected.spec.ts', 'meal-planner-connected.spec.ts']);
const maxResultCount = 1000;
const maxPrefixCount = maxResultCount + 1;
const statusValues = new Set(['passed', 'failed', 'timedout', 'interrupted']);
const parserOutcomes = new Set(['accepted', 'missing_raw', 'duplicate_raw', 'missing_safe', 'duplicate_safe', 'invalid_format', 'invalid_counts', 'invalid_spec', 'unsafe_input', 'parser_error']);
let rawPrefixCount = 0;
let safePrefixCount = 0;
let parserOutcome = 'parser_error';
try {
  const rawStats = fs.statSync(rawPath);
  const safeStats = fs.statSync(safePath);
  if (rawStats.size > 10 * 1024 * 1024 || safeStats.size > 10 * 1024 * 1024) {
    parserOutcome = 'unsafe_input';
  } else {
    const rawOutput = fs.readFileSync(rawPath, 'utf8');
    const safeOutput = fs.readFileSync(safePath, 'utf8');
    const countPrefixes = (output) => Math.min(maxPrefixCount, output.split(/\r?\n/).filter((line) => line.startsWith('PLAYWRIGHT_RESULT ')).length);
    rawPrefixCount = countPrefixes(rawOutput);
    safePrefixCount = countPrefixes(safeOutput);
    if (!Number.isSafeInteger(rawPrefixCount) || rawPrefixCount < 0 || rawPrefixCount > maxPrefixCount ||
        !Number.isSafeInteger(safePrefixCount) || safePrefixCount < 0 || safePrefixCount > maxPrefixCount) {
      parserOutcome = 'unsafe_input';
    } else if (!allowedSelectedSpecs.has(selectedSpec)) {
      parserOutcome = 'invalid_spec';
    } else if (rawPrefixCount === 0) {
      parserOutcome = 'missing_raw';
    } else if (rawPrefixCount > 1) {
      parserOutcome = 'duplicate_raw';
    } else if (safePrefixCount === 0) {
      parserOutcome = 'missing_safe';
    } else if (safePrefixCount > 1) {
      parserOutcome = 'duplicate_safe';
    } else {
      const resultLines = safeOutput.split(/\r?\n/).filter((line) => line.startsWith('PLAYWRIGHT_RESULT '));
      if (resultLines.length !== 1) parserOutcome = safePrefixCount === 0 ? 'missing_safe' : 'duplicate_safe';
      const match = /^PLAYWRIGHT_RESULT spec=([^ ]+) total=(0|[1-9][0-9]{0,3}) passed=(0|[1-9][0-9]{0,3}) flaky=(0|[1-9][0-9]{0,3}) failed=(0|[1-9][0-9]{0,3}) skipped=(0|[1-9][0-9]{0,3}) status=(passed|failed|timedout|interrupted)$/.exec(resultLines[0]);
      if (!match) {
        parserOutcome = 'invalid_format';
      } else if (match[1] !== selectedSpec || !allowedSelectedSpecs.has(match[1]) || !statusValues.has(match[7])) {
        parserOutcome = 'invalid_spec';
      } else {
        const [total, passed, flaky, failed, skipped] = match.slice(2, 7).map(Number);
        if (![total, passed, flaky, failed, skipped].every(Number.isSafeInteger) ||
            [total, passed, flaky, failed, skipped].some((count) => count > maxResultCount) ||
            total <= 0 || passed + flaky + failed <= 0 || passed + flaky + failed + skipped !== total) {
          parserOutcome = 'invalid_counts';
        } else {
          parserOutcome = 'accepted';
          process.stdout.write(resultLines[0] + '\n');
        }
      }
    }
  }
} catch {
  parserOutcome = 'parser_error';
}
if (!parserOutcomes.has(parserOutcome) || !Number.isSafeInteger(rawPrefixCount) || rawPrefixCount < 0 || rawPrefixCount > maxPrefixCount ||
    !Number.isSafeInteger(safePrefixCount) || safePrefixCount < 0 || safePrefixCount > maxPrefixCount) {
  parserOutcome = 'parser_error';
  rawPrefixCount = 0;
  safePrefixCount = 0;
}
const onEndObserved = fs.existsSync(reporterObservedPath) ? 'YES' : 'NO';
fs.writeFileSync(diagnosticPath,
  `PLAYWRIGHT_RESULT_DIAGNOSTIC on_end=${onEndObserved} raw_prefix_count=${rawPrefixCount} safe_prefix_count=${safePrefixCount} parser=${parserOutcome}\n`,
  { flag: 'wx', mode: 0o600 });
if (parserOutcome !== 'accepted') process.exit(1);
NODE
then
  if IFS= read -r PLAYWRIGHT_RESULT_DIAGNOSTIC < "$PLAYWRIGHT_RESULT_DIAGNOSTIC_FILE" &&
      [[ "$PLAYWRIGHT_RESULT_DIAGNOSTIC" =~ ^PLAYWRIGHT_RESULT_DIAGNOSTIC\ on_end=(YES|NO)\ raw_prefix_count=(0|[1-9][0-9]{0,3}|1001)\ safe_prefix_count=(0|[1-9][0-9]{0,3}|1001)\ parser=(missing_raw|duplicate_raw|missing_safe|duplicate_safe|invalid_format|invalid_counts|invalid_spec|unsafe_input|parser_error)$ ]]; then
    mark "$PLAYWRIGHT_RESULT_DIAGNOSTIC"
  fi
  fail 'Playwright result summary was missing or invalid.'
fi
IFS= read -r PLAYWRIGHT_VALIDATED_RESULT < "$WORKSPACE/playwright-result.txt"
mark "$PLAYWRIGHT_VALIDATED_RESULT"
if [[ "$PLAYWRIGHT_EXIT_CODE" != 0 || "$PLAYWRIGHT_STARTED" != YES || ! -f "$PLAYWRIGHT_STARTED_FILE" ]]; then fail 'guarded Playwright spec failed or onTestBegin start sentinel was not observed.'; fi
