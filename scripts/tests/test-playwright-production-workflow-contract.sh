#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
workflow="$root/.github/workflows/playwright-production-manual.yml"

require_pattern() {
  local pattern="$1"
  if ! grep -Fq -- "$pattern" "$workflow"; then
    printf 'FAIL: required workflow contract missing: %s\n' "$pattern" >&2
    exit 1
  fi
}

require_pattern 'on:'
require_pattern '  workflow_dispatch:'
require_pattern "if: inputs.confirmation == 'RUN_PRODUCTION_ACCEPTANCE'"
require_pattern '      confirmation:'
require_pattern '      run_synthetic_writes:'
require_pattern '        type: boolean'
require_pattern '    environment:'
require_pattern '      name: production-acceptance'
require_pattern '  contents: read'
require_pattern 'concurrency:'
require_pattern 'timeout-minutes:'
require_pattern 'actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683'
require_pattern 'actions/setup-node@1e60f620b9541d30d0d9583c6386797b1694693'
require_pattern 'run: npm ci'
require_pattern "E2E_PRODUCTION_URL: \${{ secrets.E2E_PRODUCTION_URL }}"
require_pattern "E2E_PRODUCTION_USER_EMAIL: \${{ secrets.E2E_PRODUCTION_USER_EMAIL }}"
require_pattern "E2E_PRODUCTION_USER_PASSWORD: \${{ secrets.E2E_PRODUCTION_USER_PASSWORD }}"
require_pattern "E2E_PRODUCTION_USER_ID: \${{ secrets.E2E_PRODUCTION_USER_ID }}"
require_pattern "E2E_PRODUCTION_TENANT_ID: \${{ secrets.E2E_PRODUCTION_TENANT_ID }}"
require_pattern "E2E_ALLOW_SIGNUP: 'false'"
require_pattern "E2E_PRODUCTION_SYNTHETIC_WRITES: \${{ inputs.run_synthetic_writes && 'approved' || 'disabled' }}"
require_pattern 'npm run test:e2e:production'

trigger_keys="$(awk '
  /^on:$/ { in_on = 1; next }
  in_on && /^[^[:space:]]/ { exit }
  in_on && /^  [A-Za-z_][A-Za-z0-9_-]*:$/ { print }
' "$workflow")"
if [[ "$trigger_keys" != '  workflow_dispatch:' ]]; then
  printf 'FAIL: workflow trigger set is not workflow_dispatch-only.\n' >&2
  exit 1
fi

if grep -Eq '^  (push|pull_request|schedule|workflow_run):|^    (push|pull_request|schedule|workflow_run):' "$workflow"; then
  printf 'FAIL: production workflow contains an automatic trigger.\n' >&2
  exit 1
fi

if grep -Eiq '(^|[[:space:]])(deploy|deployment|migrate|backup|ssh)([[:space:]]|$)|upload-artifact' "$workflow"; then
  printf 'FAIL: production workflow contains deployment, operational, or artifact behavior.\n' >&2
  exit 1
fi

printf 'PASS: production workflow is manual, protected, read-only in permissions, and isolated from deployment.\n'
