# M2 Ownership Transfer Count Contract

## Goal
Use one controlled PostgreSQL RED to determine whether `legacy-upgrade` still expects only the historical 38 transferable objects despite applied migration-declared functions. If and only if the catalog count proves the expectation stale, derive the test's expected count from the manifest baseline plus function additions belonging to migrations actually applied.

## Authorization and constraints
- Worktree: `/Users/yoryiabreu/proyectos/cocinacore-m2-culinary-profile`, branch `test/m2-what-cook-today-e2e`.
- PM authorized splitting the transfer-count query/assertion markers and one controlled ephemeral PostgreSQL run. RED proved a stale fixed expectation, so PM authorized a deterministic test-contract correction, regression coverage, pertinent checks, and one complete integration run.
- Preserve all existing local/untracked work. Do not edit migrations, manifest, checksums, roles, grants, ACL, provisioner, or migrator. No subagents, SDD, RDD, GGA, commit, push, CI, merge, deploy, reset, stash, clean, or force-push.
- Preserve the ownership query and all security assertions. Do not expose secrets or raw logs. Verify ephemeral-resource cleanup.

## Allowed edit surfaces
- `scripts/test-bootstrap-migrator-integration.sh`
- `odd/tasks/m2-ownership-transfer-count-contract.md`

## Tasks
- [x] Add separate static checks for transfer-count query, safe numeric result reporting, and expected-count assertion.
- [x] Run one controlled PostgreSQL RED; compare actual count with 38 historical objects plus function additions for applied migrations. Stop if no mismatch.
- [x] Replace fixed 38 expectation with deterministic manifest-plus-applied-ledger calculation; retain ownership/security assertions and regression coverage.
- [x] Run applicable syntax/contract checks and one full integration run; verify cleanup and stop for PM review.

## Exploration evidence
- Earlier full run ended with `stage=legacy-upgrade`, `check=assert_legacy_role_ownership_transfer`, status 1, but did not distinguish query failure from a non-38 result.
- The ownership query counts schemas, tables, and non-extension functions owned by `cocinacore_schema_owner`.
- Manifest `baselineObjects.transferable` is 38. Migration 014 declares four function additions. Expected count is the manifest baseline plus function additions from filenames present in the applied ledger.

## RED evidence
- The controlled original-harness run passed the ledger-count and canonical-constraint checks, and the transfer query returned numeric `TRANSFERRED=42`.
- The applied-ledger/manifest calculation returned `EXPECTED_TRANSFERRED=42`; the fixed `38` assertion failed at `assert_legacy_transfer_count`, status 1. This confirms the test expectation was stale; no product defect is established.
- Cleanup verified the run's containers, volume delta, harness temporary child, and diagnostic temporary directory. No extra volume remained.

## GREEN evidence
- Replaced only the fixed transfer-count expectation with equality to the manifest baseline plus function additions for filenames actually present in `schema_migrations`. The ownership count query and security assertions remain unchanged.
- The revised integration assertion is regression coverage: future applied function declarations increase the expected count without changing the historical 38-object baseline.
- `bash -n`, `sh -n`, scoped `git diff --check`, and an independent manifest calculation passed; static expected count is 42.
- One complete original PostgreSQL harness run passed, including the legacy-upgrade stage. It reported `TRANSFERRED=42` and `EXPECTED_TRANSFERRED=42`, then `bootstrap/migrator integration passed`.
- Cleanup verified: run-specific containers absent; no new volumes; harness temporary child and diagnostic temporary root removed.

## Results
- Files changed: `scripts/test-bootstrap-migrator-integration.sh` and this task document. No product source, manifest, migration, checksum, role, grant, or ACL changes.
- No commit, push, CI, merge, or deploy. Stop for PM review.
