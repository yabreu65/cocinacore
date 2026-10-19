# M3.2 U5 — Safe migration baseline for existing data

## Goal
Correct the official 016/017 production migration preflight so existing `shopping_list_items` rows do not block unrelated persistent-recipe migrations, without deleting data or weakening identity, size, lock, ledger, backup, tenant, or post-migration verification gates.

## Scope
- Investigate why the baseline required an empty `shopping_list_items` table.
- Preserve the 81,920-byte relation-size ceiling and all other production safety checks.
- Add executable coverage for zero rows, one-or-more rows, and oversized relations.
- Include the verified shared-VPS `pawtech` access policy in `AGENTS.md` only; do not stage protected pre-existing local paths.
- Use one approved issue, one controlled PR, and official CI only.
- Do not dispatch production workflows or retry migration in this change.

## Tasks
- [x] Inspect 016/017 SQL, runner, production gate, contracts, and M3.1 compatibility evidence.
- [x] Create and approve a dedicated issue under repository policy (`#32`, `status:approved`, `type:bug`).
- [x] Implement the smallest safe baseline-gate correction.
- [x] Add zero-row/one-plus-row/oversized-relation tests and update contract expectations.
- [x] Verify protected local paths remain unstaged and run focused checks.
- [ ] Commit one reviewable work unit and open the controlled PR.
- [ ] Monitor official CI; stop before any production retry.

## Findings
- `016_persistent_user_recipes.sql` creates recipe/version tables, constraints, indexes, a version-invariant trigger, and tenant/user RLS; it does not reference `shopping_list_items` or move data.
- `017_persistent_recipe_archive.sql` adds `archived_at` and an index to `user_recipes`; it does not reference `shopping_list_items` or move data.
- M3.1 schemas and rehearsal fixtures intentionally support existing shopping-list rows, including a synthetic persisted row.
- The production script's zero-row requirement is an unrelated conservative baseline check. Production currently has one row, so the official migration run stopped before the DDL phase.
- Safe correction: retain the relation-size ceiling and all other gates; validate the relation result but do not reject a nonzero row count.

## Evidence
- Blocked official run: `39278701785`.
- Release candidate: `d8119741fea9f8ad035b5dad56208a106420100d`.
- No production retry or deploy is authorized for this change; PM review is required after CI and before any new workflow dispatch.

## Verification evidence
- `node scripts/tests/test-pawtech-migration-baseline.js` — PASS.
- `sh scripts/tests/test-pawtech-migration-contract.sh` — PASS.
- `node --check` for both new JavaScript files — PASS.
- `sh -n scripts/migrate-pawtech-production.sh` — PASS.
- `shellcheck scripts/migrate-pawtech-production.sh scripts/tests/test-pawtech-migration-contract.sh` — PASS.
- `git diff --check` — PASS.
- Protected `.atl/skill-registry.md`, `.codegraph/`, and U0 task edit remain unstaged.

## Commit evidence
- Pending.
