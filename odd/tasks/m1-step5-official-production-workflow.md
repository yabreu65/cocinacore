# M1 Production — Step 5: Official Production Workflow

## Goal and boundaries

Complete the official, manual exact-SHA CocinaCore M1 production workflow in this worktree only:
`/Users/yoryiabreu/proyectos/cocinacore-pawtech-deploy-fix`, branch `fix/pawtech-production-deploy`, base `a1e008c392c76b6d586a1b1e9cf10ef0df56b7f0`.

ODD only. No RDD, SDD, OpenSpec, META 2, commit, push, PR, merge, deploy, production mutation, production backup, migration, restore, or GitHub deploy invocation. Preserve pre-existing Step 3/4 changes. Do not enter `cocinacore-deploy-hardening`.

## TDD resolution

- **Mode:** Strict TDD, explicitly selected by the user in this session after no project/session configuration was found.
- **Source:** Direct user choice in this session (2026-10-03).
- **Exact runner for integration diagnosis:** `sh scripts/test-bootstrap-migrator-integration.sh`, gated to local-unix Docker and loopback-only ephemeral test DBs.

## Approved immutable production contract

- App `cocinacore-web`, app dir `/opt/pawtech/apps/cocinacore`, runtime env `/opt/pawtech/env/cocinacore.env`.
- Shared `pawtech-postgres` / `cocinacore_db` / `cocinacore_user`; shared `pawtech-redis:6379`; networks `pawtech_internal`, `pawtech_public`; Traefik Pawtech; persistent local uploads `/opt/pawtech/data/cocinacore/uploads` → `/app/uploads`.
- Separated DB lanes disabled; M1 email optional; `SESSION_DAYS=30` remains supported.
- M1 schema is immutable: read-only `db:migrate:verify`, emits `MIGRATION_EXPECTATION=NO_OP` and `DATABASE_CHANGED=NO`; no mutating `db:migrate`, checksum backfill, provisioner, migration admin, `.env.migration`, or automatic DB restore. Pending/unknown/out-of-order migration blocks.
- One `workflow_dispatch` exact 40-char SHA already in `origin/main`; full frontend checks/static contracts before SSH; server read-only preflight before deploy; build exact SHA from `git archive`; CocinaCore-only backup/integrity before verify/candidate; candidate health before cutover; app rollback proof; deploy-script public health and independent GitHub smoke.

## Exploration evidence (read-only)

- Before changes, `git fetch origin` completed. Branch is `fix/pawtech-production-deploy`; HEAD and `origin/main` are both `a1e008c392c76b6d586a1b1e9cf10ef0df56b7f0`; base is ancestor of `origin/main`; no remote commits/diff since base. Existing worktree changes were enumerated and preserved.
- User/PM supplied production database semantic/hash evidence is not independently attributed to this session.
- Read-only SSH inventory found historical manual CocinaCore dumps under `/opt/pawtech/backups/postgres/cocinacore_db/manual`, including `cocinacore_db_predeploy_20260928T213033Z.dump`; manual directory mode is 0775, historical dump mode 0600, sidecar mode 0664. The only executable matching backup script under `/opt/pawtech/backups` is the shared `/opt/pawtech/backups/scripts/backup-postgres.sh`; there is no CocinaCore-only helper. Its observed dump method is `docker exec ... pg_dump -U ... -d ... -Fc --no-owner --no-acl`, then `pg_restore --list` and sha256; it loops over shared configured databases and also performs global retention/offsite work. Do not invoke it from CocinaCore deployment. No backup artifact was created or read.
- Read-only Git inspection found optional-email commit `f9e1517b7328d9dea6849c364588f5f8b4c47788`, touching README, standalone Compose, runbook, frontend env example, password-reset route test, bootstrap config test, and an unrelated prior ODD task. Relevant behavior/tests/docs need selective port; never cherry-pick or copy the unrelated ODD task.

## Tasks

1. [x] Fetch origin, verify branch/base/main relationship and unchanged remote, capture pre-existing worktree scope.
2. [x] Explore workflow, deploy, CI, tests, backup hierarchy and historical helper evidence; inspect email fix commit read-only.
3. [x] Implement versioned CocinaCore-only private predeploy snapshot helper and connect it to exact-archive deployment sequence; preserve read-only preflight, candidate, cutover and app-only rollback.
4. [x] Finalize one manual exact-SHA GitHub workflow, full CI/static gates before SSH, safe expected app-dir binding, GitHub second public smoke, and Step 5 static contract; wire static contracts into CI.
5. [x] Port only required optional-email behavior/tests/docs; label standalone Compose unambiguously; add Production Reality First policy and align runbook.
6. [x] Run the full frontend CI-equivalent gates (`npm ci`, lint, coverage, typecheck, build).
7. [x] Harden app-only rollback so recoverable prior-container restoration is not blocked by unrelated current config/shared-health/release-ancestry gates; retain attempt/state/identity checks.
8. [x] Diagnose the isolated migration integration test's exit status, confirm cleanup, and obtain a green run or report an evidence-based blocker.
9. [x] Review full accumulated diff and untracked files, classify KEEP/MODIFY/ADD/DROP, perform secret scan, reconcile all evidence, and report exact Step 5 verdict; do not commit/push/deploy.

## Current progress

- Test-first contracts were added/updated for the manual exact-SHA workflow, CocinaCore-only snapshot/verify order, config-only optional email, generic password-reset response, and post-smoke application rollback. The initial RED command `sh scripts/tests/test-pawtech-step5-workflow-contract.sh` exited 1 on the intentionally absent versioned helper; the helper and workflow implementation were then added.
- Current implementation includes a release-object read-only preflight before worktree checkout, a versioned snapshot helper under the established manual hierarchy, no-op migration verification, candidate/cutover/health gates, and a failure-only app rollback route if the independent GitHub smoke fails. Focused GREEN validation passed: shell syntax, deploy contract, Step 4 contract, Step 5 workflow contract, bootstrap/migrator config, runner syntax, and session/password-reset tests (2 files/11 tests).
- Strict TDD was explicitly selected by the user after configuration inspection found no project/session TDD setting. Source: user choice in this session; integration runner: `sh scripts/test-bootstrap-migrator-integration.sh`.
- The isolated integration harness was reviewed as loopback-only against PID-prefixed disposable containers on a confirmed local-unix Docker endpoint. Staged diagnostics first localized failure to separated `verify-complete`; the runner had skipped its migration identity/`SET ROLE` check, so RLS-protected ledger reads failed. The runner now assumes the schema-owner role inside the read-only transaction, with no DDL/lock. The next stage exposed a contradictory integration expectation that read-only verify should time out on a lock; the harness now asserts verify succeeds under a held lock and ordinary migration/provisioner attempts time out. Final exact integration run passed (status 0) through lock matrix; no matching containers remained. No production connection/action occurred.
- Full frontend gates passed in `frontend`: `npm ci` (634 packages; npm reported 5 high-severity vulnerabilities), `npm run lint` (pass with one warning in `src/app/app/page.tsx:83`), `npm run test:coverage` (49 files/411 tests; statements 81.37%, branches 74.69%, functions 87.08%, lines 83.66%), `npx tsc --noEmit`, and `npm run build` (52 static pages). The first npm ci/lint invocations mistakenly ran from the repo root and failed there; reruns from `frontend` passed.
- Read-only review found app-only rollback could be blocked before prior-container restoration by runtime-env validation, shared PostgreSQL/Redis health, network preconditions, or release ancestry. The rollback path is now dispatched before these deploy-only gates while preserving attempt/state/identity/ownership checks, and public health URLs are validated after restore before any request; invalid URL or post-restore health failure reports manual intervention. RED/GREEN static deploy and Step4 contracts passed; a test-only assertion also prevents curl/wget/public probes before URL validation. Independent source review passed this behavior.
- Final full-diff inventory: 11 modified tracked paths, 9 untracked paths, no staged changes, no deletions; all pre-existing paths preserved. Path-level disposition is recorded below.
- `git diff --check` passed. High-confidence secret scan over changed/added non-`.env*` files passed; one scanner hit in `route.test.ts:4` was independently classified as a test-mock declaration with no credential literal. No matched values were printed.
- `actionlint` is unavailable; GitHub workflow static contract passed. `npm ci` reported 5 high-severity dependency advisories; no dependency audit/remediation was in scope and no package manifests were changed.
- Read-only production metadata discovery confirmed only the shared global backup executable; it backs multiple databases/does retention and must not be called by this deploy path. No production backup, DB, or container action occurred.

## Final changed-path disposition

**MODIFY — tracked changes (11):**

- `.github/workflows/ci.yml` — add the focused static contract gates.
- `.github/workflows/deploy.yml` — manual exact-SHA workflow, pre-SSH checks, remote app deploy and failure-only rollback, independent public smoke.
- `README.md` — production deployment and email contract guidance.
- `docker-compose.prod.yml` — standalone/reference-only warning; optional email variables.
- `docs/production/runbook.md` — exact release, verify-only migration, backup and app recovery boundaries.
- `frontend/.env.example` — optional email example variables (file contents intentionally not displayed).
- `frontend/scripts/run-migrations.js` — read-only separated verifier validates migration identity and assumes schema-owner role before RLS-protected ledger reads.
- `frontend/src/app/api/auth/password-reset/request/route.test.ts` — optional email behavior contract.
- `frontend/src/lib/auth/session.ts` — preserve 30-day legacy session compatibility.
- `scripts/test-bootstrap-migrator-integration.sh` — safe progress diagnostics, separated verify/migration lock cases.
- `scripts/tests/test-bootstrap-migrator-config.sh` — static M1 config/optional-email contract.

**MODIFY — pre-existing untracked Step 3/4 artifacts (4):**

- `odd/tasks/pawtech-production-deploy-contract.md` — append Step 5 supersession note; retain Step 3/4 history.
- `scripts/deploy-pawtech-production.sh` — exact release/preflight, versioned backup, no-op verify, candidate/cutover, app-only rollback safety.
- `scripts/tests/test-pawtech-production-deploy-contract.sh` — static workflow/deploy/rollback regression contracts.
- `scripts/tests/test-pawtech-step4-contract.sh` — no-DDL, read-only verify, rollback and identity contracts.

**KEEP — pre-existing untracked path unchanged (1):** `frontend/src/lib/auth/session.test.ts`.

**ADD — new Step 5 paths (4):**

- `docs/production/production-reality-first.md`.
- `odd/tasks/m1-step5-official-production-workflow.md`.
- `scripts/backup-pawtech-cocinacore-predeploy.sh`.
- `scripts/tests/test-pawtech-step5-workflow-contract.sh`.

**DROP:** none.

## Final outcome — 2026-10-03

- `STEP5_COMPLETE=YES`.
- `READY_FOR_PM_DIFF_REVIEW=YES` for the uncommitted working diff only; this is not deployment approval or production readiness.
- Final deploy/Step4/Step5/bootstrap-config static contracts, integration runner (local disposable DB only), frontend coverage suite, lint, typecheck, and build all passed. Integration cleanup left no matching containers. `git diff --check` and high-confidence secret scan passed; the one source-scan hit was confirmed not a credential.
- Warnings/follow-ups: `npm ci` reported five high-severity dependency advisories; one existing lint warning remains; `actionlint` was unavailable. No dependency remediation or audit was performed.
- No production modified, backup, migration, restore, container action, deploy, secret-value output, or secret file addition occurred. The migration integration test used only ephemeral local containers on a local-unix Docker endpoint and loopback DB URLs.
- ODD only; no RDD/native review, SDD, OpenSpec, or META 2. No commit/push/PR/merge. Stop before Step 6.

## PM diff-review final correction — 2026-10-03

- Scope: fix the stdin archive-listing invocation and regression contracts only; preserve all other Step 5 behavior.
- PM finding: the old `pg_restore --list - <"$dump_file"` form treats `-` as a filename. PM reports a read-only listing failed against the historical dump and the stdin form without `-` succeeded; no restore/database write occurred. This is PM-supplied production evidence, not independently repeated.
- Root cause: the static Step 4 contract encoded the invalid CLI form, and the other contracts did not reject it.
- Required correction: `docker exec -i "$POSTGRES_CONTAINER" pg_restore --list <"$dump_file"`, preserving existing redirection/suppression, database user, container, path, checksum, permissions, and artifact naming. No restore flags or automatic restore.
- Reality validation: rely on the PM's read-only historical-dump archive-listing test; do not access production.
- [x] Inspect branch/status and map helper, all three contracts, and deploy ordering.
- [x] Correct helper and contracts; require stdin form, forbid `pg_restore --list -`, preserve archive-validation ordering and restore prohibitions. The helper now reads stdin with no positional dash; all three contracts positively require that form and reject the invalid form.
- [x] Run the exact requested shell/contract/diff checks and explicit executable/test search; record final readiness.

### Correction result

- `old_pg_restore_form`: `docker exec -i "$POSTGRES_CONTAINER" pg_restore --list - <"$dump_file"`.
- `new_pg_restore_form`: `docker exec -i "$POSTGRES_CONTAINER" pg_restore --list <"$dump_file"`.
- `trailing_dash_present`: NO in either production shell script; the three test scripts mention the invalid form only in negative regression assertions. Historical PM finding documentation labels it invalid.
- `database_user_changed`: NO. `backup_scope_changed`: NO. Database/container/path/checksum/permissions/artifact naming and existing output suppression were preserved.
- **Tests:** Step 4, Step 5 workflow, and production deploy contracts all require stdin listing without a positional filename; all three reject the invalid helper form. Existing `--clean`, `--create`, `--dbname`, no-automatic-restore and archive-before-verify/candidate contracts remain enforced.
- **Validation:** both shell syntax checks, the three deploy contracts, bootstrap config, `git diff --check`, and untracked whitespace checks passed. The test-first Step 4 contract failed as expected against the old helper before the one-token correction.
- **Unchanged:** exact SHA and Pawtech runtime; CocinaCore-only backup; mutating migration NO; `db:migrate:verify` YES; `DATABASE_CHANGED=NO`; candidate and app-only rollback; email remains optional.
- **PM reality validation:** PM performed the read-only historical-dump listing test; this session did not access production or repeat it.
- `STEP5_PM_CORRECTION=PASS`; `STEP5_COMPLETE=YES`; `READY_FOR_PM_FINAL_DIFF_APPROVAL=YES` for the uncommitted diff.
- Dependency advisories are explicitly deferred as `STEP6_SECURITY_FOLLOW_UP`; `actionlint` absence is non-blocking per PM.
