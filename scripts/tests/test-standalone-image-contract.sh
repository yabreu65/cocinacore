#!/bin/sh
# Static contract and optional synthetic Docker context test; no services are started.
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
D="$ROOT/Dockerfile.standalone"
I="$ROOT/Dockerfile.standalone.dockerignore"
fail() { printf '%s\n' "standalone image contract: $1" >&2; exit 1; }
for line in 'FROM base AS operations' 'FROM base AS runtime' 'WORKDIR /app/frontend' 'COPY db/migrations /app/db/migrations' 'USER nextjs' 'CMD ["node", "server.js"]'; do
  grep -Fqx "$line" "$D" || fail "missing $line"
done
for path in '**' '**/.env' '**/.env.*' '**/.npmrc' '**/*.pem' '**/*.key' '**/node_modules' '**/.next-*'; do
  grep -Fqx "$path" "$I" || fail "missing exclusion $path"
done
for path in frontend/scripts/activate-020-capabilities.js frontend/scripts/activated-capabilities-021-attestation.sql frontend/scripts/activated-capabilities-022-occurrences.sql frontend/scripts/activated-capabilities-023-retention.sql frontend/scripts/activated-capabilities-024-first-admin.sql frontend/scripts/activated-capabilities-024-inventory.sql frontend/scripts/bootstrap-first-platform-admin.js scripts/provision-runtime-role.sql scripts/provision-auth-role.sql scripts/provision-020-inert-capabilities.sql scripts/provision-first-platform-admin-roles.sql scripts/rls-candidates/020e-a1-inert-capability-guard.sql; do
  grep -Fq "$path" "$D" || fail "missing operational input $path"
  grep -Fqx "!$path" "$I" || fail "missing context input $path"
done
helper='frontend/e2e/fixtures/family-week-cleanup-contract.ts'
grep -Fqx "COPY $helper ./e2e/fixtures/" "$D" || fail "missing TypeScript fixture helper"
grep -Fqx "!$helper" "$I" || fail "missing TypeScript fixture context input"
grep -Fqx 'frontend/e2e/fixtures/**' "$I" || fail 'unrestricted E2E fixtures context'
runtime=$(sed -n '/^FROM base AS runtime$/,$p' "$D")
! printf '%s\n' "$runtime" | grep -Eq 'COPY.*(node_modules|db/migrations|frontend/scripts|scripts/provision)' || fail 'operations or full dependencies copied into runtime'
for path in '/app/.next/standalone' '/app/.next/static' '/app/public'; do
  printf '%s\n' "$runtime" | grep -Fq "$path" || fail "missing runtime artifact $path"
done
printf '%s\n' 'standalone image contract: PASS'

[ "$#" -eq 0 ] && exit 0
[ "$#" -eq 1 ] && [ "$1" = '--context' ] || fail 'expected --context or no arguments'
# Use only synthetic content. Keep the small fixture as evidence; no cleanup of
# existing files, containers, images or volumes is performed by this test.
fixture=$(mktemp -d "${TMPDIR:-/tmp}/cocinacore-standalone-context.XXXXXXXX")
context="$fixture/context"
mkdir -p "$context"
cp "$I" "$context/Dockerfile.standalone.dockerignore"
printf 'FROM scratch\nCOPY . /context\n' > "$context/Dockerfile.standalone"
allowed='frontend/package.json frontend/src/app/api/meal-plan/coverage/route.ts frontend/public/logo.png frontend/scripts/activate-020-capabilities.js frontend/scripts/activated-capabilities-021-attestation.sql frontend/scripts/activated-capabilities-022-occurrences.sql frontend/scripts/activated-capabilities-023-retention.sql db/migrations/manifest.json db/migrations/021_inventory_price_reference.sql db/migrations/022_real_consumption_occurrences.sql db/migrations/023_inventory_movement_retention.sql scripts/rls-candidates/020e-a1-inert-capability-guard.sql frontend/e2e/database-target.ts frontend/e2e/standalone-server-env.ts frontend/e2e/reporters/production-safety-reporter.ts frontend/e2e/fixtures/family-week-cleanup-contract.ts'
forbidden='.env frontend/.env.local frontend/src/.env frontend/src/app/.env.production frontend/public/synthetic.key frontend/src/.npmrc frontend/scripts/test.js frontend/node_modules/not-allowed.js frontend/.next-dev-foo/not-allowed.js odd/tasks/private.md scripts/rls-candidates/not-allowed.sql frontend/e2e/specs/other.spec.ts frontend/e2e/fixtures/other-fixture.ts'
for file in $allowed $forbidden; do
  mkdir -p "$context/$(dirname "$file")"
  printf 'synthetic fixture\n' > "$context/$file"
done
docker buildx build --file "$context/Dockerfile.standalone" --output "type=local,dest=$fixture/output" "$context"
for file in $allowed; do
  [ -f "$fixture/output/context/$file" ] || fail "expected context file missing: $file"
done
for file in $forbidden; do
  [ ! -e "$fixture/output/context/$file" ] || fail "forbidden context file present: $file"
done
printf '%s\n' 'standalone context canary: PASS'
