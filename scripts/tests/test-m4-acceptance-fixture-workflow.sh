#!/usr/bin/env bash
set -euo pipefail

root_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
workflow="$root_dir/.github/workflows/prepare-m4-acceptance-fixture.yml"
test -f "$workflow"
grep -q "PREPARE_M4_ACCEPTANCE_FIXTURE" "$workflow"
grep -q "cocinacore-production-operations" "$workflow"
grep -q "environment: production-acceptance" "$workflow"
grep -q "environment: production" "$workflow"
grep -q "scripts/production-acceptance/isolation.sh" "$workflow"
grep -q "M4_FIXTURE_MANIFEST_PATH" "$workflow"
grep -q "m4-identity-proof-" "$workflow"
grep -q "actions/download-artifact@v4" "$workflow"
test "$(grep -c "actions/download-artifact@v4" "$workflow")" -eq 2
grep -q "M4_IDENTITY_PROOF_PATH" "$root_dir/.github/workflows/prepare-m4-acceptance-fixture.yml"
grep -q "production-origin.mjs" "$root_dir/scripts/production-acceptance/identity.mjs"
grep -q "production-origin.mjs" "$root_dir/scripts/production-acceptance/prepare-fixture.mjs"
grep -q "FIXTURE_PARTIAL" "$root_dir/scripts/production-acceptance/prepare-fixture.mjs"
grep -q "process.exitCode = 1" "$root_dir/scripts/production-acceptance/prepare-fixture.mjs"
if grep -A8 '^  prepare:' "$workflow" | grep -q 'runner.temp'; then exit 1; fi
grep -q 'if: always()' "$workflow"
if grep -q 'nonce:.*steps.proof.outputs' "$workflow"; then exit 1; fi
if grep -q "run_synthetic_writes.*true" "$workflow"; then exit 1; fi
if grep -q "VPS_.*secrets.*production-acceptance" "$workflow"; then exit 1; fi
if grep -q "echo.*E2E_PRODUCTION_USER_" "$workflow"; then exit 1; fi
test "$(cat "$root_dir/.github/workflows/deploy.yml" "$root_dir/.github/workflows/migrate-production.yml" "$workflow" | grep -c "group: cocinacore-production-operations")" -eq 3
