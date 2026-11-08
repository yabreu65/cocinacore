# M6 020E-C1 — Integration and release readiness

**Decision: NO-GO for production execution.** The migration candidate is byte-pinned and the recovery rehearsal exists, but the M6 tree is not integrated into `main`, no M6-020 owner approval exists, and the current application deployment workflow can roll code back without reversing database state. This document defines the safe handoff; it does not authorize Git integration or a persistent database change.

## Quick path

1. Review the M6-only inventory below; keep the seven unrelated GGA/quality-hook paths out of the M6 release.
2. After owner review and integration, run the read-only artifact gate against the full release SHA and an independently recorded M6-020 approval reference.
3. Do not run production steps until a migration-aware application deployment and rollback control, secret-injection mechanism, owner approval, and independent restore receipt have all been approved.

The artifact checker is read-only: it validates 020's fixed checksum and manifest entry, migrations 001–019 against the protected base, and the legacy 016/017 workflow boundary. It does not verify a database, create roles, provision capabilities, migrate, activate, deploy, reopen signup, or authenticate an owner approval. The approval reference is only a pointer to independently verified approval evidence.

```sh
node scripts/check-020-release-candidate.mjs

# Only after the exact release is integrated into the locally available origin/main
# ref and its separate owner approval has been verified:
node scripts/check-020-release-candidate.mjs \
  --release-sha "$RELEASE_SHA" \
  --owner-approval-reference "M6-020:$RELEASE_SHA:<approval-record-id>"
```

The release-SHA mode performs no fetch. Refreshing Git refs is a separate authorized Git operation; a missing or stale local `origin/main` ref fails closed. The checker rejects the legacy U5 approval prefix.

## Inventory and release scope

The release candidate consists of the M6 application/runtime changes, canonical migration and manifest, provisioning/activation assets, RLS and auth tests, M6 operational evidence, and CI artifact gate listed in the exact path appendix below. Staged/unstaged status is recorded without changing it; overlapping paths may be staged and then modified again.

The following seven existing paths are unrelated GGA/quality-hook work and are excluded from M6. Preserve them unchanged for their separate owner:

- `.githooks/gga-codex-pre-commit` — staged deletion.
- `.githooks/pre-commit` — staged modification.
- `docs/ops/gga-review-policy.md` — staged modification.
- `scripts/cocina-quality-gate.mjs` — staged deletion.
- `scripts/tests/cocina-quality-gate.test.mjs` — staged deletion.
- `scripts/tests/codex-only-gga-hook.test.mjs` — staged deletion.
- `scripts/tests/pre-commit-gga.test.mjs` — staged addition.

No temporary build output or disposable PostgreSQL artifact is part of the release inventory. The M6 RLS candidate SQL under `scripts/rls-candidates/` is retained as review evidence; the canonical deployed SQL is only `db/migrations/020_tenant_rls_hardening.sql`.

## Migration and Git gates

| Gate                       | Required evidence                                                                                           | Current finding                                                                                                                                  |
| -------------------------- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Release SHA                | Full commit SHA reviewed and integrated into `main`                                                         | **Fail:** the current worktree is still based on protected HEAD `61f5b92f6aefdb27bcc79fa25c746f5ec02959a5`; it is not an integrated release SHA. |
| Owner approval             | Separate, explicit M6-020 approval record bound to that SHA                                                 | **Fail:** none was supplied. The U5 016/017 reference is not accepted.                                                                           |
| Canonical 020              | SHA-256 `1fbadb829792902ef19bdb0abd2c20e39409360986c9844d9cab3105df6eb33a`; 130,680 bytes                   | **Pass:** verified in this worktree. Do not regenerate the hash to accommodate a changed file.                                                   |
| Migrations 001–019         | Exact bytes remain equal to the protected baseline; manifest entries match                                  | **Pass:** verified locally and enforced by the candidate artifact checker.                                                                       |
| Restricted runner          | 019 boundary, exact pending set, transactional migration, activation-pending state, and `--verify-complete` | Existing runner and integration harness provide these gates; run the disposable harness in validation.                                           |
| Legacy 016/017 deploy path | Existing script/workflow remains unchanged and is not reused for 020                                        | **Pass:** the checker enforces byte equality with the protected base.                                                                            |

The migration manifest's `020` entry must remain fixed to the checksum and size above. The artifact gate expects exactly IDs `001` through `020`; an extra, missing, reordered, or mutated migration fails.

| ID  | File                                         | SHA-256                                                            |
| --- | -------------------------------------------- | ------------------------------------------------------------------ |
| 001 | `001_extensions_and_core.sql`                | `22f56f15610d16a5c7412775496df5a0908680f22eb76152e2482aadff154803` |
| 002 | `002_books_and_rag.sql`                      | `5485d2feb5b351cde7212153ea426b3b5b01145f33348e2cca50784425102382` |
| 003 | `003_recipes_and_inventory.sql`              | `7f94e83006bf4687c786f3fb220d695ffaf91ee66e567cfcdc0894aaf6334052` |
| 004 | `004_meal_plans.sql`                         | `898eb26cb1d8d1d903324808ffbad1c713ffe5de28b6c368b43469853aec840f` |
| 005 | `005_premium_and_shopping.sql`               | `812f93d1c5460539143d8d9c014260cc67d2859d28baf4c68a0566f12a291d11` |
| 006 | `006_culinary_profiles.sql`                  | `b8df80adc040c68d56b17ab059f27f15fb81cc66d286165114621a49171f6b25` |
| 007 | `007_functions.sql`                          | `b1ae050e48c4563503f0a1cb468857461dce8d06068787d9de00d8022c9191a8` |
| 008 | `008_indexes.sql`                            | `85a29801fab66ce9ab3a03c9e776e39d1094b18182daee19ce94e39437f8a1f0` |
| 009 | `009_seed_culinary_base.sql`                 | `b69cea987c70e7507980073b98d67b2bf59a6e185cf33a6f06f5112d58fd1d19` |
| 010 | `010_password_reset_tokens.sql`              | `825a350895af1fabc8680bd3c400031007c9214f660d575f78804fa357e09053` |
| 011 | `011_canonical_email_invariant.sql`          | `5117deadee2d72b8e8b5a7bc27559223c2fe4a3a71238787451c075a9bb6c9e0` |
| 012 | `012_meal_plan_consumption.sql`              | `163cac4f23aa6376d65c38c9e0132482d689a4a1faec74ce5858b665241160b9` |
| 013 | `013_culinary_profile_context.sql`           | `0c6d6e8dc67d2e0b0ebb8128562db1ec8b81a44f82c5e0601c38ba5fb608dfe5` |
| 014 | `014_culinary_profile_field_constraints.sql` | `c7989e3250c4a066e266d4f0eed7271200c1ee8e09026266ea7c450956163df4` |
| 015 | `015_shopping_inventory_transfer.sql`        | `17f47c1faefb63d7bfeba95b3e503a2d5375a716a045b480779a603891026370` |
| 016 | `016_persistent_user_recipes.sql`            | `a5f28c75ceaa793213809d05dcbb11c888f553eeb4dc9d7eb988ec9e567890fd` |
| 017 | `017_persistent_recipe_archive.sql`          | `525e84bde0c63d1f2afc65a0bab7c55bec8d07fafa48732b7eb8ac7019012a87` |
| 018 | `018_cooking_sessions.sql`                   | `42236a98bc3e7f5fd87da40e650a9f0b0591390bec0f9bd6cdaa6fd8f66546eb` |
| 019 | `019_real_consumption_reconciliation.sql`    | `cb7ecf08c252f5cbfa5e30d00351a1063e0ddb65e17b6f238281c293cbd3d373` |

## Compatible application release

The application release must be built from the same reviewed SHA and configured only through the secret manager/process environment. Expected identities and flags after database activation are:

| Capability              | Configuration contract                                                                                                                                                                                            |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tenant-scoped runtime   | `DATABASE_URL` identifies `cocinacore_runtime_rls`; application calls set tenant/user context transactionally.                                                                                                    |
| Authentication          | `COCINACORE_SEPARATE_AUTH_DB=true`, distinct `AUTH_DATABASE_URL` identifying `cocinacore_auth`. Missing, invalid, or identical configuration fails closed; it does not fall back to the data pool.                |
| Signup after activation | `COCINACORE_SIGNUP_BOOTSTRAP_ENABLED=true`; requires the separate auth identity and the fixed SQL signup capability.                                                                                              |
| Signup maintenance      | `COCINACORE_SIGNUP_MAINTENANCE=true` before the maintenance window and throughout migration, activation, and acceptance. Signup returns generic HTTP 503 before writes; unset or exact `false` disables the gate. |
| Owner metrics           | `COCINACORE_OWNER_METRICS_DB_ENABLED=true` and separate `OWNER_METRICS_DATABASE_URL` for `cocinacore_owner_metrics`. Called only after server-side session and platform-owner checks.                             |
| Global writer           | `COCINACORE_OWNER_GLOBAL_WRITER_ENABLED=true` and separate `OWNER_GLOBAL_WRITER_DATABASE_URL` for `cocinacore_global_writer`. Calls remain behind server-side owner authorization.                                |
| Sessions/password reset | Session lookup, refresh, revocation, login, and reset use auth SQL; existing contracts are exercised by the HTTP and PostgreSQL tests.                                                                            |
| RAG                     | Runtime queries remain tenant-scoped and the document/RAG disposable suite verifies cross-tenant denial.                                                                                                          |

Do not expose any URL, password, token, backup material, or approval credential in Git, a container image, build artifact, command history, test log, or CI output. The production migration-activation identity must not be put in the app or GitHub Actions. The E2E job's PostgreSQL administrator is confined to its disposable service and the one R4 setup process. No 020-specific production workflow is created here: the safe secret-injection path for production provisioner, migration, activation, and backup identities is not yet reviewed.

The signup maintenance integration test proves that the candidate can return 503 with no writes while an existing account can log in. This is local PostgreSQL/HTTP evidence only; it does not prove production traffic, process-manager reload, mail delivery, or secret-manager behavior.

## 020E-C1.1 disposable CI sequence

The E2E job exercises the canonical candidate only against its PostgreSQL 16 GitHub Actions service. Its order is fixed: provision migration identities; apply and verify the exact 001–019 boundary; provision runtime/auth logins; run A1-P with generated disposable passwords; attest all seven prepared objects and execute the inert-capability guard; apply 020 as `migration_admin`; verify activation is pending and that `--verify-complete` rejects that state; run R4 with the service-only PostgreSQL administrator; require `--verify-complete`; then run Playwright. Migration bytes and hashes are unchanged.

Migration/admin passwords are generated inside one provisioning-and-E2E step and are not written to job outputs, `GITHUB_ENV`, artifacts, or app variables. The R4 URL is supplied only to its activation process. Playwright fixtures may use `E2E_DATABASE_URL` for disposable setup/assertions; the Next.js server instead receives `cocinacore_runtime_rls` as `DATABASE_URL`, `cocinacore_auth` for auth SQL, and separate owner capability URLs. The server environment explicitly scrubs fixture-admin, bootstrap, migration, and activation variables. Global setup verifies the connected app role is not superuser/BYPASSRLS, signs up and logs in through HTTP, completes onboarding through the authenticated profile route, then uses the fixture connection only to mark that newly created user as a platform owner. It does not directly seed `users`, `tenants`, or memberships.

The isolated `.next-e2e-<execution-id>` output and pending-verification temp file have exit-trap cleanup; PostgreSQL and Redis are GitHub service containers and are destroyed with the job. The optional connected Today journey remains gated by manual dispatch, the existing exact branch, and the explicit boolean input. Local disposable evidence is required before treating any CI result as a readiness signal.

**C1.1 local rehearsal result (2026-11-06, with `CI=true`):** the extracted workflow step completed the PostgreSQL 16 disposable sequence through 019 verification, A1-P preparation/attestation, canonical 020, activation-pending verification, R4 activation, and `--verify-complete`. Global setup also verified signup, profile onboarding, login, and the restricted runtime PostgreSQL identity over real HTTP/SQL. The subsequent full Playwright suite did **not** pass: 17 passed, 24 failed, 2 skipped, and 6 did not run. Failures span cooking/recipe, meal-plan/shopping, and owner UI journeys, including fixture login failures; this rehearsal does not establish their root cause or claim end-to-end readiness. Treat E2E/build-test GO as **NO-GO** until the failures are resolved and the exact workflow step passes. Both disposable containers were removed and the isolated `.next-e2e` output was cleaned.

## 020E-C1.2 E2E diagnosis and correction

**Root cause:** the Playwright standalone-server command copied Next.js static assets to `<distDir>/standalone/.next/static`. With the execution-scoped custom `distDir` (`.next-e2e-<id>`), Next.js 16 emits the standalone server under `<distDir>/standalone/server.js` and expects static assets at `<distDir>/standalone/<distDir>/static`. The mismatch returned 404 for CSS/JavaScript chunks (served as `text/plain`), so browser pages did not hydrate and interactive locators were absent. The same failing run showed HTTP 429 from `/api/auth/login` after repeated fixture logins; trace evidence places these after test/worker retries in the broken-asset run. The login limiter was not changed. No PostgreSQL SQLSTATE/permission error was observed for these 24 failures.

The standalone command now validates the generated dist-directory name and copies static assets into the matching custom standalone path; `public` remains copied to the standalone root. A manual standalone-server check returned HTTP 200 for a JavaScript asset. The workflow contract now rejects a regression to `standalone/.next/static`. The focused formerly failing group passed 20/20, then the full extracted CI step ran with `CI=true`, PostgreSQL 16 and Redis disposable services: **49 tests executed, 47 passed, 2 skipped, 0 failed, 0 not run**. The previously observed login 429s disappeared without changing authentication, rate limits, grants, RLS, or migration 020.

The table records every test that failed in the C1.1 run. `UI-404` is the direct missing-hydration failure; `AUTH-429` is the observed fixture-login limiter response during the same retrying run. All 24 were included in the successful C1.2 full rerun.

| Original failing test                                                                                                                                                                         | C1.1 failure classification                                                             | C1.2 verification                     |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | ------------------------------------- |
| `shopping-list-full-connected.spec.ts` — Connected full Meal Planner to Shopping List journey — confirms, purchases, reloads, and rehydrates one planner shortage without mutating inventory  | `AUTH-429` — fixture login returned HTTP 429 after retry/setup churn; no database error | PASS — included in full 49-test rerun |
| `meta1-family-week-connected.spec.ts` — META 1 full family week — completes a seven-day household loop from shortage to purchase, stock intake, cooking, and exact final inventory            | `UI-404` — menu heading absent because client assets did not load                       | PASS — included in full 49-test rerun |
| `recipe.spec.ts` — Recipe Generation — user can generate a recipe with stubbed AI                                                                                                             | `AUTH-429` — fixture login returned HTTP 429 after retry/setup churn; no database error | PASS — included in full 49-test rerun |
| `shopping-list-ui-connected.spec.ts` — Connected Shopping List UI + PostgreSQL — persists seeded provenance, creates and toggles rows, reloads, and deliberately deletes only the created row | `AUTH-429` — fixture login returned HTTP 429 after retry/setup churn; no database error | PASS — included in full 49-test rerun |
| `meal-planner.spec.ts` — Meal Planner — meal planner page loads for authenticated user                                                                                                        | `AUTH-429` — fixture login returned HTTP 429 after retry/setup churn; no database error | PASS — included in full 49-test rerun |
| `shopping-list-ui.spec.ts` — Shopping List UI — guides the user when both sections are empty                                                                                                  | `AUTH-429` — fixture login returned HTTP 429 after retry/setup churn; no database error | PASS — included in full 49-test rerun |
| `shopping-list-ui.spec.ts` — Shopping List UI — loads sections, counts, quantities, status, and private provenance labels                                                                     | `AUTH-429` — fixture login returned HTTP 429 after retry/setup churn; no database error | PASS — included in full 49-test rerun |
| `meal-consumption-connected.spec.ts` — Connected cooked meal consumption — confirms one cooked meal, decrements inventory once, persists evidence, and replays idempotently                   | `UI-404` — menu heading absent because client assets did not load                       | PASS — included in full 49-test rerun |
| `recipe-persistent-connected.spec.ts` — Connected persistent recipe lifecycle — creates, edits, versions, restores, archives, searches, and unarchives a recipe                               | `AUTH-429` — fixture login returned HTTP 429 after retry/setup churn; no database error | PASS — included in full 49-test rerun |
| `owner-health.spec.ts` — Owner System Health — owner can access system health dashboard                                                                                                       | `AUTH-429` — owner fixture login returned HTTP 429; no database error                   | PASS — included in full 49-test rerun |
| `meal-planner.spec.ts` — Meal Planner — shows an adaptive proposal before confirmation and only confirms after an explicit click                                                              | `AUTH-429` — fixture login returned HTTP 429 after retry/setup churn; no database error | PASS — included in full 49-test rerun |
| `pdfjs-upload-compat.spec.ts` — Owner global PDF upload PDF.js compatibility — extracts and uploads PDF text with the matching PDF.js worker                                                  | `AUTH-429` — owner fixture login returned HTTP 429; no database error                   | PASS — included in full 49-test rerun |
| `shopping-list-ui.spec.ts` — Shopping List UI — keeps long ingredient names visible beside wrapped actions                                                                                    | `AUTH-429` — fixture login returned HTTP 429 after retry/setup churn; no database error | PASS — included in full 49-test rerun |
| `meal-planner.spec.ts` — Meal Planner — user can generate a meal plan with stubbed AI                                                                                                         | `AUTH-429` — fixture login returned HTTP 429 after retry/setup churn; no database error | PASS — included in full 49-test rerun |
| `meal-planner-connected.spec.ts` — Connected meal planner — preserves edits made before rehydration, then persists and reloads the authenticated meal plan                                    | `AUTH-429` — fixture login returned HTTP 429 after retry/setup churn; no database error | PASS — included in full 49-test rerun |
| `shopping-list-ui.spec.ts` — Shopping List UI — creates with the exact manual payload, toggles only status, and confirms exact-row deletion                                                   | `AUTH-429` — fixture login returned HTTP 429 after retry/setup churn; no database error | PASS — included in full 49-test rerun |
| `meal-plan-shopping-connected.spec.ts` — Connected Meal Planner shopping confirmation — shows persisted shortages and writes only explicit selection, then reloads idempotently               | `UI-404` — menu heading absent because client assets did not load                       | PASS — included in full 49-test rerun |
| `owner-health.spec.ts` — Owner System Health — system page shows status information                                                                                                           | `AUTH-429` — owner fixture login returned HTTP 429; no database error                   | PASS — included in full 49-test rerun |
| `cooking-session-u3-connected.spec.ts` — M5 U3 cooking sessions — runs the guided flow, reloads from PostgreSQL, and never mutates business data                                              | `UI-404` — recipe list item absent because client assets did not load                   | PASS — included in full 49-test rerun |
| `recipe-connected.spec.ts` — Connected recipe search — uses authenticated persisted context, authorized RAG sources, history, and cache                                                       | `AUTH-429` — fixture login returned HTTP 429 after retry/setup churn; no database error | PASS — included in full 49-test rerun |
| `shopping-list-connected.spec.ts` — Connected Shopping List API — persists, updates, and deletes an explicitly created item                                                                   | `AUTH-429` — fixture login returned HTTP 429 after retry/setup churn; no database error | PASS — included in full 49-test rerun |
| `recipe.spec.ts` — Recipe Generation — recipe page loads for authenticated user                                                                                                               | `AUTH-429` — fixture login returned HTTP 429 after retry/setup churn; no database error | PASS — included in full 49-test rerun |
| `shopping-to-inventory-consumption-connected.spec.ts` — Shopping purchase to inventory to Ya cociné — transfers only after confirmation and consumes transferred stock once                   | `UI-404` — shopping row action absent because client assets did not load                | PASS — included in full 49-test rerun |
| `shopping-list-ui.spec.ts` — Shopping List UI — retains state and announces controlled errors when create, status update, and delete fail                                                     | `AUTH-429` — fixture login returned HTTP 429 after retry/setup churn; no database error | PASS — included in full 49-test rerun |

**C1.2 local result (Node 22.22.3, `CI=true`):** the exact extracted workflow sequence again passed 019 verification, A1-P preparation/attestation, canonical 020 application, activation-pending verification, R4, `--verify-complete`, HTTP signup/profile onboarding/login, and the restricted-runtime-role check before Playwright. The focused formerly failing selection passed 20/20. The full Playwright suite reported 47 passed and 2 skipped; there were zero failures and zero tests not run. The two intentional skips were `culinary-profile-connected.spec.ts` and `today-recommendations-connected.spec.ts`, both guarded by the opt-in `COCINACORE_ISOLATED_E2E=1` flag; the connected Today workflow additionally remains behind its explicit workflow-dispatch gate. This is disposable local evidence only. Migration 020 and its pinned checksum are unchanged.

**C1.2 gate:** **GO to request separate authorization for selective local Git integration**, subject to human review of the exact M6-only inventory. This is not staging or commit authorization. Deployment and signup reopening remain separate NO-GO gates.

## Selective Git integration plan (not executed)

The previous inventory recorded 204 M6 paths plus seven unrelated GGA/quality-hook paths. C1.1 adds seven M6 E2E/security-plumbing paths (`frontend/e2e/database-target.ts`, `frontend/e2e/global-setup.ts`, `frontend/playwright.config.ts`, `frontend/next.config.ts`, `frontend/src/lib/e2e-database-target.test.ts`, and the two workflow contract tests). Therefore the prior exact 204-path list is no longer a complete integration list; refresh and verify it as 211 M6 paths before requesting staging. The seven GGA paths remain excluded, including their staged deletions; do not restore, reset, or include them in M6.

After separate explicit Git authorization only: preserve the live index tree and export its staged GGA-only binary patch (including deletions) outside the repository; create a temporary index rooted at the protected base; stage from a reviewed path file containing exactly the updated 211 M6 paths (never `git add -A`); compare temporary-index name-status output to the reviewed path list and assert no GGA paths; run staged diff checks and the artifact gate against the resulting tree; then obtain review before creating a local commit. Keep the original live index untouched until the selective tree is verified. If later preserving staged GGA work across a branch/index transition is needed, reapply only the saved GGA patch to an index based on the resulting M6 commit and compare its seven paths before replacing the live index. None of these index or commit steps was performed for C1.1.

Keep four approvals independent: (1) code/build/test GO, (2) selective Git integration GO, (3) deployment GO, and (4) signup reopening GO. Passing local or CI validation does not authorize Git integration, deployment, or reopening signup.

## Required 020 operation order

This is a future operator procedure, not an executable production workflow. Every transition needs its own immutable evidence and manual owner gate:

1. Review the full release SHA, manifest, fixed 020 checksum, and M6-020 owner approval; require integration into `main` and passing CI.
2. Verify a recent custom-format database backup, a separate protected globals export, archive readability/checksum, and an independently restored PostgreSQL 16 copy with roles, memberships, owners, ACLs, ledger, schema, policy, and data comparison. A scheduled backup check alone is insufficient.
3. Close signup using the compatible app release. Verify actual HTTP 503/no cookie/no writes and existing-user login; keep maintenance enabled through all following steps.
4. Verify the exact 019 boundary and that only `020_tenant_rls_hardening.sql` is pending using the official restricted runner (`--verify-boundary 019`, then dry-run with the exact pending filename).
5. Run `scripts/provision-020-inert-capabilities.sql` once transactionally with the reviewed provisioner identity. Do **not** run `scripts/provision-auth-role.sql` between inert preparation and 020; it rejects the partial signup-role state. Legacy signup is available at boundary 019 before A1-P, not after preparation.
6. Apply only migration 020 using `MIGRATION_DATABASE_URL` for `migration_admin` and `MIGRATION_EXPECTED_PENDING=020_tenant_rls_hardening.sql`. The official runner must commit the canonical migration and leave activation pending.
7. Verify the exact activation-pending state. Do not grant capabilities manually and do not switch to an older app release.
8. Run the reviewed R4 activator with a separate administrative identity through `COCINACORE_ACTIVATION_DATABASE_URL`. Never use runtime, auth, or migration credentials for activation.
9. Run `--verify-complete`, then SQL and HTTP acceptance for tenant isolation, login/signup/password reset, owner metrics, global writer, RAG, and the nine historical RLS tables. Keep maintenance on.
10. Reopen signup only after the compatible app flags are verified and a separate owner authorization explicitly approves the action. No migration, activation, or CI step may reopen signup automatically.

Commands must use `COCINACORE_SKIP_DOTENV=1`, the restricted database-lane flag, and the exact release artifact. Inject credentials through the approved secure operator channel without shell tracing or echo. Never stage credentials in an environment file retained by a runner.

## Abort and recovery

| Failure point                       | Safe response                                                                                                                                                                                                          |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Before inert preparation            | Keep 019 unchanged. If maintenance was enabled, reopen only after the previous compatible application is verified and an owner authorizes it.                                                                          |
| During A1-P                         | Its transaction must roll back all prepared roles/objects/ACLs. Preserve maintenance until the state is re-attested.                                                                                                   |
| During 020                          | Its transaction must leave the inert prepared state and no 020 ledger row. Fix only the reviewed candidate defect and rerun gates.                                                                                     |
| 020 committed, R4 pending           | Keep maintenance on. No old signup/runtime code, direct grants, or disabling FORCE RLS. R4 failure must roll back atomically.                                                                                          |
| After activation                    | Keep the compatible application and maintenance on while diagnosing. Do not use `postgres-restore.sh --clean` or an in-place reverse migration.                                                                        |
| Application smoke failure after 020 | **Code-only rollback is NO-GO.** The 020E-B disposable rehearsal proved old auth direct INSERT fails after 020. Continue forward with compatible code or use the separately approved independent-restore/cutover plan. |

The existing `.github/workflows/deploy.yml` is manual but can invoke an application rollback on public smoke failure. It is not migration-aware. It must not be used for a 020 deployment until a reviewed control prevents legacy-code rollback after the irreversible schema transition and defines a compatible recovery path. The existing `scripts/migrate-pawtech-production.sh` and `.github/workflows/migrate-production.yml` remain pinned to historical 016/017 and the U5 receipt; they are not a 020 executor.

## External boundaries and residual risks

- **Premium via Supabase REST:** `PremiumBoardService` is an exported service abstraction with no application call sites found in this repository; current source therefore appears dormant. External Supabase credentials, deployed code, and project policies were not inspected and must not be assumed disabled or safe.
- **Tenant invitations:** member pages and tests cover tenant-scoped summary reads. Invitation creation and acceptance are outside this release authorization; do not infer a supported secure end-to-end flow.
- **Signup continuity:** signup is intentionally unavailable during the maintenance interval. Login for existing users was proven in the disposable HTTP rehearsal; production availability and session-secrets continuity remain deployment gates.
- **Rollback:** old application code after 020 is incompatible. Recovery requires a compatible release or a separately approved isolated restore and traffic cutover, not a code-only rollback.
- **External providers:** Resend, Redis, object storage, Gemini, Supabase REST, process management, live load, and production secret injection were not validated here.

## Verification and current decision

Validation was run locally with Node 22.22.3 where Node tooling was involved. Results are recorded below; no production URL, Contabo, Supabase, or persistent database was contacted.

| Check                                                             | Result                                                                                                                                                                                                      |
| ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Fixed migration 020 SHA-256 and 130,680-byte size                 | PASS — exact pinned bytes                                                                                                                                                                                   |
| M6 artifact gate and negative fixture suite                       | PASS — canonical candidate accepted; manifest/migration/workflow/approval/ref/integration drift cases rejected                                                                                              |
| PostgreSQL 16 disposable integration                              | PASS — restricted runner, canonical 020, activation/attestation, signup maintenance HTTP, login/session/password-reset, owner metrics, global writer, RAG, and RLS regressions; container cleanup verified  |
| PostgreSQL-backed HTTP/RLS Vitest groups                          | PASS — application group 17 files / 82 passed / 10 skipped; owner metrics 4 passed; global writer 4 passed; additional targeted group 5 passed                                                              |
| Focused local Vitest                                              | PASS — 9 files / 82 tests                                                                                                                                                                                   |
| C1.2 focused Playwright regression selection                      | PASS — 20 passed with `CI=true`, Node 22.22.3, and disposable PostgreSQL 16/Redis; corrected asset delivery produced no login 429s                                                                          |
| C1.2 full CI-equivalent PostgreSQL 16 + Redis + Playwright        | PASS — exact local workflow sequence reached active 020 and `--verify-complete`; signup/profile/login and restricted runtime role verified; 49 tests, 47 passed, 2 intentional skipped, 0 failed, 0 not run |
| CI E2E workflow contract                                          | PASS — asserts the custom standalone `distDir` static-asset destination and rejects the former `.next/static` destination                                                                                   |
| TypeScript                                                        | PASS — `npx tsc --noEmit`                                                                                                                                                                                   |
| ESLint                                                            | PASS — zero errors; one pre-existing warning in `src/next.config.test.ts` (`_options` unused)                                                                                                               |
| Frontend production build                                         | PASS — isolated temporary source copy; 64 static pages; repository `.next` preserved                                                                                                                        |
| Migration/release shell contracts                                 | PASS — bootstrap config, migration baseline, step 4, step 5, and production deploy contracts                                                                                                                |
| Prettier, shell syntax, YAML parsing, staged/unstaged diff checks | PASS — C1.1 checks are recorded above; C1.2 reran the targeted contract, formatting, syntax, YAML and diff checks on Node 22.22.3 (see final C1.2 evidence)                                                 |
| GitHub Actions `actionlint` / remote CI                           | NOT RUN — actionlint is absent; the repository wrapper downloads a binary, and no remote file transfer or CI/PR operation was authorized                                                                    |

The PostgreSQL results are disposable-test evidence, not production evidence. No RLS, credential, restore, process-manager, or external-provider claim is inferred beyond those tests.

**Current release decision:** NO-GO for production. C1.2 is **GO to request explicit authorization for selective Git integration** after review of the exact M6-only inventory. Staging, commit, PR, merge, deployment, and reopening signup remain unperformed and require their own authorization; the E2E result does not grant any of them.

## Exact current path inventory

The following appendix is generated from the worktree's current index, worktree, and untracked paths. It identifies status by Git's two status columns (`X` staged, `Y` unstaged; `??` untracked) and classifies each path. Rebuild it after any further file change; do not treat these counts as a clean or integrated release.

**Exact worktree inventory at C1.2 validation close:** 218 changed paths are present using `git status --short --untracked-files=all`: 102 staged paths, 97 unstaged paths, and 66 untracked paths (staged/unstaged counts overlap for partially staged paths). The M6 subset contains 211 paths; the seven unrelated GGA/quality-hook paths remain excluded. C1.2 modified only already-listed M6 paths; no route was added. Protected HEAD and index trees remain unchanged.

| Category                                              | Paths |
| ----------------------------------------------------- | ----: |
| CI and release-candidate gate                         |     1 |
| Canonical migration and manifest                      |     2 |
| Documentation and operational runbooks                |     8 |
| Tests and disposable harnesses                        |    94 |
| Provisioning, activation, and migration tooling       |    11 |
| Application/runtime M6 code                           |    78 |
| Provisioning, activation, and reviewed SQL candidates |    16 |
| Migration and operational tooling                     |     1 |

The following tables are the exact M6 release inventory. Status uses Git porcelain columns (`X` staged, `Y` unstaged; `??` untracked); `MM` means staged and then modified again. Paths are not staged or otherwise changed by this inventory.

### CI and release-candidate gate

| Status | Path                       |
| ------ | -------------------------- |
| ` M`   | `.github/workflows/ci.yml` |

### C1.1 E2E security and workflow contract delta

| Status | Path                                                       |
| ------ | ---------------------------------------------------------- |
| ` M`   | `frontend/e2e/database-target.ts`                          |
| ` M`   | `frontend/e2e/global-setup.ts`                             |
| ` M`   | `frontend/next.config.ts`                                  |
| ` M`   | `frontend/playwright.config.ts`                            |
| ` M`   | `frontend/src/lib/e2e-database-target.test.ts`             |
| ` M`   | `scripts/tests/test-ci-e2e-runner-contract.sh`             |
| ` M`   | `scripts/tests/test-hosted-today-e2e-workflow-contract.sh` |

### Canonical migration and manifest

| Status | Path                                         |
| ------ | -------------------------------------------- |
| `??`   | `db/migrations/020_tenant_rls_hardening.sql` |
| ` M`   | `db/migrations/manifest.json`                |

### Documentation and operational runbooks

| Status | Path                                                              |
| ------ | ----------------------------------------------------------------- |
| `A `   | `docs/ops/postgresql-runtime-rls.md`                              |
| `??`   | `docs/ops/rls-020-gate-draft.md`                                  |
| `??`   | `docs/ops/rls-020d5-residual-permissions.md`                      |
| `??`   | `docs/ops/rls-020e-a-runner-gate.md`                              |
| `??`   | `docs/ops/rls-020e-b-recovery-runbook.md`                         |
| `??`   | `docs/ops/rls-020e-c-release-readiness.md`                        |
| `A `   | `docs/roadmap/m6-u0-intelligent-cooking-teacher-specification.md` |
| `A `   | `docs/roadmap/m6-u6-local-acceptance-checklist.md`                |

### Tests and disposable harnesses

| Status | Path                                                                              |
| ------ | --------------------------------------------------------------------------------- |
| `A `   | `frontend/e2e/specs/cooking-teacher-connected.spec.ts`                            |
| `??`   | `frontend/src/app/api/auth/login/route.test.ts`                                   |
| `MM`   | `frontend/src/app/api/auth/password-reset/request/route.test.ts`                  |
| `MM`   | `frontend/src/app/api/auth/password-reset/update/route.test.ts`                   |
| `MM`   | `frontend/src/app/api/auth/signup/route.test.ts`                                  |
| `A `   | `frontend/src/app/api/auth/signup/signup-atomicity.integration.test.ts`           |
| `??`   | `frontend/src/app/api/auth/signup/signup-bootstrap-http.integration.test.ts`      |
| `AM`   | `frontend/src/app/api/auth/signup/signup-real-schema.integration.test.ts`         |
| ` M`   | `frontend/src/app/api/cooking-intent-preview/route.test.ts`                       |
| `AM`   | `frontend/src/app/api/cooking-sessions/[id]/teacher/route.test.ts`                |
| `??`   | `frontend/src/app/api/dashboard/route.test.ts`                                    |
| `A `   | `frontend/src/app/api/embeddings/route.test.ts`                                   |
| ` M`   | `frontend/src/app/api/inventory/route.test.ts`                                    |
| `??`   | `frontend/src/app/api/library/pdfs/[id]/route.test.ts`                            |
| ` M`   | `frontend/src/app/api/meal-plan/adaptive-proposal/route.test.ts`                  |
| ` M`   | `frontend/src/app/api/meal-plan/coverage/route.test.ts`                           |
| `A `   | `frontend/src/app/api/meal-plan/inventory-suggestion/route.test.ts`               |
| `MM`   | `frontend/src/app/api/meal-plan/route.test.ts`                                    |
| ` M`   | `frontend/src/app/api/meal-plan/shopping-suggestions/route.test.ts`               |
| `A `   | `frontend/src/app/api/meal-plan/warmup/route.test.ts`                             |
| `??`   | `frontend/src/app/api/owner/global-pdfs/route.test.ts`                            |
| `MM`   | `frontend/src/app/api/profile/route.test.ts`                                      |
| `MM`   | `frontend/src/app/api/recipe-generate/route.test.ts`                              |
| ` M`   | `frontend/src/app/api/recipe-history/route.test.ts`                               |
| ` M`   | `frontend/src/app/api/shopping-list/[id]/inventory/route.test.ts`                 |
| ` M`   | `frontend/src/app/api/shopping-list/[id]/route.test.ts`                           |
| ` M`   | `frontend/src/app/api/shopping-list/route.test.ts`                                |
| `MM`   | `frontend/src/app/api/today/route.test.ts`                                        |
| ` M`   | `frontend/src/app/api/waste-prevention/route.test.ts`                             |
| `??`   | `frontend/src/app/billing/page.test.tsx`                                          |
| `??`   | `frontend/src/app/library/page.test.tsx`                                          |
| `??`   | `frontend/src/app/members/page.test.tsx`                                          |
| `??`   | `frontend/src/app/owner/page.test.tsx`                                            |
| `A `   | `frontend/src/app/recipes/CookingSessionPanel.test.tsx`                           |
| `A `   | `frontend/src/app/recipes/CookingTeacherPanel.test.tsx`                           |
| `AM`   | `frontend/src/lib/auth/internal-capability.test.ts`                               |
| ` M`   | `frontend/src/lib/auth/session.test.ts`                                           |
| `A `   | `frontend/src/lib/cooking-teacher-budget.test.ts`                                 |
| `AM`   | `frontend/src/lib/cooking-teacher-context-cancellation.test.ts`                   |
| `AM`   | `frontend/src/lib/cooking-teacher-context.test.ts`                                |
| `A `   | `frontend/src/lib/cooking-teacher.test.ts`                                        |
| `??`   | `frontend/src/lib/db-auth.test.ts`                                                |
| `??`   | `frontend/src/lib/db-global-writer.test.ts`                                       |
| `MM`   | `frontend/src/lib/db.test.ts`                                                     |
| `??`   | `frontend/src/lib/db/repositories/authIdentityRepository.test.ts`                 |
| `MM`   | `frontend/src/lib/db/repositories/bookChunkRepository.test.ts`                    |
| `MM`   | `frontend/src/lib/db/repositories/culinaryProfileRepository.test.ts`              |
| `??`   | `frontend/src/lib/db/repositories/culinaryProfileRls.integration.test.ts`         |
| `??`   | `frontend/src/lib/db/repositories/documents-rag-rls.integration.test.ts`          |
| `??`   | `frontend/src/lib/db/repositories/identity-rls.integration.test.ts`               |
| `??`   | `frontend/src/lib/db/repositories/inventory-rls.integration.test.ts`              |
| ` M`   | `frontend/src/lib/db/repositories/inventoryRepository.test.ts`                    |
| `??`   | `frontend/src/lib/db/repositories/mealPlanConsumptionRepository.scoped.test.ts`   |
| ` M`   | `frontend/src/lib/db/repositories/mealPlanRepository.test.ts`                     |
| `??`   | `frontend/src/lib/db/repositories/passwordResetRepository.test.ts`                |
| `??`   | `frontend/src/lib/db/repositories/pdfRepository.test.ts`                          |
| `??`   | `frontend/src/lib/db/repositories/plans-history-shopping-rls.integration.test.ts` |
| `??`   | `frontend/src/lib/db/repositories/platformOwnerRepository.test.ts`                |
| `M `   | `frontend/src/lib/db/repositories/profile-update-atomicity.integration.test.ts`   |
| `M `   | `frontend/src/lib/db/repositories/realConsumptionRepository.test.ts`              |
| ` M`   | `frontend/src/lib/db/repositories/recipeRepository.test.ts`                       |
| `??`   | `frontend/src/lib/db/repositories/sessionRepository.test.ts`                      |
| ` M`   | `frontend/src/lib/db/repositories/shoppingListRepository.test.ts`                 |
| `??`   | `frontend/src/lib/db/repositories/shoppingListTransfer.integration.test.ts`       |
| `??`   | `frontend/src/lib/db/repositories/signup-bootstrap.integration.test.ts`           |
| `??`   | `frontend/src/lib/db/repositories/tenant-invitations-rls.integration.test.ts`     |
| ` M`   | `frontend/src/lib/db/repositories/userRepository.test.ts`                         |
| `M `   | `frontend/src/lib/db/statement-timeout.integration.test.ts`                       |
| `M `   | `frontend/src/lib/meal-planner/recipe-warmup.test.ts`                             |
| `??`   | `frontend/src/lib/owner/global-writer.integration.test.ts`                        |
| `??`   | `frontend/src/lib/owner/metrics.integration.test.ts`                              |
| `??`   | `frontend/src/lib/owner/metrics.test.ts`                                          |
| `A `   | `frontend/src/lib/queue/meal-plan-warmup.test.ts`                                 |
| `M `   | `frontend/src/lib/rate-limit.redis.test.ts`                                       |
| `M `   | `frontend/src/lib/rate-limit.test.ts`                                             |
| `MM`   | `frontend/src/lib/recipes/persisted-context.test.ts`                              |
| `MM`   | `frontend/src/lib/recipes/server-rag-context.test.ts`                             |
| `M `   | `frontend/src/lib/validation.test.ts`                                             |
| `M `   | `frontend/src/services/__tests__/apiDtos.test.ts`                                 |
| `A `   | `frontend/src/services/__tests__/gemini.test.ts`                                  |
| `??`   | `scripts/test-020e-b-recovery.sh`                                                 |
| ` M`   | `scripts/test-bootstrap-migrator-integration.sh`                                  |
| `A `   | `scripts/test-m6-http-smoke.mjs`                                                  |
| `AM`   | `scripts/test-signup-real-schema.sh`                                              |
| `??`   | `scripts/tests/020d3-document-fixtures.sql`                                       |
| `A `   | `scripts/tests/m6-http-smoke/fixtures.sql`                                        |
| `A `   | `scripts/tests/m6-http-smoke/local-network.cjs`                                   |
| `A `   | `scripts/tests/m6-http-smoke/scenarios.mjs`                                       |
| `??`   | `scripts/tests/test-020-release-candidate.sh`                                     |
| ` M`   | `scripts/tests/test-bootstrap-migrator-config.sh`                                 |
| ` M`   | `scripts/tests/test-pawtech-step4-contract.sh`                                    |

### Provisioning, activation, and migration tooling

| Status | Path                                                           |
| ------ | -------------------------------------------------------------- |
| `??`   | `frontend/scripts/activate-020-capabilities.js`                |
| `??`   | `frontend/scripts/activate-020-capabilities.test.mjs`          |
| `??`   | `frontend/scripts/activated-capabilities-attestation.js`       |
| `??`   | `frontend/scripts/activated-capabilities-attestation.sql`      |
| `??`   | `frontend/scripts/activated-capabilities-attestation.test.mjs` |
| `??`   | `frontend/scripts/prepared-capabilities-attestation.js`        |
| `??`   | `frontend/scripts/prepared-capabilities-attestation.sql`       |
| `??`   | `frontend/scripts/prepared-capabilities-attestation.test.mjs`  |
| `??`   | `frontend/scripts/prepared-capabilities-contract.js`           |
| `??`   | `frontend/scripts/prepared-capabilities-contract.test.mjs`     |
| ` M`   | `frontend/scripts/run-migrations.js`                           |

### Application/runtime M6 code

| Status | Path                                                                |
| ------ | ------------------------------------------------------------------- |
| `MM`   | `frontend/src/app/api/auth/login/route.ts`                          |
| `MM`   | `frontend/src/app/api/auth/password-reset/request/route.ts`         |
| `M `   | `frontend/src/app/api/auth/password-reset/update/route.ts`          |
| `MM`   | `frontend/src/app/api/auth/signup/route.ts`                         |
| `MM`   | `frontend/src/app/api/cooking-intent-preview/route.ts`              |
| `AM`   | `frontend/src/app/api/cooking-sessions/[id]/teacher/route.ts`       |
| `MM`   | `frontend/src/app/api/dashboard/route.ts`                           |
| `MM`   | `frontend/src/app/api/embeddings/route.ts`                          |
| ` M`   | `frontend/src/app/api/inventory/route.ts`                           |
| ` M`   | `frontend/src/app/api/library/pdfs/[id]/route.ts`                   |
| `M `   | `frontend/src/app/api/meal-plan/adaptive-proposal/confirm/route.ts` |
| `MM`   | `frontend/src/app/api/meal-plan/adaptive-proposal/route.ts`         |
| `MM`   | `frontend/src/app/api/meal-plan/coverage/route.ts`                  |
| `M `   | `frontend/src/app/api/meal-plan/inventory-suggestion/route.ts`      |
| `MM`   | `frontend/src/app/api/meal-plan/route.ts`                           |
| `M `   | `frontend/src/app/api/meal-plan/schedule/route.ts`                  |
| `MM`   | `frontend/src/app/api/meal-plan/shopping-suggestions/route.ts`      |
| `M `   | `frontend/src/app/api/meal-plan/warmup/route.ts`                    |
| ` M`   | `frontend/src/app/api/owner/global-pdfs/route.ts`                   |
| ` M`   | `frontend/src/app/api/owner/health/route.ts`                        |
| `MM`   | `frontend/src/app/api/profile/route.ts`                             |
| `MM`   | `frontend/src/app/api/recipe-generate/route.ts`                     |
| ` M`   | `frontend/src/app/api/recipe-history/route.ts`                      |
| ` M`   | `frontend/src/app/api/shopping-list/[id]/inventory/route.ts`        |
| ` M`   | `frontend/src/app/api/shopping-list/[id]/route.ts`                  |
| ` M`   | `frontend/src/app/api/shopping-list/route.ts`                       |
| `MM`   | `frontend/src/app/api/today/route.ts`                               |
| `MM`   | `frontend/src/app/api/waste-prevention/route.ts`                    |
| ` M`   | `frontend/src/app/billing/page.tsx`                                 |
| ` M`   | `frontend/src/app/library/page.tsx`                                 |
| ` M`   | `frontend/src/app/members/page.tsx`                                 |
| ` M`   | `frontend/src/app/owner/global-books/page.tsx`                      |
| ` M`   | `frontend/src/app/owner/global-pdfs/page.tsx`                       |
| ` M`   | `frontend/src/app/owner/layout.tsx`                                 |
| ` M`   | `frontend/src/app/owner/page.tsx`                                   |
| `M `   | `frontend/src/app/recipes/CookingSessionPanel.tsx`                  |
| `A `   | `frontend/src/app/recipes/CookingTeacherPanel.tsx`                  |
| `AM`   | `frontend/src/lib/auth/internal-capability.ts`                      |
| `M `   | `frontend/src/lib/auth/server.ts`                                   |
| `MM`   | `frontend/src/lib/auth/session.ts`                                  |
| `A `   | `frontend/src/lib/cooking-teacher-budget.ts`                        |
| `AM`   | `frontend/src/lib/cooking-teacher-context.ts`                       |
| `A `   | `frontend/src/lib/cooking-teacher.ts`                               |
| `MM`   | `frontend/src/lib/db.ts`                                            |
| `MM`   | `frontend/src/lib/db/repositories/bookChunkRepository.ts`           |
| `M `   | `frontend/src/lib/db/repositories/cookingSessionRepository.ts`      |
| `MM`   | `frontend/src/lib/db/repositories/culinaryProfileRepository.ts`     |
| `MM`   | `frontend/src/lib/db/repositories/inventoryRepository.ts`           |
| ` M`   | `frontend/src/lib/db/repositories/mealPlanConsumptionRepository.ts` |
| ` M`   | `frontend/src/lib/db/repositories/mealPlanRepository.ts`            |
| ` M`   | `frontend/src/lib/db/repositories/passwordResetRepository.ts`       |
| ` M`   | `frontend/src/lib/db/repositories/pdfRepository.ts`                 |
| ` M`   | `frontend/src/lib/db/repositories/platformOwnerRepository.ts`       |
| `M `   | `frontend/src/lib/db/repositories/realConsumptionRepository.ts`     |
| `MM`   | `frontend/src/lib/db/repositories/recipeRepository.ts`              |
| `MM`   | `frontend/src/lib/db/repositories/sessionRepository.ts`             |
| ` M`   | `frontend/src/lib/db/repositories/shoppingListRepository.ts`        |
| `??`   | `frontend/src/lib/db/repositories/signupBootstrapRepository.ts`     |
| `MM`   | `frontend/src/lib/db/repositories/tenantRepository.ts`              |
| `MM`   | `frontend/src/lib/db/repositories/userRepository.ts`                |
| `M `   | `frontend/src/lib/meal-planner/recipe-warmup.ts`                    |
| `??`   | `frontend/src/lib/owner/global-writer.ts`                           |
| `??`   | `frontend/src/lib/owner/metrics.ts`                                 |
| `M `   | `frontend/src/lib/queue/meal-plan-warmup.ts`                        |
| `A `   | `frontend/src/lib/rate-limit-identity.ts`                           |
| `M `   | `frontend/src/lib/rate-limit.ts`                                    |
| `MM`   | `frontend/src/lib/recipes/persisted-context.ts`                     |
| `MM`   | `frontend/src/lib/recipes/server-rag-context.ts`                    |
| `A `   | `frontend/src/lib/safe-error-reason.ts`                             |
| `M `   | `frontend/src/lib/validation.ts`                                    |
| `M `   | `frontend/src/services/apiDtos.ts`                                  |
| `M `   | `frontend/src/services/gemini.ts`                                   |
| `M `   | `frontend/src/services/ragEngine.ts`                                |
| `M `   | `frontend/src/services/types.ts`                                    |

### Provisioning, activation, and reviewed SQL candidates

| Status | Path                                                        |
| ------ | ----------------------------------------------------------- |
| `??`   | `scripts/provision-020-inert-capabilities.sql`              |
| `??`   | `scripts/provision-auth-role.sql`                           |
| `??`   | `scripts/provision-global-writer-role.sql`                  |
| `??`   | `scripts/provision-owner-metrics-role.sql`                  |
| `AM`   | `scripts/provision-runtime-role.sql`                        |
| `??`   | `scripts/provision-signup-bootstrap-roles.sql`              |
| `??`   | `scripts/rls-candidates/020b-inventory.sql`                 |
| `??`   | `scripts/rls-candidates/020c-identity.sql`                  |
| `??`   | `scripts/rls-candidates/020c1-signup.sql`                   |
| `??`   | `scripts/rls-candidates/020d1-plans-history-shopping.sql`   |
| `??`   | `scripts/rls-candidates/020d2-culinary-profiles.sql`        |
| `??`   | `scripts/rls-candidates/020d3-documents-rag.sql`            |
| `??`   | `scripts/rls-candidates/020d4a-owner-metrics.sql`           |
| `??`   | `scripts/rls-candidates/020d4b-global-writer.sql`           |
| `??`   | `scripts/rls-candidates/020d5-residual-permissions.sql`     |
| `??`   | `scripts/rls-candidates/020e-a1-inert-capability-guard.sql` |

### Migration and operational tooling

| Status | Path                                      |
| ------ | ----------------------------------------- |
| `??`   | `scripts/check-020-release-candidate.mjs` |
