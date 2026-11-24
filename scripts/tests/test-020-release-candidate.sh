#!/usr/bin/env bash
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/../.." && pwd)
CHECKER="$ROOT/scripts/check-020-release-candidate.mjs"
TMP=$(mktemp -d "${TMPDIR:-/tmp}/cocinacore-020-release.XXXXXX")
trap 'rm -rf -- "$TMP"' EXIT HUP INT TERM

fail() {
  printf 'FAIL: %s\n' "$1" >&2
  exit 1
}

make_fixture() {
  local destination=$1
  mkdir -p "$destination/db" "$destination/frontend" "$destination/.github" "$destination/docs"
  cp -R "$ROOT/db/migrations" "$destination/db/"
  cp -R "$ROOT/frontend/src" "$destination/frontend/"
  cp -R "$ROOT/frontend/scripts" "$destination/frontend/"
  cp -R "$ROOT/scripts" "$destination/"
  cp -R "$ROOT/docs/ops" "$destination/docs/"
  cp -R "$ROOT/.github/workflows" "$destination/.github/"
}

expect_reject() {
  local label=$1
  shift
  if "$@" >"$TMP/output" 2>&1; then
    fail "$label was accepted"
  fi
  printf 'PASS: %s rejected\n' "$label"
}

snapshot() {
  find "$1" -type f -print0 | sort -z | xargs -0 shasum -a 256
}

node "$CHECKER" >/dev/null || fail 'current candidate artifacts did not validate'
printf 'PASS: current candidate artifacts validated\n'

FIXTURE="$TMP/valid"
make_fixture "$FIXTURE"
node "$CHECKER" --root "$FIXTURE" >/dev/null || fail 'copied candidate fixture did not validate'
printf 'PASS: copied candidate fixture validated\n'

for scenario in migration manifest legacy migration_script workflow occurrence_migration retention_migration first_admin_migration first_admin_manifest first_admin_asset_missing private_pdf_migration private_pdf_manifest; do
  case_root="$TMP/$scenario"
  cp -R "$FIXTURE" "$case_root"
  case "$scenario" in
    migration)
      printf '\n-- injected migration drift\n' >>"$case_root/db/migrations/020_tenant_rls_hardening.sql"
      ;;
    manifest)
      node -e "const fs=require('node:fs'); const p=process.argv[1]; const m=JSON.parse(fs.readFileSync(p,'utf8')); m.migrations[19].byteLength++; fs.writeFileSync(p,JSON.stringify(m));" \
        "$case_root/db/migrations/manifest.json"
      ;;
    legacy)
      printf '\n-- injected legacy migration mutation\n' >>"$case_root/db/migrations/003_recipes_and_inventory.sql"
      ;;
    migration_script)
      printf '\n# injected legacy workflow drift\n' >>"$case_root/scripts/migrate-pawtech-production.sh"
      ;;
    workflow)
      printf '\n# injected workflow drift\n' >>"$case_root/.github/workflows/migrate-production.yml"
      ;;
    occurrence_migration)
      printf '\n-- injected 022 migration drift\n' >>"$case_root/db/migrations/022_real_consumption_occurrences.sql"
      ;;
    retention_migration)
      printf '\n-- injected 023 migration drift\n' >>"$case_root/db/migrations/023_inventory_movement_retention.sql"
      ;;
    first_admin_migration)
      printf '\n-- injected 024 migration drift\n' >>"$case_root/db/migrations/024_first_platform_admin_bootstrap.sql"
      ;;
    first_admin_manifest)
      node -e "const fs=require('node:fs'); const p='$case_root/db/migrations/manifest.json'; const m=JSON.parse(fs.readFileSync(p,'utf8')); m.migrations[23].byteLength++; fs.writeFileSync(p,JSON.stringify(m));"
      ;;
    first_admin_asset_missing)
      rm -- "$case_root/frontend/scripts/bootstrap-first-platform-admin.js"
      ;;
    private_pdf_migration)
      printf '\n-- injected 025 migration drift\n' >>"$case_root/db/migrations/025_private_tenant_pdf_creation.sql"
      ;;
    private_pdf_manifest)
      node -e "const fs=require('node:fs'); const p=process.argv[1]; const m=JSON.parse(fs.readFileSync(p,'utf8')); m.migrations[24].byteLength++; fs.writeFileSync(p,JSON.stringify(m));" \
        "$case_root/db/migrations/manifest.json"
      ;;
  esac
  before=$(snapshot "$case_root")
  expect_reject "$scenario drift" node "$CHECKER" --root "$case_root"
  after=$(snapshot "$case_root")
  [[ "$before" == "$after" ]] || fail "$scenario rejection mutated candidate files"
done

expect_reject 'legacy U5 approval reference' node "$CHECKER" \
  --release-sha 61f5b92f6aefdb27bcc79fa25c746f5ec02959a5 \
  --owner-approval-reference U5-016-017-20261018-owner-approved
expect_reject 'release SHA without approval reference' node "$CHECKER" \
  --release-sha 61f5b92f6aefdb27bcc79fa25c746f5ec02959a5
expect_reject 'approval reference bound to a different SHA' node "$CHECKER" \
  --release-sha 61f5b92f6aefdb27bcc79fa25c746f5ec02959a5 \
  --owner-approval-reference M6-020:36a40886ca03740a20447e43138aab0181d42597:receipt-1
expect_reject 'release SHA not integrated into main' node "$CHECKER" \
  --release-sha 61f5b92f6aefdb27bcc79fa25c746f5ec02959a5 \
  --owner-approval-reference M6-020:61f5b92f6aefdb27bcc79fa25c746f5ec02959a5:receipt-1

printf '%s\n' 'PASS: 020 release artifact gate checks are read-only and fail closed'
