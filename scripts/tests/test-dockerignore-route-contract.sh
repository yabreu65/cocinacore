#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
DOCKERIGNORE="$ROOT/.dockerignore"

fail() {
  printf '%s\n' "dockerignore route contract failure: $1" >&2
  exit 1
}

[ -f "$DOCKERIGNORE" ] || fail '.dockerignore is missing'

for forbidden in coverage '**/coverage'; do
  if grep -Fqx "$forbidden" "$DOCKERIGNORE"; then
    fail "broad coverage exclusion '$forbidden' can remove application routes"
  fi
done

for required in \
  '/coverage' \
  '/frontend/coverage' \
  '/frontend/playwright-report' \
  '/frontend/test-results'; do
  grep -Fqx "$required" "$DOCKERIGNORE" || fail "missing report exclusion '$required'"
done

for route in \
  'frontend/src/app/api/meal-plan/coverage/route.ts' \
  'frontend/src/app/api/waste-prevention/route.ts' \
  'frontend/src/app/api/meal-plan/adaptive-proposal/route.ts' \
  'frontend/src/app/api/meal-plan/shopping-suggestions/route.ts'; do
  [ -f "$ROOT/$route" ] || fail "required application route is missing: $route"
done

printf '%s\n' 'dockerignore route contract: PASS'
