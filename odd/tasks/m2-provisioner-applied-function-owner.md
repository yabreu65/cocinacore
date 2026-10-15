# M2 Provisioner Applied-Function Ownership

## Goal
Fix `attestBaselineCatalog()` so applied migration-declared functions are owner-attested without being mistaken for historical transferable objects or causing an unclassified `TypeError`. Preserve the exact 38 historical objects and all existing ownership/security checks.

## Authorization and constraints
- Repository/worktree: `/Users/yoryiabreu/proyectos/cocinacore-m2-culinary-profile`, branch `test/m2-what-cook-today-e2e`, starting HEAD `9a9e45b57820cf8b187e2cea45b3c7c6b706b4f8`.
- PM authorizes focused TDD implementation for the provisioner and a separate focused regression test. Only applied migrations' declared functions may be recognized; preserve exact identity/unique overload and owner checks; unknown catalog objects must fail with a controlled contract error.
- Do not edit manifest, SQL migrations 001–014, checksums, roles, grants, ACL, INHERIT, historical 38-object set, or existing local SET ROLE changes. Preserve unrelated local work including `.atl/skill-registry.md`; never inspect `.env*`, secrets, or `.atl/skill-registry.md`.
- No commit, push, CI, merge, deploy, GGA, SDD, RDD, M3, destructive Git actions, or extra functionality.
- After focused RED/GREEN and static checks pass, PM authorizes exactly one full ephemeral PostgreSQL harness execution. If it fails, report stage/check/cause and stop without another correction or retry. If it passes, report results and stop for PM authorization before commit/push/CI.

## Allowed edit surfaces
- `frontend/scripts/provision-database.js`
- `frontend/scripts/provision-database.test.js` (new isolated test file)
- `odd/tasks/m2-provisioner-applied-function-owner.md`

## Tasks
- [x] Add isolated deterministic coverage with a genuine RED for applied migration 014 function owner checks and the missing `byKey` object; include declared/applied, undeclared, unapplied, wrong owner, overloaded identity, altered historical owner, and controlled unknown-object failures.
- [x] Apply the minimal provisioner correction: preserve strict historical ownership; map only uniquely matched functions declared by validated applied migrations with owner expectations for both legacy and target states; reject unknown objects via a classified contract error; do not weaken exact existence/identity/owner checks.
- [x] Run focused tests through RED/GREEN and all specified negatives; run Node syntax and scoped diff checks; inspect changed-file boundaries.
- [x] Run exactly one full ephemeral PostgreSQL integration harness after focused checks pass; record last confirmed stage/check and cleanup status. It progressed past `vector_member_revalidate` and failed at `legacy-upgrade / startup`; no retry. Stop for PM review.
- [x] Await PM review of the later legacy-upgrade startup failure and the temp-root cleanup verification limitation. **Resolved by the later count-contract diagnosis, full local PostgreSQL PASS, and verified cleanup** recorded below; no further PostgreSQL run is authorized.

## Exploration evidence
- Previous diagnostic isolated the integration failure: restoration of the vector operator's `pg_depend` row succeeded (exit 0); the following `provision` revalidation failed (exit 1), but its safe class was unknown.
- Read-only exploration mapped the provisioner path: `frontend/scripts/provision-database.js:974-1063`. Applied function additions are checked separately against their expected owner; the later `byKey` map contains only `baselineObjects.transferable`, then final catalog ownership loops over functions as well. A missing map entry can be dereferenced for `expectedLegacyOwner`/`targetOwner`.
- `expectedCatalog()` already derives function additions only from applied migrations and checks unique same-name resolution; the final owner map must preserve this exact applied-only identity and owner policy rather than expand the baseline set.
- Current worktree already has uncommitted `frontend/scripts/run-migrations.js` and `scripts/tests/test-pawtech-step4-contract.sh`; preserve both. Also preserve unrelated `.atl/skill-registry.md` and ODD artifacts.

## Evidence
- At start of this task: branch `test/m2-what-cook-today-e2e`, HEAD `9a9e45b`; prior SET ROLE correction remains local/uncommitted. No source changes for this task yet.
- Existing static integration evidence: `verify-complete`, `verify-marker`, and `ledger-count` passed in PostgreSQL before the later ownership checks; the one last PM-authorized diagnostic separated restore SQL success from provisioner failure and was cleaned up.
- Record RED/GREEN commands/results, focused negative outcomes, one full PostgreSQL harness result, exact cleanup evidence, and final file list below.

## Results
- Complete pre-fix RED: `node --test frontend/scripts/provision-database.test.js` exited 1 (6 pass, 1 fail). The valid applied-014 function test failed at `attestBaselineCatalog` line 1061 reading `expectedLegacyOwner` from `undefined`; this confirms the `byKey.get(...)` miss. All six required negatives passed: wrong owner, same-name overload, altered historical owner, physically present function from unapplied migration, undeclared function, and unknown catalog object.
- Minimal fix: keep `baselineObjects.transferable` unchanged; resolve additions only from applied migration declarations, preserve unique identity and owner validation, add exact catalog identities to a separate ephemeral owner-policy map, and reject conflicting/missing policies with `BASELINE_MISMATCH`. Normal CLI behavior remains guarded by `require.main`; `attestBaselineCatalog` is exported for direct deterministic tests.
- Focused GREEN: `node --test frontend/scripts/provision-database.test.js` passed 7/7, including legacy and target ownership plus all six negative cases. `node --check` passed for source and test; scoped `git diff --check` passed.
- Exactly one full harness run: `bash scripts/test-bootstrap-migrator-integration.sh` exited 1. It passed fresh-install checks and the advisory-lock matrix, advanced beyond `vector_member_revalidate`, then failed at `stage=legacy-upgrade check=startup`. Safe output did not establish the underlying cause. No retry or source modification followed.
- Cleanup: the run verifier reported no matching containers/volumes remaining. The harness EXIT trap attempted to remove its randomly named `mktemp -d` root, but that root has no stable prefix and was not independently verified. Report this limitation; do not claim complete temporary-directory verification.
- Stop for PM review. No commit, push, CI, merge, deploy, or further correction.
- Files changed for this work unit: `frontend/scripts/provision-database.js`, new `frontend/scripts/provision-database.test.js`, and this ODD task document. Existing local `frontend/scripts/run-migrations.js` / `scripts/tests/test-pawtech-step4-contract.sh` SET ROLE changes and unrelated work were left untouched; manifest, migrations, checksums, roles, grants, ACLs, and baseline set unchanged.

## Final local closeout (2026-10-15)
This subsequent result resolves the earlier broad `legacy-upgrade / startup` blocker; all earlier RED, GREEN, and failure evidence above is retained as historical evidence.
- The follow-up separated the transfer-count query from its assertion. RED established that the query succeeded with `TRANSFERRED=42`, while the test's fixed `38` expectation was stale; manifest baseline plus function additions from applied ledger entries yielded `EXPECTED_TRANSFERRED=42`.
- Only the integration test contract was corrected to derive its expected count from the manifest baseline and functions declared by migrations actually present in the applied ledger. Product code and security assertions were not changed in this follow-up.
- Focused `node --test frontend/scripts/provision-database.test.js`: 7/7 PASS; `bash scripts/tests/test-pawtech-step4-contract.sh`: PASS. Syntax and scoped diff checks: PASS.
- One complete original PostgreSQL integration after the contract correction: PASS; it reported `TRANSFERRED=42`, `EXPECTED_TRANSFERRED=42`, and the integration success line.
- Final-run cleanup was verified: no run-owned containers, no new volumes, and no harness or diagnostic temporary directories remaining. This supersedes the earlier cleanup-verification limitation for that final run, without altering its historical record.
- All results above are local. Remote CI has not run for the pending candidate. Commit, push, CI, and merge remain pending explicit PM authorization.
