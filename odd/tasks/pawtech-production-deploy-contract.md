# ODD — PawTech production deploy contract

## Outcome

CocinaCore production deployment must match the existing PawTech VPS topology instead of creating a second PostgreSQL/Redis stack.

## Observable contract

- Deployment accepts only a 40-character SHA already integrated into `origin/main`.
- Runtime configuration remains outside Git at `/opt/pawtech/env/cocinacore.env` and must be mode `0600`; deployment passes it as the runtime env source without printing, copying, or rewriting it.
- Runtime database target is `cocinacore_user@pawtech-postgres:5432/cocinacore_db`; Redis is `pawtech-redis:6379`.
- The app joins `pawtech_internal` and `pawtech_public`.
- Local uploads persist at `/opt/pawtech/data/cocinacore/uploads`.
- `STORAGE_DRIVER=local` requires no S3 credentials; `s3` requires the modern S3 credential contract.
- Missing transactional-email configuration is reported but does not block deployment.
- M1 Pawtech deployment runs only `npm run db:migrate:verify` through the app image using the shared runtime env before candidate startup; it must not invoke mutating `npm run db:migrate`. Missing `COCINACORE_SEPARATED_DB_LANES_ENABLED` means separated lanes are disabled; this M1 path does not provision databases or activate lanes.
- A candidate container must pass app/DB/Redis health before cutover.
- The previous production container is retained stopped as the immediate application rollback target.
- If cutover health or public smoke fails, the prior container is automatically restored.
- The production workflow must not invoke the standalone `docker-compose.prod.yml` path.

## Non-goals

- Activating separated database lanes.
- Creating or rotating application secrets.
- Creating a second PostgreSQL or Redis service.
- Deleting historical rollback containers.
- Changing META 1 product behavior.
- Deploying, changing production containers, running production migrations, modifying PostgreSQL/Redis, or changing/copying/printing the production runtime env file during this task.
- Creating a commit; the user explicitly deferred commits.

## Existing Change Classification

These dispositions preserve all existing work unless a Pawtech M1 contract mismatch is identified. `DROP` refers only to behavior from the Pawtech deploy path, not deletion of unrelated repository migration support.

| Existing path/change | Disposition | Rationale |
|---|---|---|
| `.github/workflows/ci.yml` | KEEP | Preserve the pre-existing local contract-test workflow change without broadening workflow policy. |
| `.github/workflows/deploy.yml` | MODIFY | Keep full-SHA/main validation and public smoke; remove the `.env.migration` dependency and invoke only the Pawtech deploy script. |
| `docs/production/runbook.md` | MODIFY | Preserve useful candidate health/rollback guidance; make M1's shared Pawtech topology and no-lanes contract authoritative. |
| `scripts/deploy-pawtech-production.sh` | MODIFY | Pin the optional workflow env-path argument to `/opt/pawtech/env/cocinacore.env` with a value-free mismatch error; require healthy shared services/networks/Traefik and local uploads; M1 runs only read-only `db:migrate:verify` before candidate; preserve exact-SHA archive, backup, candidate health and rollback; no provisioner or Compose-created infrastructure. |
| `scripts/tests/test-pawtech-production-deploy-contract.sh` | MODIFY | Add static assertions for every requested contract case; never execute the deploy or print secret values. |
| `scripts/tests/test-bootstrap-migrator-config.sh` | MODIFY | Preserve generic runner/provisioner and CI integration safety checks; require M1's shared runtime-env read-only verification and forbid mutating deployment migration/provisioning/migration-env behavior, without requiring a separated-lane path. |
| `odd/tasks/pawtech-production-deploy-contract.md` | MODIFY | Maintain this contract, classification and verification evidence. |
| Pawtech deploy behavior using `/opt/pawtech/config/cocinacore/runtime.env`, `.env.production`, `.env.migration`, separated lanes/provisioner, or a standalone Compose DB/Redis stack | DROP | These conflict with the user-authoritative M1 Pawtech runtime. Do not delete unrelated repository code/tests. |
| Session duration compatibility | MODIFY | `AUTH_SESSION_TTL_SECONDS` remains authoritative; only absent/empty values fall back to positive legacy `SESSION_DAYS` converted to seconds, with the seven-day fallback retained otherwise (including explicitly invalid AUTH TTL). |

## M1 Production — Step 3 Final Correction

### Authorized scope

Only this worktree and branch: `/Users/yoryiabreu/proyectos/cocinacore-pawtech-deploy-fix`, `fix/pawtech-production-deploy`, based at `a1e008c392c76b6d586a1b1e9cf10ef0df56b7f0`. No commit, staging, deploy, production access, migration execution, secret changes, RDD, META 2, or unrelated worktree access.

### Acceptance criteria

- Local storage requires `/opt/pawtech/data/cocinacore/uploads` to already exist; deploy/preflight must never create, chmod, chown, or otherwise alter that directory.
- Preflight remains strictly read-only, including no cleanup trap invocation or mutating deploy commands.
- Contract tests assert the directory precondition, absence of directory mutation, and read-only preflight boundary.
- Run only the authorized validation commands and report exact outcomes.

### Task state

- [x] Add/adjust contract assertions first and observe the expected failure (strict TDD): baseline failed because local uploads existence was not required.
- [x] Update deploy script to enforce the existing uploads directory and keep preflight side-effect-free; focused contract test turned green.
- [x] Run authorized local validation; preserve no-commit/no-deploy boundary.

### Evidence

- Strict TDD RED: `sh scripts/tests/test-pawtech-production-deploy-contract.sh` failed before the script change because local uploads existence was not required; GREEN: the same test passed after the correction.
- `sh -n scripts/deploy-pawtech-production.sh` passed.
- `sh scripts/tests/test-pawtech-production-deploy-contract.sh` passed (`pawtech production deploy contract passed`).
- `sh scripts/tests/test-bootstrap-migrator-config.sh` passed (`bootstrap/migrator static config passed`); Compose checks were config-only and started no services.
- `git diff --check` passed for tracked changes. Since the two changed scripts were untracked, independent `git diff --no-index --check /dev/null <file>` checks were also run for each; both returned expected status 1 with no output/whitespace diagnostics.
- Independent verification confirmed branch `fix/pawtech-production-deploy`, HEAD `a1e008c392c76b6d586a1b1e9cf10ef0df56b7f0`, and no change to the prior worktree status beyond the authorized task artifacts. Preflight was not executed against real `/opt/pawtech` paths; no production access, deploy, migration, staging, or commit occurred.

## M1 Production — Step 4: Backup, migrations, rollback

### Outcome

Implement the PM-approved M1 release path: build exact SHA, run and validate the existing Pawtech backup routine, run only read-only `db:migrate:verify`, then candidate and cutover. M1 must report `DATABASE_CHANGED=NO`; automatic database restore is forbidden. No production mutation, backup run, migration, restore, commit, or deploy is authorized in this task.

### PM decision and supplied production evidence (2026-10-03)

- **Authority/source:** The following semantic checks, deployed-image migration hashes, exact ledger rows, and runtime-user capabilities were supplied by the PM in the current request. Do not present them as newly observed by this session; no production access is authorized for this continuation.
- Production image is `cocinacore:deploy-a1e008c392c76b6d586a1b1e9cf10ef0df56b7f0`; it contains migrations 001–012, whose SHA-256 files match the current repository according to PM evidence. The production ledger contains exactly 001–012 and no pending filename.
- Migration 011 semantic evidence: `users_email_canonical_check` and `accept_tenant_invitation` exist; canonical-email expression is `email = lower(btrim(email)) AND email <> ''`; noncanonical count and canonical-collision groups are zero.
- Migration 012 semantic evidence: `public.user_meal_plans.consumption_payload` exists as `jsonb NOT NULL DEFAULT '{}'::jsonb`, with the stated idempotent-confirmation comment.
- PM evidence says runtime user has DDL capability. M1 does not depend on it: M1 must not execute `db:migrate` and must use only read-only verification.
- `LEGACY_LEDGER_CHECKSUMS=UNAVAILABLE` remains true. Do not add a checksum column, backfill, or enable separated DB lanes. PM-declared image/repository hashes, exact ledger names, 011/012 semantic checks, and healthy current application provide compensating evidence for a no-DDL M1 deploy.
- Retention numeric value, exact offsite ACL and latest-dump restore drill are **OPERATIONAL_FOLLOW_UP_FOR_STEP6**, not Step 4 blockers. Do not alter the historical 0644/0755 backup; future wrapper-created objects still fail closed unless modes/owner are correct.
- M1 sequence: exact-SHA validate/build -> Pawtech backup -> SHA-256 verification -> `pg_restore --list` -> read-only `db:migrate:verify` -> `MIGRATION_EXPECTATION=NO_OP` and `DATABASE_CHANGED=NO` -> candidate -> health -> cutover -> public health. Any verify failure blocks candidate/cutover; future pending migration forces separate authorized migration work.

### Production reality — earlier read-only evidence

- Fresh SSH target `pawtech` resolved to `31.220.98.21:22`; host identity observed as `vmi3361868.contaboserver.net`, remote account `yoryi`.
- `cocinacore-web` is running image `cocinacore:deploy-a1e008c392c76b6d586a1b1e9cf10ef0df56b7f0`, attached to `pawtech_internal` and `pawtech_public`; no Docker healthcheck is configured. `pawtech-postgres` and `pawtech-redis` are running/healthy on `pawtech_internal`.
- Runtime DB query from the app used `BEGIN READ ONLY` and `ROLLBACK`: `current_user=cocinacore_user`, database `cocinacore_db`, PostgreSQL 16.14. The legacy `public.schema_migrations` ledger contains filenames 001–012 exactly, no extra/pending filename, and only `filename, applied_at` columns (no checksum column). All current migrations are timestamped as applied. Production SQL checksum drift therefore cannot be determined from this legacy ledger.
- Runtime user is not superuser and cannot create roles/databases; it has public-schema CREATE/USAGE, owns `public`, `internal`, the migration ledger and M1 migration target tables, and can read/write those objects. This capability does not authorize future pending DDL; the M1 deploy path will fail closed on any pending migration.
- Pawtech's real scheduled routine is enabled `pawtech-postgres-backup.timer` -> service running as `yoryi` -> `/opt/pawtech/backups/scripts/backup-postgres.sh`; latest service result was successful. The routine has no database-only argument and the latest run log names `buildingos_db`, `cocinacore_db`, and `pawtech_db`; it backs up the shared set. It performs `pg_dump`, `pg_restore --list` validation, SHA-256 creation, `rclone` copy, and retention cleanup. The deploy must reuse this routine, not create a separate backup implementation.
- Latest CocinaCore artifact `/opt/pawtech/backups/tmp/2026-10-03T08-28-21Z/cocinacore_db_2026-10-03T08-28-21Z.dump` and sidecar both passed checksum verification and `pg_restore --list`. The dump is 111007 bytes, owner `yoryi`, mode 0644; `/opt/pawtech/backups/tmp` is mode 0755. A historical manual predeploy dump `/opt/pawtech/backups/postgres/cocinacore_db/manual/cocinacore_db_predeploy_20260928T213033Z.dump` (mode 0600) also passed both checks. The protected `backups.env` was not read; its configured numeric retention policy and offsite ACL are unknown.
- Existing restored-clone evidence from the earlier CocinaCore rehearsal covers an older verified dump; the current latest dump was structurally validated but not restored in this task. The repository `scripts/postgres-restore.sh` uses the standalone Compose path and destructive `pg_restore --clean`; it is not a proven Pawtech restore procedure. No Pawtech-specific restore script was found under the shared backup scripts directory.
- Repository migration set is 001–012. At the initial Step 4 source review, the baseline runner validated manifest/file SHA-256 and order and took a session advisory lock; legacy `db:migrate` performed ledger setup DDL before skipping applied files, and the baseline `db:migrate:verify` reused that setup path. The Step 4 implementation later made `verifyComplete` read-only; this baseline description is historical, not the current contract. Migrations still run one transaction per file on their separate mutating path.
- Initial Step 4 deploy baseline lacked the backup gate and full prior-image/rollback health evidence. The implementation below adds these controls; this bullet is historical baseline evidence, not a current-state claim.
- One initial read-only catalog query attempt failed due shell quoting; a corrected read-only query succeeded. No production state was changed.

### Implementation plan (reopened by PM decision)

- [x] Preserve the already-reviewed Pawtech backup gate, app rollback, and manual-only DB restore boundary.
- [x] Remove `db:migrate -- --require-no-pending` from M1 deploy; invoke only `db:migrate:verify` before candidate startup and report `MIGRATION_EXPECTATION=NO_OP`, `DATABASE_CHANGED=NO`.
- [x] Remove Step-4-only `requireNoPending` implementation/checksum requirement; keep legacy `verifyComplete` strictly read-only and preserve separated-lane checksum behavior.
- [x] Update offline contracts for command distinction, ordering, legacy-ledger outcomes, no DDL/advisory lock, unchanged database state, rollback safety, and no automatic DB restore.
- [x] Update runbook/ODD for PM-supplied evidence, unavailable legacy checksums, Step 6 restore follow-up, and no-schema-mutation M1.
- [x] Run all authorized local checks with Node v22.22.3/npm 10.9.8; the bootstrap contract rendered Compose config only and started no services. No SSH/production/backup/migration/restore/deploy/preflight/stage/commit/push.

### Implementation evidence

- Strict TDD RED observed: `sh scripts/tests/test-pawtech-production-deploy-contract.sh` failed because the mutating `npm run db:migrate -- --require-no-pending` invocation remained in deploy code; `sh scripts/tests/test-pawtech-step4-contract.sh` then failed because the no-op marker was missing. Both focused contracts passed after implementation.
- Deploy retains the existing Pawtech backup gate (real routine only, private umask, one fresh dump/sidecar, ownership/modes, checksum, archive list, fail closed before candidate, retain artifacts), then executes only read-only verification and emits the no-op marker. The hardened app-only rollback remains unchanged.
- Runner `verifyComplete` checks the existing legacy ledger in `BEGIN READ ONLY`, rejects missing/unknown/out-of-order/pending state, and uses no DDL or advisory DB-change lock. Separated-lane checksum behavior and generic migration behavior remain intact.
- PM supplied (not this session queried) the image/hash/ledger/011/012/app-health evidence recorded above. Legacy ledger checksums are `UNAVAILABLE`, not a Step 4 blocker; no checksum mutation is authorized.
- Runbook states automatic database restore is NO; the isolated restore/latest-backup drill is Step 6, with retention/offsite details as operational follow-up. No production, backup, migration, restore, deploy, or preflight action has occurred.

### Independent verification and Step 4 result

- Branch/HEAD confirmed: `fix/pawtech-production-deploy` / `a1e008c392c76b6d586a1b1e9cf10ef0df56b7f0`; existing local worktree changes preserved. Node `v22.22.3`, npm `10.9.8`.
- Passed: `sh -n scripts/deploy-pawtech-production.sh`; `sh scripts/tests/test-pawtech-production-deploy-contract.sh`; `sh scripts/tests/test-pawtech-step4-contract.sh`; `sh scripts/tests/test-bootstrap-migrator-config.sh` (Compose config rendering only, no services); from `frontend/`, `npm test -- src/lib/auth/session.test.ts` (1 file/3 tests; Vite config-loader warning only) and `node --check scripts/run-migrations.js`; `git diff --check`.
- No-index whitespace checks passed for all five untracked files (ODD task, session test, deploy script, and both contract tests): each `git diff --no-index --check /dev/null <path>` returned expected status 1 with empty output. `npx tsc --noEmit` was not run because no TypeScript files changed.
- Step 4 contracts verify backup/order/checksum/archive/verify/no-op/candidate/health/cutover/public order; absence of the exact mutating `npm run db:migrate` command; verify-only invocation; complete legacy 001–012; pending, unknown, out-of-order and future-013 fail-closed cases; no DDL/advisory lock; `DATABASE_CHANGED=NO`; app rollback; and no automatic DB restore.
- All validations are local and static/mocked, not production/Docker/migration/backup/restore/runtime integration. PM-supplied semantic/hash evidence remains attributed to PM; legacy checksum availability is `UNAVAILABLE`, not fabricated.
- Backup retention/offsite details and the isolated latest-backup restore/Pawtech restore-procedure validation are Step 6/operational follow-ups, not Step 4 blockers.
- **STEP4_COMPLETE = YES. READY_FOR_STEP5 = YES.** No production backup, migration, restore, deploy, preflight, or mutation occurred. No secrets were printed. No commit or push. Stop here; Step 5 was not started.

### Step 5 implementation supersession

This record's Step 4 plan/evidence describes consideration and validation of the shared Pawtech backup routine at that time; it is historical and is not permission to invoke that cross-service routine from the official Step 5 workflow. Step 5 read-only discovery confirmed the shared executable also processes other databases and global retention/offsite work, so the official workflow instead uses the exact-SHA CocinaCore-only helper under the established manual backup hierarchy. Step 4's no-schema-mutation decision and PM-supplied evidence remain unchanged. No production backup or other production operation was performed.

Current official workflow and implementation evidence: `odd/tasks/m1-step5-official-production-workflow.md`.

## ODD Progress

- **Base:** branch `fix/pawtech-production-deploy`, exact HEAD `a1e008c392c76b6d586a1b1e9cf10ef0df56b7f0`.
- **Worktree:** `/Users/yoryiabreu/proyectos/cocinacore-pawtech-deploy-fix` only. Do not inspect or modify `cocinacore-deploy-hardening`.
- **TDD mode:** strict TDD, explicitly selected by the user for this task because project/session config has no setting. Runner is Vitest (`npm test` from `frontend/`); for the new session test use `npm test -- src/lib/auth/session.test.ts` from `frontend/`.
- **Tasks:** (1) preserve pre-existing work and confirm branch/base **DONE**; (2) pin runtime env path, update stale deploy assertions, and restore/reconcile historical runbook content **DONE**; (3) run authorized local verification **DONE**; (4) report exact results with no commit/deploy **DONE**.
- **Session duration contract:** retain precedence of `AUTH_SESSION_TTL_SECONDS`; when absent or empty, convert positive `SESSION_DAYS` to seconds (30 days = 2,592,000); an explicitly invalid/non-positive AUTH TTL uses the seven-day fallback rather than legacy days. JWT expiry, database row expiry, and cookie `maxAge` share the effective TTL.
- **TDD evidence:** after installing exactly from the frontend lockfile, the focused session test failed against a temporary reversion to the base seven-day-only TTL (the legacy 30-day expiry assertion failed; two other tests passed). The intended TTL fallback was immediately reapplied; final focused test passed (3/3).
- **Review corrections:** M1 uses the shared runtime env/user only for read-only migration completeness verification before cutover; no `db:migrate` invocation. PostgreSQL and Redis are checked through narrow `.State.Health.Status` inspection; static tests cover verify-only deployment, secret-output prohibitions, and the default cookie name. Generic bootstrap/migrator checks remain intact while stale Pawtech deployment assertions are reconciled. The script rejects any optional env-path argument other than `/opt/pawtech/env/cocinacore.env` with a value-free error. Historical runbook guidance is preserved and aligned with M1.
- **Verification:** `sh -n scripts/deploy-pawtech-production.sh` passed; `sh scripts/tests/test-pawtech-production-deploy-contract.sh` passed; `sh scripts/tests/test-bootstrap-migrator-config.sh` passed, including its local `docker compose config` checks only; `npm test -- src/lib/auth/session.test.ts` passed (3 tests); `node --version && npm --version` reported v22.22.3 / 10.9.8; `git diff --check` passed. No integration test ran.
- **Native RDD review:** high-risk review lineage `review-01954b41c634e996` admitted `review-risk`, `review-resilience`, and `review-readability`. The final `review-reliability` capture failed; fresh STATUS escalated with `unknown_causality` finding `R3-001` and terminal `native_stop_required`. No approval/acknowledgement was obtained; the terminal stop requires maintainer inspection. No further review operation was issued.
- **No production action occurred; no commit was created.**
