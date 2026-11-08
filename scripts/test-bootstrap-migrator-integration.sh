#!/bin/sh
set -eu

STAGE=initialization
CHECK=initialization
ROOT=
IMAGE='pgvector/pgvector:pg16'
PREFIX=
CONTAINER=
TMP_ROOT=
LOG=
MIGRATION_PASSWORD=
ADMIN_PASSWORD=
PORT=
DB=
ADMIN_URL=
MIGRATION_URL=

expect_vector_error_classification() {
  VECTOR_EXPECTED_CLASS=$1
  VECTOR_TEST_FIXTURE=$2
  printf '%s\n' "$VECTOR_TEST_FIXTURE" > "$VECTOR_DIAGNOSTIC_TEST_LOG"
  VECTOR_ACTUAL_CLASS=$(classify_provisioner_error "$VECTOR_DIAGNOSTIC_TEST_LOG")
  [ "$VECTOR_ACTUAL_CLASS" = "$VECTOR_EXPECTED_CLASS" ] || {
    printf '%s\n' 'vector-unavailable diagnostic self-test failed: error classification' >&2
    return 1
  }
  case "$VECTOR_ACTUAL_CLASS" in
    *REDACTION_SENTINEL*)
      printf '%s\n' 'vector-unavailable diagnostic self-test failed: captured text leaked' >&2
      return 1
      ;;
  esac
}

expect_vector_availability_state() {
  VECTOR_EXPECTED_AVAILABILITY=$2
  VECTOR_ACTUAL_AVAILABILITY=$(normalize_vector_availability "$1")
  [ "$VECTOR_ACTUAL_AVAILABILITY" = "$VECTOR_EXPECTED_AVAILABILITY" ] || {
    printf '%s\n' 'vector-unavailable diagnostic self-test failed: availability mapping' >&2
    return 1
  }
}

cleanup_vector_unavailable_diagnostics_self_test() {
  SELF_TEST_EXIT_STATUS=$?
  trap - EXIT
  SELF_TEST_CLEANUP_STATUS=0
  if [ -n "${REGRESSION_TEST_TMP:-}" ]; then
    rm -rf "$REGRESSION_TEST_TMP" || SELF_TEST_CLEANUP_STATUS=1
  fi
  if [ -n "${VECTOR_DIAGNOSTIC_TEST_TMP:-}" ]; then
    rm -rf "$VECTOR_DIAGNOSTIC_TEST_TMP" || SELF_TEST_CLEANUP_STATUS=1
  fi
  if [ "$SELF_TEST_EXIT_STATUS" -eq 0 ] && [ "$SELF_TEST_CLEANUP_STATUS" -ne 0 ]; then
    SELF_TEST_EXIT_STATUS=$SELF_TEST_CLEANUP_STATUS
  fi
  exit "$SELF_TEST_EXIT_STATUS"
}

vector_unavailable_diagnostics_self_test() {
  REGRESSION_TEST_TMP=
  VECTOR_DIAGNOSTIC_TEST_TMP=$(mktemp -d)
  trap cleanup_vector_unavailable_diagnostics_self_test EXIT
  VECTOR_DIAGNOSTIC_TEST_LOG="$VECTOR_DIAGNOSTIC_TEST_TMP/provisioner.log"
  expect_vector_availability_state t yes
  expect_vector_availability_state f no
  expect_vector_availability_state unexpected query_failed
  expect_vector_error_classification manifest_config:before_connect 'Trusted migration manifest metadata is invalid. REDACTION_SENTINEL'
  expect_vector_error_classification manifest_config:before_connect 'BOOTSTRAP_DATABASE_URL environment variable is required. REDACTION_SENTINEL'
  expect_vector_error_classification manifest_config:before_connect 'MIGRATION_CHECKSUM_MISMATCH: trusted file 001_test.sql REDACTION_SENTINEL'
  expect_vector_error_classification unknown:unknown 'MIGRATION_CHECKSUM_MISMATCH: 001_test.sql REDACTION_SENTINEL'
  expect_vector_error_classification unknown:unknown 'connect ECONNREFUSED REDACTION_SENTINEL'
  expect_vector_error_classification identity_or_lock:connected_preflight 'MIGRATION_IDENTITY_MISMATCH: REDACTION_SENTINEL'
  expect_vector_error_classification identity_or_lock:connected_preflight 'LOCK_TIMEOUT: REDACTION_SENTINEL'
  expect_vector_error_classification role_state:connected_validation 'ROLE_STATE_MISMATCH: REDACTION_SENTINEL'
  expect_vector_error_classification lock_release:connected_cleanup 'Database-change lock release failure. REDACTION_SENTINEL'
  expect_vector_error_classification vector_unavailable:preflight_or_provision_guard 'VECTOR_NOT_AVAILABLE: REDACTION_SENTINEL'
  expect_vector_error_classification unknown:unknown 'unrecognized REDACTION_SENTINEL'

  rename_diagnostic=$(report_vector_control_rename failed 17)
  [ "$rename_diagnostic" = 'integration diagnostic: vector-unavailable control_file_rename=failed exit_code=17' ] || {
    printf '%s\n' 'vector-unavailable diagnostic self-test failed: rename' >&2
    return 1
  }
  result_diagnostic=$(report_vector_provisioner_result 1 yes clear none absent yes vector_unavailable:preflight_or_provision_guard)
  [ "$result_diagnostic" = 'integration diagnostic: vector-unavailable provisioner_exit_code=1 VECTOR_NOT_AVAILABLE=yes sensitive_output=clear roles=none ledger=absent postgres_vector_available=yes error_class_phase=vector_unavailable:preflight_or_provision_guard' ] || {
    printf '%s\n' 'vector-unavailable diagnostic self-test failed: provisioner result' >&2
    return 1
  }
  result_diagnostic=$(report_vector_provisioner_result 1 no clear none absent query_failed unknown:unknown)
  [ "$result_diagnostic" = 'integration diagnostic: vector-unavailable provisioner_exit_code=1 VECTOR_NOT_AVAILABLE=no sensitive_output=clear roles=none ledger=absent postgres_vector_available=query_failed error_class_phase=unknown:unknown' ] || {
    printf '%s\n' 'vector-unavailable diagnostic self-test failed: query-failed result' >&2
    return 1
  }
  result_diagnostic=$(report_vector_provisioner_result 1 no clear none absent no unknown:unknown)
  [ "$result_diagnostic" = 'integration diagnostic: vector-unavailable provisioner_exit_code=1 VECTOR_NOT_AVAILABLE=no sensitive_output=clear roles=none ledger=absent postgres_vector_available=no error_class_phase=unknown:unknown' ] || {
    printf '%s\n' 'vector-unavailable diagnostic self-test failed: unavailable result' >&2
    return 1
  }
  bootstrap_migrator_regression_self_test
  printf '%s\n' 'vector-unavailable diagnostic self-test passed'
}

# Regression-test interfaces for the PM-authorized manifest and verify-complete
# follow-up:
#   manifest_migration_count MANIFEST_PATH -> total manifest migration count
#   classify_verify_error LOG_PATH -> one closed error_class:phase value
#   report_verify_failure LOG_PATH EXIT_CODE -> safe diagnostic; returns EXIT_CODE
bootstrap_migrator_regression_self_test() {
  REGRESSION_TEST_ROOT=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
  REGRESSION_TEST_SCRIPT="$REGRESSION_TEST_ROOT/scripts/test-bootstrap-migrator-integration.sh"
  REGRESSION_TEST_MANIFEST="$REGRESSION_TEST_ROOT/db/migrations/manifest.json"
  REGRESSION_TEST_TMP=$(mktemp -d)
  REGRESSION_TEST_FAILURES=0

  regression_assert() {
    if [ "$1" = yes ]; then return 0; fi
    printf 'bootstrap/migrator regression self-test failed: %s\n' "$2" >&2
    REGRESSION_TEST_FAILURES=$((REGRESSION_TEST_FAILURES + 1))
  }

  if command -v manifest_migration_count >/dev/null 2>&1; then
    REGRESSION_MANIFEST_COUNT=$(manifest_migration_count "$REGRESSION_TEST_MANIFEST")
    REGRESSION_EXPECTED_MANIFEST_COUNT=$(python3 - "$REGRESSION_TEST_MANIFEST" <<'PY'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as manifest_file:
    manifest = json.load(manifest_file)
migrations = manifest.get("migrations") if isinstance(manifest, dict) else None
if not isinstance(migrations, list):
    raise SystemExit("manifest migrations must be a list")
print(len(migrations))
PY
)
    regression_assert "$( [ "$REGRESSION_MANIFEST_COUNT" = "$REGRESSION_EXPECTED_MANIFEST_COUNT" ] && printf yes || printf no )" 'manifest migration count matches parsed entries'
  else
    regression_assert no 'manifest_migration_count interface is defined'
  fi

  REGRESSION_TOTAL_COUNT_LINES=$(awk '
    /^STAGE=initialization$/ { in_main=1 }
    in_main && /select count\(\*\) from/ && /schema_migrations/ && /EXPECTED_MIGRATION_COUNT/ { count++ }
    END { print count+0 }
  ' "$REGRESSION_TEST_SCRIPT")
  regression_assert "$( [ "$REGRESSION_TOTAL_COUNT_LINES" = 3 ] && printf yes || printf no )" 'all three total ledger assertions use the manifest count'
  if awk '
    /^STAGE=initialization$/ { in_main=1 }
    in_main && /select count\(\*\) from/ && /schema_migrations/ && / = 12/ { stale=1 }
    END { exit !stale }
  ' "$REGRESSION_TEST_SCRIPT"; then
    regression_assert no 'total ledger assertions are not hardcoded to 12'
  else
    regression_assert yes 'total ledger assertions are not hardcoded to 12'
  fi
  REGRESSION_BACKFILL_CHECKS=$(grep -Fc 'checksum is not null")" = 10' "$REGRESSION_TEST_SCRIPT" || true)
  regression_assert "$( [ "$REGRESSION_BACKFILL_CHECKS" -gt 1 ] && printf yes || printf no )" 'historical checksum backfill expectation remains 10'
  REGRESSION_DONE_012_CHECKS=$(grep -Fc 'DONE 012_meal_plan_consumption.sql' "$REGRESSION_TEST_SCRIPT" || true)
  regression_assert "$( [ "$REGRESSION_DONE_012_CHECKS" -gt 1 ] && printf yes || printf no )" 'DONE 012 milestone checks remain'
  REGRESSION_DONE_014_CHECKS=$(grep -Fc 'DONE 014' "$REGRESSION_TEST_SCRIPT" || true)
  regression_assert "$( [ "$REGRESSION_DONE_014_CHECKS" -gt 1 ] && printf yes || printf no )" 'DONE 014 full-completion markers are present'

  if command -v classify_verify_error >/dev/null 2>&1; then
    printf '%s\n' 'MIGRATION_IDENTITY_MISMATCH: REDACTION_SENTINEL' >"$REGRESSION_TEST_TMP/known.log"
    REGRESSION_KNOWN_CLASS=$(classify_verify_error "$REGRESSION_TEST_TMP/known.log")
    regression_assert "$( [ "$REGRESSION_KNOWN_CLASS" = 'identity_state:verify_complete' ] && printf yes || printf no )" 'known verify marker maps to its closed class'
    printf '%s\n' 'unknown secret=REGRESSION_SECRET postgresql://private.example/db' >"$REGRESSION_TEST_TMP/unknown.log"
    REGRESSION_UNKNOWN_CLASS=$(classify_verify_error "$REGRESSION_TEST_TMP/unknown.log")
    regression_assert "$( [ "$REGRESSION_UNKNOWN_CLASS" = 'unknown:unknown' ] && printf yes || printf no )" 'unknown verify log maps to unknown'
    case "$REGRESSION_UNKNOWN_CLASS" in
      *REGRESSION_SECRET*|*private.example*|*secret=*) regression_assert no 'verify classifier does not echo sensitive log content' ;;
      *) regression_assert yes 'verify classifier does not echo sensitive log content' ;;
    esac
  else
    regression_assert no 'classify_verify_error interface is defined'
    regression_assert no 'known verify marker maps to its closed class'
    regression_assert no 'unknown verify log maps to unknown'
    regression_assert no 'verify classifier does not echo sensitive log content'
  fi

  if command -v report_verify_failure >/dev/null 2>&1; then
    if report_verify_failure "$REGRESSION_TEST_TMP/unknown.log" 23 >"$REGRESSION_TEST_TMP/report.out"; then
      REGRESSION_REPORT_STATUS=0
    else
      REGRESSION_REPORT_STATUS=$?
    fi
    REGRESSION_REPORT_OUTPUT=$(cat "$REGRESSION_TEST_TMP/report.out")
    regression_assert "$( [ "$REGRESSION_REPORT_STATUS" = 23 ] && printf yes || printf no )" 'safe verify reporter retains the original nonzero status'
    case "$REGRESSION_REPORT_OUTPUT" in
      *unknown*exit_code=23*) regression_assert yes 'verify reporter emits closed class and exit code' ;;
      *) regression_assert no 'verify reporter emits closed class and exit code' ;;
    esac
    case "$REGRESSION_REPORT_OUTPUT" in
      *REGRESSION_SECRET*|*private.example*|*secret=*|*postgresql://*) regression_assert no 'verify reporter never echoes log contents' ;;
      *) regression_assert yes 'verify reporter never echoes log contents' ;;
    esac
  else
    regression_assert no 'report_verify_failure interface is defined'
    regression_assert no 'safe verify reporter retains the original nonzero status'
    regression_assert no 'verify reporter emits closed class and exit code'
    regression_assert no 'verify reporter never echoes log contents'
  fi

  [ "$REGRESSION_TEST_FAILURES" -eq 0 ] || return 1
  printf '%s\n' 'bootstrap/migrator regression self-test passed'
}

vector_log_matches_markers() {
  VECTOR_MARKER_LOG=$1
  shift
  for VECTOR_STATIC_MARKER do
    if grep -Fq "$VECTOR_STATIC_MARKER" "$VECTOR_MARKER_LOG"; then return 0; fi
  done
  return 1
}

manifest_migration_count() {
  node -e '
    const fs = require("fs");
    const manifest = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    if (!manifest || typeof manifest !== "object" || !Array.isArray(manifest.migrations)) {
      process.exit(1);
    }
    process.stdout.write(String(manifest.migrations.length) + "\n");
  ' "$1"
}

classify_verify_error() {
  VERIFY_CLASSIFY_LOG=$1
  if grep -Fq 'MIGRATION_IDENTITY_MISMATCH:' "$VERIFY_CLASSIFY_LOG" 2>/dev/null; then
    printf '%s\n' 'identity_state:verify_complete'
  elif grep -Fq 'ROLE_STATE_MISMATCH:' "$VERIFY_CLASSIFY_LOG" 2>/dev/null; then
    printf '%s\n' 'role_state:verify_complete'
  elif grep -Fq 'MIGRATION_CHECKSUM_MISMATCH:' "$VERIFY_CLASSIFY_LOG" 2>/dev/null; then
    printf '%s\n' 'checksum_state:verify_complete'
  elif grep -Fq 'BASELINE_MISMATCH:' "$VERIFY_CLASSIFY_LOG" 2>/dev/null; then
    printf '%s\n' 'baseline_state:verify_complete'
  elif grep -Fq 'VECTOR_STATE_MISMATCH:' "$VERIFY_CLASSIFY_LOG" 2>/dev/null; then
    printf '%s\n' 'vector_state:verify_complete'
  elif grep -Fq 'Pending migration:' "$VERIFY_CLASSIFY_LOG" 2>/dev/null; then
    printf '%s\n' 'pending_migrations:verify_complete'
  elif grep -Fq 'Migration ledger is missing.' "$VERIFY_CLASSIFY_LOG" 2>/dev/null; then
    printf '%s\n' 'ledger_missing:verify_complete'
  elif grep -Fq 'schema_migrations has an unexpected shape.' "$VERIFY_CLASSIFY_LOG" 2>/dev/null; then
    printf '%s\n' 'ledger_shape:verify_complete'
  else
    printf '%s\n' 'unknown:unknown'
  fi
}

report_verify_failure() {
  VERIFY_FAILURE_CLASS=$(classify_verify_error "$1")
  printf 'integration diagnostic: verify-complete error_class_phase=%s exit_code=%s\n' "$VERIFY_FAILURE_CLASS" "$2"
  return "$2"
}

classify_provisioner_error() {
  VECTOR_CLASSIFY_LOG=$1
  if vector_log_matches_markers "$VECTOR_CLASSIFY_LOG" 'VECTOR_NOT_AVAILABLE:'; then
    printf '%s\n' 'vector_unavailable:preflight_or_provision_guard'
  elif vector_log_matches_markers "$VECTOR_CLASSIFY_LOG" \
    'MIGRATION_IDENTITY_MISMATCH:' \
    'LOCK_TIMEOUT:' \
    'MIGRATION_LOCK_TIMEOUT_MS must be an integer between'; then
    printf '%s\n' 'identity_or_lock:connected_preflight'
  elif vector_log_matches_markers "$VECTOR_CLASSIFY_LOG" 'Database-change lock release failure.'; then
    printf '%s\n' 'lock_release:connected_cleanup'
  elif vector_log_matches_markers "$VECTOR_CLASSIFY_LOG" 'ROLE_STATE_MISMATCH:'; then
    printf '%s\n' 'role_state:connected_validation'
  elif vector_log_matches_markers "$VECTOR_CLASSIFY_LOG" \
    'COCINACORE_SEPARATED_DB_LANES_ENABLED must be an explicit true or false value.' \
    'BOOTSTRAP_DATABASE_URL environment variable is required.' \
    'MIGRATION_ADMIN_PASSWORD environment variable is required.' \
    'MIGRATION_ADMIN_PASSWORD must contain at least 24 characters.' \
    'Trusted migration manifest is unreadable:' \
    'Trusted migration manifest metadata is invalid.' \
    'Trusted migration lock contract is invalid.' \
    'Trusted migration manifest structure is invalid.' \
    'Trusted managed-schema/bootstrap declaration is invalid.' \
    'Trusted ownership allowlist must contain exactly' \
    'Trusted manifest migration ordering is invalid at' \
    'Trusted manifest contains a duplicate migration:' \
    'Trusted manifest migration metadata is invalid:' \
    'Trusted historical migration metadata is invalid:' \
    'Historical migration cannot declare catalog additions:' \
    'Trusted catalog additions are invalid:' \
    'Trusted catalog addition is unsupported:' \
    'Duplicate trusted catalog addition:' \
    'MIGRATION_CHECKSUM_MISMATCH: trusted file' \
    'Trusted historical migration baseline is incomplete.' \
    'Migration manifest and SQL files are not an exact bijection.' \
    'Trusted ownership target is malformed.' \
    'Duplicate trusted ownership target:' \
    'Trusted legacy owner policy is invalid:' \
    'Trusted catalog inventory counts are invalid.' \
    'Trusted role or schema ACL contract is invalid.' \
    'Trusted role declaration is invalid:' \
    'Trusted role membership/privilege declaration is invalid.' \
    'Trusted extension declaration is invalid:' \
    'Trusted vector capability declaration is invalid.'; then
    printf '%s\n' 'manifest_config:before_connect'
  else
    printf '%s\n' 'unknown:unknown'
  fi
}

normalize_vector_availability() {
  case "$1" in
    t) printf '%s\n' yes ;;
    f) printf '%s\n' no ;;
    *) printf '%s\n' query_failed ;;
  esac
}

report_vector_control_rename() {
  printf 'integration diagnostic: vector-unavailable control_file_rename=%s exit_code=%s\n' "$1" "$2"
}

report_vector_provisioner_result() {
  printf 'integration diagnostic: vector-unavailable provisioner_exit_code=%s VECTOR_NOT_AVAILABLE=%s sensitive_output=%s roles=%s ledger=%s postgres_vector_available=%s error_class_phase=%s\n' "$1" "$2" "$3" "$4" "$5" "$6" "$7"
}

if [ "${VECTOR_UNAVAILABLE_DIAGNOSTICS_SELF_TEST:-}" = yes ]; then
  vector_unavailable_diagnostics_self_test
  exit $?
fi

set_check() {
  if [ "$CHECK" != "$1" ]; then
    CHECK=$1
    printf 'integration check: %s\n' "$CHECK" >&2
  fi
}

cleanup() {
  status=$?
  if [ "$status" -ne 0 ]; then
    printf 'integration failure: stage=%s check=%s status=%s\n' "$STAGE" "$CHECK" "$status" >&2
  fi
  if [ -n "$CONTAINER" ]; then docker rm -fv "$CONTAINER" >/dev/null 2>&1 || true; fi
  if [ -n "$PREFIX" ]; then
    for leftover in $(docker ps -a --format '{{.Names}}' | grep "^$PREFIX" || true); do
      docker rm -fv "$leftover" >/dev/null 2>&1 || true
    done
  fi
  if [ -n "$TMP_ROOT" ]; then rm -rf "$TMP_ROOT"; fi
  return "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

STAGE=initialization
CHECK=initialization
printf '%s\n' 'integration stage: initialization' >&2
printf '%s\n' 'integration check: initialization' >&2
ROOT=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
EXPECTED_MIGRATION_COUNT=$(manifest_migration_count "$ROOT/db/migrations/manifest.json")
PREFIX="cocinacore-pr0a-cp21-$$"
TMP_ROOT=$(mktemp -d)
LOG="$TMP_ROOT/operation.log"
MIGRATION_PASSWORD=$(openssl rand -hex 18)
ADMIN_PASSWORD=$(openssl rand -hex 18)

fail() {
  exit 1
}

start_container() {
  suffix=$1
  DB=$2
  CONTAINER="$PREFIX-$suffix"
  docker run -d --name "$CONTAINER" \
    -e POSTGRES_DB="$DB" -e POSTGRES_USER=cocinacore -e POSTGRES_PASSWORD="$ADMIN_PASSWORD" \
    -p 127.0.0.1::5432 "$IMAGE" >/dev/null
  attempt=0
  until docker exec "$CONTAINER" pg_isready -h 127.0.0.1 -U cocinacore -d "$DB" >/dev/null 2>&1; do
    attempt=$((attempt + 1)); [ "$attempt" -lt 60 ] || fail 'PostgreSQL did not become ready'; sleep 1
  done
  admin_sql "$DB" 'create role cocinacore_user nologin nosuperuser nobypassrls'
  PORT=$(docker port "$CONTAINER" 5432/tcp | sed 's/.*://')
  ADMIN_URL="postgresql://cocinacore:$ADMIN_PASSWORD@127.0.0.1:$PORT/$DB"
  MIGRATION_URL="postgresql://migration_admin:$MIGRATION_PASSWORD@127.0.0.1:$PORT/$DB"
}

stop_container() {
  docker rm -fv "$CONTAINER" >/dev/null
  CONTAINER=
}

admin_sql() {
  database=$1; shift
  docker exec -i "$CONTAINER" psql -X -v ON_ERROR_STOP=1 -U cocinacore -d "$database" -Atqc "$*"
}

migrator_sql() {
  database=$1; shift
  docker exec -e PGPASSWORD="$MIGRATION_PASSWORD" -i "$CONTAINER" \
    psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -U migration_admin -d "$database" -Atqc "$*"
}

provision() {
  COCINACORE_SEPARATED_DB_LANES_ENABLED=true \
  BOOTSTRAP_DATABASE_URL="$ADMIN_URL" MIGRATION_ADMIN_PASSWORD="$MIGRATION_PASSWORD" \
  node "$ROOT/frontend/scripts/provision-database.js"
}

migrate() {
  COCINACORE_SEPARATED_DB_LANES_ENABLED=true MIGRATION_DATABASE_URL="$MIGRATION_URL" \
  node "$ROOT/frontend/scripts/run-migrations.js" --lane migration "$@"
}

migrate_m5_pending() {
  COCINACORE_SEPARATED_DB_LANES_ENABLED=true MIGRATION_DATABASE_URL="$MIGRATION_URL" \
  MIGRATION_EXPECTED_PENDING='018_cooking_sessions.sql,019_real_consumption_reconciliation.sql' \
  node "$ROOT/frontend/scripts/run-migrations.js" --lane migration
}

expect_provision_failure() {
  expected=$1
  if COCINACORE_SEPARATED_DB_LANES_ENABLED=true \
     BOOTSTRAP_DATABASE_URL="$ADMIN_URL" MIGRATION_ADMIN_PASSWORD="$MIGRATION_PASSWORD" \
     node "$ROOT/frontend/scripts/provision-database.js" >"$LOG" 2>&1; then
    provisioner_exit_code=0
  else
    provisioner_exit_code=$?
  fi
  if [ "${2:-}" = vector-unavailable-diagnostic ]; then
    VECTOR_PROVISIONER_EXIT_CODE=$provisioner_exit_code
    if grep -Fq -- "$expected" "$LOG"; then VECTOR_NOT_AVAILABLE_DETECTED=yes; else VECTOR_NOT_AVAILABLE_DETECTED=no; fi
    if grep -Fq "$ADMIN_PASSWORD" "$LOG" || grep -Fq "$MIGRATION_PASSWORD" "$LOG"; then
      VECTOR_SENSITIVE_OUTPUT=detected
    else
      VECTOR_SENSITIVE_OUTPUT=clear
    fi
    VECTOR_ERROR_CLASS_PHASE=$(classify_provisioner_error "$LOG")
    return 0
  fi
  [ "$provisioner_exit_code" -ne 0 ] || fail "provisioner accepted failure case $expected"
  grep -q "$expected" "$LOG" || fail "provisioner did not report $expected"
  grep -Fq "$ADMIN_PASSWORD" "$LOG" && fail 'administrator secret was logged'
  grep -Fq "$MIGRATION_PASSWORD" "$LOG" && fail 'migration secret was logged'
  return 0
}

make_fixture() {
  target=$1; suffix=$2; source=$3
  mkdir -p "$target"
  cp "$ROOT"/db/migrations/*.sql "$target/"
  cp "$ROOT/db/migrations/manifest.json" "$target/manifest.json"
  GENERATED_FIXTURE_FILENAME=$(python3 - "$target/manifest.json" "$target" "$suffix" "$source" <<'PY'
import hashlib, json, pathlib, sys
manifest_path, target, suffix, source = map(pathlib.Path, sys.argv[1:])
manifest=json.loads(manifest_path.read_text())
fixture_id=f"{int(manifest['migrations'][-1]['id'])+1:03d}"
filename=f"{fixture_id}_{suffix.name}"
migration_path=target / filename
data=source.read_bytes()
migration_path.write_bytes(data)
manifest['migrations'].append({
  'id':fixture_id,'filename':filename,'lane':'migration','sha256':hashlib.sha256(data).hexdigest(),
  'byteLength':len(data),'transactional':'required','legacyChecksumBackfillAllowed':False
})
manifest_path.write_text(json.dumps(manifest,indent=2)+'\n')
print(filename)
PY
  )
}

# ---------------------------------------------------------------------------
# Fresh installation, extension boundary, activation, SQL policy, and locks.
# ---------------------------------------------------------------------------
STAGE=fresh-install
set_check startup
printf '%s\n' 'integration stage: fresh-install' >&2
start_container fresh cocinacore_fresh

# Unavailable vector fails before roles, ledger, or migrations exist.
set_check vector-unavailable
if SHARE_DIR=$(docker exec "$CONTAINER" pg_config --sharedir 2>/dev/null); then
  if [ -z "$SHARE_DIR" ]; then
    printf '%s\n' 'integration diagnostic: vector-unavailable sharedir_lookup=empty' >&2
    fail 'could not determine PostgreSQL shared directory'
  fi
else
  sharedir_exit_code=$?
  printf 'integration diagnostic: vector-unavailable sharedir_lookup=failed exit_code=%s\n' "$sharedir_exit_code" >&2
  fail 'could not determine PostgreSQL shared directory'
fi
if docker exec "$CONTAINER" mv "$SHARE_DIR/extension/vector.control" "$SHARE_DIR/extension/vector.control.cp21" >/dev/null 2>&1; then
  report_vector_control_rename ok 0 >&2
else
  rename_exit_code=$?
  report_vector_control_rename failed "$rename_exit_code" >&2
  fail 'could not rename vector.control for unavailable-vector check'
fi
if vector_available_query=$(admin_sql "$DB" "select exists (select 1 from pg_available_extension_versions where name = 'vector')" 2>/dev/null); then
  POSTGRES_VECTOR_AVAILABLE=$(normalize_vector_availability "$vector_available_query")
else
  POSTGRES_VECTOR_AVAILABLE=query_failed
fi
printf 'integration diagnostic: vector-unavailable postgres_vector_available_after_rename=%s\n' "$POSTGRES_VECTOR_AVAILABLE" >&2
expect_provision_failure VECTOR_NOT_AVAILABLE vector-unavailable-diagnostic
if reserved_roles_count=$(admin_sql "$DB" "select count(*) from pg_roles where rolname in ('migration_admin','cocinacore_schema_owner')" 2>/dev/null); then
  if [ "$reserved_roles_count" = 0 ]; then VECTOR_ROLES_STATE=none; else VECTOR_ROLES_STATE=unexpected; fi
else
  VECTOR_ROLES_STATE=query_failed
fi
if ledger_is_null=$(admin_sql "$DB" "select to_regclass('public.schema_migrations') is null" 2>/dev/null); then
  case "$ledger_is_null" in
    t) VECTOR_LEDGER_STATE=absent ;;
    f) VECTOR_LEDGER_STATE=unexpected ;;
    *) VECTOR_LEDGER_STATE=query_failed ;;
  esac
else
  VECTOR_LEDGER_STATE=query_failed
fi
report_vector_provisioner_result "$VECTOR_PROVISIONER_EXIT_CODE" "$VECTOR_NOT_AVAILABLE_DETECTED" "$VECTOR_SENSITIVE_OUTPUT" "$VECTOR_ROLES_STATE" "$VECTOR_LEDGER_STATE" "$POSTGRES_VECTOR_AVAILABLE" "$VECTOR_ERROR_CLASS_PHASE" >&2
[ "$VECTOR_PROVISIONER_EXIT_CODE" -ne 0 ] || fail 'provisioner accepted failure case VECTOR_NOT_AVAILABLE'
[ "$VECTOR_NOT_AVAILABLE_DETECTED" = yes ] || fail 'provisioner did not report VECTOR_NOT_AVAILABLE'
[ "$VECTOR_SENSITIVE_OUTPUT" = clear ] || fail 'provisioner logged a secret'
[ "$VECTOR_ROLES_STATE" = none ] || fail 'unavailable vector created roles'
[ "$VECTOR_LEDGER_STATE" = absent ] || fail 'unavailable vector created ledger'
if docker exec "$CONTAINER" mv "$SHARE_DIR/extension/vector.control.cp21" "$SHARE_DIR/extension/vector.control" >/dev/null 2>&1; then
  printf '%s\n' 'integration diagnostic: vector-unavailable control_file_restore=ok' >&2
else
  restore_exit_code=$?
  printf 'integration diagnostic: vector-unavailable control_file_restore=failed exit_code=%s\n' "$restore_exit_code" >&2
  fail 'could not restore vector.control after unavailable-vector check'
fi

# Wrong installed vector state fails closed and is not repaired.
set_check vector-mismatch
admin_sql "$DB" "create schema vector_wrong; create extension vector with schema vector_wrong"
expect_provision_failure VECTOR_STATE_MISMATCH
[ "$(admin_sql "$DB" "select n.nspname from pg_extension e join pg_namespace n on n.oid=e.extnamespace where e.extname='vector'")" = vector_wrong ] || fail 'wrong vector schema was repaired'
[ "$(admin_sql "$DB" "select count(*) from pg_roles where rolname in ('migration_admin','cocinacore_schema_owner')")" = 0 ] || fail 'wrong vector state created roles'
admin_sql "$DB" 'drop extension vector; drop schema vector_wrong'

set_check provision
provision >"$LOG" 2>&1
grep -q 'trusted ownership are provisioned' "$LOG" || fail 'fresh bootstrap did not finish'
[ "$(admin_sql "$DB" "select n.nspname||','||r.rolname||','||r.rolsuper from pg_extension e join pg_namespace n on n.oid=e.extnamespace join pg_roles r on r.oid=e.extowner where e.extname='vector'")" = 'public,cocinacore,true' ] || fail 'fresh vector state is invalid'
[ "$(admin_sql "$DB" "select count(*) from pg_extension where extname='pgcrypto'")" = 0 ] || fail 'bootstrap preinstalled pgcrypto'
[ "$(admin_sql "$DB" "select n.nspname from pg_extension e join pg_namespace n on n.oid=e.extnamespace where e.extname='plpgsql'")" = pg_catalog ] || fail 'plpgsql attestation failed'

# Exact rerun before migrations is a safe no-op, including credential state.
set_check provision-rerun
VECTOR_OID=$(admin_sql "$DB" "select oid from pg_extension where extname='vector'")
PASSWORD_BEFORE=$(admin_sql "$DB" "select rolpassword from pg_authid where rolname='migration_admin'")
provision >"$LOG" 2>&1
[ "$(admin_sql "$DB" "select oid from pg_extension where extname='vector'")" = "$VECTOR_OID" ] || fail 'rerun replaced vector extension'
[ "$(admin_sql "$DB" "select rolpassword from pg_authid where rolname='migration_admin'")" = "$PASSWORD_BEFORE" ] || fail 'rerun rotated migration password'

# The restricted actor cannot install vector in another prepared database.
set_check role-ownership
admin_sql "$DB" 'create database vector_denied'
admin_sql vector_denied "alter schema public owner to cocinacore_schema_owner; grant create on database vector_denied to cocinacore_schema_owner"
if migrator_sql vector_denied 'set role cocinacore_schema_owner; create extension vector with schema public' >"$LOG" 2>&1; then
  fail 'migration actor installed vector'
fi
grep -Eq 'permission denied|Must be superuser' "$LOG" || fail 'vector denial was not a privilege denial'
admin_sql "$DB" 'drop database vector_denied'

# Explicit bootstrap preinstall makes unchanged 001 safe; pgcrypto remains migration-owned.
set_check migration-apply
migrate >"$LOG" 2>&1
set_check migration-marker
grep -q 'DONE 012_meal_plan_consumption.sql' "$LOG" || fail 'fresh migration did not reach milestone 012'
grep -q 'DONE 014_culinary_profile_field_constraints.sql' "$LOG" || fail 'fresh migration did not complete manifest migration 014'
set_check verify-complete
if migrate --verify-complete >"$LOG" 2>&1; then
  :
else
  VERIFY_EXIT_CODE=$?
  report_verify_failure "$LOG" "$VERIFY_EXIT_CODE" >&2 || true
  exit "$VERIFY_EXIT_CODE"
fi
set_check verify-marker
grep -q 'Migration ledger is complete' "$LOG" || fail 'fresh completeness verification failed'
set_check ledger-count
[ "$(admin_sql "$DB" "select count(*) from public.schema_migrations")" = "$EXPECTED_MIGRATION_COUNT" ] || fail 'fresh ledger count does not match manifest'
set_check schema-ownership
[ "$(admin_sql "$DB" "select count(*) from pg_constraint where conrelid='public.users'::regclass and conname='users_email_canonical_check'")" = 1 ] || fail 'forward canonical constraint is missing'
[ "$(admin_sql "$DB" "select pg_get_userbyid(extowner) from pg_extension where extname='pgcrypto'")" = cocinacore_schema_owner ] || fail 'pgcrypto was not created by schema owner'
[ "$(admin_sql "$DB" "select pg_get_userbyid(relowner) from pg_class where oid='public.tenants'::regclass")" = cocinacore_schema_owner ] || fail 'fresh objects are not schema-owner owned'

# Established ledgers accept only a checksummed continuous manifest prefix.
set_check provision-ledger
CHECKSUM_010=$(admin_sql "$DB" "select checksum from schema_migrations where filename='010_password_reset_tokens.sql'")
CHECKSUM_011=$(admin_sql "$DB" "select checksum from schema_migrations where filename='011_canonical_email_invariant.sql'")
admin_sql "$DB" "delete from schema_migrations where filename='010_password_reset_tokens.sql'"
expect_provision_failure 'Established ledger migration prefix'
admin_sql "$DB" "insert into schema_migrations(filename,checksum) values ('010_password_reset_tokens.sql','$CHECKSUM_010')"
admin_sql "$DB" "update schema_migrations set checksum=repeat('0',64) where filename='011_canonical_email_invariant.sql'"
expect_provision_failure MIGRATION_CHECKSUM_MISMATCH
admin_sql "$DB" "update schema_migrations set checksum='$CHECKSUM_011' where filename='011_canonical_email_invariant.sql'"
admin_sql "$DB" "insert into schema_migrations(filename,checksum) values ('999_unknown.sql',repeat('0',64))"
expect_provision_failure 'Established ledger migration prefix'
admin_sql "$DB" "delete from schema_migrations where filename='999_unknown.sql'"

# Malformed extension membership is detected, while extension members remain outside app adoption.
set_check role-ownership
VECTOR_OPERATOR=$(admin_sql "$DB" "select d.objid from pg_extension e join pg_depend d on d.refclassid='pg_extension'::regclass and d.refobjid=e.oid and d.deptype='e' where e.extname='vector' and d.classid='pg_operator'::regclass order by d.objid limit 1")
admin_sql "$DB" "delete from pg_depend where refclassid='pg_extension'::regclass and refobjid=(select oid from pg_extension where extname='vector') and deptype='e' and classid='pg_operator'::regclass and objid=$VECTOR_OPERATOR"
expect_provision_failure 'extension vector membership is outside policy'
admin_sql "$DB" "insert into pg_depend(classid,objid,objsubid,refclassid,refobjid,refobjsubid,deptype) values ('pg_operator'::regclass,$VECTOR_OPERATOR,0,'pg_extension'::regclass,(select oid from pg_extension where extname='vector'),0,'e')"
provision >"$LOG" 2>&1

# Exact extension identity detects same-count substitution, not only cardinality drift.
admin_sql "$DB" 'create function public.cp21_fake_vector_member() returns integer language sql as $$select 1$$'
admin_sql "$DB" "delete from pg_depend where refclassid='pg_extension'::regclass and refobjid=(select oid from pg_extension where extname='vector') and deptype='e' and classid='pg_operator'::regclass and objid=$VECTOR_OPERATOR;
insert into pg_depend(classid,objid,objsubid,refclassid,refobjid,refobjsubid,deptype)
values ('pg_proc'::regclass,'public.cp21_fake_vector_member()'::regprocedure,0,'pg_extension'::regclass,(select oid from pg_extension where extname='vector'),0,'e')"
expect_provision_failure 'extension vector membership is outside policy'
admin_sql "$DB" "delete from pg_depend where refclassid='pg_extension'::regclass and refobjid=(select oid from pg_extension where extname='vector') and deptype='e' and classid='pg_proc'::regclass and objid='public.cp21_fake_vector_member()'::regprocedure;
insert into pg_depend(classid,objid,objsubid,refclassid,refobjid,refobjsubid,deptype)
values ('pg_operator'::regclass,$VECTOR_OPERATOR,0,'pg_extension'::regclass,(select oid from pg_extension where extname='vector'),0,'e')"
admin_sql "$DB" 'drop function public.cp21_fake_vector_member()'

# Reserved roles cannot own or receive authority in rogue non-system schemas.
admin_sql "$DB" 'create schema cp21_rogue authorization migration_admin'
expect_provision_failure ROLE_STATE_MISMATCH
admin_sql "$DB" 'alter schema cp21_rogue owner to cocinacore; drop schema cp21_rogue'
admin_sql "$DB" 'create schema cp21_rogue; create type cp21_rogue.forbidden_enum as enum ($$forbidden$$); alter type cp21_rogue.forbidden_enum owner to migration_admin'
expect_provision_failure ROLE_STATE_MISMATCH
admin_sql "$DB" 'alter type cp21_rogue.forbidden_enum owner to cocinacore; drop schema cp21_rogue cascade'

# Independent runner rejects direct migration_admin database-object authority drift.
admin_sql "$DB" 'create schema cp21_runner_rogue; grant usage on schema cp21_runner_rogue to migration_admin'
if COCINACORE_SEPARATED_DB_LANES_ENABLED=true MIGRATION_DATABASE_URL="$MIGRATION_URL" \
   node "$ROOT/frontend/scripts/run-migrations.js" --lane migration --verify-complete >"$LOG" 2>&1; then
  fail 'runner accepted direct database-object authority drift'
fi
grep -q ROLE_STATE_MISMATCH "$LOG" || fail 'runner authority-drift failure was not explicit'
admin_sql "$DB" 'revoke usage on schema cp21_runner_rogue from migration_admin; drop schema cp21_runner_rogue'
admin_sql "$DB" 'create schema cp21_runner_rogue; grant usage on schema cp21_runner_rogue to cocinacore_schema_owner'
if COCINACORE_SEPARATED_DB_LANES_ENABLED=true MIGRATION_DATABASE_URL="$MIGRATION_URL" \
   node "$ROOT/frontend/scripts/run-migrations.js" --lane migration --verify-complete >"$LOG" 2>&1; then
  fail 'runner accepted schema-owner direct ACL drift'
fi
grep -q ROLE_STATE_MISMATCH "$LOG" || fail 'runner schema-owner drift failure was not explicit'
admin_sql "$DB" 'revoke usage on schema cp21_runner_rogue from cocinacore_schema_owner; drop schema cp21_runner_rogue'
admin_sql "$DB" 'create role cp21_foreign_owner; alter table public.tenants owner to cp21_foreign_owner'
if COCINACORE_SEPARATED_DB_LANES_ENABLED=true MIGRATION_DATABASE_URL="$MIGRATION_URL" \
   node "$ROOT/frontend/scripts/run-migrations.js" --lane migration --verify-complete >"$LOG" 2>&1; then
  fail 'runner accepted missing schema-owner manifest ownership'
fi
grep -q ROLE_STATE_MISMATCH "$LOG" || fail 'runner missing-owner failure was not explicit'
admin_sql "$DB" 'alter table public.tenants owner to cocinacore_schema_owner; drop role cp21_foreign_owner'

# Activation failure matrix.
set_check activation
if COCINACORE_SEPARATED_DB_LANES_ENABLED=true \
   node "$ROOT/frontend/scripts/run-migrations.js" --lane migration >"$LOG" 2>&1; then
  fail 'enabled runner accepted missing MIGRATION_DATABASE_URL'
fi
grep -q 'MIGRATION_DATABASE_URL environment variable is required' "$LOG" || fail 'missing migration secret failure was not explicit'
if COCINACORE_SEPARATED_DB_LANES_ENABLED=true MIGRATION_DATABASE_URL="$ADMIN_URL" \
   node "$ROOT/frontend/scripts/run-migrations.js" --lane migration --verify-complete >"$LOG" 2>&1; then
  fail 'enabled runner accepted the wrong identity'
fi
grep -q 'MIGRATION_IDENTITY_MISMATCH' "$LOG" || fail 'wrong migration identity failure was not explicit'
migrate --verify-complete >"$LOG" 2>&1

# Disabled/default mode retains the legacy DATABASE_URL path without privileged inputs.
admin_sql "$DB" 'create database legacy_disabled'
DISABLED_URL="postgresql://cocinacore:$ADMIN_PASSWORD@127.0.0.1:$PORT/legacy_disabled"
DATABASE_URL="$DISABLED_URL" node "$ROOT/frontend/scripts/run-migrations.js" --lane migration >"$LOG" 2>&1
grep -q 'DONE 012_meal_plan_consumption.sql' "$LOG" || fail 'missing-gate legacy mode did not reach milestone 012'
grep -q 'DONE 014_culinary_profile_field_constraints.sql' "$LOG" || fail 'missing-gate legacy mode did not complete manifest migration 014'
COCINACORE_SEPARATED_DB_LANES_ENABLED=false DATABASE_URL="$DISABLED_URL" \
node "$ROOT/frontend/scripts/run-migrations.js" --lane migration --verify-complete >"$LOG" 2>&1
grep -q 'Migration ledger is complete' "$LOG" || fail 'false-gate legacy mode failed'
admin_sql "$DB" 'drop database legacy_disabled'

# Role attributes and least-privilege boundaries.
set_check role-ownership
[ "$(admin_sql "$DB" "select rolcanlogin||','||rolinherit||','||rolsuper||','||rolcreatedb||','||rolcreaterole||','||rolreplication||','||rolbypassrls||','||rolconnlimit||','||(rolvaliduntil is null)||','||(rolconfig is null) from pg_roles where rolname='migration_admin'")" = 'true,false,false,false,false,false,false,-1,true,true' ] || fail 'migration_admin attributes drifted'
[ "$(admin_sql "$DB" "select rolcanlogin||','||rolinherit||','||rolsuper||','||rolcreatedb||','||rolcreaterole||','||rolreplication||','||rolbypassrls||','||rolconnlimit||','||(rolvaliduntil is null)||','||(rolconfig is null) from pg_roles where rolname='cocinacore_schema_owner'")" = 'false,false,false,false,false,false,false,-1,true,true' ] || fail 'schema owner attributes drifted'
if migrator_sql "$DB" 'create role forbidden_role' >"$LOG" 2>&1; then fail 'migration_admin created a role'; fi
if migrator_sql "$DB" 'set role cocinacore' >"$LOG" 2>&1; then fail 'migration_admin assumed bootstrap actor'; fi
[ "$(migrator_sql "$DB" "select current_user; set role cocinacore_schema_owner; select current_user")" = "migration_admin
cocinacore_schema_owner" ] || fail 'schema-owner SET ROLE contract failed'

# Negative catalog tests fail before mutation on an established DB.
admin_sql "$DB" 'create table public.unexpected_table_cp21(id integer)'
expect_provision_failure 'Managed table set mismatch'
[ "$(admin_sql "$DB" "select pg_get_userbyid(relowner) from pg_class where oid='public.unexpected_table_cp21'::regclass")" = cocinacore ] || fail 'unexpected table was adopted'
admin_sql "$DB" 'drop table public.unexpected_table_cp21'
admin_sql "$DB" "create function public.unexpected_function_cp21() returns integer language sql as 'select 1'"
expect_provision_failure 'Managed function set mismatch'
[ "$(admin_sql "$DB" "select pg_get_userbyid(proowner) from pg_proc where oid='public.unexpected_function_cp21()'::regprocedure")" = cocinacore ] || fail 'unexpected function was adopted'
admin_sql "$DB" 'drop function public.unexpected_function_cp21()'

# Role state drift always fails before repair/mutation.
admin_sql "$DB" 'alter role migration_admin connection limit 4'
expect_provision_failure ROLE_STATE_MISMATCH
admin_sql "$DB" 'alter role migration_admin connection limit -1'
admin_sql "$DB" "alter role migration_admin set statement_timeout='5s'"
expect_provision_failure ROLE_STATE_MISMATCH
admin_sql "$DB" 'alter role migration_admin reset statement_timeout'
admin_sql "$DB" "alter role migration_admin in database $DB set statement_timeout='5s'"
expect_provision_failure ROLE_STATE_MISMATCH
admin_sql "$DB" "alter role migration_admin in database $DB reset statement_timeout"
admin_sql "$DB" 'create role membership_drift; grant membership_drift to migration_admin'
expect_provision_failure 'unexpected memberships'
admin_sql "$DB" 'revoke membership_drift from migration_admin; drop role membership_drift'

# SQL analyzer fixtures are validated before any connection.
STAGE=sql-analyzer
set_check sql-analyzer
printf '%s\n' 'integration stage: sql-analyzer' >&2
printf '%s\n' 'begin;' >"$TMP_ROOT/begin.sql"
printf '%s\n' 'commit;' >"$TMP_ROOT/commit.sql"
printf '%s\n' 'create index concurrently cp21_idx on public.tenants(id);' >"$TMP_ROOT/concurrently.sql"
printf '%s\n' 'vacuum public.tenants;' >"$TMP_ROOT/vacuum.sql"
printf '%s\n' 'release migration_savepoint;' >"$TMP_ROOT/release.sql"
printf '%s\r%s\n' '-- comment ending with carriage return' 'commit;' >"$TMP_ROOT/cr_comment.sql"
cat >"$TMP_ROOT/backslash.sql" <<'SQL'
select 'ordinary string ending in backslash\'; commit;
SQL
for spec in 'begin:BEGIN:prohibited top-level' 'commit:COMMIT:prohibited top-level' \
            'concurrently:CONCURRENTLY:unsupported nontransactional' 'vacuum:VACUUM:unsupported nontransactional' \
            'release:RELEASE:prohibited top-level' 'cr_comment:CR_COMMENT:prohibited top-level' \
            'backslash:BACKSLASH:prohibited top-level'; do
  name=${spec%%:*}; rest=${spec#*:}; label=${rest%%:*}; expected=${rest#*:}
  dir="$TMP_ROOT/fixture-$name"; make_fixture "$dir" "${name}_fixture.sql" "$TMP_ROOT/$name.sql"
  if MIGRATIONS_DIR="$dir" node "$ROOT/frontend/scripts/run-migrations.js" --lane migration --dry-run >"$LOG" 2>&1; then
    fail "$label fixture was accepted"
  fi
  grep -q "$expected" "$LOG" || fail "$label fixture failure was not explicit"
done
cat >"$TMP_ROOT/false-positive.sql" <<'SQL'
-- COMMIT; VACUUM;
select 'BEGIN and CREATE INDEX CONCURRENTLY are data';
create function public.cp21_lexer_probe() returns text language plpgsql as $$
begin
  return 'ROLLBACK inside a dollar body';
end
$$;
SQL
FALSE_DIR="$TMP_ROOT/fixture-false-positive"
make_fixture "$FALSE_DIR" false_positive_fixture.sql "$TMP_ROOT/false-positive.sql"
MIGRATIONS_DIR="$FALSE_DIR" node "$ROOT/frontend/scripts/run-migrations.js" --lane migration --dry-run >"$LOG" 2>&1
grep -Fq "$GENERATED_FIXTURE_FILENAME" "$LOG" || fail 'lexer false-positive fixture was rejected'

# A changed historical file can never certify itself.
MUTATED_DIR="$TMP_ROOT/mutated-history"
mkdir "$MUTATED_DIR"; cp "$ROOT"/db/migrations/*.sql "$MUTATED_DIR/"; cp "$ROOT/db/migrations/manifest.json" "$MUTATED_DIR/manifest.json"
printf '%s\n' '-- unauthorized drift' >>"$MUTATED_DIR/001_extensions_and_core.sql"
if MIGRATIONS_DIR="$MUTATED_DIR" node "$ROOT/frontend/scripts/run-migrations.js" --lane migration --dry-run >"$LOG" 2>&1; then
  fail 'mutated historical migration was accepted'
fi
grep -q 'MIGRATION_CHECKSUM_MISMATCH' "$LOG" || fail 'mutated historical failure was not explicit'

# Failed normal migration and its ledger row roll back together.
cat >"$TMP_ROOT/failure.sql" <<'SQL'
create table public.cp21_must_roll_back(id integer primary key);
select public.cp21_missing_function();
SQL
FAILURE_DIR="$TMP_ROOT/fixture-failure"
make_fixture "$FAILURE_DIR" atomic_failure.sql "$TMP_ROOT/failure.sql"
if COCINACORE_SEPARATED_DB_LANES_ENABLED=true MIGRATION_DATABASE_URL="$MIGRATION_URL" \
   MIGRATIONS_DIR="$FAILURE_DIR" node "$ROOT/frontend/scripts/run-migrations.js" --lane migration >"$LOG" 2>&1; then
  fail 'failed migration succeeded'
fi
[ "$(admin_sql "$DB" "select to_regclass('public.cp21_must_roll_back') is null")" = t ] || fail 'failed migration left an object'
[ "$(admin_sql "$DB" "select count(*) from schema_migrations where filename='$GENERATED_FIXTURE_FILENAME'")" = 0 ] || fail 'failed migration left a ledger row'

# Shared advisory-lock matrix. A real first actor holds the exact key while the second executable times out.
STAGE=advisory-locks
set_check locks
printf '%s\n' 'integration stage: advisory-locks' >&2
wait_for_lock() {
  attempt=0
  until [ "$(admin_sql "$DB" "select count(*) from pg_locks where locktype='advisory' and granted")" -ge 1 ]; do
    attempt=$((attempt + 1)); [ "$attempt" -lt 40 ] || fail 'lock holder did not acquire'; sleep 0.05
  done
}
start_admin_holder() {
  docker exec "$CONTAINER" psql -X -U cocinacore -d "$DB" -qc \
    "select pg_advisory_lock(hashtextextended('cocinacore:database-change:v1:'||current_database(),0)); select pg_sleep(1.5)" >/dev/null 2>&1 &
  HOLDER_PID=$!; wait_for_lock
}
start_runner_holder() {
  docker exec -e PGPASSWORD="$MIGRATION_PASSWORD" "$CONTAINER" \
    psql -X -h 127.0.0.1 -U migration_admin -d "$DB" -qc \
    "set role cocinacore_schema_owner; select pg_advisory_lock(hashtextextended('cocinacore:database-change:v1:'||current_database(),0)); select pg_sleep(1.5)" >/dev/null 2>&1 &
  HOLDER_PID=$!; wait_for_lock
}
expect_verify_without_lock() {
  if MIGRATION_LOCK_TIMEOUT_MS=120 migrate --verify-complete >"$LOG" 2>&1; then
    grep -q 'Migration ledger is complete' "$LOG" || fail 'read-only verification did not report completion'
  else
    fail 'read-only verification failed while an advisory lock was held'
  fi
}
expect_runner_lock_timeout() {
  if MIGRATION_LOCK_TIMEOUT_MS=120 migrate "$DB" >"$LOG" 2>&1; then
    fail 'runner entered a held mutable critical section'
  fi
  grep -q LOCK_TIMEOUT "$LOG" || fail 'runner lock timeout was not explicit'
}
expect_provisioner_lock_timeout() {
  if COCINACORE_SEPARATED_DB_LANES_ENABLED=true BOOTSTRAP_DATABASE_URL="$ADMIN_URL" \
     MIGRATION_ADMIN_PASSWORD="$MIGRATION_PASSWORD" MIGRATION_LOCK_TIMEOUT_MS=120 \
     node "$ROOT/frontend/scripts/provision-database.js" >"$LOG" 2>&1; then
    fail 'provisioner entered a held mutable critical section'
  fi
  grep -q LOCK_TIMEOUT "$LOG" || fail 'provisioner lock timeout was not explicit'
}
set_check verify-complete-under-runner-lock
start_runner_holder; expect_verify_without_lock; wait "$HOLDER_PID"
set_check runner-timeout-under-runner-lock
start_runner_holder; expect_runner_lock_timeout; wait "$HOLDER_PID"
set_check runner-timeout-under-admin-lock
start_admin_holder; expect_runner_lock_timeout; wait "$HOLDER_PID"
set_check provisioner-timeout-under-runner-lock
start_runner_holder; expect_provisioner_lock_timeout; wait "$HOLDER_PID"
set_check provisioner-timeout-under-admin-lock
start_admin_holder; expect_provisioner_lock_timeout; wait "$HOLDER_PID"

# VALID UNTIL drift is tested last because PostgreSQL exposes no ALTER ROLE syntax restoring catalog NULL.
admin_sql "$DB" "alter role migration_admin valid until '2099-01-01'"
expect_provision_failure ROLE_STATE_MISMATCH
stop_container

# ---------------------------------------------------------------------------
# Existing trusted legacy upgrade, exact backfill, ownership, and compatibility.
# ---------------------------------------------------------------------------
STAGE=legacy-upgrade
set_check legacy_stage_begin
printf '%s\n' 'integration stage: legacy-upgrade' >&2
set_check harness_legacy_admin_password
ADMIN_PASSWORD=$(openssl rand -hex 18)
set_check harness_legacy_migration_password
MIGRATION_PASSWORD=$(openssl rand -hex 18)
set_check harness_legacy_container_start
start_container legacy cocinacore_legacy
set_check harness_legacy_container_started
set_check harness_legacy_migration_selection
LEGACY_MIGRATIONS=$(node -e "const m=require(process.argv[1]); console.log(m.migrations.filter(x=>x.legacyChecksumBackfillAllowed).map(x=>x.filename).join('\\n'))" "$ROOT/db/migrations/manifest.json")
set_check harness_legacy_migrations_selected
for filename in $LEGACY_MIGRATIONS; do
  migration="$ROOT/db/migrations/$filename"
  migration_id=${filename%%_*}
  set_check harness_legacy_migration_id_validation
  case "$migration_id" in
    [0-9][0-9][0-9]) ;;
    *) fail 'invalid legacy migration identifier' ;;
  esac
  set_check "product_legacy_historical_migration_${migration_id}"
  docker exec -i "$CONTAINER" psql -X -v ON_ERROR_STOP=1 -U cocinacore -d "$DB" >/dev/null <"$migration"
  set_check "product_legacy_historical_migration_${migration_id}_applied"
done
set_check harness_legacy_ledger_create
admin_sql "$DB" "create schema internal;
  create table public.schema_migrations(filename text primary key, applied_at timestamptz not null default now());
  alter table public.schema_migrations enable row level security;
  revoke all on public.schema_migrations from public;"
set_check harness_legacy_ledger_created
for filename in $LEGACY_MIGRATIONS; do
  migration_id=${filename%%_*}
  set_check harness_legacy_ledger_seed_id_validation
  case "$migration_id" in
    [0-9][0-9][0-9]) ;;
    *) fail 'invalid legacy migration identifier' ;;
  esac
  set_check "harness_legacy_ledger_seed_${migration_id}"
  admin_sql "$DB" "insert into public.schema_migrations(filename) values ('$filename')"
  set_check "harness_legacy_ledger_seed_${migration_id}_done"
done
set_check harness_legacy_tenant_insert
LEGACY_TENANT=$(admin_sql "$DB" "insert into public.tenants(name) values ('legacy-before') returning id")
set_check harness_legacy_reader_role_grant
admin_sql "$DB" 'create role legacy_reader nologin; grant usage on schema public to legacy_reader; grant select on public.tenants to legacy_reader'
set_check harness_legacy_data_ready

# Complete ledger/catalog attestation happens before any adoption.
set_check harness_negative_unknown_ledger_fixture
admin_sql "$DB" "insert into public.schema_migrations(filename) values ('999_unknown.sql')"
set_check product_legacy_negative_unknown_ledger
expect_provision_failure BASELINE_MISMATCH
set_check assert_negative_unknown_ledger
[ "$(admin_sql "$DB" "select count(*) from pg_roles where rolname in ('migration_admin','cocinacore_schema_owner')")" = 0 ] || fail 'unknown ledger row created roles'
set_check harness_negative_unknown_ledger_restore
admin_sql "$DB" "delete from public.schema_migrations where filename='999_unknown.sql'"
set_check harness_negative_missing_ledger_fixture
admin_sql "$DB" "delete from public.schema_migrations where filename='010_password_reset_tokens.sql'"
set_check product_legacy_negative_missing_ledger
expect_provision_failure 'Legacy ledger migration set mismatch'
set_check assert_negative_missing_ledger
[ "$(admin_sql "$DB" "select pg_get_userbyid(relowner) from pg_class where oid='public.tenants'::regclass")" = cocinacore ] || fail 'missing ledger row started ownership adoption'
set_check harness_negative_missing_ledger_restore
admin_sql "$DB" "insert into public.schema_migrations(filename) values ('010_password_reset_tokens.sql')"
set_check harness_negative_unexpected_table_fixture
admin_sql "$DB" 'create table public.unexpected_legacy_table(id integer)'
set_check product_legacy_negative_unexpected_table
expect_provision_failure 'Managed table set mismatch'
set_check assert_negative_unexpected_table
[ "$(admin_sql "$DB" "select pg_get_userbyid(relowner) from pg_class where oid='public.tenants'::regclass")" = cocinacore ] || fail 'unexpected table started ownership adoption'
set_check harness_negative_unexpected_table_restore
admin_sql "$DB" 'drop table public.unexpected_legacy_table'
set_check harness_negative_unexpected_function_fixture
admin_sql "$DB" "create function public.unexpected_legacy_function() returns integer language sql as 'select 1'"
set_check product_legacy_negative_unexpected_function
expect_provision_failure 'Managed function set mismatch'
set_check harness_negative_unexpected_function_restore
admin_sql "$DB" 'drop function public.unexpected_legacy_function()'
set_check harness_negative_foreign_owner_fixture
admin_sql "$DB" 'create role foreign_owner; alter table public.tenants owner to foreign_owner'
set_check product_legacy_negative_foreign_owner
expect_provision_failure 'unexpected owner'
set_check assert_negative_foreign_owner
[ "$(admin_sql "$DB" "select pg_get_userbyid(relowner) from pg_class where oid='public.tenants'::regclass")" = foreign_owner ] || fail 'unexpected owner was rewritten'
set_check harness_negative_foreign_owner_restore
admin_sql "$DB" 'alter table public.tenants owner to cocinacore; drop role foreign_owner'

set_check assert_legacy_owner_baseline
OWNER_BEFORE=$(admin_sql "$DB" "select pg_get_userbyid(relowner) from pg_class where oid='public.tenants'::regclass")
ACL_BEFORE=$(admin_sql "$DB" "select has_schema_privilege('legacy_reader','public','USAGE')||','||has_table_privilege('legacy_reader','public.tenants','SELECT')")
[ "$OWNER_BEFORE" = cocinacore ] || fail 'legacy owner baseline is wrong'
[ "$ACL_BEFORE" = 'true,true' ] || fail 'legacy explicit grant baseline is wrong'

set_check product_legacy_provisioner_adoption
provision >"$LOG" 2>&1
set_check assert_legacy_checksum_backfill
[ "$(admin_sql "$DB" "select count(*) from schema_migrations where checksum is not null")" = 10 ] || fail 'trusted legacy checksum backfill did not cover 10 rows'
set_check harness_legacy_expected_ledger
EXPECTED_LEDGER=$(node -e "const m=require(process.argv[1]); console.log(m.migrations.filter(x=>x.legacyChecksumBackfillAllowed).map(x=>x.filename+'='+x.sha256).sort().join(','))" "$ROOT/db/migrations/manifest.json")
set_check harness_legacy_actual_ledger
ACTUAL_LEDGER=$(admin_sql "$DB" "select string_agg(filename||'='||checksum,',' order by filename) from schema_migrations")
set_check assert_legacy_ledger_matches_manifest
[ "$EXPECTED_LEDGER" = "$ACTUAL_LEDGER" ] || fail 'legacy backfill does not equal trusted manifest'

set_check product_legacy_remaining_migrations
migrate >"$LOG" 2>&1
set_check assert_legacy_migration_milestones
grep -q 'DONE 012_meal_plan_consumption.sql' "$LOG" || fail 'legacy upgrade did not reach milestone 012'
grep -q 'DONE 014_culinary_profile_field_constraints.sql' "$LOG" || fail 'legacy upgrade did not complete manifest migration 014'
set_check assert_legacy_migration_ledger_count
[ "$(admin_sql "$DB" "select count(*) from schema_migrations")" = "$EXPECTED_MIGRATION_COUNT" ] || fail 'legacy upgrade ledger count does not match manifest'
set_check assert_legacy_canonical_constraint
[ "$(admin_sql "$DB" "select count(*) from pg_constraint where conrelid='public.users'::regclass and conname='users_email_canonical_check'")" = 1 ] || fail 'legacy upgrade canonical constraint is missing'
set_check product_legacy_transfer_count_query
TRANSFERRED=$(admin_sql "$DB" "select
  (select count(*) from pg_namespace where nspname in ('public','internal') and pg_get_userbyid(nspowner)='cocinacore_schema_owner') +
  (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','internal') and c.relkind in ('r','p') and pg_get_userbyid(c.relowner)='cocinacore_schema_owner') +
  (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','internal') and pg_get_userbyid(p.proowner)='cocinacore_schema_owner' and not exists(select 1 from pg_depend d where d.classid='pg_proc'::regclass and d.objid=p.oid and d.deptype='e'))")
set_check assert_legacy_transfer_count_numeric
case "$TRANSFERRED" in
  ''|*[!0-9]*) fail 'ownership transfer count is not numeric' ;;
esac
printf 'integration diagnostic: legacy_TRANSFERRED=%s\n' "$TRANSFERRED" >&2
set_check harness_legacy_applied_migrations_snapshot
APPLIED_MIGRATIONS=$(admin_sql "$DB" "select string_agg(filename, E'\\n' order by filename) from public.schema_migrations")
set_check harness_legacy_manifest_expected_count
EXPECTED_TRANSFERRED=$(node - "$ROOT/db/migrations/manifest.json" "$APPLIED_MIGRATIONS" <<'NODE'
const fs = require('node:fs');
const manifest = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const applied = new Set(process.argv[3].split('\n').filter(Boolean));
const catalogAdditions = manifest.migrations
  .filter((migration) => applied.has(migration.filename))
  .flatMap((migration) => migration.catalogAdditions || [])
  .filter((addition) => addition.kind === 'function' || addition.kind === 'table').length;
console.log(manifest.baselineObjects.transferable.length + catalogAdditions);
NODE
)
case "$EXPECTED_TRANSFERRED" in
  ''|*[!0-9]*) fail 'expected ownership transfer count is not numeric' ;;
esac
printf 'integration diagnostic: legacy_EXPECTED_TRANSFERRED=%s\n' "$EXPECTED_TRANSFERRED" >&2
set_check assert_legacy_transfer_count
[ "$TRANSFERRED" = "$EXPECTED_TRANSFERRED" ] || fail 'ownership transfer count does not match manifest and applied migration functions'
set_check assert_legacy_extension_dependencies
[ "$(admin_sql "$DB" "select count(*) from pg_depend d where d.deptype='e' and ((d.classid='pg_proc'::regclass and exists(select 1 from pg_proc p where p.oid=d.objid and pg_get_userbyid(p.proowner)='cocinacore_schema_owner')) or (d.classid='pg_type'::regclass and exists(select 1 from pg_type t where t.oid=d.objid and pg_get_userbyid(t.typowner)='cocinacore_schema_owner')))")" = 0 ] || fail 'legacy extension-managed objects were transferred'
set_check assert_legacy_extension_owners
[ "$(admin_sql "$DB" "select pg_get_userbyid(extowner) from pg_extension where extname='vector'")" = cocinacore ] || fail 'legacy vector owner changed'
[ "$(admin_sql "$DB" "select pg_get_userbyid(extowner) from pg_extension where extname='pgcrypto'")" = cocinacore ] || fail 'legacy pgcrypto owner changed'
set_check assert_legacy_acl_preservation
[ "$(admin_sql "$DB" "select has_schema_privilege('legacy_reader','public','USAGE')||','||has_table_privilege('legacy_reader','public.tenants','SELECT')")" = "$ACL_BEFORE" ] || fail 'legacy explicit grants changed'
[ "$(admin_sql "$DB" "select has_schema_privilege('public','public','USAGE')||','||has_schema_privilege('public','public','CREATE')")" = 'true,false' ] || fail 'public schema ACL target is wrong'
set_check assert_legacy_data_preservation
[ "$(admin_sql "$DB" "select count(*) from tenants where id='$LEGACY_TENANT'")" = 1 ] || fail 'legacy data was lost'
set_check harness_legacy_data_write
admin_sql "$DB" "insert into tenants(name) values ('legacy-after')" >/dev/null
set_check assert_legacy_read_write_compatibility
[ "$(admin_sql "$DB" "select count(*) from tenants where name in ('legacy-before','legacy-after')")" = 2 ] || fail 'legacy read/write compatibility failed'

# Exact-state provisioner rerun remains safe.
set_check product_legacy_provisioner_rerun
provision >"$LOG" 2>&1
set_check assert_legacy_idempotent_data
[ "$(admin_sql "$DB" "select count(*) from tenants where name in ('legacy-before','legacy-after')")" = 2 ] || fail 'reprovision changed application data'
stop_container

# Exact production-017 legacy shape, fixed non-default owner profile, and 018/019 continuation.
STAGE=legacy-017-adoption
set_check legacy017_container_start
printf '%s\n' 'integration stage: legacy-017-adoption' >&2
start_container legacy017 cocinacore_legacy017
LEGACY017_MIGRATIONS=$(node -e "const m=require(process.argv[1]); console.log(m.migrations.slice(0,17).map(x=>x.filename).join('\\n'))" "$ROOT/db/migrations/manifest.json")
for filename in $LEGACY017_MIGRATIONS; do
  set_check "legacy017_schema_migration_${filename%%_*}"
  docker exec -i "$CONTAINER" psql -X -1 -v ON_ERROR_STOP=1 -U cocinacore -d "$DB" >/dev/null <"$ROOT/db/migrations/$filename"
done
set_check legacy017_ledger_create
admin_sql "$DB" "create schema if not exists internal;
  create table public.schema_migrations(filename text primary key, applied_at timestamptz not null default now());
  alter table public.schema_migrations enable row level security;
  revoke all on public.schema_migrations from public"
for filename in $LEGACY017_MIGRATIONS; do
  set_check "legacy017_ledger_seed_${filename%%_*}"
  admin_sql "$DB" "insert into public.schema_migrations(filename, applied_at) values ('$filename', '2026-01-01 00:00:00+00')"
done
set_check legacy017_fixture_data
LEGACY017_TENANT=$(admin_sql "$DB" "insert into public.tenants(name) values ('legacy017-before') returning id")
set_check legacy017_owner_profile
admin_sql "$DB" "DO \$\$
DECLARE
  item record;
BEGIN
  ALTER SCHEMA public OWNER TO cocinacore_user;
  ALTER SCHEMA internal OWNER TO cocinacore_user;
  FOR item IN
    SELECT c.oid::regclass AS object_name
      FROM pg_catalog.pg_class c
      JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
     WHERE n.nspname IN ('public','internal') AND c.relkind IN ('r','p')
       AND NOT EXISTS (
         SELECT 1 FROM pg_catalog.pg_depend d
          WHERE d.classid='pg_catalog.pg_class'::pg_catalog.regclass
            AND d.objid=c.oid AND d.deptype='e'
       )
  LOOP
    EXECUTE format('ALTER TABLE %s OWNER TO %I', item.object_name, 'cocinacore_user');
  END LOOP;
  FOR item IN
    SELECT p.oid::regprocedure AS object_name
      FROM pg_catalog.pg_proc p
      JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
     WHERE n.nspname IN ('public','internal')
       AND NOT EXISTS (
         SELECT 1 FROM pg_catalog.pg_depend d
          WHERE d.classid='pg_catalog.pg_proc'::pg_catalog.regclass
            AND d.objid=p.oid AND d.deptype='e'
       )
  LOOP
    EXECUTE format('ALTER FUNCTION %s OWNER TO %I', item.object_name, 'cocinacore_user');
  END LOOP;
END
\$\$"
set_check legacy017_provisioner_adoption
provision >"$LOG" 2>&1
grep -q 'trusted ownership are provisioned' "$LOG" || fail 'legacy 017 adoption did not finish'
set_check legacy017_provenance_rows
[ "$(admin_sql "$DB" "select count(*) from schema_migrations where checksum_source='legacy_unverifiable' and checksum is null")" = 7 ] || fail 'legacy 017 checksums were not preserved as unverifiable'
[ "$(admin_sql "$DB" "select count(*) from schema_migrations where checksum_source='manifest_backfill' and checksum is not null")" = 10 ] || fail 'manifest checksums were not backfilled for 001-010'
[ "$(admin_sql "$DB" "select count(*) from schema_migrations where checksum_source is null")" = 0 ] || fail 'legacy 017 provenance is incomplete'
set_check legacy017_owner_transfer
[ "$(admin_sql "$DB" "select pg_catalog.pg_get_userbyid(c.relowner) from pg_catalog.pg_class c where c.oid='public.schema_migrations'::pg_catalog.regclass")" = cocinacore_schema_owner ] || fail 'legacy 017 ledger ownership was not transferred'
[ "$(admin_sql "$DB" "select pg_catalog.pg_get_userbyid(p.proowner) from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='is_valid_culinary_profile_text_list'")" = cocinacore_schema_owner ] || fail 'legacy 017 application function ownership was not transferred'
set_check legacy017_data_preservation
[ "$(admin_sql "$DB" "select count(*) from tenants where id='$LEGACY017_TENANT' and name='legacy017-before'")" = 1 ] || fail 'legacy 017 fixture data was lost'
set_check legacy017_exact_pending_m5
migrate_m5_pending >"$LOG" 2>&1
grep -q 'DONE 018_cooking_sessions.sql' "$LOG" || fail 'legacy 017 continuation did not apply 018'
grep -q 'DONE 019_real_consumption_reconciliation.sql' "$LOG" || fail 'legacy 017 continuation did not apply 019'
set_check legacy017_verify_complete
migrate --verify-complete >"$LOG" 2>&1
grep -q 'Migration ledger is complete' "$LOG" || fail 'legacy 017 continuation did not verify complete'
[ "$(admin_sql "$DB" "select count(*) from schema_migrations")" = "$EXPECTED_MIGRATION_COUNT" ] || fail 'legacy 017 ledger is not complete through 019'
[ "$(admin_sql "$DB" "select count(*) from schema_migrations where filename in ('018_cooking_sessions.sql','019_real_consumption_reconciliation.sql') and checksum_source='migration_file' and checksum is not null")" = 2 ] || fail '018/019 migration-file provenance is missing'
[ "$(admin_sql "$DB" "select count(*) from schema_migrations where checksum_source='legacy_unverifiable' and checksum is null")" = 7 ] || fail '018/019 continuation changed unknown historic checksums'
set_check assert_m5_runtime_grants
M5_RUNTIME_PRIVILEGES=$(admin_sql "$DB" "select
  has_table_privilege('cocinacore_user','public.cooking_sessions','select') || ',' ||
  has_table_privilege('cocinacore_user','public.cooking_sessions','insert') || ',' ||
  has_table_privilege('cocinacore_user','public.cooking_sessions','update') || ',' ||
  has_table_privilege('cocinacore_user','public.cooking_sessions','delete') || ',' ||
  has_table_privilege('cocinacore_user','public.cooking_session_events','select') || ',' ||
  has_table_privilege('cocinacore_user','public.cooking_session_events','insert') || ',' ||
  has_table_privilege('cocinacore_user','public.cooking_session_events','update') || ',' ||
  has_table_privilege('cocinacore_user','public.cooking_session_events','delete') || ',' ||
  has_table_privilege('cocinacore_user','public.real_consumption_operations','select') || ',' ||
  has_table_privilege('cocinacore_user','public.real_consumption_operations','insert') || ',' ||
  has_table_privilege('cocinacore_user','public.real_consumption_operations','update') || ',' ||
  has_table_privilege('cocinacore_user','public.real_consumption_operations','delete') || ',' ||
  has_table_privilege('cocinacore_user','public.meal_consumption_claims','select') || ',' ||
  has_table_privilege('cocinacore_user','public.meal_consumption_claims','insert') || ',' ||
  has_table_privilege('cocinacore_user','public.meal_consumption_claims','update') || ',' ||
  has_table_privilege('cocinacore_user','public.meal_consumption_claims','delete') || ',' ||
  has_table_privilege('cocinacore_user','public.real_consumption_items','select') || ',' ||
  has_table_privilege('cocinacore_user','public.real_consumption_items','insert') || ',' ||
  has_table_privilege('cocinacore_user','public.real_consumption_items','update') || ',' ||
  has_table_privilege('cocinacore_user','public.real_consumption_items','delete') || ',' ||
  has_table_privilege('cocinacore_user','public.real_consumption_substitutions','select') || ',' ||
  has_table_privilege('cocinacore_user','public.real_consumption_substitutions','insert') || ',' ||
  has_table_privilege('cocinacore_user','public.real_consumption_substitutions','update') || ',' ||
  has_table_privilege('cocinacore_user','public.real_consumption_substitutions','delete') || ',' ||
  has_table_privilege('cocinacore_user','public.real_consumption_movement_links','select') || ',' ||
  has_table_privilege('cocinacore_user','public.real_consumption_movement_links','insert') || ',' ||
  has_table_privilege('cocinacore_user','public.real_consumption_movement_links','update') || ',' ||
  has_table_privilege('cocinacore_user','public.real_consumption_movement_links','delete')")
[ "$M5_RUNTIME_PRIVILEGES" = 'true,true,true,false,true,true,false,false,true,true,false,false,true,true,false,false,true,true,false,false,true,true,false,false,true,true,false,false' ] || fail 'runtime privileges on 018/019 tables are not minimal'
[ "$(admin_sql "$DB" "select count(*) from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace cross join lateral pg_catalog.aclexplode(coalesce(c.relacl, pg_catalog.acldefault('r', c.relowner))) a where n.nspname='public' and c.relname in ('cooking_sessions','cooking_session_events','real_consumption_operations','meal_consumption_claims','real_consumption_items','real_consumption_substitutions','real_consumption_movement_links') and a.grantee=0")" = 0 ] || fail 'PUBLIC has a direct grant on an M5 table'

STAGE=final-cleanup
set_check cleanup
printf '%s\n' 'integration stage: final-cleanup' >&2
stop_container
[ "$(docker ps -a --format '{{.Names}}' | grep -c "^$PREFIX" || true)" = 0 ] || fail 'temporary containers remain'
printf '%s\n' 'bootstrap/migrator integration passed: fresh legacy 010 and 017 adoption, extensions, roles, locks, transactions, activation'
