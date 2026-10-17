# M3.1 Shopping-to-Inventory Transfer

**Status:** M3.1 implementation and the authorized lint correction are locally verified and committed. No push, PR, merge, or deployment is authorized.

**Base:** `ffd8afaf165b215d023c3a8c0d4a317b369c9ba8`
**Source worktree:** `/Users/yoryiabreu/proyectos/cocinacore-worktrees/m3-1-shopping-inventory-transfer-20261017`
**Closeout branch/worktree:** `feat/m3-1-shopping-inventory-transfer-closeout-20261017` at `/Users/yoryiabreu/proyectos/cocinacore-worktrees/m3-1-shopping-inventory-transfer-closeout-20261017`

## Scope and safeguards

- Add one explicit, tenant-safe, atomic/idempotent transfer of a purchased shopping row into inventory; add minimal confirmation UI; verify the existing “Ya cociné” consumption path unchanged.
- Transfer uses supported structured quantity/unit only; ambiguous `1 bolsa` is rejected, not guessed. `4 kilos` and `1 kilo` normalize to kg.
- No production or persistent Compose DB access, production migration, deploy, push, PR, merge, or scope expansion. No migration was applied during this closeout turn.
- Never inspect, read, alter, stage, or commit `.atl/skill-registry.md`, `.codegraph/`, `.env*`, credentials, or PM files. Use only the explicitly enumerated M3.1 paths in the clean closeout worktree. Use standard hooks; never bypass.
- The original source worktree’s M31-1 staged diff remains unchanged: SHA-256 `2ef5ed902dc9914d40dc81c1ba9b1264261df84cac25b7cfcefa04703348a0af`.

## Work units

### M31-1 — Atomic transfer contract

Migration `015_shopping_inventory_transfer.sql` adds a nullable inventory-transfer marker and timestamp with a pair constraint. The repository locks and scopes the purchased row by user/tenant, validates a positive structured quantity/unit, creates inventory plus one purchase movement and transfer marker transactionally, and returns the existing transfer on replay. Shopping reads expose persisted transfer state. The existing consumption contract was not changed.

### M31-2 — Confirmation UI and vertical regression

The shopping UI requires explicit confirmation, displays durable transferred state after reload, and surfaces errors. The vertical regression covers transfer confirmation/dismissal, replay, persisted state, and the existing “Ya cociné” decrement/replay.

### Isolated E2E harness

Playwright requires explicit `E2E_DATABASE_URL` and `E2E_REDIS_URL`, validating exact loopback host, test port and database path. It binds both app server and runner to the same validated targets, logs only credential-redacted target metadata, binds test services to loopback, and fails if their ports are occupied. The selected spec uses the validator directly. Runner `DATABASE_URL`/`REDIS_URL` are overwritten from the validated E2E targets before worker creation so other Playwright tests using generic variable names cannot silently fall back to development defaults.

## Verification evidence

- Disposable containers `cocinacore-m31-e2e-db` and `cocinacore-m31-e2e-redis` were verified running with `AutoRemove=true`, loopback-only mappings `127.0.0.1:5435` and `127.0.0.1:6381`, no persistent mounts, and tmpfs data directories. Read-only PostgreSQL transaction confirmed `cocinacore_local_db`, role `cocinacore_user`, and `transaction_read_only=on`; Redis PING returned `PONG`. Test app/provider ports `4320`/`4319` were free.
- With `COCINACORE_SKIP_DOTENV=1` and an explicit URL to the disposable database, `npm run db:migrate:verify` passed: migration ledger complete through 015. No migration was applied during this closeout.
- Focused Vitest: **40/40 passed across 5 files**. Fail-closed target validator: **12/12 passed** (including observed RED/GREEN for overwriting ambient generic DB/Redis URLs). `tsc --noEmit --incremental false` passed. Prettier check on all M3.1 source/test/config files passed.
- Connected Playwright: **2/2 passed**. The legacy-row case verified 4 kg and 1 kg transfers and rejection of `1 bolsa`; the UI path verified explicit confirmation, persisted transfer, and existing cooking consumption/replay. Runner and app-server logs showed identical sanitized targets: PostgreSQL `127.0.0.1:5435/cocinacore_local_db`, Redis `127.0.0.1:6381/15`.
- The meal-plan E2E seed initially failed GET rehydration because its payload had empty ingredient arrays, while the persisted-plan schema requires at least one ingredient per meal. The test fixture now seeds valid structured ingredients; product behavior was unchanged. The subsequent full connected spec passed.
- Dependency setup note: clean checkout has no lockfile, so `npm ci` was not usable and no package files were changed. A symlinked dependency directory caused an initial Next build failure; only the clean closeout tree’s symlink was replaced with a copy of already installed dependencies. The later build and E2E passed.

## Safety incident and resolution

One E2E attempt occurred before the runner-wide target fix. The connected spec had its own module-level `Pool` using ambient `DATABASE_URL` or default port 5433, bypassing Playwright/fixture validation. That attempt failed during setup before feature API actions (missing transfer column and tenant FK). The ambient URL was not inspected; therefore the earlier runner connection target cannot be established, and no claim is made that this attempt was isolated. Both seed statements failed and no successful seed or feature API operation was observed. No data cleanup or inspection was performed on 5433. The runner leak was corrected before the passing E2E rerun; the current harness now binds all Playwright workers to the verified disposable target.

## Work-unit commits

Created in the clean closeout worktree, each with the default pre-commit hook (no bypass):

- `a4b24d3f8f4cc27995c08ba562db8d7abbfbde47` — `feat(shopping): transfer purchased items to inventory`
- `59d6cb8b1b4c8cf7fcdff525de7a48d8e7f93dae` — `feat(shopping): add inventory transfer confirmation`
- `b582b0a564189759728c37d60cea1533d49b3d19` — `test(e2e): bind shopping flow to isolated services`

Native Gentle AI review was not started: the final workspace inspect reported only an out-of-scope `.atl/skill-registry.md` change. No START or capture was submitted, and the file content was not read.

Hook notes: commits succeeded with standard hooks. The Guardian’s first M31-2 review attempt could not start Vitest because of `ERR_REQUIRE_ESM` involving `std-env`; its retry passed. The first harness review attempt raised a possible tenant-scope concern for culinary-profile fixture queries; the retry passed, and schema inspection confirmed profile rows are globally unique by `user_id` (profile terms by `(user_id, term_id, preference_type)`), so no tenant-composite key was omitted. The independently executed focused tests, typecheck, Prettier, and connected Playwright checks all passed.

Task-document commits: `e976eb15ba7e3642efdc0fd06e4280029699291f` and `e5999026a4f5ad99a780521fcb5b3bcfb49b2d5e`. No push, PR, merge, or deployment.

## Authorized lint follow-up

**Scope:** Closeout branch `feat/m3-1-shopping-inventory-transfer-closeout-20261017` only. No changes to `main`, server 3000, habitual DB, protected files, or unrelated worktrees.

1. [x] Confirm the introduced unsafe return in `frontend/src/lib/db/repositories/shoppingListRepository.test.ts` and compare formatting against `origin/main`.
2. [x] Add a runtime string guard to the SQL mock call mapping; non-string arguments throw rather than being cast or coerced. Existing SQL assertions and order remain unchanged.
3. [x] Do not reformat `db/migrations/manifest.json` or baseline content. M3.1-added transfer fields and `InventoryMovementType` union already match Prettier; remaining whole-file warnings are pre-existing.
4. [x] Verify: focused Vitest **40/40**; target-validator Vitest **12/12**; `tsc --noEmit --incremental false` passed; ESLint across changed TS/TSX passed; Prettier on the changed test and this task document passed; connected E2E **2/2** passed with only the named ephemeral DB/Redis containers (5435/6381), app/provider ports 4320/4319, and no 3000/3001 use.
5. [x] Independent read-only review found no issue in the guard or preserved SQL assertion semantics.
6. [x] Commit the test and task record with the normal pre-commit hook: `11a0024bee24ca3e910bc26a66dc87b253efce55` (`test(shopping): guard SQL mock assertions`). Hook passed; no merge/push/PR/deploy.
