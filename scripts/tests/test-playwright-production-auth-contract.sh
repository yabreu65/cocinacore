#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
auth="$root/frontend/src/lib/production-e2e-auth.ts"
production_dir="$root/frontend/e2e/production"

require_pattern() {
  local pattern="$1"
  local file="$2"
  if ! grep -Fq -- "$pattern" "$file"; then
    printf 'FAIL: required auth contract missing in %s: %s\n' "${file#"$root"/}" "$pattern" >&2
    exit 1
  fi
}

require_pattern "'/api/auth/login'" "$auth"
require_pattern "'/api/auth/session'" "$auth"
require_pattern 'credentials.expectedUserId' "$auth"
require_pattern 'credentials.expectedTenantId' "$auth"
require_pattern "throw new Error('Production authentication failed.')" "$auth"
require_pattern 'return { userId: user.id, tenantId: tenant.tenantId }' "$auth"

if grep -Eiq 'signup|register|database|postgres|redis|storageState|console\.(log|info|warn|error)|logger\.' "$auth"; then
  printf 'FAIL: production auth helper contains a forbidden auth path, dependency, state, or logger.\n' >&2
  exit 1
fi

if find "$production_dir" -type f -name '*.production.spec.ts' -print -quit | grep -q .; then
  printf 'FAIL: production directory contains a production spec before its authorization gate.\n' >&2
  exit 1
fi

printf 'PASS: production auth contract is isolated and the production spec directory is empty.\n'
