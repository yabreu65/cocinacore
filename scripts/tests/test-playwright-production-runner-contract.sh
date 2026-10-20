#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
config="$root/frontend/playwright.production.config.ts"
validator="$root/frontend/src/lib/e2e-production-config.ts"
production_dir="$root/frontend/e2e/production"

require_pattern() {
  local pattern="$1"
  local file="$2"
  if ! grep -Fq -- "$pattern" "$file"; then
    printf 'FAIL: required contract not found in %s: %s\n' "${file#"$root"/}" "$pattern" >&2
    exit 1
  fi
}

require_pattern "validateProductionEnvironment(process.env)" "$config"
require_pattern "testDir: './e2e/production'" "$config"
require_pattern "testMatch: '**/*.production.spec.ts'" "$config"
require_pattern "fullyParallel: false" "$config"
require_pattern "workers: 1" "$config"
require_pattern "retries: 0" "$config"
require_pattern "trace: 'off'" "$config"
require_pattern "video: 'off'" "$config"
require_pattern "E2E_RUN_MODE !== 'production'" "$validator"
require_pattern 'E2E_PRODUCTION_URL' "$validator"
require_pattern 'E2E_PRODUCTION_USER_EMAIL' "$validator"
require_pattern 'E2E_PRODUCTION_USER_PASSWORD' "$validator"
require_pattern 'E2E_PRODUCTION_USER_ID' "$validator"
require_pattern 'E2E_PRODUCTION_TENANT_ID' "$validator"
require_pattern "E2E_ALLOW_SIGNUP !== 'false'" "$validator"
require_pattern 'https://cocinacore.31-220-98-21.sslip.io' "$validator"

if grep -Eq 'webServer|globalSetup|storageState|database-target|standalone-server-env|DATABASE_URL|REDIS_URL|postgres|redis|127\.0\.0\.1|localhost' "$config"; then
  printf 'FAIL: production config references local services, state, or database/Redis targets.\n' >&2
  exit 1
fi

while IFS= read -r -d '' spec; do
  if grep -Eiq 'sign.?up|register|database|postgres|redis|storageState|console\.(log|info|warn|error)|logger\.' "$spec"; then
    printf 'FAIL: a production spec contains signup, direct persistence, state, or logging behavior.\n' >&2
    exit 1
  fi
done < <(find "$production_dir" -type f -name '*.production.spec.ts' -print0)

printf 'PASS: production Playwright runner is fail-closed and isolated.\n'
