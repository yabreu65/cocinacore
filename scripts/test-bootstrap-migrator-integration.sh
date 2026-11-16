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
  regression_assert "$( [ "$REGRESSION_TOTAL_COUNT_LINES" = 1 ] && printf yes || printf no )" 'canonical complete-ledger assertion uses the total manifest count'
  REGRESSION_PRE020_COUNT_LINES=$(awk '
    /^STAGE=initialization$/ { in_main=1 }
    in_main && /select count\(\*\) from/ && /schema_migrations/ && /EXPECTED_PRE020_MIGRATION_COUNT/ { count++ }
    END { print count+0 }
  ' "$REGRESSION_TEST_SCRIPT")
  regression_assert "$( [ "$REGRESSION_PRE020_COUNT_LINES" = 2 ] && printf yes || printf no )" 'fresh and legacy boundary assertions use the 001-019 prefix count'
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
[ "$(node -p 'process.version')" = 'v22.22.3' ] || { printf '%s\n' 'Node 22.22.3 is required for this integration harness' >&2; exit 1; }
EXPECTED_PRE020_MIGRATION_COUNT=$(node - "$ROOT/db/migrations/manifest.json" <<'NODE'
const fs = require('node:fs');
const manifest = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
process.stdout.write(String(manifest.migrations.filter((entry) => Number(entry.id) <= 19).length));
NODE
)
PREFIX="cocinacore-pr0a-cp21-$$"
TMP_ROOT=$(mktemp -d)
# This historical integration harness certifies 020, not later migrations.
# Keep the exact prefix and its checksums, including all manifest metadata.
R3_DIR="$TMP_ROOT/canonical-020-prefix"
node - "$ROOT/db/migrations" "$R3_DIR" <<'NODE'
const fs = require('node:fs');
const path = require('node:path');
const [source, target] = process.argv.slice(2);
const manifest = JSON.parse(fs.readFileSync(path.join(source, 'manifest.json'), 'utf8'));
const prefix = manifest.migrations.slice(0, 20);
if (prefix.length !== 20 || prefix[19].filename !== '020_tenant_rls_hardening.sql') process.exit(1);
fs.mkdirSync(target);
for (const entry of prefix) fs.copyFileSync(path.join(source, entry.filename), path.join(target, entry.filename));
fs.writeFileSync(path.join(target, 'manifest.json'), JSON.stringify({...manifest, migrations: prefix}, null, 2));
NODE
EXPECTED_MIGRATION_COUNT=$(manifest_migration_count "$R3_DIR/manifest.json")
LOG="$TMP_ROOT/operation.log"
MIGRATION_PASSWORD=$(openssl rand -hex 18)
ADMIN_PASSWORD=$(openssl rand -hex 18)
RUNTIME_PASSWORD=$(openssl rand -hex 18)

fail() {
  exit 1
}

start_container() {
  suffix=$1
  DB=$2
  CONTAINER="$PREFIX-$suffix"
  docker run --pull=never -d --name "$CONTAINER" --tmpfs /var/lib/postgresql/data:rw,nosuid,size=512m \
    -e POSTGRES_DB="$DB" -e POSTGRES_USER=cocinacore -e POSTGRES_PASSWORD="$ADMIN_PASSWORD" \
    -p 127.0.0.1::5432 "$IMAGE" >/dev/null
  attempt=0
  until docker exec "$CONTAINER" pg_isready -h 127.0.0.1 -U cocinacore -d "$DB" >/dev/null 2>&1; do
    attempt=$((attempt + 1)); [ "$attempt" -lt 60 ] || fail 'PostgreSQL did not become ready'; sleep 1
  done
  admin_sql "$DB" "create role cocinacore_user login password '$RUNTIME_PASSWORD' nosuperuser nocreatedb nocreaterole noreplication nobypassrls"
  PORT=$(docker port "$CONTAINER" 5432/tcp | sed 's/.*://')
  ADMIN_URL="postgresql://cocinacore:$ADMIN_PASSWORD@127.0.0.1:$PORT/$DB"
  MIGRATION_URL="postgresql://migration_admin:$MIGRATION_PASSWORD@127.0.0.1:$PORT/$DB"
  RUNTIME_URL="postgresql://cocinacore_user:$RUNTIME_PASSWORD@127.0.0.1:$PORT/$DB"
}

stop_container() {
  docker rm -fv "$CONTAINER" >/dev/null
  CONTAINER=
}

admin_sql() {
  database=$1; shift
  docker exec -i "$CONTAINER" psql -X -v ON_ERROR_STOP=1 -U cocinacore -d "$database" -Atqc "$*"
}

runtime_sql() {
  database=$1; shift
  docker exec -e PGPASSWORD="$RUNTIME_PASSWORD" -i "$CONTAINER" \
    psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -U cocinacore_user -d "$database" -Atqc "$*"
}

admin_sql_stdin() {
  database=$1
  docker exec -i "$CONTAINER" psql -X -v ON_ERROR_STOP=1 -U cocinacore -d "$database"
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
  MIGRATIONS_DIR="$R3_DIR" \
  COCINACORE_SEPARATED_DB_LANES_ENABLED=true MIGRATION_DATABASE_URL="$MIGRATION_URL" \
  MIGRATION_EXPECTED_PENDING='018_cooking_sessions.sql,019_real_consumption_reconciliation.sql' \
  node "$ROOT/frontend/scripts/run-migrations.js" --lane migration --stop-after 019
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

# These fixtures intentionally exercise a trusted 019 state. Keep them at id
# 020 after canonical migration 020 is added; otherwise that real migration
# would run before a fixture intended to test the 019 boundary.
make_pre020_fixture() {
  target=$1; suffix=$2; source=$3
  mkdir -p "$target"
  GENERATED_FIXTURE_FILENAME=$(python3 - "$ROOT/db/migrations/manifest.json" "$target" "$suffix" "$source" "$ROOT/db/migrations" <<'PY'
import hashlib, json, pathlib, shutil, sys
manifest_path, target, suffix, source, migrations_dir = map(pathlib.Path, sys.argv[1:])
manifest=json.loads(manifest_path.read_text())
historical=[entry for entry in manifest['migrations'] if int(entry['id']) < 20]
if len(historical) != 19 or historical[-1]['id'] != '019':
    raise SystemExit('pre-020 fixture requires the exact historical 001-019 manifest prefix')
for entry in historical:
    shutil.copy2(migrations_dir / entry['filename'], target / entry['filename'])
fixture_id='020'
filename=f"{fixture_id}_{suffix.name}"
migration_path=target / filename
data=source.read_bytes()
migration_path.write_bytes(data)
fixture_manifest={key:value for key,value in manifest.items() if key != 'migrations'}
fixture_manifest['migrations']=historical+[{
  'id':fixture_id,'filename':filename,'lane':'migration','sha256':hashlib.sha256(data).hexdigest(),
  'byteLength':len(data),'transactional':'required','legacyChecksumBackfillAllowed':False
}]
(target / 'manifest.json').write_text(json.dumps(fixture_manifest,indent=2)+'\n')
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
printf '%s\n' 'select 1;' >"$TMP_ROOT/boundary.sql"
BOUNDARY_DIR="$TMP_ROOT/boundary-fixture"
make_pre020_fixture "$BOUNDARY_DIR" boundary_fixture.sql "$TMP_ROOT/boundary.sql"
BOUNDARY_NEXT=$GENERATED_FIXTURE_FILENAME
MIGRATIONS_DIR="$BOUNDARY_DIR" migrate --stop-after 019 >"$LOG" 2>&1 || { tail -n 8 "$LOG" >&2; fail 'boundary migration failed'; }
set_check boundary-ledger
grep -q 'BOUNDARY 019 reached' "$LOG" || fail 'missing migration boundary marker'
[ "$(admin_sql "$DB" "select count(*) from schema_migrations")" = 19 ] || fail 'boundary ledger is not exactly 001-019'
MIGRATIONS_DIR="$BOUNDARY_DIR" migrate --stop-after 019 >"$LOG" 2>&1
set_check boundary-idempotent
grep -q 'SKIP 019_real_consumption_reconciliation.sql' "$LOG" || fail 'boundary is not idempotent'
set_check boundary-verify
MIGRATIONS_DIR="$BOUNDARY_DIR" MIGRATION_EXPECTED_PENDING="$BOUNDARY_NEXT" migrate --verify-boundary 019 >"$LOG" 2>&1 || { tail -n 8 "$LOG" >&2; fail 'boundary verification failed'; }
grep -q 'BOUNDARY 019 verified' "$LOG" || fail 'boundary verification did not report the partial result'
set_check boundary-checksum-denial
BOUNDARY_CHECKSUM=$(admin_sql "$DB" "select checksum from schema_migrations where filename='019_real_consumption_reconciliation.sql'")
admin_sql "$DB" "update schema_migrations set checksum=repeat('0',64) where filename='019_real_consumption_reconciliation.sql'"
if MIGRATIONS_DIR="$BOUNDARY_DIR" migrate --verify-boundary 019 >"$LOG" 2>&1; then fail 'bad boundary checksum was accepted'; fi
grep -q MIGRATION_CHECKSUM_MISMATCH "$LOG" || fail 'checksum failure was not explicit'
admin_sql "$DB" "update schema_migrations set checksum='$BOUNDARY_CHECKSUM' where filename='019_real_consumption_reconciliation.sql'"
set_check boundary-order-denial
BOUNDARY_TIMESTAMP=$(admin_sql "$DB" "select applied_at from schema_migrations where filename='019_real_consumption_reconciliation.sql'")
admin_sql "$DB" "update schema_migrations set applied_at=(select applied_at from schema_migrations where filename='018_cooking_sessions.sql') where filename='019_real_consumption_reconciliation.sql'"
if MIGRATIONS_DIR="$BOUNDARY_DIR" migrate --verify-boundary 019 >"$LOG" 2>&1; then fail 'ambiguous ledger timestamps were accepted'; fi
grep -q BOUNDARY_INVALID "$LOG" || fail 'ledger order failure was not explicit'
admin_sql "$DB" "update schema_migrations set applied_at='$BOUNDARY_TIMESTAMP' where filename='019_real_consumption_reconciliation.sql'"
if MIGRATIONS_DIR="$BOUNDARY_DIR" migrate --verify-complete >"$LOG" 2>&1; then fail 'partial ledger was treated as complete'; fi
grep -q 'Pending migration' "$LOG" || fail 'complete verification did not detect pending fixture'
for bad_args in '--stop-after 018' '--stop-after 019 --dry-run' '--verify-boundary 019 --verify-complete' '--stop-after' '--unknown' '--lane migration'; do
  # The last case duplicates --lane, supplied by migrate().
  if migrate $bad_args >"$LOG" 2>&1; then fail 'invalid boundary arguments were accepted'; fi
done
[ "$(admin_sql "$DB" "select count(*) from schema_migrations")" = 19 ] || fail 'invalid arguments modified ledger'
set_check migration-marker
MIGRATIONS_DIR="$BOUNDARY_DIR" migrate --stop-after 019 >"$LOG" 2>&1
grep -q 'SKIP 012_meal_plan_consumption.sql' "$LOG" || fail 'fresh migration did not reach milestone 012'
grep -q 'SKIP 014_culinary_profile_field_constraints.sql' "$LOG" || fail 'fresh migration did not complete manifest migration 014'
unset MIGRATIONS_DIR MIGRATION_EXPECTED_PENDING
set_check verify-complete-pending-020
if migrate --verify-complete >"$LOG" 2>&1; then fail 'fresh 019 boundary was incorrectly considered complete before 020'; fi
grep -Eq 'Pending migration|PREPARED_CAPABILITIES_PARTIAL' "$LOG" || { tail -n 12 "$LOG" >&2; fail 'fresh pending-020 rejection was not explicit'; }
set_check ledger-count
[ "$(admin_sql "$DB" "select count(*) from public.schema_migrations")" = "$EXPECTED_PRE020_MIGRATION_COUNT" ] || fail 'fresh ledger is not exactly the pre-020 migration prefix'
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
admin_sql "$DB" "create function public.cp21_fake_vector_member() returns integer language sql as \$\$select 1\$\$"
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
admin_sql "$DB" "create schema cp21_rogue; create type cp21_rogue.forbidden_enum as enum (\$\$forbidden\$\$); alter type cp21_rogue.forbidden_enum owner to migration_admin"
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
grep -q 'MIGRATION_IDENTITY_MISMATCH' "$LOG" || { tail -n 15 "$LOG" >&2; fail 'wrong migration identity failure was not explicit'; }
if migrate --verify-complete >"$LOG" 2>&1; then fail 'unprepared 019 ledger was incorrectly accepted as complete'; fi
grep -Eq 'Pending migration|PREPARED_CAPABILITIES_PARTIAL' "$LOG" || { tail -n 15 "$LOG" >&2; fail 'unprepared 019 ledger did not report canonical 020 as pending'; }

# Disabled/default mode retains the legacy DATABASE_URL path without privileged inputs.
admin_sql "$DB" 'create database legacy_disabled'
DISABLED_URL="postgresql://cocinacore:$ADMIN_PASSWORD@127.0.0.1:$PORT/legacy_disabled"
COCINACORE_SEPARATED_DB_LANES_ENABLED=false DATABASE_URL="$DISABLED_URL" \
MIGRATIONS_DIR="$BOUNDARY_DIR" node "$ROOT/frontend/scripts/run-migrations.js" --lane migration --stop-after 019 >"$LOG" 2>&1 || { tail -n 15 "$LOG" >&2; fail 'legacy mode failed to apply the 019 prefix'; }
grep -q 'DONE 012_meal_plan_consumption.sql' "$LOG" || fail 'missing-gate legacy mode did not reach milestone 012'
grep -q 'DONE 014_culinary_profile_field_constraints.sql' "$LOG" || fail 'missing-gate legacy mode did not complete manifest migration 014'
[ "$(admin_sql legacy_disabled 'select count(*) from public.schema_migrations')" = 19 ] || fail 'false-gate legacy mode did not stop at the explicit 019 boundary'
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

# Static manifest validation is independent of database attestation and is not
# sufficient to authorize 020. Reject an altered prepared-owner declaration.
set_check prepared-capability-manifest-owner-denial
PREPARED_MANIFEST_DIR="$TMP_ROOT/prepared-manifest-fixture"
mkdir -p "$PREPARED_MANIFEST_DIR"
cp "$ROOT"/db/migrations/*.sql "$PREPARED_MANIFEST_DIR/"
node - "$ROOT/db/migrations/manifest.json" "$PREPARED_MANIFEST_DIR/manifest.json" <<'NODE'
const fs = require('node:fs');
const manifest = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
manifest.preparedCapabilities.objects[0].owner = 'postgres';
fs.writeFileSync(process.argv[3], JSON.stringify(manifest));
NODE
if MIGRATIONS_DIR="$PREPARED_MANIFEST_DIR" node "$ROOT/frontend/scripts/run-migrations.js" --lane migration --dry-run >"$LOG" 2>&1; then
  fail 'arbitrary prepared capability owner was accepted'
fi
grep -q 'PREPARED_CAPABILITIES_MANIFEST_MISMATCH' "$LOG" || fail 'prepared owner rejection was not explicit'
printf '%s\n' 'PASS: migration runner rejects an arbitrary prepared capability owner in the manifest'

# Failed normal migration and its ledger row roll back together.
cat >"$TMP_ROOT/failure.sql" <<'SQL'
create table public.cp21_must_roll_back(id integer primary key);
select public.cp21_missing_function();
SQL
FAILURE_DIR="$TMP_ROOT/fixture-failure"
make_pre020_fixture "$FAILURE_DIR" atomic_failure.sql "$TMP_ROOT/failure.sql"
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
    fail 'read-only verification accepted an unprepared 019 ledger as complete'
  else
    grep -q 'Pending migration' "$LOG" || fail 'read-only verification did not report the pending 020 migration'
  fi
}
expect_runner_lock_timeout() {
  if MIGRATION_LOCK_TIMEOUT_MS=120 migrate >"$LOG" 2>&1; then
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
set_check boundary-timeout-under-runner-lock
start_runner_holder
if MIGRATIONS_DIR="$BOUNDARY_DIR" MIGRATION_LOCK_TIMEOUT_MS=120 migrate --stop-after 019 >"$LOG" 2>&1; then fail 'boundary ignored the migration lock'; fi
grep -q LOCK_TIMEOUT "$LOG" || fail 'boundary lock timeout was not explicit'
wait "$HOLDER_PID"
unset MIGRATIONS_DIR MIGRATION_LOCK_TIMEOUT_MS
set_check provisioner-timeout-under-runner-lock
start_runner_holder; expect_provisioner_lock_timeout; wait "$HOLDER_PID"
set_check provisioner-timeout-under-admin-lock
start_admin_holder; expect_provisioner_lock_timeout; wait "$HOLDER_PID"

# Provision only inside this disposable cluster, then resume with the same fixture manifest.
set_check boundary-provision-and-resume
for role in runtime auth owner-metrics global-writer; do
  set_check "boundary-provision-$role"
  case "$role" in
    runtime) var=runtime_password ;;
    auth) var=auth_password ;;
    owner-metrics) var=owner_metrics_password ;;
    global-writer) var=global_writer_password ;;
  esac
  docker exec -i "$CONTAINER" psql -X -v ON_ERROR_STOP=1 -U cocinacore -d "$DB" -v "$var=disposable_boundary_only" <"$ROOT/scripts/provision-$role-role.sql" >"$LOG" 2>&1 || { tail -n 8 "$LOG" >&2; fail 'candidate role provisioning failed'; }
done
set_check boundary-signup-owner-provision
docker exec -i "$CONTAINER" psql -X -v ON_ERROR_STOP=1 -U cocinacore -d "$DB" \
  <"$ROOT/scripts/provision-signup-bootstrap-roles.sql" >"$LOG" 2>&1 || { tail -n 8 "$LOG" >&2; fail 'signup owner provisioning failed'; }
set_check boundary-legacy-signup-with-inert-owner-roles
docker exec -e PGPASSWORD=disposable_boundary_only -i "$CONTAINER" psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -U cocinacore_auth -d "$DB" >"$LOG" 2>&1 <<'SQL'
begin;
do $$
declare new_tenant uuid; new_user uuid;
begin
  insert into public.tenants(name,tenant_type) values ('020e legacy fixture','home') returning id into new_tenant;
  insert into public.users(email,password_hash,tenant_id,role) values ('020e-legacy-fixture@example.test','fixture',new_tenant,'owner') returning id into new_user;
  insert into public.tenant_memberships(tenant_id,user_id,role) values (new_tenant,new_user,'owner');
  insert into public.sessions(user_id,token_hash,expires_at) values (new_user,'020e-legacy-fixture-token-hash',now()+interval '1 day');
end $$;
rollback;
SQL
[ "$(admin_sql "$DB" "select count(*) from public.users where email='020e-legacy-fixture@example.test'")" = 0 ] || fail 'legacy signup fixture did not roll back'
printf '%s\n' 'PASS: auth LOGIN retains atomic legacy signup with NOLOGIN owner roles present'
set_check boundary-auth-reprovision-rejects-owner-only-state
admin_sql "$DB" "insert into public.tenants(id,name) values ('e0100000-0000-4000-8000-000000000001','020e populated fixture'); insert into public.users(id,email,password_hash,tenant_id,role) values ('e0100000-0000-4000-8000-000000000002','020e-populated@example.test','fixture','e0100000-0000-4000-8000-000000000001','owner'); insert into public.tenant_memberships(tenant_id,user_id,role) values ('e0100000-0000-4000-8000-000000000001','e0100000-0000-4000-8000-000000000002','owner')" >/dev/null
boundary_identity_fingerprint() {
  {
    docker exec "$CONTAINER" pg_dumpall -U cocinacore --globals-only
    docker exec "$CONTAINER" pg_dump -U cocinacore -d "$DB" --schema-only
    docker exec "$CONTAINER" pg_dump -U cocinacore -d "$DB" --data-only
    admin_sql "$DB" "select coalesce(jsonb_agg(to_jsonb(t) order by t.id)::text,'[]') from public.tenants t; select coalesce(jsonb_agg(to_jsonb(u) order by u.id)::text,'[]') from public.users u; select coalesce(jsonb_agg(to_jsonb(m) order by m.tenant_id,m.user_id)::text,'[]') from public.tenant_memberships m;"
  } | sed '/^\\restrict /d; /^\\unrestrict /d' | shasum -a 256 | cut -d' ' -f1
}
AUTH_OWNER_ONLY_BEFORE=$(boundary_identity_fingerprint)
if docker exec -i "$CONTAINER" psql -X -v ON_ERROR_STOP=1 -U cocinacore -d "$DB" -v auth_password=disposable_boundary_only \
  <"$ROOT/scripts/provision-auth-role.sql" >"$LOG" 2>&1; then
  fail 'auth provisioner unexpectedly accepted pre-020 owner-only state'
fi
grep -q 'Refusing partial 020C1 identity installation' "$LOG" || { tail -n 8 "$LOG" >&2; fail 'auth owner-only incompatibility was not explicit'; }
AUTH_OWNER_ONLY_AFTER=$(boundary_identity_fingerprint)
[ "$AUTH_OWNER_ONLY_BEFORE" = "$AUTH_OWNER_ONLY_AFTER" ] || fail 'rejected auth reprovision mutated roles, schema or populated identity data'
printf '%s\n' 'PASS: auth reprovision rejects pre-020 owner-only state without mutation'
set_check boundary-legacy-metrics-login-active
[ "$(docker exec -e PGPASSWORD=disposable_boundary_only "$CONTAINER" psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -U cocinacore_owner_metrics -d "$DB" -Atqc "select current_user='cocinacore_owner_metrics' and tenants is not null and users is not null from public.owner_global_metrics")" = t ] || fail 'expected legacy metrics capability not observed'
printf '%s\n' 'PASS: legacy pre-020 metrics capability is active for its real LOGIN'
set_check boundary-legacy-writer-login-active
docker exec -e PGPASSWORD=disposable_boundary_only "$CONTAINER" psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -U cocinacore_global_writer -d "$DB" -qc "begin; insert into public.owner_write_global_books(title) values ('020e inert capability fixture'); rollback" >"$LOG" 2>&1 || { tail -n 8 "$LOG" >&2; fail 'expected legacy writer capability not observed'; }
[ "$(admin_sql "$DB" "select count(*) from public.global_books where title='020e inert capability fixture'")" = 0 ] || fail 'writer capability fixture was not rolled back'
printf '%s\n' 'PASS: legacy pre-020 writer LOGIN can insert through its view; fixture rolled back'
set_check boundary-inert-guard-rejects-active-metrics
if docker exec -i "$CONTAINER" psql -X -v ON_ERROR_STOP=1 -U cocinacore -d "$DB" \
  <"$ROOT/scripts/rls-candidates/020e-a1-inert-capability-guard.sql" >"$LOG" 2>&1; then
  fail 'inert guard accepted the legacy metrics grant'
fi
grep -q 'a login can read metrics view' "$LOG" || { tail -n 8 "$LOG" >&2; fail 'metrics inert-guard denial not explicit'; }
printf '%s\n' 'PASS: inert guard rejects pre-020 active metrics access'
set_check boundary-inert-guard-rejects-active-writer
if { printf '%s\n' 'begin;' 'revoke select on public.owner_global_metrics from cocinacore_owner_metrics;';
     cat "$ROOT/scripts/rls-candidates/020e-a1-inert-capability-guard.sql"; printf '%s\n' 'rollback;'; } |
  docker exec -i "$CONTAINER" psql -X -v ON_ERROR_STOP=1 -U cocinacore -d "$DB" >"$LOG" 2>&1; then
  fail 'inert guard accepted the legacy writer grants'
fi
grep -q 'a login can access writer view' "$LOG" || { tail -n 8 "$LOG" >&2; fail 'writer inert-guard denial not explicit'; }
printf '%s\n' 'PASS: inert guard rejects pre-020 active writer access'
set_check boundary-inert-guard-accepts-revoked-fixture
{ printf '%s\n' 'begin;' 'revoke select on public.owner_global_metrics from cocinacore_owner_metrics;' \
    'revoke insert on public.owner_write_global_books, public.owner_write_global_pdfs, public.owner_write_global_chunks from cocinacore_global_writer;' \
    'revoke select (id) on public.owner_write_global_books from cocinacore_global_writer;';
  cat "$ROOT/scripts/rls-candidates/020e-a1-inert-capability-guard.sql"; printf '%s\n' 'rollback;'; } |
  docker exec -i "$CONTAINER" psql -X -v ON_ERROR_STOP=1 -U cocinacore -d "$DB" >"$LOG" 2>&1 || { tail -n 8 "$LOG" >&2; fail 'inert guard rejected revoked fixture'; }
[ "$(admin_sql "$DB" "select has_table_privilege('cocinacore_owner_metrics','public.owner_global_metrics','SELECT') and has_table_privilege('cocinacore_global_writer','public.owner_write_global_books','INSERT') and has_column_privilege('cocinacore_global_writer','public.owner_write_global_books','id','SELECT')")" = t ] || fail 'inert fixture modified the original role grants'
printf '%s\n' 'PASS: inert guard accepts revoked fixture without persisting grant changes'
set_check boundary-inert-guard-rejects-signup-execute
if { printf '%s\n' 'begin;' "create function public.signup_new_account(text,text,text,timestamptz,text) returns integer language sql as 'select 1';";
     cat "$ROOT/scripts/rls-candidates/020e-a1-inert-capability-guard.sql"; printf '%s\n' 'rollback;'; } |
  docker exec -i "$CONTAINER" psql -X -v ON_ERROR_STOP=1 -U cocinacore -d "$DB" >"$LOG" 2>&1; then
  fail 'inert guard accepted a PUBLIC signup function'
fi
grep -q 'a login can execute signup' "$LOG" || { tail -n 8 "$LOG" >&2; fail 'signup inert-guard denial not explicit'; }
[ "$(admin_sql "$DB" "select to_regprocedure('public.signup_new_account(text,text,text,timestamptz,text)') is null")" = t ] || fail 'signup guard fixture left a function'
printf '%s\n' 'PASS: inert guard rejects PUBLIC signup execution'
set_check boundary-inert-guard-rejects-probe-access
if { printf '%s\n' 'begin;' 'create view public.runtime_identity_probe as select id, tenant_id from public.users;' \
    'grant select on public.runtime_identity_probe to cocinacore_runtime_rls;';
     cat "$ROOT/scripts/rls-candidates/020e-a1-inert-capability-guard.sql"; printf '%s\n' 'rollback;'; } |
  docker exec -i "$CONTAINER" psql -X -v ON_ERROR_STOP=1 -U cocinacore -d "$DB" >"$LOG" 2>&1; then
  fail 'inert guard accepted an accessible identity probe'
fi
grep -q 'a login can read identity probe' "$LOG" || { tail -n 8 "$LOG" >&2; fail 'probe inert-guard denial not explicit'; }
[ "$(admin_sql "$DB" "select to_regclass('public.runtime_identity_probe') is null")" = t ] || fail 'probe guard fixture left a view'
printf '%s\n' 'PASS: inert guard rejects accessible identity probe'
set_check boundary-inert-guard-rejects-membership
if { printf '%s\n' 'begin;' 'grant cocinacore_identity_probe to cocinacore_auth;';
     cat "$ROOT/scripts/rls-candidates/020e-a1-inert-capability-guard.sql"; printf '%s\n' 'rollback;'; } |
  docker exec -i "$CONTAINER" psql -X -v ON_ERROR_STOP=1 -U cocinacore -d "$DB" >"$LOG" 2>&1; then
  fail 'inert guard accepted unexpected NOLOGIN membership'
fi
grep -q 'missing or untrusted role cocinacore_identity_probe' "$LOG" || { tail -n 8 "$LOG" >&2; fail 'membership inert-guard denial not explicit'; }
[ "$(admin_sql "$DB" "select not exists(select 1 from pg_auth_members m join pg_roles r on r.oid=m.roleid where r.rolname='cocinacore_identity_probe')")" = t ] || fail 'membership guard fixture left a role grant'
printf '%s\n' 'PASS: inert guard rejects unexpected NOLOGIN membership'
for role in cocinacore_owner_metrics cocinacore_global_writer; do
  set_check "boundary-inert-guard-rejects-direct-table-$role"
  if { printf '%s\n' 'begin;' "grant select (id) on public.users to $role;";
       cat "$ROOT/scripts/rls-candidates/020e-a1-inert-capability-guard.sql"; printf '%s\n' 'rollback;'; } |
    docker exec -i "$CONTAINER" psql -X -v ON_ERROR_STOP=1 -U cocinacore -d "$DB" >"$LOG" 2>&1; then
    fail 'inert guard accepted direct table privilege'
  fi
  grep -q "login $role has direct table access" "$LOG" || { tail -n 8 "$LOG" >&2; fail 'direct-table inert-guard denial not explicit'; }
  [ "$(admin_sql "$DB" "select not has_column_privilege('$role','public.users','id','SELECT')")" = t ] || fail 'direct-table fixture left a grant'
  printf 'PASS: inert guard rejects direct table access for %s\n' "$role"
done
set_check boundary-restricted-identity-view-owner
cat >"$TMP_ROOT/e020-identity-owner.sql" <<'SQL'
create view public.e020_identity_owner_probe as select id, tenant_id from public.users;
alter view public.e020_identity_owner_probe owner to cocinacore_identity_probe;
SQL
E020_IDENTITY_DIR="$TMP_ROOT/e020-identity-fixture"
make_pre020_fixture "$E020_IDENTITY_DIR" identity_owner_probe.sql "$TMP_ROOT/e020-identity-owner.sql"
E020_IDENTITY_FILENAME=$GENERATED_FIXTURE_FILENAME
if MIGRATIONS_DIR="$E020_IDENTITY_DIR" MIGRATION_EXPECTED_PENDING="$E020_IDENTITY_FILENAME" migrate >"$LOG" 2>&1; then
  fail 'restricted migration identity unexpectedly transferred ownership to identity probe'
fi
grep -q 'PREPARED_CAPABILITIES_PARTIAL' "$LOG" || { tail -n 8 "$LOG" >&2; fail 'partial preparation was not rejected before identity DDL'; }
[ "$(admin_sql "$DB" "select to_regclass('public.e020_identity_owner_probe') is null")" = t ] || fail 'failed identity-owner transaction left a view'
[ "$(admin_sql "$DB" "select count(*) from public.schema_migrations where filename='$E020_IDENTITY_FILENAME'")" = 0 ] || fail 'failed identity-owner migration left a ledger row'
printf '%s\n' 'PASS: restricted migrator rejects partial preparation before identity-owner DDL'
set_check boundary-restricted-metrics-view-owner
METRICS_VIEW_BEFORE=$(admin_sql "$DB" "select md5(pg_get_viewdef('public.owner_global_metrics'::regclass,true))")
cat >"$TMP_ROOT/e020-metrics-owner.sql" <<'SQL'
create or replace view public.owner_global_metrics as select 0::bigint tenants, 0::bigint users, 0::bigint books, 0::bigint pdfs, 0::bigint chunks, 0::bigint reports, 0::bigint owners;
SQL
E020_METRICS_DIR="$TMP_ROOT/e020-metrics-fixture"
make_pre020_fixture "$E020_METRICS_DIR" metrics_owner_probe.sql "$TMP_ROOT/e020-metrics-owner.sql"
E020_METRICS_FILENAME=$GENERATED_FIXTURE_FILENAME
if MIGRATIONS_DIR="$E020_METRICS_DIR" MIGRATION_EXPECTED_PENDING="$E020_METRICS_FILENAME" migrate >"$LOG" 2>&1; then
  fail 'restricted migration identity unexpectedly replaced the metrics-owner view'
fi
grep -q 'PREPARED_CAPABILITIES_PARTIAL' "$LOG" || { tail -n 8 "$LOG" >&2; fail 'partial preparation was not rejected before metrics DDL'; }
[ "$(admin_sql "$DB" "select md5(pg_get_viewdef('public.owner_global_metrics'::regclass,true))")" = "$METRICS_VIEW_BEFORE" ] || fail 'failed metrics migration changed the view'
[ "$(admin_sql "$DB" "select count(*) from public.schema_migrations where filename='$E020_METRICS_FILENAME'")" = 0 ] || fail 'failed metrics migration left a ledger row'
printf '%s\n' 'PASS: restricted migrator rejects partial preparation before metrics-owner DDL'
set_check boundary-resume
if MIGRATIONS_DIR="$BOUNDARY_DIR" MIGRATION_EXPECTED_PENDING="$BOUNDARY_NEXT" migrate >"$LOG" 2>&1; then
  fail 'runner resumed synthetic 020 with a partially prepared legacy state'
fi
grep -q PREPARED_CAPABILITIES_PARTIAL "$LOG" || { tail -n 8 "$LOG" >&2; fail 'partial boundary rejection was not explicit'; }
[ "$(admin_sql "$DB" "select count(*) from schema_migrations where filename='$BOUNDARY_NEXT'")" = 0 ] || fail 'partial state left a synthetic 020 ledger entry'
unset MIGRATION_EXPECTED_PENDING
unset MIGRATIONS_DIR MIGRATION_EXPECTED_PENDING

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
MIGRATIONS_DIR="$BOUNDARY_DIR" migrate --stop-after 019 >"$LOG" 2>&1
set_check assert_legacy_migration_milestones
grep -q 'DONE 012_meal_plan_consumption.sql' "$LOG" || fail 'legacy upgrade did not reach milestone 012'
grep -q 'DONE 014_culinary_profile_field_constraints.sql' "$LOG" || fail 'legacy upgrade did not complete manifest migration 014'
set_check assert_legacy_migration_ledger_count
[ "$(admin_sql "$DB" "select count(*) from schema_migrations")" = "$EXPECTED_PRE020_MIGRATION_COUNT" ] || fail 'legacy upgrade ledger is not exactly the pre-020 prefix'
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
set_check legacy017_runtime_ledger_select
[ "$(runtime_sql "$DB" 'select count(*) from public.schema_migrations')" = 17 ] || fail 'runtime role cannot read all 17 legacy ledger rows after provision'
set_check legacy017_runtime_ledger_policy
[ "$(admin_sql "$DB" "select c.relrowsecurity||','||c.relforcerowsecurity||','||(select count(*) from pg_catalog.pg_policy p where p.polrelid=c.oid and p.polname='schema_migrations_runtime_select' and p.polcmd='r' and p.polpermissive and p.polroles=array[(select oid from pg_catalog.pg_roles where rolname='cocinacore_user')]::oid[] and pg_catalog.pg_get_expr(p.polqual,p.polrelid)='true' and p.polwithcheck is null and (select count(*) from pg_catalog.pg_policy other where other.polrelid=c.oid)=1) from pg_catalog.pg_class c where c.oid='public.schema_migrations'::pg_catalog.regclass")" = 'true,false,1' ] || fail 'migration ledger SELECT policy does not match the exact runtime-only contract'
set_check legacy017_runtime_ledger_read_only
if runtime_sql "$DB" "update public.schema_migrations set applied_at=applied_at where filename='001_extensions_and_core.sql'" >"$LOG" 2>&1; then
  fail 'runtime role unexpectedly updated the migration ledger'
fi
grep -qi 'permission denied' "$LOG" || fail 'runtime ledger write rejection was not a permission denial'
set_check legacy017_runtime_unlisted_table_denial
if runtime_sql "$DB" 'select count(*) from public.premium_recipes' >"$LOG" 2>&1; then
  fail 'runtime role unexpectedly read the unlisted premium_recipes table'
fi
grep -qi 'permission denied' "$LOG" || fail 'unlisted table rejection was not a permission denial'
set_check legacy017_exact_pending_m5
migrate_m5_pending >"$LOG" 2>&1
grep -q 'DONE 018_cooking_sessions.sql' "$LOG" || fail 'legacy 017 continuation did not apply 018'
grep -q 'DONE 019_real_consumption_reconciliation.sql' "$LOG" || fail 'legacy 017 continuation did not apply 019'
set_check legacy017_verify_boundary
MIGRATIONS_DIR="$ROOT/db/migrations" migrate --verify-boundary 019 >"$LOG" 2>&1
grep -q 'BOUNDARY 019 verified' "$LOG" || fail 'legacy 017 continuation did not verify the complete 001-019 prefix'
[ "$(admin_sql "$DB" "select count(*) from schema_migrations")" = "$EXPECTED_PRE020_MIGRATION_COUNT" ] || fail 'legacy 017 ledger is not complete through 019'
[ "$(admin_sql "$DB" "select count(*) from schema_migrations where filename in ('018_cooking_sessions.sql','019_real_consumption_reconciliation.sql') and checksum_source='migration_file' and checksum is not null")" = 2 ] || fail '018/019 migration-file provenance is missing'
[ "$(admin_sql "$DB" "select count(*) from schema_migrations where checksum_source='legacy_unverifiable' and checksum is null")" = 7 ] || fail '018/019 continuation changed unknown historic checksums'
[ "$(runtime_sql "$DB" 'select count(*) from public.schema_migrations')" = "$EXPECTED_PRE020_MIGRATION_COUNT" ] || fail 'runtime role cannot read the full 019 migration ledger'
set_check runtime_ledger_no_update
if runtime_sql "$DB" "update public.schema_migrations set applied_at=applied_at where filename='001_extensions_and_core.sql'" >"$LOG" 2>&1; then
  fail 'runtime role unexpectedly updated the completed migration ledger'
fi
grep -qi 'permission denied' "$LOG" || fail 'completed runtime ledger write rejection was not a permission denial'
set_check runtime_app_repository_operations
(
  cd "$ROOT/frontend"
  COCINACORE_PROVISIONED_RUNTIME_INTEGRATION=true \
  DATABASE_URL="$RUNTIME_URL" \
  RUNTIME_TEST_ADMIN_DATABASE_URL="$ADMIN_URL" \
  npm test -- src/lib/db/runtime-provisioning.integration.test.ts
) >"$LOG" 2>&1 || {
  cat "$LOG" >&2
  fail 'application repository operations failed under the provisioned runtime role'
}
grep -Eq '1 passed|Tests  1 passed' "$LOG" || fail 'runtime application integration test did not report one passing test'
set_check runtime_baseline_acl_matrix
RUNTIME_ACL_SQL=$(node - "$ROOT/frontend/scripts/provision-database.js" <<'NODE'
const { RUNTIME_TABLE_PRIVILEGES } = require(process.argv[2]);
const tables = Object.keys(RUNTIME_TABLE_PRIVILEGES).sort();
const privileges = ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'];
const rows = tables.map((table) => `select '${table}' as table_name, ${privileges
  .map((privilege) => `pg_catalog.has_table_privilege('cocinacore_user', 'public.${table}', '${privilege}')::int`)
  .join(', ')}`);
console.log(rows.join(' union all ') + ' order by table_name');
NODE
)
RUNTIME_ACL_ACTUAL=$(admin_sql "$DB" "$RUNTIME_ACL_SQL" | LC_ALL=C sort)
RUNTIME_ACL_EXPECTED=$(node - "$ROOT/frontend/scripts/provision-database.js" <<'NODE' | LC_ALL=C sort
const { RUNTIME_TABLE_PRIVILEGES } = require(process.argv[2]);
const tables = Object.keys(RUNTIME_TABLE_PRIVILEGES).sort();
const privileges = ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'];
console.log(tables.map((table) => `${table}|${privileges
  .map((privilege) => RUNTIME_TABLE_PRIVILEGES[table]?.includes(privilege) ? 1 : 0)
  .join('|')}`).join('\n'));
NODE
)
if [ "$RUNTIME_ACL_ACTUAL" != "$RUNTIME_ACL_EXPECTED" ]; then
  printf '%s\n' 'runtime ACL matrix actual:' "$RUNTIME_ACL_ACTUAL" 'runtime ACL matrix expected:' "$RUNTIME_ACL_EXPECTED" >&2
  fail 'runtime privileges on the baseline 31-table set are not the exact fixed contract'
fi
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

stop_container
STAGE=inert-preparation
set_check inert-development-fixture
ADMIN_PASSWORD=$(openssl rand -hex 18)
MIGRATION_PASSWORD=$(openssl rand -hex 18)
start_container inert cocinacore_inert
provision >"$LOG" 2>&1 || { tail -n 12 "$LOG" >&2; fail 'inert bootstrap failed'; }
migrate --stop-after 019 >"$LOG" 2>&1 || { tail -n 12 "$LOG" >&2; fail 'inert 019 migration failed'; }
migrate --verify-boundary 019 >"$LOG" 2>&1 || { tail -n 12 "$LOG" >&2; fail 'inert 019 boundary verification failed'; }
cat >"$TMP_ROOT/r2-before-preparation.sql" <<'SQL'
create policy r2_unprepared_fixture on public.user_recipes as restrictive for select to public using (true);
SQL
R2_UNPREPARED_DIR="$TMP_ROOT/r2-before-preparation"
make_pre020_fixture "$R2_UNPREPARED_DIR" r2_unprepared_fixture.sql "$TMP_ROOT/r2-before-preparation.sql"
R2_UNPREPARED_FILENAME=$GENERATED_FIXTURE_FILENAME
INERT_BEFORE=$(boundary_identity_fingerprint)
if MIGRATIONS_DIR="$R2_UNPREPARED_DIR" migrate >"$LOG" 2>&1; then fail 'runner applied 020 without preparation'; fi
grep -q PREPARED_CAPABILITIES_PARTIAL "$LOG" || { tail -n 12 "$LOG" >&2; fail 'unprepared 020 rejection was not explicit'; }
[ "$INERT_BEFORE" = "$(boundary_identity_fingerprint)" ] || fail 'unprepared 020 rejection mutated role, schema or data'
[ "$(admin_sql "$DB" "select count(*) from public.schema_migrations where filename='$R2_UNPREPARED_FILENAME'")" = 0 ] || fail 'unprepared 020 left a ledger row'
printf '%s\n' 'PASS: runner rejects synthetic 020 before SQL or ledger when unprepared'
for role in runtime auth; do
  case "$role" in runtime) var=runtime_password ;; auth) var=auth_password ;; esac
  docker exec -i "$CONTAINER" psql -X -v ON_ERROR_STOP=1 -U cocinacore -d "$DB" -v "$var=disposable_boundary_only" <"$ROOT/scripts/provision-$role-role.sql" >"$LOG" 2>&1 || { tail -n 12 "$LOG" >&2; fail 'inert baseline login provisioning failed'; }
done
INERT_SCRIPT="$ROOT/scripts/provision-020-inert-capabilities.sql"
admin_sql "$DB" "insert into public.tenants(id,name) values ('e0200000-0000-4000-8000-000000000001','020 inert populated fixture'); insert into public.users(id,email,password_hash,tenant_id,role) values ('e0200000-0000-4000-8000-000000000002','020-inert-existing@example.test','fixture','e0200000-0000-4000-8000-000000000001','owner'); insert into public.tenant_memberships(tenant_id,user_id,role) values ('e0200000-0000-4000-8000-000000000001','e0200000-0000-4000-8000-000000000002','owner')" >/dev/null
set_check inert-injected-failure-rollback
INERT_BEFORE=$(boundary_identity_fingerprint)
awk '{print} /ALTER VIEW public.runtime_identity_probe OWNER TO cocinacore_identity_probe;/ {print "SELECT 1/0;"}' "$INERT_SCRIPT" >"$TMP_ROOT/inert-injected-failure.sql"
if docker exec -i "$CONTAINER" psql -X -1 -v ON_ERROR_STOP=1 -U cocinacore -d "$DB" -v metrics_password=disposable_boundary_only -v global_writer_password=disposable_boundary_only <"$TMP_ROOT/inert-injected-failure.sql" >"$LOG" 2>&1; then fail 'injected inert preparation failure succeeded'; fi
grep -q 'division by zero' "$LOG" || { tail -n 12 "$LOG" >&2; fail 'injected failure did not reach intended statement'; }
[ "$INERT_BEFORE" = "$(boundary_identity_fingerprint)" ] || fail 'injected preparation failure mutated role, schema or populated identity data'
[ "$(admin_sql "$DB" "select count(*) from public.schema_migrations")" = 19 ] || fail 'injected preparation failure changed the ledger'
printf '%s\n' 'PASS: injected inert preparation failure rolls back objects, roles, schema and data'
set_check inert-partial-fixture-rejected
admin_sql "$DB" 'create view public.runtime_identity_probe as select id,tenant_id from public.users' >/dev/null
INERT_BEFORE=$(boundary_identity_fingerprint)
if docker exec -i "$CONTAINER" psql -X -1 -v ON_ERROR_STOP=1 -U cocinacore -d "$DB" -v metrics_password=disposable_boundary_only -v global_writer_password=disposable_boundary_only <"$INERT_SCRIPT" >"$LOG" 2>&1; then fail 'inert preparer accepted a partial fixture'; fi
grep -q 'refuses partial object state' "$LOG" || { tail -n 12 "$LOG" >&2; fail 'partial fixture rejection was not explicit'; }
[ "$INERT_BEFORE" = "$(boundary_identity_fingerprint)" ] || fail 'partial fixture rejection mutated role, schema or populated identity data'
admin_sql "$DB" 'drop view public.runtime_identity_probe' >/dev/null
printf '%s\n' 'PASS: inert preparer rejects partial object fixture without mutation'
set_check inert-missing-password-rollback
INERT_BEFORE=$(boundary_identity_fingerprint)
if docker exec -i "$CONTAINER" psql -X -1 -v ON_ERROR_STOP=1 -U cocinacore -d "$DB" -v metrics_password=disposable_boundary_only <"$INERT_SCRIPT" >"$LOG" 2>&1; then fail 'inert preparer accepted a missing writer password'; fi
grep -q 'global_writer_password is required' "$LOG" || { tail -n 12 "$LOG" >&2; fail 'missing writer password error was not explicit'; }
[ "$INERT_BEFORE" = "$(boundary_identity_fingerprint)" ] || fail 'missing password left a role, schema or data change'
printf '%s\n' 'PASS: missing writer credential rolls back previously created metrics role'
docker exec -i "$CONTAINER" psql -X -1 -v ON_ERROR_STOP=1 -U cocinacore -d "$DB" -v metrics_password=disposable_boundary_only -v global_writer_password=disposable_boundary_only <"$INERT_SCRIPT" >"$LOG" 2>&1 || { tail -n 20 "$LOG" >&2; fail 'inert preparation failed'; }
printf '%s\n' 'PASS: inert preparer installed and attested seven objects'
docker exec -i "$CONTAINER" psql -X -1 -v ON_ERROR_STOP=1 -U cocinacore -d "$DB" <"$ROOT/scripts/rls-candidates/020e-a1-inert-capability-guard.sql" >"$LOG" 2>&1 || { tail -n 12 "$LOG" >&2; fail 'standalone inert capability guard rejected prepared state'; }
printf '%s\n' 'PASS: standalone inert capability guard accepts prepared state'
set_check runner-prepared-boundary-attestation
migrate --verify-boundary 019 >"$LOG" 2>&1 || { tail -n 15 "$LOG" >&2; fail 'restricted runner rejected the prepared 019 state'; }
grep -q 'BOUNDARY 019 verified' "$LOG" || fail 'prepared 019 runner boundary verification marker missing'
printf '%s\n' 'PASS: restricted runner attests prepared seven-object state at boundary 019'
set_check inert-role-logins-denied
for item in auth probe metrics writer; do
  case "$item" in
    auth) login=cocinacore_auth; sql="select * from public.signup_new_account('020-denied@example.test','fixture','Denied',now(),'v1')" ;;
    probe) login=cocinacore_runtime_rls; sql='select * from public.runtime_identity_probe' ;;
    metrics) login=cocinacore_owner_metrics; sql='select * from public.owner_global_metrics' ;;
    writer) login=cocinacore_global_writer; sql="insert into public.owner_write_global_books(title) values ('020 denied writer')" ;;
  esac
  if docker exec -e PGPASSWORD=disposable_boundary_only "$CONTAINER" psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -U "$login" -d "$DB" -qc "$sql" >"$LOG" 2>&1; then fail "inert $item LOGIN capability unexpectedly succeeded"; fi
  grep -Eq 'permission denied' "$LOG" || { tail -n 10 "$LOG" >&2; fail "inert $item denial was not a privilege denial"; }
done
printf '%s\n' 'PASS: four real LOGINs cannot use inert signup, probe, metrics or writer capabilities'
for login in cocinacore_auth cocinacore_runtime_rls cocinacore_owner_metrics cocinacore_global_writer; do
  for owner in cocinacore_identity_probe cocinacore_signup_bootstrap cocinacore_metrics_view_owner cocinacore_global_writer_view_owner; do
    if docker exec -e PGPASSWORD=disposable_boundary_only "$CONTAINER" psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -U "$login" -d "$DB" -qc "set role $owner" >"$LOG" 2>&1; then fail 'a LOGIN assumed an independent NOLOGIN owner'; fi
    grep -q 'permission denied to set role' "$LOG" || { tail -n 10 "$LOG" >&2; fail 'SET ROLE denial was not a privilege denial'; }
  done
done
printf '%s\n' 'PASS: all four real LOGINs are denied SET ROLE to all four independent owners'
set_check inert-legacy-signup
docker exec -e PGPASSWORD=disposable_boundary_only -i "$CONTAINER" psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -U cocinacore_auth -d "$DB" >"$LOG" 2>&1 <<'SQL'
begin;
do $$
declare new_tenant uuid; new_user uuid;
begin
  insert into public.tenants(name,tenant_type) values ('020 inert legacy fixture','home') returning id into new_tenant;
  insert into public.users(email,password_hash,tenant_id,role) values ('020-inert-legacy@example.test','fixture',new_tenant,'owner') returning id into new_user;
  insert into public.tenant_memberships(tenant_id,user_id,role) values (new_tenant,new_user,'owner');
  insert into public.sessions(user_id,token_hash,expires_at) values (new_user,'020-inert-fixture-hash',now()+interval '1 day');
end $$;
rollback;
SQL
printf '%s\n' 'PASS: legacy signup SQL remains usable after inert preparation'
set_check inert-idempotence
INERT_BEFORE=$(boundary_identity_fingerprint)
docker exec -i "$CONTAINER" psql -X -1 -v ON_ERROR_STOP=1 -U cocinacore -d "$DB" -v metrics_password=incorrect_rotation_attempt -v global_writer_password=incorrect_rotation_attempt <"$INERT_SCRIPT" >"$LOG" 2>&1 || { tail -n 20 "$LOG" >&2; fail 'inert re-provision failed'; }
[ "$INERT_BEFORE" = "$(boundary_identity_fingerprint)" ] || fail 'inert re-provision mutated roles, schema or populated identity data'
docker exec -e PGPASSWORD=disposable_boundary_only "$CONTAINER" psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -U cocinacore_owner_metrics -d "$DB" -Atqc 'select current_user' >/dev/null || fail 'metrics password changed during re-provision'
docker exec -e PGPASSWORD=disposable_boundary_only "$CONTAINER" psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -U cocinacore_global_writer -d "$DB" -Atqc 'select current_user' >/dev/null || fail 'writer password changed during re-provision'
printf '%s\n' 'PASS: inert preparation is idempotent without credential rotation'
cat >"$TMP_ROOT/r2-drift-probe.sql" <<'SQL'
create policy r2_drift_fixture on public.user_recipes as restrictive for select to cocinacore_runtime_rls using (true);
SQL
R2_DRIFT_DIR="$TMP_ROOT/r2-drift-probe"
make_pre020_fixture "$R2_DRIFT_DIR" r2_drift_fixture.sql "$TMP_ROOT/r2-drift-probe.sql"
R2_DRIFT_FILENAME=$GENERATED_FIXTURE_FILENAME
for fixture in owner grant public_grant view_definition signup_owner membership source_grant missing definer search_path extra_owned barrier check_option owner_bypass; do
  set_check "inert-drift-$fixture"
  case "$fixture" in
    owner) change='alter view public.runtime_identity_probe owner to cocinacore_schema_owner'; undo='alter view public.runtime_identity_probe owner to cocinacore_identity_probe' ;;
    grant) change='grant select on public.runtime_identity_probe to cocinacore_runtime_rls'; undo='revoke select on public.runtime_identity_probe from cocinacore_runtime_rls' ;;
    public_grant) change='grant select on public.owner_global_metrics to public'; undo='revoke select on public.owner_global_metrics from public' ;;
    view_definition) change='create or replace view public.owner_write_global_pdfs as select global_book_id,storage_path,file_size_bytes,page_count,checksum_sha256,uploaded_by from public.global_pdf_library where true'; undo='create or replace view public.owner_write_global_pdfs as select global_book_id,storage_path,file_size_bytes,page_count,checksum_sha256,uploaded_by from public.global_pdf_library' ;;
    signup_owner) change='alter function public.signup_new_account(text,text,text,timestamptz,text) owner to cocinacore_schema_owner'; undo='alter function public.signup_new_account(text,text,text,timestamptz,text) owner to cocinacore_signup_bootstrap' ;;
    membership) change='grant cocinacore_identity_probe to cocinacore_auth'; undo='revoke cocinacore_identity_probe from cocinacore_auth' ;;
    source_grant) change='grant select (password_hash) on public.users to cocinacore_identity_probe'; undo='revoke select (password_hash) on public.users from cocinacore_identity_probe' ;;
    missing) change='alter view public.owner_write_global_pdfs rename to r2_pdf_missing_fixture'; undo='alter view public.r2_pdf_missing_fixture rename to owner_write_global_pdfs' ;;
    definer) change='alter function public.signup_new_account(text,text,text,timestamptz,text) security invoker'; undo='alter function public.signup_new_account(text,text,text,timestamptz,text) security definer' ;;
    search_path) change='alter function public.signup_new_account(text,text,text,timestamptz,text) set search_path to public'; undo='alter function public.signup_new_account(text,text,text,timestamptz,text) set search_path to pg_catalog' ;;
    extra_owned) change='create view public.r2_extra_owned as select 1 as value; alter view public.r2_extra_owned owner to cocinacore_identity_probe'; undo='drop view public.r2_extra_owned' ;;
    barrier) change='alter view public.runtime_identity_probe set (security_barrier=false)'; undo='alter view public.runtime_identity_probe set (security_barrier=true)' ;;
    check_option) change='alter view public.owner_write_global_chunks set (check_option=local)'; undo='alter view public.owner_write_global_chunks set (check_option=cascaded)' ;;
    owner_bypass) change='alter role cocinacore_identity_probe bypassrls'; undo='alter role cocinacore_identity_probe nobypassrls' ;;
  esac
  admin_sql "$DB" "$change" >/dev/null
  INERT_BEFORE=$(boundary_identity_fingerprint)
  if docker exec -i "$CONTAINER" psql -X -1 -v ON_ERROR_STOP=1 -U cocinacore -d "$DB" <"$INERT_SCRIPT" >"$LOG" 2>&1; then fail "inert preparer accepted $fixture drift"; fi
  [ "$INERT_BEFORE" = "$(boundary_identity_fingerprint)" ] || fail "inert $fixture drift rejection mutated role, schema or populated identity data"
  if migrate --verify-boundary 019 >"$LOG" 2>&1; then fail "restricted runner accepted $fixture drift"; fi
  grep -Eq 'PREPARED_CAPABILITIES_(PARTIAL|MISMATCH)|ROLE_STATE_MISMATCH' "$LOG" || { tail -n 12 "$LOG" >&2; fail "runner $fixture drift rejection was not explicit"; }
  [ "$INERT_BEFORE" = "$(boundary_identity_fingerprint)" ] || fail "runner $fixture drift rejection mutated role, schema or populated identity data"
  if MIGRATIONS_DIR="$R2_DRIFT_DIR" migrate >"$LOG" 2>&1; then fail "restricted runner applied 020 with $fixture drift"; fi
  grep -Eq 'PREPARED_CAPABILITIES_(PARTIAL|MISMATCH)|ROLE_STATE_MISMATCH' "$LOG" || { tail -n 12 "$LOG" >&2; fail "runner $fixture migration drift rejection was not explicit"; }
  [ "$INERT_BEFORE" = "$(boundary_identity_fingerprint)" ] || fail "runner 020 $fixture drift rejection mutated role, schema or populated identity data"
  [ "$(admin_sql "$DB" "select count(*) from public.schema_migrations where filename='$R2_DRIFT_FILENAME'")" = 0 ] || fail "runner 020 $fixture drift left a ledger row"
  admin_sql "$DB" "$undo" >/dev/null
  printf 'PASS: inert preparer and restricted runner rejected %s drift without mutation\n' "$fixture"
done
[ "$(admin_sql "$DB" "select count(*) from public.schema_migrations")" = 19 ] || fail 'inert preparation changed migration ledger'
printf '%s\n' 'PASS: inert preparation leaves migration ledger at 019'

set_check runner-restored-prepared-boundary
migrate --verify-boundary 019 >"$LOG" 2>&1 || { tail -n 15 "$LOG" >&2; fail 'runner rejected restored prepared state'; }
printf '%s\n' 'PASS: restricted runner accepts restored prepared state'

set_check runner-synthetic-020-rollback
cat >"$TMP_ROOT/r2-020-failure.sql" <<'SQL'
create policy r2_inert_failure on public.user_recipes as restrictive for select to cocinacore_runtime_rls using (true);
select 1/0;
SQL
R2_FAILURE_DIR="$TMP_ROOT/r2-020-failure"
make_pre020_fixture "$R2_FAILURE_DIR" r2_inert_failure.sql "$TMP_ROOT/r2-020-failure.sql"
R2_FAILURE_FILENAME=$GENERATED_FIXTURE_FILENAME
INERT_BEFORE=$(boundary_identity_fingerprint)
if MIGRATIONS_DIR="$R2_FAILURE_DIR" migrate >"$LOG" 2>&1; then fail 'failing synthetic 020 succeeded'; fi
grep -q 'division by zero' "$LOG" || { tail -n 15 "$LOG" >&2; fail 'synthetic 020 did not reach its injected failure'; }
[ "$INERT_BEFORE" = "$(boundary_identity_fingerprint)" ] || fail 'failing synthetic 020 changed role, schema or populated identity data'
[ "$(admin_sql "$DB" "select count(*) from public.schema_migrations where filename='$R2_FAILURE_FILENAME'")" = 0 ] || fail 'failing synthetic 020 left a ledger row'
printf '%s\n' 'PASS: synthetic 020 DDL and ledger roll back after injected failure'

printf '%s\n' 'PASS: incomplete synthetic 020 rolls back; successful post-020 transition is covered by the complete R3 fixture'

STAGE=canonical-020-runner
R3_FILENAME=020_tenant_rls_hardening.sql
R3_CHECKSUM=$(node - "$R3_DIR/manifest.json" "$R3_FILENAME" <<'NODE'
const fs = require('node:fs');
const manifest = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
process.stdout.write(manifest.migrations.find((entry) => entry.filename === process.argv[3]).sha256);
NODE
)

# Inject a failure at the end of the real 020 body and use a temporary, fixed
# 001-019 manifest prefix. The runner must roll back all policy and ledger DDL.
cp "$ROOT/db/migrations/$R3_FILENAME" "$TMP_ROOT/canonical-020-failure.sql"
printf '\nSELECT 1 / 0;\n' >>"$TMP_ROOT/canonical-020-failure.sql"
R3_FAILURE_DIR="$TMP_ROOT/canonical-020-failure"
make_pre020_fixture "$R3_FAILURE_DIR" canonical_020_failure.sql "$TMP_ROOT/canonical-020-failure.sql"
R3_FAILURE_FILENAME=$GENERATED_FIXTURE_FILENAME
set_check canonical-020-runner-rollback
R3_FAILURE_BEFORE=$(boundary_identity_fingerprint)
if MIGRATIONS_DIR="$R3_FAILURE_DIR" migrate >"$LOG" 2>&1; then fail 'fault-injected canonical 020 succeeded'; fi
grep -q 'division by zero' "$LOG" || { tail -n 15 "$LOG" >&2; fail 'canonical 020 did not reach the injected SQL failure'; }
[ "$R3_FAILURE_BEFORE" = "$(boundary_identity_fingerprint)" ] || fail 'failed canonical 020 changed schema, roles, ACLs, ledger or populated identity data'
[ "$(admin_sql "$DB" "select count(*) from public.schema_migrations where filename='$R3_FAILURE_FILENAME'")" = 0 ] || fail 'failed canonical 020 left a ledger row'
[ "$(admin_sql "$DB" "select count(*) from public.schema_migrations")" = 19 ] || fail 'failed canonical 020 moved the trusted ledger beyond 019'
printf '%s\n' 'PASS: real 020 SQL and ledger roll back completely after an injected PostgreSQL error'

set_check canonical-020-runner-applies
MIGRATIONS_DIR="$R3_DIR" MIGRATION_EXPECTED_PENDING="$R3_FILENAME" migrate >"$LOG" 2>&1 || { tail -n 30 "$LOG" >&2; fail 'restricted runner rejected canonical 020'; }
unset MIGRATION_EXPECTED_PENDING
grep -q "DONE $R3_FILENAME" "$LOG" || fail 'canonical 020 was not committed by the restricted runner'
grep -q 'ACTIVATION PENDING' "$LOG" || fail 'runner did not report pending capability activation'
[ "$(admin_sql "$DB" "select count(*) from public.schema_migrations where filename='$R3_FILENAME' and checksum='$R3_CHECKSUM'")" = 1 ] || fail 'canonical 020 ledger/checksum is missing'
[ "$(admin_sql "$DB" 'select count(*) from public.schema_migrations')" = "$EXPECTED_MIGRATION_COUNT" ] || fail 'canonical complete ledger count does not match the manifest'
[ "$(admin_sql "$DB" 'select count(*) from pg_policy')" = 71 ] || fail 'canonical 020 did not install the complete 71-policy contract'
[ "$(admin_sql "$DB" "select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relrowsecurity and c.relforcerowsecurity")" = 27 ] || fail 'canonical 020 did not FORCE RLS on exactly the 27 reviewed public relations'
[ "$(admin_sql "$DB" "select not has_table_privilege('cocinacore_runtime_rls','public.runtime_identity_probe','SELECT') and not has_function_privilege('cocinacore_auth','public.signup_new_account(text,text,text,timestamptz,text)','EXECUTE') and not has_table_privilege('cocinacore_owner_metrics','public.owner_global_metrics','SELECT') and not has_table_privilege('cocinacore_global_writer','public.owner_write_global_books','INSERT')")" = t ] || fail 'canonical 020 activated one or more R4-reserved LOGIN grants'
printf '%s\n' 'PASS: official restricted runner applied canonical 020 with 71 policies, 27 FORCE RLS relations and R4 grants pending'

set_check canonical-020-runner-idempotence-pending
R3_BEFORE=$(boundary_identity_fingerprint)
MIGRATIONS_DIR="$R3_DIR" migrate >"$LOG" 2>&1 || { tail -n 15 "$LOG" >&2; fail 'canonical 020 pending-state rerun failed'; }
grep -q "SKIP $R3_FILENAME" "$LOG" || fail 'canonical 020 rerun reapplied the migration'
grep -q 'ACTIVATION PENDING' "$LOG" || fail 'canonical 020 rerun failed to expose pending activation'
[ "$R3_BEFORE" = "$(boundary_identity_fingerprint)" ] || fail 'canonical 020 rerun mutated the catalog or data'
set_check canonical-020-verify-complete-pending
if MIGRATIONS_DIR="$R3_DIR" migrate --verify-complete >"$LOG" 2>&1; then fail 'verify-complete accepted canonical 020 while activation was pending'; fi
grep -q 'ACTIVATION_PENDING' "$LOG" || { tail -n 15 "$LOG" >&2; fail 'incomplete activation rejection was not explicit'; }
admin_sql "$DB" "update public.schema_migrations set checksum=repeat('0',64) where filename='$R3_FILENAME'" >/dev/null
if MIGRATIONS_DIR="$R3_DIR" migrate --verify-complete >"$LOG" 2>&1; then fail 'runner accepted corrupted canonical 020 checksum'; fi
grep -q 'MIGRATION_CHECKSUM_MISMATCH' "$LOG" || { tail -n 15 "$LOG" >&2; fail 'canonical 020 checksum mismatch was not explicit'; }
admin_sql "$DB" "update public.schema_migrations set checksum='$R3_CHECKSUM' where filename='$R3_FILENAME'" >/dev/null
printf '%s\n' 'PASS: canonical checksum is enforced and verify-complete rejects the structurally complete but inactive state'

set_check activation-contract-activate-disposable-fixture
R4_SCRIPT="$ROOT/frontend/scripts/activate-020-capabilities.js"
run_r4_activation_candidate() {
  COCINACORE_ACTIVATION_DATABASE_URL="$ADMIN_URL" NODE_PATH="$ROOT/frontend/node_modules" \
    node "$R4_SCRIPT" >"$LOG" 2>&1
}
expect_r4_activation_rejection() {
  r4_label=$1; r4_marker=$2
  r4_before=$(boundary_identity_fingerprint)
  if run_r4_activation_candidate; then fail "activation candidate accepted $r4_label"; fi
  grep -Eq "$r4_marker" "$LOG" || { tail -n 12 "$LOG" >&2; fail "wrong activation rejection for $r4_label"; }
  if grep -Fq "$ADMIN_PASSWORD" "$LOG" || grep -Fq "$ADMIN_URL" "$LOG"; then fail "activation candidate logged a secret for $r4_label"; fi
  r4_after=$(boundary_identity_fingerprint)
  [ "$r4_before" = "$r4_after" ] || fail "activation candidate mutated state while rejecting $r4_label"
  printf 'PASS: activation candidate rejected %s without mutation\n' "$r4_label"
}

set_check activation-contract-pending-signup-maintenance-gap
SIGNUP_PENDING_BEFORE=$(boundary_identity_fingerprint)
if docker exec -e PGPASSWORD=disposable_boundary_only "$CONTAINER" psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -U cocinacore_auth -d "$DB" -qc \
  "select * from public.signup_new_account('020e-pending@example.test','fixture','Pending',now(),'terms-v1')" >"$LOG" 2>&1; then
  fail 'auth LOGIN executed signup while structural 020 activation was pending'
fi
grep -q 'permission denied' "$LOG" || { tail -n 8 "$LOG" >&2; fail 'pending signup failed for an unexpected reason'; }
if docker exec -e PGPASSWORD=disposable_boundary_only "$CONTAINER" psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -U cocinacore_auth -d "$DB" -qc \
  "insert into public.tenants(name,tenant_type) values ('020e-pending-legacy','home')" >"$LOG" 2>&1; then
  fail 'auth LOGIN retained legacy direct INSERT after structural 020'
fi
grep -q 'permission denied' "$LOG" || { tail -n 8 "$LOG" >&2; fail 'legacy signup denial was unexpected'; }
[ "$SIGNUP_PENDING_BEFORE" = "$(boundary_identity_fingerprint)" ] || fail 'pending signup attempts left partial tenant/user/membership data'
printf '%s\n' 'PASS: post-020 pending state rejects signup explicitly with no partial records; maintenance required'

set_check activation-contract-rejects-partial-grant-state
admin_sql "$DB" "BEGIN; SET ROLE cocinacore_signup_bootstrap; GRANT EXECUTE ON FUNCTION public.signup_new_account(text,text,text,timestamptz,text) TO cocinacore_auth; RESET ROLE; COMMIT" >/dev/null
expect_r4_activation_rejection 'partial activation grant set' 'ACTIVATION_PARTIAL_GRANTS'
if MIGRATIONS_DIR="$R3_DIR" migrate --verify-complete >"$LOG" 2>&1; then fail 'verify-complete accepted a partial activation grant set'; fi
grep -q 'ACTIVATION_PENDING' "$LOG" || { tail -n 8 "$LOG" >&2; fail 'partial activation was not rejected as pending'; }
admin_sql "$DB" "BEGIN; SET ROLE cocinacore_signup_bootstrap; REVOKE EXECUTE ON FUNCTION public.signup_new_account(text,text,text,timestamptz,text) FROM cocinacore_auth; RESET ROLE; COMMIT" >/dev/null

set_check activation-contract-rollback-after-partial-grants
R4_BEFORE=$(boundary_identity_fingerprint)
if COCINACORE_ACTIVATION_DATABASE_URL="$ADMIN_URL" NODE_PATH="$ROOT/frontend/node_modules" node - "$R4_SCRIPT" fault >"$LOG" 2>&1 <<'NODE'
const { Client } = require('pg');
const activation = require(process.argv[2]);
const client = new Client({ connectionString: process.env.COCINACORE_ACTIVATION_DATABASE_URL });
(async () => {
  await client.connect();
  try {
    await activation.activateWithClient(client, {
      afterGrantForTest: async (index, transactionClient) => {
        if (index === 2) await transactionClient.query('SELECT 1 / 0');
      },
    });
    throw new Error('fault injection unexpectedly committed');
  } catch (error) {
    if (error.databaseCode !== '22012') throw error;
    console.log('R4_INJECTED_DATABASE_FAILURE=22012');
  } finally {
    await client.end();
  }
})().catch(() => { process.exitCode = 1; });
NODE
then
  :
else
  tail -n 12 "$LOG" >&2
  fail 'activation rollback driver failed'
fi
grep -q 'R4_INJECTED_DATABASE_FAILURE=22012' "$LOG" || { tail -n 8 "$LOG" >&2; fail 'activation did not reach injected PostgreSQL failure after three grants'; }
[ "$R4_BEFORE" = "$(boundary_identity_fingerprint)" ] || fail 'failed activation left grants or other state behind'
printf '%s\n' 'PASS: PostgreSQL failure after three real GRANTs rolled back the entire activation transaction'

for fixture in owner policy definition acl ledger ledger_filename; do
  set_check "activation-contract-reject-drift-$fixture"
  case "$fixture" in
    owner)
      admin_sql "$DB" 'ALTER VIEW public.runtime_identity_probe OWNER TO cocinacore_schema_owner' >/dev/null
      ;;
    policy)
      admin_sql "$DB" 'DROP POLICY inventory_runtime_select ON public.recipe_inventory_items' >/dev/null
      ;;
    definition)
      admin_sql "$DB" 'CREATE OR REPLACE VIEW public.owner_global_metrics AS SELECT 0::bigint tenants,0::bigint users,0::bigint books,0::bigint pdfs,0::bigint chunks,0::bigint reports,0::bigint owners' >/dev/null
      ;;
    acl)
      admin_sql "$DB" 'SET ROLE cocinacore_metrics_view_owner; GRANT SELECT ON public.owner_metrics_rls_guard TO cocinacore_owner_metrics; RESET ROLE' >/dev/null
      ;;
    ledger)
      admin_sql "$DB" "UPDATE public.schema_migrations SET checksum=repeat('0',64) WHERE filename='$R3_FILENAME'" >/dev/null
      ;;
    ledger_filename)
      admin_sql "$DB" "UPDATE public.schema_migrations SET filename='020_unapproved.sql' WHERE filename='$R3_FILENAME'" >/dev/null
      ;;
  esac
  expect_r4_activation_rejection "$fixture drift" '020_CAPABILITY_ACTIVATION_REJECTED'
  case "$fixture" in
    owner)
      admin_sql "$DB" 'ALTER VIEW public.runtime_identity_probe OWNER TO cocinacore_identity_probe' >/dev/null
      ;;
    policy)
      awk '$0 ~ /^CREATE POLICY inventory_runtime_select / {copy=1} copy {print} copy && /;$/ {exit}' \
        "$ROOT/scripts/rls-candidates/020b-inventory.sql" | admin_sql_stdin "$DB" >/dev/null
      ;;
    definition)
      admin_sql "$DB" "CREATE OR REPLACE VIEW public.owner_global_metrics AS
WITH guard AS (SELECT available FROM public.owner_metrics_rls_guard)
SELECT CASE WHEN guard.available THEN (SELECT count(id) FROM public.tenants) ELSE NULL END AS tenants,
CASE WHEN guard.available THEN (SELECT count(id) FROM public.users) ELSE NULL END AS users,
CASE WHEN guard.available THEN (SELECT count(id) FROM public.global_books) ELSE NULL END AS books,
CASE WHEN guard.available THEN (SELECT count(id) FROM public.global_pdf_library) ELSE NULL END AS pdfs,
CASE WHEN guard.available THEN (SELECT count(id) FROM public.book_chunks WHERE global_book_id IS NOT NULL) ELSE NULL END AS chunks,
CASE WHEN guard.available THEN (SELECT count(id) FROM public.premium_review_reports) ELSE NULL END AS reports,
CASE WHEN guard.available THEN (SELECT count(user_id) FROM public.platform_owners) ELSE NULL END AS owners
FROM guard" >/dev/null
      ;;
    acl)
      admin_sql "$DB" 'SET ROLE cocinacore_metrics_view_owner; REVOKE SELECT ON public.owner_metrics_rls_guard FROM cocinacore_owner_metrics; RESET ROLE' >/dev/null
      ;;
    ledger)
      admin_sql "$DB" "UPDATE public.schema_migrations SET checksum='$R3_CHECKSUM' WHERE filename='$R3_FILENAME'" >/dev/null
      ;;
    ledger_filename)
      admin_sql "$DB" "UPDATE public.schema_migrations SET filename='$R3_FILENAME' WHERE filename='020_unapproved.sql'" >/dev/null
      ;;
  esac
done

set_check activation-contract-administrative-activation-transaction
if COCINACORE_ACTIVATION_DATABASE_URL="$ADMIN_URL" NODE_PATH="$ROOT/frontend/node_modules" node - "$R4_SCRIPT" apply >"$LOG" 2>&1 <<'NODE'
const { Client } = require('pg');
const activation = require(process.argv[2]);
const client = new Client({ connectionString: process.env.COCINACORE_ACTIVATION_DATABASE_URL });
(async () => {
  await client.connect();
  try {
    const result = await activation.activateWithClient(client);
    if (result.state !== 'active' || result.changed !== true || !/^\d+$/.test(result.transactionId || '')) {
      throw new Error('activation result or transaction identity mismatch');
    }
    console.log('R4_ACTIVATION_RESULT=active:changed:' + result.transactionId);
  } finally {
    await client.end();
  }
})().catch(() => { process.exitCode = 1; });
NODE
then
  :
else
  tail -n 16 "$LOG" >&2
  fail 'administrative activation failed in the disposable PostgreSQL state'
fi
grep -Eq '^R4_ACTIVATION_RESULT=active:changed:[0-9]+$' "$LOG" || { tail -n 8 "$LOG" >&2; fail 'activation did not prove a single transaction id'; }
if grep -Fq "$ADMIN_PASSWORD" "$LOG" || grep -Fq "$ADMIN_URL" "$LOG"; then fail 'activation output leaked an administrative secret'; fi
printf '%s\n' 'PASS: one authorized administrative transaction granted the exact activation set and attested active'

set_check activation-contract-administrative-idempotence
R4_BEFORE=$(boundary_identity_fingerprint)
run_r4_activation_candidate || { tail -n 12 "$LOG" >&2; fail 'activated-state reexecution failed'; }
grep -q 'ACTIVATION ALREADY COMPLETE; NO CHANGES' "$LOG" || fail 'activated-state reexecution did not report no-op'
[ "$R4_BEFORE" = "$(boundary_identity_fingerprint)" ] || fail 'idempotent activation changed roles, ACLs, schema, data or ledger'
printf '%s\n' 'PASS: exact active state is idempotent without credential, ACL, membership or ledger changes'

set_check activation-contract-verify-complete-active
MIGRATIONS_DIR="$R3_DIR" migrate --verify-complete >"$LOG" 2>&1 || { tail -n 20 "$LOG" >&2; fail 'verify-complete rejected exact activated state'; }
grep -q 'Migration ledger is complete' "$LOG" || fail 'verify-complete did not report active synthetic migration'
printf '%s\n' 'PASS: verify-complete accepts the exact activated PostgreSQL catalog'

set_check activation-contract-public-capability-denials
admin_sql "$DB" 'CREATE ROLE r4_public_probe NOLOGIN NOSUPERUSER NOBYPASSRLS; GRANT USAGE ON SCHEMA public TO r4_public_probe' >/dev/null
[ "$(admin_sql "$DB" "select has_schema_privilege('r4_public_probe','public','USAGE')")" = t ] || fail 'public denial probe lacks schema resolution needed for a meaningful test'
for statement in \
  'SELECT * FROM public.runtime_identity_probe' \
  'SELECT * FROM public.owner_global_metrics' \
  'SELECT * FROM public.owner_write_global_books' \
  "INSERT INTO public.owner_write_global_books(title) VALUES ('020e-public-denied')" \
  "SELECT * FROM public.signup_new_account('020e-public-denied@example.test','fixture','Denied',now(),'terms-v1')"; do
  if admin_sql "$DB" "SET ROLE r4_public_probe; $statement" >"$LOG" 2>&1; then fail "PUBLIC-like role accessed a protected capability: $statement"; fi
  grep -q 'permission denied' "$LOG" || { tail -n 8 "$LOG" >&2; fail 'PUBLIC-like capability denial was not a permission denial'; }
done
admin_sql "$DB" 'REVOKE USAGE ON SCHEMA public FROM r4_public_probe; DROP ROLE r4_public_probe' >/dev/null
printf '%s\n' 'PASS: unprivileged role inheriting only PUBLIC access cannot use signup, probe, metrics or writer capabilities'

set_check activation-contract-real-login-capabilities
set +e
METRICS_RESULT=$(docker exec -e PGPASSWORD=disposable_boundary_only "$CONTAINER" \
  psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -U cocinacore_owner_metrics -d "$DB" -Atqc \
  "select current_user='cocinacore_owner_metrics' and tenants is not null and users is not null and books is not null and pdfs is not null and chunks is not null and reports is not null and owners is not null from public.owner_global_metrics" 2>"$LOG")
METRICS_EXIT=$?
set -e
[ "$METRICS_EXIT" -eq 0 ] || { tail -n 12 "$LOG" >&2; fail 'metrics LOGIN query failed'; }
[ "$METRICS_RESULT" = t ] || fail 'metrics LOGIN did not receive exactly seven non-null metrics'
set_check activation-contract-writer-login
set +e
WRITER_RESULT=$(docker exec -e PGPASSWORD=disposable_boundary_only "$CONTAINER" \
  psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -U cocinacore_global_writer -d "$DB" -Atqc \
  "begin; insert into public.owner_write_global_books(title) values ('020e-r3 disposable writer fixture'); select current_user='cocinacore_global_writer'; rollback" 2>"$LOG")
WRITER_EXIT=$?
set -e
[ "$WRITER_EXIT" -eq 0 ] || { tail -n 12 "$LOG" >&2; fail 'global-writer LOGIN query failed'; }
printf '%s\n' "$WRITER_RESULT" | grep -q t || fail 'global-writer LOGIN could not write through approved view'
set_check activation-contract-writer-base-denial
if docker exec -e PGPASSWORD=disposable_boundary_only "$CONTAINER" psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -U cocinacore_global_writer -d "$DB" -qc 'select id from public.global_books' >"$LOG" 2>&1; then fail 'global-writer LOGIN accessed its base table directly'; fi
if docker exec -e PGPASSWORD=disposable_boundary_only "$CONTAINER" psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -U cocinacore_global_writer -d "$DB" -qc 'select password_hash from public.users' >"$LOG" 2>&1; then fail 'global-writer LOGIN read private user data'; fi
if docker exec -e PGPASSWORD=disposable_boundary_only "$CONTAINER" psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -U cocinacore_global_writer -d "$DB" -qc 'select title from public.owner_write_global_books' >"$LOG" 2>&1; then fail 'global-writer LOGIN read a non-id column from its write view'; fi
if docker exec -e PGPASSWORD=disposable_boundary_only "$CONTAINER" psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -U cocinacore_owner_metrics -d "$DB" -qc 'select id from public.users' >"$LOG" 2>&1; then fail 'metrics LOGIN accessed a private base table directly'; fi
set_check activation-contract-metrics-guard-denial
if docker exec -e PGPASSWORD=disposable_boundary_only "$CONTAINER" psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -U cocinacore_owner_metrics -d "$DB" -qc 'select * from public.owner_metrics_rls_guard' >"$LOG" 2>&1; then fail 'metrics LOGIN accessed the NOLOGIN guard directly'; fi
if docker exec -e PGPASSWORD=disposable_boundary_only "$CONTAINER" psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -U cocinacore_auth -d "$DB" -qc 'select * from public.runtime_identity_probe' >"$LOG" 2>&1; then fail 'auth LOGIN read the runtime identity probe'; fi
set_check activation-contract-metrics-guard-owner
GUARD_RESULT=$(admin_sql "$DB" "SET ROLE cocinacore_metrics_view_owner; SELECT current_user='cocinacore_metrics_view_owner' AND available FROM public.owner_metrics_rls_guard; RESET ROLE")
[ "$GUARD_RESULT" = t ] || fail 'NOLOGIN metrics owner did not evaluate its FORCE RLS guard'
set_check activation-contract-signup-login
docker exec -e PGPASSWORD=disposable_boundary_only -i "$CONTAINER" psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -U cocinacore_auth -d "$DB" >"$LOG" 2>&1 <<'SQL'
select user_id is not null and tenant_id is not null
from public.signup_new_account('r3-new-account@example.test','fixture_hash','R3 signup fixture',now(),'terms-v1');
SQL
[ "$?" -eq 0 ] || fail 'auth LOGIN could not invoke the secure signup function'
set_check activation-contract-auth-direct-insert-denial
AUTH_DIRECT_INSERT_BEFORE=$(boundary_identity_fingerprint)
if docker exec -e PGPASSWORD=disposable_boundary_only "$CONTAINER" psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -U cocinacore_auth -d "$DB" -qc "insert into public.tenants(name,tenant_type) values ('020e-auth-direct-denied','home')" >"$LOG" 2>&1; then fail 'auth LOGIN inserted a tenant directly'; fi
if docker exec -e PGPASSWORD=disposable_boundary_only "$CONTAINER" psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -U cocinacore_auth -d "$DB" -qc "insert into public.users(email,password_hash,tenant_id,role) values ('020e-auth-direct-denied@example.test','fixture','e0200000-0000-4000-8000-000000000001','owner')" >"$LOG" 2>&1; then fail 'auth LOGIN inserted a user directly'; fi
if docker exec -e PGPASSWORD=disposable_boundary_only "$CONTAINER" psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -U cocinacore_auth -d "$DB" -qc "insert into public.tenant_memberships(tenant_id,user_id,role) values ('e0200000-0000-4000-8000-000000000001','e0200000-0000-4000-8000-000000000002','owner')" >"$LOG" 2>&1; then fail 'auth LOGIN created an arbitrary owner membership directly'; fi
[ "$AUTH_DIRECT_INSERT_BEFORE" = "$(boundary_identity_fingerprint)" ] || fail 'auth direct INSERT denial mutated data'
if docker exec -e PGPASSWORD=disposable_boundary_only "$CONTAINER" psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -U cocinacore_runtime_rls -d "$DB" -qc "select public.match_chunks('[0,0]'::vector,0,1,NULL)" >"$LOG" 2>&1; then fail 'runtime LOGIN executed match_chunks directly'; fi
set_check activation-contract-rag-denial
printf '%s\n' 'PASS: real LOGIN roles enforce seven metrics, scoped signup, view-only writer, NOLOGIN guard, and RAG denial'

set_check activation-contract-auth-reprovision-after-020
docker exec -i "$CONTAINER" psql -X -v ON_ERROR_STOP=1 -U cocinacore -d "$DB" \
  -v auth_password=disposable_boundary_only <"$ROOT/scripts/provision-auth-role.sql" >"$LOG" 2>&1 || { tail -n 15 "$LOG" >&2; fail 'auth reprovisioner rejected the complete 020 identity state'; }
[ "$(admin_sql "$DB" "select has_function_privilege('cocinacore_auth','public.signup_new_account(text,text,text,timestamptz,text)','EXECUTE') and not has_table_privilege('cocinacore_auth','public.tenants','INSERT') and not has_table_privilege('cocinacore_auth','public.users','INSERT') and not has_table_privilege('cocinacore_auth','public.tenant_memberships','INSERT') and not has_any_column_privilege('cocinacore_auth','public.tenants','INSERT') and not has_any_column_privilege('cocinacore_auth','public.users','INSERT') and not has_any_column_privilege('cocinacore_auth','public.tenant_memberships','INSERT')")" = t ] || fail 'auth reprovision restored unsafe direct INSERTs or removed secure signup EXECUTE'
docker exec -e PGPASSWORD=disposable_boundary_only -i "$CONTAINER" psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -U cocinacore_auth -d "$DB" >"$LOG" 2>&1 <<'SQL'
begin;
select user_id is not null and tenant_id is not null
from public.signup_new_account('r3-after-auth-reprovision@example.test','fixture_hash','Reprovision fixture',now(),'terms-v1');
rollback;
SQL
[ "$?" -eq 0 ] || fail 'auth LOGIN signup failed after secure reprovisioning'
printf '%s\n' 'PASS: auth reprovision after 020 preserves function-only signup and keeps all direct INSERTs denied'

set_check activation-contract-runtime-cross-tenant
admin_sql "$DB" "insert into public.tenants(id,name) values ('e0300000-0000-4000-8000-000000000001','020e R3 tenant B'); insert into public.users(id,email,password_hash,tenant_id,role) values ('e0300000-0000-4000-8000-000000000002','020e-r3-user-b@example.test','fixture','e0300000-0000-4000-8000-000000000001','owner'); insert into public.tenant_memberships(tenant_id,user_id,role) values ('e0300000-0000-4000-8000-000000000001','e0300000-0000-4000-8000-000000000002','owner')" >/dev/null
set +e
RUNTIME_RESULT=$(docker exec -e PGPASSWORD=disposable_boundary_only -i "$CONTAINER" psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -U cocinacore_runtime_rls -d "$DB" -Atq <<'SQL'
begin;
set local app.user_id='e0200000-0000-4000-8000-000000000002';
set local app.tenant_id='e0200000-0000-4000-8000-000000000001';
select (select count(*)=1 from public.users where id='e0200000-0000-4000-8000-000000000002')
   and (select count(*)=0 from public.users where id='e0300000-0000-4000-8000-000000000002');
commit;
SQL
)
RUNTIME_EXIT=$?
set -e
[ "$RUNTIME_EXIT" -eq 0 ] || fail 'runtime LOGIN cross-tenant query failed'
[ "$(printf '%s\n' "$RUNTIME_RESULT" | tail -n 1)" = t ] || fail 'runtime LOGIN read across tenant context'
printf '%s\n' 'PASS: runtime LOGIN reads the authenticated tenant and receives no cross-tenant user row'

activation_catalog_fingerprint() {
  admin_sql "$DB" "SELECT pg_catalog.md5(concat_ws(E'\\n',
    (SELECT string_agg(c.relname||'|'||p.polname||'|'||p.polcmd::text||'|'||p.polpermissive||'|'||p.polroles::text||'|'||coalesce(pg_catalog.md5(pg_catalog.pg_get_expr(p.polqual,p.polrelid)),'-')||'|'||coalesce(pg_catalog.md5(pg_catalog.pg_get_expr(p.polwithcheck,p.polrelid)),'-'),E'\\n' ORDER BY c.relname,p.polname) FROM pg_catalog.pg_policy p JOIN pg_catalog.pg_class c ON c.oid=p.polrelid JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public'),
    (SELECT string_agg(c.relname||'|'||c.relrowsecurity||'|'||c.relforcerowsecurity||'|'||c.relowner::text||'|'||coalesce(pg_catalog.md5(pg_catalog.pg_get_viewdef(c.oid,true)),'-')||'|'||coalesce(c.relacl::text,'-'),E'\\n' ORDER BY c.relname) FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND (c.relname IN ('runtime_identity_probe','owner_metrics_rls_guard','owner_global_metrics','owner_write_global_books','owner_write_global_pdfs','owner_write_global_chunks','users','tenants','tenant_memberships','recipe_inventory_items','inventory_movements','user_meal_plans','recipe_ai_history','shopping_list_items','user_culinary_profiles','user_culinary_profile_terms','tenant_books','tenant_pdf_library','book_chunks','tenant_invitations','global_books','global_pdf_library','premium_review_reports','platform_owners'))),
    (SELECT string_agg(r.rolname||'|'||r.rolcanlogin||'|'||r.rolsuper||'|'||r.rolbypassrls||'|'||r.rolinherit||'|'||m.roleid::text||'|'||m.member::text,E'\\n' ORDER BY r.rolname,m.roleid,m.member) FROM pg_catalog.pg_roles r LEFT JOIN pg_catalog.pg_auth_members m ON m.roleid=r.oid OR m.member=r.oid WHERE r.rolname LIKE 'cocinacore_%'),
    (SELECT pg_catalog.md5(string_agg(id::text||'|'||email||'|'||password_hash||'|'||tenant_id::text||'|'||role,E'\\n' ORDER BY id)) FROM public.users),
    (SELECT pg_catalog.md5(string_agg(id::text||'|'||name,E'\\n' ORDER BY id)) FROM public.tenants),
    (SELECT pg_catalog.md5(string_agg(tenant_id::text||'|'||user_id::text||'|'||role,E'\\n' ORDER BY tenant_id,user_id)) FROM public.tenant_memberships),
    (SELECT string_agg(filename||'|'||checksum||'|'||applied_at::text,E'\\n' ORDER BY applied_at,filename) FROM public.schema_migrations)
  ))"
}
expect_r3_verify_rejection() {
  label=$1; marker=$2
  before=$(activation_catalog_fingerprint)
  if MIGRATIONS_DIR="$R3_DIR" migrate --verify-complete >"$LOG" 2>&1; then fail "verify-complete accepted $label"; fi
  grep -Eq "$marker" "$LOG" || { tail -n 15 "$LOG" >&2; fail "wrong rejection for $label"; }
  after=$(activation_catalog_fingerprint)
  [ "$before" = "$after" ] || fail "verify-complete mutated protected state while rejecting $label"
  printf 'PASS: activation attestation rejected %s without mutation\n' "$label"
}
restore_identity_read_policy() {
  admin_sql "$DB" 'DROP POLICY identity_users_read ON public.users' >/dev/null
  awk '$0 == "CREATE POLICY identity_users_read ON public.users FOR SELECT TO cocinacore_runtime_rls" {copy=1} copy {print} copy && /;$/ {exit}' \
    "$ROOT/scripts/rls-candidates/020c-identity.sql" | admin_sql_stdin "$DB" >/dev/null
}
expect_r3_verify_active() {
  if ! MIGRATIONS_DIR="$R3_DIR" migrate --verify-complete >"$LOG" 2>&1; then
    tail -n 15 "$LOG" >&2
    fail 'restored activated fixture did not attest'
  fi
  grep -q 'Migration ledger is complete' "$LOG" || fail 'restored activated fixture was not complete'
}

set_check activation-contract-reject-policy-deletion
admin_sql "$DB" 'DROP POLICY inventory_runtime_select ON public.recipe_inventory_items' >/dev/null
expect_r3_verify_rejection 'missing RLS policy' 'ACTIVATED_CAPABILITIES_POLICY_MISMATCH'
awk '$0 ~ /^CREATE POLICY inventory_runtime_select / {copy=1} copy {print} copy && /;$/ {exit}' "$ROOT/scripts/rls-candidates/020b-inventory.sql" | admin_sql_stdin "$DB" >/dev/null
expect_r3_verify_active

set_check activation-contract-reject-expression-drift
admin_sql "$DB" "ALTER POLICY identity_users_read ON public.users USING (true)" >/dev/null
expect_r3_verify_rejection 'modified RLS USING expression' 'ACTIVATED_CAPABILITIES_POLICY_MISMATCH'
restore_identity_read_policy
expect_r3_verify_active

set_check activation-contract-reject-role-drift
admin_sql "$DB" 'DROP POLICY identity_users_read ON public.users; CREATE POLICY identity_users_read ON public.users FOR SELECT TO cocinacore_auth USING (true)' >/dev/null
expect_r3_verify_rejection 'RLS role-target drift' 'ACTIVATED_CAPABILITIES_POLICY_MISMATCH'
restore_identity_read_policy
expect_r3_verify_active

set_check activation-contract-reject-permissive-extra
admin_sql "$DB" 'CREATE POLICY r3_unexpected_policy ON public.users AS RESTRICTIVE FOR SELECT TO cocinacore_runtime_rls USING (true)' >/dev/null
expect_r3_verify_rejection 'additional restrictive RLS policy' 'ACTIVATED_CAPABILITIES_POLICY_MISMATCH'
admin_sql "$DB" 'DROP POLICY r3_unexpected_policy ON public.users' >/dev/null
expect_r3_verify_active

set_check activation-contract-reject-unexpected-login-grant
admin_sql "$DB" 'SET ROLE cocinacore_metrics_view_owner; GRANT SELECT ON public.owner_metrics_rls_guard TO cocinacore_owner_metrics; RESET ROLE' >/dev/null
expect_r3_verify_rejection 'extra metrics LOGIN guard grant' 'ACTIVATED_CAPABILITIES_LOGIN_BOUNDARY_MISMATCH'
admin_sql "$DB" 'SET ROLE cocinacore_metrics_view_owner; REVOKE SELECT ON public.owner_metrics_rls_guard FROM cocinacore_owner_metrics; RESET ROLE' >/dev/null

set_check activation-contract-reject-runtime-unexpected-grant
admin_sql "$DB" 'GRANT TRUNCATE ON public.recipe_inventory_items TO cocinacore_runtime_rls' >/dev/null
expect_r3_verify_rejection 'unexpected runtime table privilege' 'ACTIVATED_CAPABILITIES_RUNTIME_ACL_MISMATCH'
admin_sql "$DB" 'REVOKE TRUNCATE ON public.recipe_inventory_items FROM cocinacore_runtime_rls' >/dev/null

set_check activation-contract-reject-missing-grant
admin_sql "$DB" 'SET ROLE cocinacore_metrics_view_owner; REVOKE SELECT ON public.owner_global_metrics FROM cocinacore_owner_metrics; RESET ROLE' >/dev/null
expect_r3_verify_rejection 'missing required activation grant' 'ACTIVATION_PENDING'
admin_sql "$DB" 'SET ROLE cocinacore_metrics_view_owner; GRANT SELECT ON public.owner_global_metrics TO cocinacore_owner_metrics; RESET ROLE' >/dev/null

set_check activation-contract-reject-owner-drift
admin_sql "$DB" 'ALTER VIEW public.runtime_identity_probe OWNER TO cocinacore_schema_owner' >/dev/null
expect_r3_verify_rejection 'capability owner drift' '(ROLE_STATE_MISMATCH|ACTIVATED_CAPABILITIES_OWNER_MISMATCH)'
admin_sql "$DB" 'ALTER VIEW public.runtime_identity_probe OWNER TO cocinacore_identity_probe' >/dev/null

set_check activation-contract-reject-membership
admin_sql "$DB" 'CREATE ROLE r3_membership_drift NOLOGIN; GRANT r3_membership_drift TO cocinacore_runtime_rls' >/dev/null
expect_r3_verify_rejection 'unexpected role membership' 'ACTIVATED_CAPABILITIES_ROLE_MISMATCH'
admin_sql "$DB" 'REVOKE r3_membership_drift FROM cocinacore_runtime_rls; DROP ROLE r3_membership_drift' >/dev/null

set_check activation-contract-reject-view-definition-drift
admin_sql "$DB" 'CREATE OR REPLACE VIEW public.owner_global_metrics AS SELECT 0::bigint tenants,0::bigint users,0::bigint books,0::bigint pdfs,0::bigint chunks,0::bigint reports,0::bigint owners' >/dev/null
expect_r3_verify_rejection 'altered metrics view definition' 'ACTIVATED_CAPABILITIES_OBJECT_MISMATCH'
admin_sql "$DB" "CREATE OR REPLACE VIEW public.owner_global_metrics AS
WITH guard AS (SELECT available FROM public.owner_metrics_rls_guard)
SELECT CASE WHEN guard.available THEN (SELECT count(id) FROM public.tenants) ELSE NULL END AS tenants,
CASE WHEN guard.available THEN (SELECT count(id) FROM public.users) ELSE NULL END AS users,
CASE WHEN guard.available THEN (SELECT count(id) FROM public.global_books) ELSE NULL END AS books,
CASE WHEN guard.available THEN (SELECT count(id) FROM public.global_pdf_library) ELSE NULL END AS pdfs,
CASE WHEN guard.available THEN (SELECT count(id) FROM public.book_chunks WHERE global_book_id IS NOT NULL) ELSE NULL END AS chunks,
CASE WHEN guard.available THEN (SELECT count(id) FROM public.premium_review_reports) ELSE NULL END AS reports,
CASE WHEN guard.available THEN (SELECT count(user_id) FROM public.platform_owners) ELSE NULL END AS owners
FROM guard" >/dev/null

set_check activation-contract-reject-missing-ledger-evidence
admin_sql "$DB" "DELETE FROM public.schema_migrations WHERE filename='$R3_FILENAME'" >/dev/null
before=$(activation_catalog_fingerprint)
if MIGRATIONS_DIR="$R3_DIR" migrate --verify-complete >"$LOG" 2>&1; then fail 'verify-complete accepted complete policy state without 020 ledger evidence'; fi
grep -Eq 'PREPARED_CAPABILITIES_(MISMATCH|PARTIAL)|Pending migration' "$LOG" || { tail -n 15 "$LOG" >&2; fail 'ledgerless activation was not rejected explicitly'; }
after=$(activation_catalog_fingerprint)
[ "$before" = "$after" ] || fail 'ledgerless verify-complete rejection mutated the database'
admin_sql "$DB" "INSERT INTO public.schema_migrations(filename,applied_at,checksum) VALUES ('$R3_FILENAME',(SELECT max(applied_at)+interval '1 second' FROM public.schema_migrations),'$R3_CHECKSUM')" >/dev/null
printf '%s\n' 'PASS: incomplete and ledgerless states fail closed without mutating protected data'

set_check canonical-020-http-and-application-regressions
admin_sql postgres "CREATE DATABASE signup_real_disposable TEMPLATE $DB"
admin_sql postgres "COMMENT ON DATABASE signup_real_disposable IS 'cocinacore-signup-real-disposable'; REVOKE CREATE,TEMP ON DATABASE signup_real_disposable FROM PUBLIC; GRANT CONNECT ON DATABASE signup_real_disposable TO cocinacore_runtime_rls,cocinacore_auth,cocinacore_owner_metrics,cocinacore_global_writer"
if [ "$(admin_sql "$DB" "select count(*) from pg_roles where rolname='postgres'")" -ne 0 ]; then fail 'test-only postgres administrator role unexpectedly exists'; fi
admin_sql "$DB" "CREATE ROLE postgres LOGIN SUPERUSER PASSWORD 'disposable_probe_only'; GRANT CONNECT ON DATABASE signup_real_disposable TO postgres" >/dev/null
admin_sql signup_real_disposable "CREATE ROLE cocinacore_metrics_public_probe LOGIN PASSWORD 'disposable_probe_only'; CREATE ROLE cocinacore_writer_public_probe LOGIN PASSWORD 'disposable_probe_only'; CREATE ROLE cocinacore_global_public_probe LOGIN PASSWORD 'disposable_probe_only'; GRANT CONNECT ON DATABASE signup_real_disposable TO cocinacore_metrics_public_probe,cocinacore_writer_public_probe,cocinacore_global_public_probe; GRANT USAGE ON SCHEMA public TO cocinacore_metrics_public_probe,cocinacore_writer_public_probe,cocinacore_global_public_probe" >/dev/null
# Seed the fixed tenant/user parents and D3 document fixtures expected by the
# PostgreSQL-backed application suite. Keep these test-only rows in the clone.
admin_sql_stdin signup_real_disposable <<'SQL' >/dev/null
INSERT INTO public.tenants(id,name,tenant_type) VALUES
  ('99100000-0000-4000-8000-000000000001','D3 disposable tenant A','home'),
  ('99100000-0000-4000-8000-000000000002','D3 disposable tenant B','home');
INSERT INTO public.users(id,tenant_id,email,password_hash,role) VALUES
  ('99100000-0000-4000-8000-000000000003','99100000-0000-4000-8000-000000000001','d3-a1@example.test','fixture','member'),
  ('99100000-0000-4000-8000-000000000004','99100000-0000-4000-8000-000000000001','d3-a2@example.test','fixture','member'),
  ('99100000-0000-4000-8000-000000000005','99100000-0000-4000-8000-000000000002','d3-b1@example.test','fixture','member'),
  ('99100000-0000-4000-8000-000000000006','99100000-0000-4000-8000-000000000001','backup-a@example.test','fixture','member');
INSERT INTO public.tenant_memberships(tenant_id,user_id,role) VALUES
  ('99100000-0000-4000-8000-000000000001','99100000-0000-4000-8000-000000000003','member'),
  ('99100000-0000-4000-8000-000000000001','99100000-0000-4000-8000-000000000004','member'),
  ('99100000-0000-4000-8000-000000000002','99100000-0000-4000-8000-000000000005','member'),
  ('99100000-0000-4000-8000-000000000001','99100000-0000-4000-8000-000000000006','member');
SQL
docker exec -i "$CONTAINER" psql -X -v ON_ERROR_STOP=1 -U cocinacore -d signup_real_disposable \
  <"$ROOT/scripts/tests/020d3-document-fixtures.sql" >/dev/null
CLONE_GUARD=$(admin_sql signup_real_disposable "SET ROLE cocinacore_metrics_view_owner; SELECT current_user='cocinacore_metrics_view_owner' AND available FROM public.owner_metrics_rls_guard; RESET ROLE")
[ "$CLONE_GUARD" = t ] || fail 'application-suite clone does not preserve the activated owner-metrics guard contract'
printf '%s\n' 'PASS: application-suite clone preserves the activated metrics guard under its NOLOGIN owner'
SIGNUP_TEST_ADMIN_URL="postgresql://postgres:disposable_probe_only@127.0.0.1:$PORT/signup_real_disposable"
APP_TEST_LOG="$LOG"
if (
  cd "$ROOT/frontend"
  SIGNUP_TEST_ADMIN_URL="$SIGNUP_TEST_ADMIN_URL" \
  DATABASE_URL="postgresql://cocinacore_runtime_rls:disposable_boundary_only@127.0.0.1:$PORT/signup_real_disposable" \
  AUTH_DATABASE_URL="postgresql://cocinacore_auth:disposable_boundary_only@127.0.0.1:$PORT/signup_real_disposable" \
  OWNER_METRICS_DATABASE_URL="postgresql://cocinacore_owner_metrics:disposable_boundary_only@127.0.0.1:$PORT/signup_real_disposable" \
  OWNER_GLOBAL_WRITER_DATABASE_URL="postgresql://cocinacore_global_writer:disposable_boundary_only@127.0.0.1:$PORT/signup_real_disposable" \
  OWNER_METRICS_PUBLIC_PROBE_DATABASE_URL="postgresql://cocinacore_metrics_public_probe:disposable_probe_only@127.0.0.1:$PORT/signup_real_disposable" \
  OWNER_GLOBAL_WRITER_PUBLIC_PROBE_DATABASE_URL="postgresql://cocinacore_writer_public_probe:disposable_probe_only@127.0.0.1:$PORT/signup_real_disposable" \
  COCINACORE_SKIP_DOTENV=1 COCINACORE_SEPARATE_AUTH_DB=true \
  COCINACORE_OWNER_METRICS_DB_ENABLED=true COCINACORE_OWNER_GLOBAL_WRITER_ENABLED=false \
  COCINACORE_SIGNUP_BOOTSTRAP_TEST=1 COCINACORE_IDENTITY_RLS_TEST=1 \
  COCINACORE_INVENTORY_RLS_TEST=1 COCINACORE_PLANS_HISTORY_SHOPPING_RLS_TEST=1 \
  COCINACORE_CULINARY_PROFILE_RLS_TEST=1 COCINACORE_DOCUMENTS_RAG_RLS_TEST=1 \
  COCINACORE_TENANT_INVITATIONS_RLS_TEST=1 COCINACORE_OWNER_GLOBAL_WRITER_RLS_TEST=1 \
  COCINACORE_OWNER_METRICS_RLS_TEST=1 \
  node node_modules/vitest/vitest.mjs run \
    src/lib/db-global-writer.test.ts \
    src/lib/owner/global-writer.integration.test.ts \
    src/app/api/owner/global-pdfs/route.test.ts \
    src/lib/db/repositories/documents-rag-rls.integration.test.ts \
    src/lib/db/repositories/bookChunkRepository.test.ts \
    src/lib/recipes/server-rag-context.test.ts \
    src/services/__tests__/ragEngine.test.ts \
    src/app/library/page.test.tsx \
    src/lib/db/repositories/culinaryProfileRls.integration.test.ts \
    src/lib/db/repositories/plans-history-shopping-rls.integration.test.ts \
    src/lib/db/repositories/identity-rls.integration.test.ts \
    src/lib/db/repositories/inventory-rls.integration.test.ts \
    src/lib/db/repositories/tenant-invitations-rls.integration.test.ts \
    src/lib/db/repositories/signup-bootstrap.integration.test.ts \
    src/app/api/auth/signup/signup-bootstrap-http.integration.test.ts \
    src/app/api/auth/login/route.test.ts \
    src/lib/owner/metrics.integration.test.ts \
    src/lib/db/repositories/platformOwnerRepository.test.ts \
    src/app/owner/page.test.tsx --maxWorkers=1 --reporter=verbose
) >"$APP_TEST_LOG" 2>&1; then
  grep -E 'Test Files|Tests[[:space:]]+[0-9]+ passed|PASS' "$APP_TEST_LOG" | tail -n 30 || true
else
  node - "$APP_TEST_LOG" "$ADMIN_PASSWORD" <<'NODE' >&2
const fs = require('node:fs');
let output = fs.readFileSync(process.argv[2], 'utf8');
for (const secret of [process.argv[3], 'disposable_boundary_only', 'disposable_probe_only']) {
  output = output.split(secret).join('[redacted]');
}
output = output.replace(/postgres(?:ql)?:\/\/[^\s)'"`]+/g, '[database-url-redacted]');
process.stderr.write(output.split('\n').slice(-100).join('\n'));
NODE
  fail 'canonical 020 PostgreSQL-backed application regressions failed'
fi
if (
  cd "$ROOT/frontend"
  SIGNUP_TEST_ADMIN_URL="$SIGNUP_TEST_ADMIN_URL" \
  DATABASE_URL="postgresql://cocinacore_runtime_rls:disposable_boundary_only@127.0.0.1:$PORT/signup_real_disposable" \
  AUTH_DATABASE_URL="postgresql://cocinacore_auth:disposable_boundary_only@127.0.0.1:$PORT/signup_real_disposable" \
  OWNER_METRICS_DATABASE_URL="postgresql://cocinacore_owner_metrics:disposable_boundary_only@127.0.0.1:$PORT/signup_real_disposable" \
  OWNER_GLOBAL_WRITER_DATABASE_URL="postgresql://cocinacore_global_writer:disposable_boundary_only@127.0.0.1:$PORT/signup_real_disposable" \
  OWNER_METRICS_PUBLIC_PROBE_DATABASE_URL="postgresql://cocinacore_metrics_public_probe:disposable_probe_only@127.0.0.1:$PORT/signup_real_disposable" \
  COCINACORE_SKIP_DOTENV=1 COCINACORE_SEPARATE_AUTH_DB=true \
  COCINACORE_OWNER_METRICS_DB_ENABLED=true COCINACORE_OWNER_GLOBAL_WRITER_ENABLED=false \
  COCINACORE_SIGNUP_REAL_SCHEMA_TEST=1 COCINACORE_OWNER_METRICS_RLS_TEST=1 \
  node node_modules/vitest/vitest.mjs run src/lib/owner/metrics.integration.test.ts \
    --maxWorkers=1 --reporter=verbose
) >>"$APP_TEST_LOG" 2>&1; then
  grep -E 'Test Files|Tests[[:space:]]+[0-9]+ passed|PASS' "$APP_TEST_LOG" | tail -n 12 || true
else
  node - "$APP_TEST_LOG" "$ADMIN_PASSWORD" <<'NODE' >&2
const fs = require('node:fs');
let output = fs.readFileSync(process.argv[2], 'utf8');
for (const secret of [process.argv[3], 'disposable_boundary_only', 'disposable_probe_only']) {
  output = output.split(secret).join('[redacted]');
}
output = output.replace(/postgres(?:ql)?:\/\/[^\s)'"`]+/g, '[database-url-redacted]');
process.stderr.write(output.split('\n').slice(-60).join('\n'));
NODE
  fail 'canonical 020 PostgreSQL-backed owner-metrics application regressions failed'
fi
if (
  cd "$ROOT/frontend"
  SIGNUP_TEST_ADMIN_URL="$SIGNUP_TEST_ADMIN_URL" \
  DATABASE_URL="postgresql://cocinacore_runtime_rls:disposable_boundary_only@127.0.0.1:$PORT/signup_real_disposable" \
  AUTH_DATABASE_URL="postgresql://cocinacore_auth:disposable_boundary_only@127.0.0.1:$PORT/signup_real_disposable" \
  OWNER_METRICS_DATABASE_URL="postgresql://cocinacore_owner_metrics:disposable_boundary_only@127.0.0.1:$PORT/signup_real_disposable" \
  OWNER_GLOBAL_WRITER_DATABASE_URL="postgresql://cocinacore_global_writer:disposable_boundary_only@127.0.0.1:$PORT/signup_real_disposable" \
  OWNER_GLOBAL_WRITER_PUBLIC_PROBE_DATABASE_URL="postgresql://cocinacore_global_public_probe:disposable_probe_only@127.0.0.1:$PORT/signup_real_disposable" \
  COCINACORE_SKIP_DOTENV=1 COCINACORE_SEPARATE_AUTH_DB=true \
  COCINACORE_OWNER_METRICS_DB_ENABLED=true COCINACORE_OWNER_GLOBAL_WRITER_ENABLED=false \
  COCINACORE_SIGNUP_REAL_SCHEMA_TEST=1 \
  node node_modules/vitest/vitest.mjs run src/lib/owner/global-writer.integration.test.ts \
    --maxWorkers=1 --reporter=verbose
) >>"$APP_TEST_LOG" 2>&1; then
  grep -E 'Test Files|Tests[[:space:]]+[0-9]+ passed|PASS' "$APP_TEST_LOG" | tail -n 12 || true
else
  node - "$APP_TEST_LOG" "$ADMIN_PASSWORD" <<'NODE' >&2
const fs = require('node:fs');
let output = fs.readFileSync(process.argv[2], 'utf8');
for (const secret of [process.argv[3], 'disposable_boundary_only', 'disposable_probe_only']) {
  output = output.split(secret).join('[redacted]');
}
output = output.replace(/postgres(?:ql)?:\/\/[^\s)'"`]+/g, '[database-url-redacted]');
process.stderr.write(output.split('\n').slice(-60).join('\n'));
NODE
  fail 'canonical 020 PostgreSQL-backed global-writer application regressions failed'
fi
admin_sql postgres "REVOKE CONNECT ON DATABASE signup_real_disposable FROM cocinacore_metrics_public_probe,cocinacore_writer_public_probe,cocinacore_global_public_probe,postgres" >/dev/null
admin_sql postgres "DROP DATABASE signup_real_disposable WITH (FORCE)" >/dev/null
admin_sql postgres "DROP ROLE cocinacore_metrics_public_probe; DROP ROLE cocinacore_writer_public_probe; DROP ROLE cocinacore_global_public_probe; DROP ROLE postgres" >/dev/null
[ "$(admin_sql postgres "select count(*) from pg_database where datname='signup_real_disposable'")" = 0 ] || fail 'application-regression disposable clone was not dropped'
printf '%s\n' 'PASS: actual HTTP signup, login, sessions, password reset and directed RLS application regressions passed on canonical 020'

STAGE=activation-contract-policy-fingerprints
admin_sql "$DB" "select c.relname,p.polname,p.polcmd,p.polpermissive,case when cardinality(p.polroles)=1 then coalesce(r.rolname,'PUBLIC') else 'MULTI' end,coalesce(md5(pg_get_expr(p.polqual,p.polrelid)),'-'),coalesce(md5(pg_get_expr(p.polwithcheck,p.polrelid)),'-') from pg_policy p join pg_class c on c.oid=p.polrelid left join pg_roles r on r.oid=p.polroles[1] where c.relnamespace='public'::regnamespace order by c.relname,p.polname"

STAGE=final-cleanup
set_check cleanup
printf '%s\n' 'integration stage: final-cleanup' >&2
stop_container
[ "$(docker ps -a --format '{{.Names}}' | grep -c "^$PREFIX" || true)" = 0 ] || fail 'temporary containers remain'
printf '%s\n' 'bootstrap/migrator integration passed: fresh legacy 010 and 017 adoption, extensions, roles, locks, transactions, activation'
