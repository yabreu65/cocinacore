# M2 Migration Identity and Ledger Order

## Goal
Confirm or reject the PM hypothesis that verify-complete reads `schema_migrations` as non-inheriting `migration_admin` before `SET ROLE cocinacore_schema_owner`; correct the order only if a permission-faithful focused RED test confirms it, preserving all current security controls.

## Authorization and constraints
- Repository: `/Users/yoryiabreu/proyectos/cocinacore-m2-culinary-profile`
- Branch / starting HEAD: `test/m2-what-cook-today-e2e` / `9a9e45b57820cf8b187e2cea45b3c7c6b706b4f8`
- PM authorizes investigation and a conditional runner/test correction only after a focused RED confirms the cause. If not confirmed, stop with evidence and proposal; no source change, commit, push, or CI.
- Provisioner defines `migration_admin` as LOGIN NOINHERIT and grants it only SET-capable, non-inheriting membership in NOLOGIN NOINHERIT `cocinacore_schema_owner`; managed ledger is owner-controlled, RLS-enabled, and has no PUBLIC grant. Do not grant SELECT or relax role/ACL/membership/ownership checks.
- Required sequence if confirmed: verify migration_admin identity/attributes; verify cluster authority and authorized membership; SET ROLE schema owner; verify active role; only then inspect ledger/applied migrations and perform exact object-owner attestation, including only declarations in validated applied migrations.
- Preserve existing tests/security checks: bad identity, invalid membership, altered ledger, unapplied migration, undeclared function, ambiguous overload, wrong owner; positive verify-complete must reach the final verification rather than pass after an unconfigured mock failure.
- Do not modify runner, provisioner, manifest, migrations 001–014, checksums, roles, grants, ACLs, security contracts, harness assertions, or unrelated work during the current diagnostic. Do not inspect `.env*`, secrets, `.atl/skill-registry.md`. Preserve local state. No commit, push, CI, build, full E2E, GGA, external reviewers, reset/stash/clean/rebase/merge/force-push/deploy/M3. PM authorizes exactly one further isolated PostgreSQL run to distinguish the `pg_depend` restoration SQL from provisioner revalidation; use a temporary harness copy with diagnostic-only markers, loopback/temporary credentials, no shared DB, safe fixed-class/SQLSTATE reporting only, and verify all cleanup.

## Allowed edit surfaces
- `frontend/scripts/run-migrations.js`
- `scripts/tests/test-pawtech-step4-contract.sh`

## Tasks
- [x] Add a permission-faithful regression first. The fake client models the provisioner: `migration_admin` has no inherited ledger/table privileges; `SET ROLE` is authorized only by valid SET membership; ledger reads fail before that role switch. RED observed on the current runner: `permission denied for table schema_migrations` in `--verify-complete/complete`.
- [x] After RED confirmed the hypothesis, reorder identity checks, cluster/membership attestation, explicit SET ROLE and post-switch identity verification before ledger/applied-migration queries; preserve exact applied-function owner attestation and all guards. Offline verification passed.
- [x] Reconcile integration evidence. Real PostgreSQL passed `verify-complete`, `verify-marker`, and `ledger-count` before later role-ownership subtests; the harness did not fully pass.
- [ ] Commit/push/CI are not authorized. No source fixes during diagnosis. Preserve prior local SET ROLE changes.
- [x] Run one safe, temporary marker-instrumented diagnostic for the second `role-ownership` block. Last static ID was `vector_member_restore`; the exact failing operation/class remains unavailable. Cleanup verified; no repository changes.
- [x] Receive PM authorization for one final isolated diagnosis that separates restoration SQL and provisioner revalidation; no source or test behavior changes.
- [x] Run the single diagnostic with four static operation markers, safe exit code/SQLSTATE/closed-class reporting, and verified cleanup. Restore SQL passed (exit 0); provisioner revalidation failed (exit 1), but no allowlisted error ID/SQLSTATE was captured. Stop for PM review; no fix or further run.
- [x] Await PM review of the unresolved provisioner validation failure. **Resolved by subsequent PM-approved corrections and final full PostgreSQL PASS;** the earlier diagnostic evidence below remains historical. Remote CI is still pending.

## Exploration evidence
- `frontend/scripts/provision-database.js:1287-1313` creates the owner and migration roles with NOINHERIT, grants only `SET TRUE, INHERIT FALSE` role membership; `:1319-1326` grants migration-admin only database CONNECT and schema owner database CREATE. `:431-495` enforces owner-controlled schemas/relations/functions and rejects migration-admin ACLs.
- At starting HEAD `9a9e45b`, `frontend/scripts/run-migrations.js:895-900` and `:926` checked ledger existence/read applied migrations before membership check and SET ROLE; `:1212-1216` performs the ledger SELECT. Ledger construction/attestation at `:1142-1195` requires schema-owner ownership, RLS and no PUBLIC grants. Current change moves all ledger/applied reads after verified SET ROLE.
- Source predicted pre-role ledger SELECT denial; the permission-faithful fake test confirmed it with `permission denied for table schema_migrations`.

## Evidence
- Starting candidate is published commit `9a9e45b57820cf8b187e2cea45b3c7c6b706b4f8`; prior CI `38626978178` failed at verify-complete but emitted no safe classifier line. Current uncommitted changes are limited to `frontend/scripts/run-migrations.js` and `scripts/tests/test-pawtech-step4-contract.sh`.
- Focused RED: `sh scripts/tests/test-pawtech-step4-contract.sh` failed at `--verify-complete/complete` with simulated `permission denied for table schema_migrations` before SET ROLE. The mock was audited: migration_admin has no direct/inherited SELECT; only valid SET membership changes role.
- After correction, `sh scripts/tests/test-pawtech-step4-contract.sh`, `node --check frontend/scripts/run-migrations.js`, `sh -n scripts/tests/test-pawtech-step4-contract.sh`, and target `git diff --check` passed. The fake harness covers wrong identity, invalid membership, altered/pending/unknown ledger and owner-function negatives, but does not prove actual extension member hashes.
- The manifest contains only expected extension member counts/hashes (234/36/4), not identity preimages; no extension fixture exists in `scripts/tests`. User explicitly authorized one isolated ephemeral PostgreSQL fixture.
- Prior and current integration evidence align with source order (`scripts/test-bootstrap-migrator-integration.sh:532-548`): `verify-complete` runs before `verify-marker`, then `ledger-count`, `schema-ownership`, `provision-ledger`, and the later `role-ownership` block.
- Prior diagnostic output only located `vector_member_restore`. The current single authorized temporary-copy run separated operations: `vector_member_restore_sql_result exit_code=0 sqlstate=none error_class=none`; `vector_member_revalidate_result exit_code=1 sqlstate=unavailable error_class=unknown`. Thus the exact SQL restore succeeded, and subsequent `provision` failed. No recognized static error ID or safe SQLSTATE was captured; do not infer which provisioner validation failed.
- Source path review: vector revalidation proceeds through `assertExtensionState` (`frontend/scripts/provision-database.js:700+`), which checks catalog state, owner policy, vector capabilities, then `assertExtensionMembers` and its expected count/hash/owner checks. The safe result does not distinguish these checks or rule out a later provisioner validation; exact cause remains unknown.
- Static block inspection (`scripts/test-bootstrap-migrator-integration.sh:564-614`) covers vector member removal/restoration; same-count identity substitution/restoration; reserved-role schema/type ownership; runner direct ACL drift for migration_admin and schema owner; and loss of legitimate `public.tenants` ownership. The temporary diagnostic copy changed output only, not conditions or commands, and was removed.
- Current run: one PostgreSQL harness execution only. It failed at `fresh-install / role-ownership` after restoration SQL passed and revalidation exited 1; fail-fast stopped later assertions in the role-ownership block (they remain unchanged and present). No retry. Temporary copy passed `bash -n`; stale resource preflight was clear. Cleanup verified: no run-owned containers/volumes and temporary copy, overlay, capture, and temp directory removed. No runner/security changes, repo source changes, commit, push, or CI.
- Focused offline tests and static checks passed, but do not substitute for the incomplete real-DB positive. Stop for PM review before any further DB diagnosis.
- Preserve the existing uncommitted runner/test correction and all unrelated worktree changes. Nothing was staged; current PM authorization forbids commit, push, and CI.

## Final local closeout (2026-10-15)
This later verification supersedes the unresolved local integration status above; it does not erase the earlier failures or diagnostics.
- Focused `bash scripts/tests/test-pawtech-step4-contract.sh`: PASS. `node --check frontend/scripts/run-migrations.js`, shell syntax, and scoped `git diff --check`: PASS. The provisioner regression suite also passed 7/7.
- One subsequent complete original PostgreSQL integration: PASS. The ownership query returned `TRANSFERRED=42`; the manifest/applied-ledger expectation was `EXPECTED_TRANSFERRED=42`.
- Cleanup in that final run was verified: no run-owned containers, no new volumes, and the harness and diagnostic temporary directories were removed.
- These are local checks only. Remote CI has not run for the pending candidate; commit, push, CI, and merge remain pending explicit PM authorization.
