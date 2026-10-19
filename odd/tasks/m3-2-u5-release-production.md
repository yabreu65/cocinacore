# M3.2 U5 — Release and production

## Goal
Prepare and, only after explicit PM review of live preflight/backup evidence, release M3.2 to `main`, run the official 016/017 production migration workflow, deploy the exact SHA, and execute authenticated smoke checks.

## Constraints
- Preserve local pre-existing `.atl/skill-registry.md`, `odd/tasks/m3-2-u0-e2e-target-hardening.md`, and `.codegraph`; never stage or publish those local changes.
- Do not modify or delete test accounts/data, including local `yoryiabreu65@gmail.com` and production `yoryiabreu@gmail.com`.
- Use one approved issue and one PR; official CI must be green before merge.
- Production mutation is a separate gated phase after PM review of exact release SHA, migration preflight, verified backup, scope, and rollback.
- No U6.

## Tasks
- [x] Create/approve U5 issue under repository policy and record stable readback (`#30`, `status:approved`).
- [x] Update official migration workflow/runner for exact pending 016/017, idempotent ledger checks, backup verification, and rollback-safe behavior; validate statically.
- [ ] Verify release scope and push only the versioned feature branch; open one PR toward `main` with issue linkage.
- [ ] Follow official CI and merge only when green and conflict-free; capture exact merged SHA.
- [ ] Run production migration preflight/backup workflow and stop for PM review before mutation.
- [ ] After PM approval, dispatch exact-SHA migration, deploy, and authenticated smoke; record live evidence without touching test accounts.

## Evidence so far
- U4 release tip: `c958bc3`.
- U3/U4 validation passed; migrations 016/017 hashes and lengths match manifest.
- Official migration workflow/runner now require the exact ordered pending set `016_persistent_user_recipes.sql,017_persistent_recipe_archive.sql`; static contract and shell syntax checks passed.
- Issue `https://github.com/yabreu65/cocinacore/issues/30` is open with `status:approved` and `type:bug`.
- Current worktree dirty paths include pre-existing protected files plus the scoped migration gate edits and this U5 task document; protected paths must remain uncommitted.

## Commit evidence
- `e2892ed` — `chore(release): gate production migration on 016 and 017`
