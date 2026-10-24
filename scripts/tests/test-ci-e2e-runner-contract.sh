#!/bin/sh
set -eu

ROOT=$(CDPATH='' cd -- "$(dirname -- "$0")/../.." && pwd)
WORKFLOW="$ROOT/.github/workflows/ci.yml"

fail() {
  printf '%s\n' "CI E2E runner contract failure: $1" >&2
  exit 1
}

runner_for_job() {
  job="$1"
  awk -v job="$job" '
    $0 == "  " job ":" { in_job = 1; next }
    in_job && /^  [A-Za-z0-9_-]+:$/ { exit }
    in_job && /^    runs-on:/ { print $2; found = 1; exit }
    END { if (!found) exit 1 }
  ' "$WORKFLOW"
}

frontend_runner=$(runner_for_job frontend-quality) || fail 'frontend-quality runner is missing'
e2e_runner=$(runner_for_job e2e-tests) || fail 'e2e-tests runner is missing'

[ "$frontend_runner" = 'ubuntu-latest' ] || fail "frontend-quality runner changed unexpectedly: $frontend_runner"
[ "$e2e_runner" = 'ubuntu-24.04' ] || fail "e2e-tests must pin ubuntu-24.04, got: $e2e_runner"

printf '%s\n' 'CI E2E runner contract passed'
