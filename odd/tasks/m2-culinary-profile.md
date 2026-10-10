# M2.1 — Real household culinary profile

## Status
M2.1 local gates and connected E2E are reported passed; M2.1 is complete for the purpose of starting M2.2. The identified allergy-safety blocker task is COMPLETE, and the latest independent allergy review found no blockers. Reported pre-E2E gates: full coverage 54 files / 475 tests (81.64% statements, 75.56% branches, 86.03% functions, 83.82% lines), full lint exit 0, `tsc --noEmit` exit 0, non-connected harness contract/lifecycle/redaction suites, contained production build, and migration static plus legacy/fresh 001–013 verify/no-op/cleanup. These are recorded as reported results, not rerun in this documentation update. Overall task tracker: [`m2-total.md`](./m2-total.md).

## Starting point
- Base/branch commit: `86bd606006e739fe30e15f1f5e44fbec9204ac4d`.
- Branch: `feat/m2-culinary-profile`.
- Intentionally uncommitted M2.1 work preserved: profile API, onboarding, Profile UI, profile repository, API test, and culinary-profile contract paths listed in the master ODD record. Initial tracked diff: 711 additions / 161 deletions; no staged changes.
- User-supplied PM baseline independently repeated before source edits: 2 focused test files / 10 tests PASS; direct `tsc --noEmit`, `npm run lint -- --max-warnings=0`, and `git diff --check` PASS. Vite emitted a config-loader warning. No coverage/build/E2E ran.
- Node `v22.22.3`; local Vitest, tsc, and Playwright binaries exist.

## Objective
Persist a minimal, privacy-conscious household culinary context using existing profile and taxonomy models. Make onboarding and `/profile` real persisted experiences; feed the exact authenticated profile into Recipe AI and Meal Planner without exposing household names or user/tenant identity. Add migration 013 without changing production migration behavior.

## Scope
- Current taxonomy dimensions/semantics: cuisine, dietary, technique, ingredient_type, goal; preserve canonical active-term validation and existing preference types.
- Required profile: full name, level, favorite cuisines, restrictions, techniques, ingredient types, goals, normalized dislikes, specific allergies/restrictions, habitual time (5–240 minutes), up to 12 minimal household members (`name`, `adult|teen|child`), persisted profile reads/writes, onboarding, UI, AI context and recipe-safety integration.
- Migration `db/migrations/013_culinary_profile_context.sql`, exact manifest hash/byte length/contract, types, and release-gate documentation/tests.
- Migration release remains a separately authorized future operation. Production deploy stays verify-only; production is never accessed.

## Explicit privacy and consistency decisions
- Store household names for UI/persistence only. Provider receives aggregate age-group counts, never names.
- No medical, diagnosis, medication, weight, calorie, or biometric fields.
- Profile scalar fields and selection replacement must share the existing profile transaction. Full-name/onboarding table updates are separate unless the repository can safely put them in that same transaction; otherwise specify and test truthful partial-failure behavior without claiming cross-table atomicity.
- Omitted fields/selections preserve persisted state; explicit empty lists clear only their own list; supplied selections replace atomically.
- Keep server-derived user/tenant identity and canonical taxonomy authority; reject unknown/inactive/wrong-dimension terms and malformed/over-limit JSON.

## RED / GREEN evidence
Initial RED evidence: focused Vitest exited 1 with 13 expected M2.1 failures and 36 passes across five files. The migration matcher fixtures passed, and the contract then exited at the expected missing migration-013 manifest entry; `git diff --check` passed. Independent audit confirmed the privacy assertion passes household names through the real persisted-context builder, and repository-level tests distinguish omitted selection terms from explicit empty terms. It also noted that free-text state preservation still requires real DB integration and broad migration regexes need positive/negative scrutiny. Core API/repository/migration implementation has begun; context/UI/recipe-safety and local release/test harness remain. Focused RED tests for A–J now exist across API, repository, persisted-context, recipe-safety, and migration-contract seams. Record any later changes and run the exact focused cases after each GREEN increment; do not fake a failure or break unrelated behavior.

## Implementation and acceptance evidence
Core API/repository/migration naming alignment now uses preferred `available_time_minutes` and `disliked_ingredients`; no prior schema convention justified alternatives. Focused profile/repository/API-meal-plan/profile-context tests PASS 46/46, and `git diff --check` PASS. Migration 013 is 548 bytes, SHA256 `0c6d6e8dc67d2e0b0ebb8128562db1ec8b81a44f82c5e0601c38ba5fb608dfe5`; manifest was updated. Four type-error test fixtures received neutral profile values. The first shared-context RED was the household/time/allergy/dislike aggregate assertion; the formatter then made the combined profile-context/persisted-context/recipe-generate suite GREEN at 29/29. Typecheck after row-fixture updates PASS (`tsc --noEmit`, exit 0). The migration contract initially exposed brittle line-wrap/case matching against the unchanged M1 runbook; after normalizing whitespace/case, the static migration contract PASS and `git diff --check` PASS. Production runbook remains unchanged. Read-only mapping confirmed Recipe and Meal Planner share `frontend/src/lib/meal-planner/profile-context.ts`. Shared formatter now adds bounded time/allergy/dislike fields and household counts only; both contexts omit household names. Recipe RAG treats persisted allergies plus taxonomy avoidance as hard restrictions, never dislikes. First generated-output check scanned prose by substring; strict TDD refined it to parsed ingredient names with diacritic-insensitive token/phrase matching and fail-closed behavior when allergies exist but no usable ingredient list parses. Focused route tests PASS 22/22; `git diff --check` PASS. Profile page now loads, edits, and submits all four detailed fields with labeled controls while preserving existing design and the short onboarding flow. Pure form adapter test PASS 4/4; profile API route test PASS 18/18. Post-UI direct typecheck PASS; the combined focused regression passed 7 files / 78 tests; migration contract and diff-check PASS (Vite config-loader warning only). Harness mapping found no React Testing Library or jsdom, and Playwright auth uses real login/signup; defer connected E2E until isolated local DB is proven. Exercise actual persisted UI/context in connected profile E2E. Keep code/tests/docs together in the M2.1 local work-unit commit. Must prove:
- authenticated GET/PUT returns canonical profile/taxonomy/selection data, only active taxonomy terms, and masks foreign user/tenant profile;
- profile/term mutation atomicity, exact validation bounds, field preservation/clearing and user-account failure semantics;
- migration constraints, exact computed checksum/byte length, manifest ledger semantics, fresh and legacy local DB chain, `db:migrate:verify` pending-before/complete-after, and safe rerun behavior;
- onboarding and Profile UI save/reload work with keyboard-accessible, household-friendly controls;
- Recipe AI and Meal Planner receive level, time, avoids, disliked/allergy text, and aggregate household counts; never names, IDs, email, tenant metadata, or secrets;
- allergies/restrictions are hard constraints in prompt and output validation; dislikes remain preference only;
- deterministic local provider fixture, connected profile E2E, zero synthetic DB-row residue.

## Migration 013 future production release contract
Not run in production and not authorized to run there. The runbook/test must require a pre-backup before any migration, exact target SHA, exact expected pending set, only individually authorized migrations, pre/post ledger+checksum verification, existing migration lock/transaction behavior, post-run verify, failure rollback before commit, no automatic restore, and separate authorization. Do not alter M1 verify-only deployment.

## Latest runtime authorization

The fresh Bash-3-compatible run exited 1 because Docker inspect `.Mounts` was empty; migrations did not run. Container `b33388eca6382d5905a163ac7ee14bf31496654b70621b4e0f868503bfc7e1c0` and temporary workspace were removed and verified absent. User authorized bounded diagnosis, contract-first correction if needed, and exactly one further isolated attempt. Validate effective `/proc/mounts` inside the container for exactly one `tmpfs` mount at the PostgreSQL data path; run strict static checks and independent review before that one attempt. If it fails, stop.

## Verification/cleanup
Code-only phase gate currently PASS: focused 7 files / 78 tests, direct typecheck, migration static contract, diff-check. DB integration/E2E pending. Default Playwright DB is persistent `postgres_data`, and runner/provisioner load `frontend/.env.local`; neither is safe. Opt-in `COCINACORE_SKIP_DOTENV=1` preserves default dotenv behavior while allowing explicit isolation. Three strict-TDD harness cycles and independent audit/static verification passed. Preflight confirmed Docker Desktop local Unix socket and required local image. First isolated integration attempt exited 1 at `container data mount is not exactly one tmpfs mount at /var/lib/postgresql/data.` Exact container ID `161c7436cac50cefc807f836c53a2bc2dac6ac570be2463295a823e539a5c842` was removed and verified absent; migrations did not run. User authorized offline diagnosis, strict-TDD correction and one fresh attempt. Local image declares the DB path as a volume; Docker docs state tmpfs obscures existing content. Harness now validates exactly one tmpfs mount at that path and ignores unrelated mounts; mismatch diagnostics are bounded. Independent review found implementation correct but contract test lacked count/type/duplicate assertions. Strengthened the test contract only; harness behavior was already correct, so no meaningful RED was expected or observed. GREEN passed. Independently verify/review before one fresh isolated attempt. No pull, persistent DB, production, or prune; if fresh run fails, stop.

## Latest runtime update

The single fresh integration run after the tmpfs adjustment exited 127 at `mapfile: command not found` (macOS Bash compatibility) before mount validation or any migration. Cleanup reported exact container ID `a5bdaa0322644822a52f989261261c0da4596c1475ff9d74a626f363be241bd9` removed and verified absent; temporary workspace cleanup was not explicitly confirmed. No retry/recovery. The prior single-run authorization is consumed; request fresh authorization before a Bash 3-compatible strict-TDD fix and another isolated run.

## Current authorized continuation

User authorized a Bash 3-compatible Strict-TDD fix and one additional isolated migration attempt. Contract RED→GREEN now rejects `mapfile`, requires Bash 3-compatible `while read` mount parsing, and requires explicit workspace removal/absence proof. Independent verification passed on GNU Bash 3.2.57: contract, syntax, diff, trailing whitespace; independent code review found no blockers. Proceed with the single fresh integration run only; no retries, pulls, persistent DB or production.

## Latest integration outcome

The authorized Bash 3-compatible integration attempt exited 1: Docker inspect returned no mount entries, so the DB tmpfs assertion stopped the run before migrations. Legacy/fresh assertions did not execute. Exact container `b33388eca6382d5905a163ac7ee14bf31496654b70621b4e0f868503bfc7e1c0` and temporary workspace were removed and verified absent. No retry/recovery. The one-run authorization is consumed; request fresh authorization before further Docker diagnosis or another attempt.

## Probe dependency review

The independent reviewer found no semantic blocker in the `/proc/mounts` parser but could not prove `awk` exists in the image. Replace `awk` with POSIX `sh` built-ins (`read`/`printf`) inside the container, contract-first strict TDD, before the single authorized attempt. No runtime action until reviewed.

## One-run preflight after POSIX probe correction

The effective mount query now uses POSIX `sh` built-ins against `/proc/mounts`, no `awk`; it still requires exactly one tmpfs at the PostgreSQL data destination. Strict-TDD contract RED→GREEN, Bash 3 syntax, diff/whitespace, independent code review and static verifier all pass. The sole remaining authorized isolated integration attempt may run. If it fails, stop; no retry.

## Latest integration outcome

The last authorized isolated run passed the mount gate and applied legacy migrations 001–012, then exited 1 when the expected pending-013 verification returned `Migration 013_culinary_profile_context.sql has an unsupported catalog addition.` The fresh-manifest migration assertions were not reached. Mount passage is inferred from reaching legacy migration application; there was no positive marker in command output. Exact container `1c20461ed15f09a59bda5525d219cdfbc08889a83788ef20f1977ca7c0f2c88c` and temporary workspace were removed/verified absent. No retry/recovery. The one-run authorization is consumed; request fresh authorization before offline diagnosis or another integration attempt.

## Catalog contract review follow-up

Independent review confirmed the manifest change is correct but found the static assertion omitted `schema === 'public'`. Add this test-only assertion before integration; current manifest already satisfies it, so no meaningful RED is expected. Independently validate/review afterward.

## Catalog failure diagnosis and authorized plan

Offline source inspection identified migration 013 manifest metadata as the cause: four `catalogAdditions` entries use `kind: "column"`, but `frontend/scripts/run-migrations.js:225-245` and `frontend/scripts/provision-database.js` permit only `kind: "constraint"`. Legacy 001–012 succeeded with the temporary prefix; the full-manifest pending-013 verifier rejected metadata. User authorized offline diagnosis and one new isolated run. Strict-TDD: add a contract assertion that all catalog additions use supported `constraint` kind, observe RED, remove only unsupported column entries while retaining constraint entries, run GREEN/static/review, then one isolated attempt. If it fails, stop.

## One-run preflight: catalog metadata

TDD added a contract for exactly two supported public-schema constraints. Observed RED with four unsupported column entries; removed only those manifest entries and kept constraints. SQL unchanged (548 bytes; SHA256 `0c6d6e8dc67d2e0b0ebb8128562db1ec8b81a44f82c5e0601c38ba5fb608dfe5`). Contract/syntax/diff/whitespace passed; independent review no blockers. The newly authorized isolated attempt may run once; if failed, stop.

## Latest catalog-fix integration outcome

The newly authorized run applied legacy migrations 001–012, then pending-013 verification still failed with `Migration 013_culinary_profile_context.sql has an unsupported catalog addition.` It stopped before migration 013 apply, rerun, or fresh-manifest path. Mount check passage is inferred from subsequent migration execution; no explicit pass marker was printed. Container `8c79c7ed85f370970ae5117ac6b0b654c35f48441b555bfb9381f12de226c193` and temporary workspace were removed and verified absent. Exit 1; no retry/recovery. The one-run authorization is consumed; request new authorization before further diagnosis or another isolated attempt.

## Catalog identity diagnosis authorization

The same unsupported-catalog error persisted after removing `kind: column`. The runner also validates catalog `identity` against a dotted-name regex, while current entries are bare constraint names. User authorized offline format diagnosis, strict-TDD correction if warranted, and one new isolated integration attempt. Map the catalog query output/consumer identity representation first; do not guess. Then contract RED/GREEN, static gates/review, and one attempt. Stop if it fails.

## Catalog identity resolution

Independent read-only trace established `identity` must be `table.constraint`; provisioner composes `schema.table.constraint`, and migration 011 provides precedent `users.users_email_canonical_check`. Migration 013 currently uses bare constraint identities. Correct them to `user_culinary_profiles.user_culinary_profiles_available_time_minutes_check` and `user_culinary_profiles.user_culinary_profiles_household_members_check`, schema `public`. TDD: update contract expectations first (RED), then manifest identities only; static gates/review and one authorized isolated attempt.

## Catalog identity final preflight

Manifest now contains the exact `table.constraint` identities under schema public. Strict-TDD contract RED→GREEN, SQL hash/length unchanged, static checks and independent review/verification pass. The user-authorized isolated integration attempt may run once; if failed, stop.

## Catalog integration result

The authorized isolated migration integration passed (exit 0): legacy 001–012, pending-013 verification, migration013 apply, complete verification, safe rerun/no-op, fresh full 001–013 apply and verify. Tmpfs and loopback checks passed. Container `67c635ea51e31787d679d5e4616af6d80083148b49323a1e437164377b776243` and temp workspace were removed and verified absent. No pulls, persistent compose DB or production.

## Connected E2E exploration

Read-only review found no profile/onboarding connected E2E spec (auth smoke only checks API status). Playwright does not start DB/Redis and defaults to local ports. Safe candidate: run a disposable copy excluding `.env*`, `.git`, and `node_modules`, inject synthetic DB/Redis/auth/provider env, use local provider stub and clean fresh DB. Add focused profile field persistence E2E without the mutating broad database fixture. Verify local services/images before run; never pull, touch persistent compose DB, or build from original worktree. If isolation cannot be established, leave E2E blocked.

## E2E auth isolation review

Independent review found the first profile E2E used `injectAuth` defaults with fixed user email. Guard this spec to skip unless explicit credentials contain a fresh unique `m2-profile-e2e-<random>@cocinacore.local` address, and call `injectAuth(..., {allowSignup:true})` so the fresh disposable DB receives its own account. Test-only safety hardening before execution in sanitized copy.

## E2E synthetic-auth cache blocker

Independent review found `injectAuth` can reuse module-level cached cookies from a prior default-user test, bypassing the E2E unique-email guard. Do not run. Update this test or helper to establish its unique synthetic session without shared cached auth; preserve fresh disposable DB requirement. Independently review after correction.

## Connected profile E2E added

Added one guarded E2E spec using UUID email/password direct signup, `COCINACORE_ISOLATED_E2E=1`, and same page-request cookie context, then persisted UI fields/save/reload. It avoids cached auth and broad DB mutation fixtures. Independent reviewer found no blockers. Runtime pending: prove local Redis service/image and run from sanitized source copy only; no `.env*` or persistent compose DB.

## E2E isolated runner implementation plan

Add a dedicated local E2E runner and static contract rather than run default Playwright: sanitized temporary source copy excludes `.env*`, `.git`, node_modules and `.next`; symlink local node_modules; only copied config patched to random loopback ports/hostname; local present pgvector/Redis images with no pull, random loopback ports and tmpfs; dotenv opt-out for copied migration runner; migrations to fresh disposable DB; synthetic env/local provider; run only the guarded profile spec; exact container/temp cleanup and absence proof. Contract-first strict TDD; no runtime until independent review and preflight.

## E2E runner static gates and review

Strict-TDD RED caught missing runner/provider-port propagation. Fixed; contract, Bash syntax, shell contract syntax, targeted diff check passed; independent reviewer found no blockers.

## Connected E2E runtime failure — STOP

Ran `bash scripts/test-culinary-profile-connected-e2e.sh` exactly once. Failed in migration with `Connection terminated unexpectedly` (exit 1). Exact ephemeral container IDs `ba7055ae7d356fe05019747142804612b26108b881b7a03124fcb1b76efc9a3b` and `9d120b9545282e0378812a2def0879e75ac2b52588b674119ba2e0e751961e23` removed and verified absent by exact run-label filter; temporary workspace verified absent. Runtime tmpfs/loopback markers were not returned; no claim. User authorizes exactly one instrumented rerun. Contract-first RED observed. Runner instrumentation added with stage/migration timestamps, events, failure state/log capture before cleanup, process status, DB/Redis pings, isolation and inventory markers. Static safety contract, shell syntax and diff checks pass after dynamic-prefix and Bash-array matcher corrections. Independent audit found pre-run blockers: `--rm` may erase a failed container before diagnostics; Docker logs print unredacted; isolation/probe/inventory markers lack timestamps. Extended contract first; after correcting the run-line matcher, observed RED: `owned containers must remain inspectable until failure evidence is captured`. Runner now retains exited containers until exact cleanup, redacts Postgres/Redis logs, timestamps isolation/probe and inventory markers, and keeps exact cleanup. Existing migration APPLY/DONE output is timestamped externally; no `run-migrations.js` edit. Static contract, Bash/sh syntax, targeted diff pass. Independent read-only audit found no blockers, but the single authorized instrumented run failed when Next.js/Turbopack rejected the sanitized tree's `node_modules` symlink as outside the filesystem root. Playwright PID 76675 exited 1; failure marker 2026-10-06T15:47:33.441Z; cleanup completed 15:47:34.503Z. Exact Postgres `ffea3869148231d49906832af4730e21bbb117b8637fe5bf0e31fe46b755f14b`, Redis `a5d367b1d4caccb826d183071ed583c4c3754f6d6d031fb469178f85402dff46`, and temp workspace were removed/verified absent. Runner reported inventory match and zero test garbage. The returned verifier output was truncated: PRE count/hashes and full inventory are unavailable; visible POST count is 6 containers / 5 networks / 231 volumes. Its redaction filter also errored (`sed: unterminated regular expression` / `-e: command not found`) for both service logs, leaving logs unavailable. That authorization was consumed. A fresh user authorization now classifies the failure as `HARNESS_DEFECT_CONFIRMED` and permits one new connected-profile run after strict-TDD harness fixes. Strict-TDD RED reproduced the external `node_modules` symlink and legacy sed sanitizer failure (exit 127). Implemented APFS `cp -cR` dependencies with manifest hashes/realpath containment, a bounded Node sanitizer with 9 passing fixtures, concise private forensic capture and PRE/POST inventory reports, live sanitized migration markers and exact source-vs-ledger verification, live Playwright `onTestBegin` sentinel, and bounded owned-process cleanup. Scope stayed harness/tests/ODD; product/migration SQL unchanged. Static contract, sanitizer fixtures, Bash/sh syntax, Node checks, and targeted diff all PASS; independent review found no blockers. The one newly authorized run executed once and failed before migrations: `POSTGRES_PRE_MIGRATION_SELECT` failed with `psql` unable to find `/var/run/postgresql/.s.PGSQL.5432`. Migration and Playwright were not started. Both service containers were reported running; loopback and tmpfs markers were YES. Event sanitizer exited 143 during teardown and `LOG_SANITIZATION_FAILED=YES` was recorded; no raw service logs/credentials were printed. Exact Postgres/Redis containers and temp workspace/COW dependencies/forensics removed. PRE and POST inventories exactly match: containers count 6 hash `5a34c48551e57833f06912418a0f4844043b65ed29bb256f141bd6ec18879837`; networks count 5 hash `6a660bb59004de97cbffb20d030bf46957307fa1beea961543d7f9e9d36a8da9`; volumes count 231 hash `42d66dae0c6c7c809cda411e1ed4b0bf30d0c4086200a2ce79e296e53cd7108a`. `POST_INVENTORY_MATCH=YES`, `ZERO_M2_TEST_GARBAGE=YES`. Stop now: no diagnosis, repair, retry, remaining M2.1 gates, or M2.2 until fresh authorization.
- Files: implementation in progress; final list pending.
- Commit: pending; intended subject `feat(profile): persist real household culinary context`.
- Baseline evidence: profile API and profile-context 10/10; tsc/lint/diff check PASS. Node `v22.22.3`; npm `12.2.0` left unchanged. Docker context/server responded; no container/resource inspection or mutation.
- Refined test-only RED patch touched only allowed test surfaces; 13 expected failures / 36 passes. Independent audit confirmed expected missing behavior and called out remaining DB integration proof; no product implementation was changed.
- Production accessed/modified/migrated/deployed: NO.

## Latest independent pre-E2E review — BLOCKED
The reviewer identified two P1 findings that block connected E2E:

1. **Meal-plan allergy enforcement:** `frontend/src/app/api/meal-plan/route.ts:319-344` asks the provider to respect persisted allergies but persists parsed structured output without deterministic ingredient-vs-allergy validation. Recipe generation already validates at `frontend/src/app/api/recipe-generate/route.ts:526-539`.
2. **Allergy/dislike truncation:** profile API accepts up to 20 allergies/dislikes (`frontend/src/app/api/profile/route.ts:48-60`), but shared context silently truncates each to 12 (`frontend/src/lib/meal-planner/profile-context.ts:5-8,29-39,99-109`). Accepted restrictions can be omitted from both consumers.

### Next strict-TDD implementation scope
Proposed exact paths: `frontend/src/app/api/meal-plan/route.ts`, `frontend/src/app/api/meal-plan/route.test.ts`, `frontend/src/app/api/recipe-generate/route.ts`, `frontend/src/app/api/recipe-generate/route.test.ts`, `frontend/src/lib/meal-planner/profile-context.ts`, and `frontend/src/lib/meal-planner/profile-context.test.ts`. Reuse/extract the recipe whole-token normalized matcher; reject unsafe meal-plan output before persistence; independently bound allergies and dislikes to 20 while retaining 12 for preference-term categories. Add behavior tests first, observe RED, implement, observe focused GREEN, triangulate whole-token normalization/safe cases and 12-vs-20 boundaries, then obtain independent re-review. No blocker code or tests have been changed yet.

Connected E2E is authorized but remains STOPPED until both P1 findings are fixed, tested, and independently re-reviewed. M2.1 remains INCOMPLETE; M2.2 remains NOT STARTED. Keep M1 Issue #6 open and do not start Step 8. Production actions remain gated on all applicable tests and reviews and required production prerequisites. This record update does not claim any new tests, E2E, merge, migration application, or deployment.

## Superseding independent re-review — common-inflection P1 blocks E2E
This supersedes the prior claim that canonical-alias matching was resolved. Both original P1s pass focused tests: meal-plan output has deterministic allergy enforcement, and shared context preserves accepted allergies/dislikes rather than truncating them at 12. Selected alias/plural matching also passes focused tests for tomato/onion/garlic variants. Independent re-review nevertheless found a remaining P1 in `frontend/src/lib/recipes/structured-ingredients.ts`: `normalizeIngredientName` does not cover common allergy singular/plural variants `almendra`/`almendras`, `huevo`/`huevos`, and irregular `nuez`/`nueces`, so these evade the exact whole-token check.

This common-inflection defect is the **sole remaining identified E2E blocker**. Require focused behavior-level RED/GREEN tests for those variants, conservative canonicalization that preserves exact whole-token behavior and prevents substring/non-token collisions, relevant safe/negative alternatives, and independent re-review before connected E2E. E2E remains authorized but **STOPPED** until those gates pass. M2.1 remains INCOMPLETE; M2.2 remains NOT STARTED. No E2E or production activity is claimed or performed.

## Superseding independent re-review — recipe cache-hit P1, E2E STOPPED
This supersedes the earlier “sole remaining common-inflection blocker” status above. The common-inflection mapping fix now passes 60 focused tests, including almond/egg/walnut variants. Independent re-review found a new high/P1 bypass in `frontend/src/app/api/recipe-generate/route.ts:426-458`: the cache-hit path persists and returns cached recipe text before the current hard-allergy validation at `:502-520`. A cached recipe containing a currently restricted ingredient—or unusable ingredients—can therefore bypass validation.

Next strict-TDD scope: validate cache hits against the current authenticated hard restrictions before history persistence and return. Fail closed when active hard restrictions exist but the cached structured recipe has no usable ingredient names. Tests must prove rejection causes no history or cache writes. Give the existing safe cache-hit fixture a usable ingredient. While touching the matcher, add a direct regression for the existing `ajos` → `ajo` normalizer alias.

Connected E2E remains authorized but **STOPPED** until the cache-bypass fix, garlic alias regression, focused tests, and clean independent re-review pass. M2.1 remains INCOMPLETE; M2.2 remains NOT STARTED. No E2E or production run occurred.

## Latest explicit user authorization — staged E2E and release
This entry supersedes prior statements that the connected M2.1 E2E and eventual merge, migration 013 application, or production deployment are unauthorized. The user explicitly authorized connected M2.1 E2E and, only if every gate passes, merge, apply migration 013, and deploy to production. This is staged authorization: do not execute a stage before its gates; stop on any failure. If production execution requires missing or ambiguous environment, target, credential/access, or maintenance-window details, ask before proceeding.

- Worktree: `/Users/yoryiabreu/proyectos/cocinacore-m2-culinary-profile`. Keep M1 Issue #6 open; do not start M1 Step 8. No dependencies/network pulls; do not read `.env*`; use isolated resources only; never use the persistent Playwright DB.
- Latest recorded local focused harness gates pass: static contract, 9 synchronous + 7 subprocess redaction fixtures, lifecycle coverage (EOF/TERM/KILL/timeout/partial output/redaction), scoped syntax, and scoped diff check. This records the latest local focused harness evidence; it does not claim connected E2E or full release validation.
- M2.1 is INCOMPLETE; M2.2 is NOT STARTED. Connected E2E and full release execution are authorized but not yet run. Independent review, E2E, full release gates, merge, migration application, deployment, commit, and PR have not happened.
- Next immediate action: obtain an independent read-only M2.1 review before connected E2E. If blockers are found, stop before E2E; route fixes through strict TDD, then rerun affected gates and obtain review before resuming.
- Production go/no-go requires all preceding gates and independent review to pass, plus verification of the exact production environment/target, exact migration 013 and expected pending set/checksum, backup and readiness, safe stop/rollback plan, required credential/access, and maintenance window if applicable. Ask for any required missing or ambiguous production detail before the operation. Do not widen migration scope or perform an unapproved restore.
- Keep the one-PR policy for M2. No merge, migration apply, or production deployment until every applicable gate and production prerequisite passes. Stop on any failed gate and report execution status precisely; authorization is not evidence of execution.

## Fresh authorization — harness-only TDD repair
User now authorizes strict-TDD correction of only the confirmed pre-migration TCP endpoint and sanitizer lifecycle defects plus exactly one connected-profile E2E after focused tests/static checks/independent review. Scope is the connected runner, focused harness tests/helpers, and ODD evidence only. No product/API/schema/ORM/migration SQL/dependencies/production/deploy changes; no commit/push/PR/merge. Preserve host migration URL `127.0.0.1:$PG_HOST_PORT`; use in-container `127.0.0.1:5432` explicitly for `pg_isready` and `psql`, with safe credential-free marker. Test sanitizer normal EOF/exit, TERM/KILL, timeout, partial output, redaction, and Docker events deterministically. Before the one run require full PRE inventory; after it record full POST inventory and exact cleanup. Any failing gate blocks runtime; if the single E2E fails, capture/clean and STOP without retry. Detailed tasks: `odd/tasks/m2-1-connected-e2e-harness-repair.md`.

The first focused post-change contract command stopped with exit 1, `ReferenceError: existsSync is not defined` at `[stdin]:182:25` (Node v22.22.3). Remaining sanitizer/lifecycle fixture commands were not run. No Docker, migrations, DB, or E2E were started. Fix/test status is unverified; STOP per PM gate, no connected E2E.

## Superseding final harness gate status
The subsequent authorized FIFO/lifecycle evidence supersedes the stale lifecycle-FAIL/latest-gate claim above and in `m2-1-connected-e2e-harness-repair.md`; retain those claims as history only. Redirected `process.stdin` did not emit `end`/`close` on this host, whereas `fs.createReadStream(FIFO)` did. Redactor optional `--input-file` mode now uses `createReadStream`, runner FIFO consumers use it, and ordinary stdin behavior remains. The named-FIFO JSON password expectation was corrected to valid JSON syntax. Lifecycle fixture timeout-regex escaping was corrected; fixtures clean exact temp directories on `fail`/success rather than through an EXIT trap, and TERM/KILL expectations use helper-classified cause rather than temporary marker files.

Final authorized gates PASS: static contract; 9 synchronous + 7 subprocess redaction fixtures; lifecycle fixtures covering normal EOF, TERM, KILL, timeout escalation, partial output, and redaction; scoped shell `bash -n`; `node --check` on both JS files; scoped `git diff --check`. No connected E2E, Docker/containers, DB/migrations, Playwright, production, network, dependency, or delivery operations were run. The previously passed migration integration was not rerun. Scope audit found only expected pre-existing M2.1 product/migration changes and allowed harness/task files; no `.env*`, production/deploy/dependency changes, or non-synthetic secrets. No commit, push, PR, merge, deploy, or production access. M2.1 remains INCOMPLETE: connected E2E, full M2.1 regression/coverage/lint/typecheck/build, and independent review remain. M2.2 is NOT STARTED pending M2.1 and separate authorization. Final M2 release/regression and one PR remain pending.

## Superseding independent re-review — restriction-bound P2, E2E STOPPED
This supersedes the prior recipe cache-bypass blocker as resolved in code and focused tests (76 tests passed, per user-provided evidence). Independent review found a new remaining P2 safety blocker: recipe hard-restriction normalization caps concatenated `[allergies, avoid]` at 20, while accepted bounds allow 20 allergies plus 12 taxonomy avoid terms. When 20 allergies are present, accepted avoid terms can silently drop from restriction validation/context.

Smallest safe fix: retain a combined bound of 32, with a full-bound route regression proving all 20 allergies and all 12 avoid terms reach restriction validation/context. Dislikes must remain excluded from hard restrictions. Connected E2E is authorized but **STOPPED** pending this bound fix, focused GREEN, and clean independent re-review. M2.1 remains INCOMPLETE; M2.2 remains NOT STARTED. No E2E or production run occurred. This record-only update did not edit code or run tests.

## Current allergy-safety blocker status and next phase
This supersedes the preceding P2 STOP as resolved. Strict-TDD GREEN; latest independent focused tests: 4 files / 63 tests passed; latest independent re-review: no identified blockers. The completed blocker set covers meal-plan validation before persistence; retaining the accepted 20 allergy/dislike context limit; common alias/plural canonicalization; cached recipe validation and fail-closed handling before history/cache/return; the full 32 hard-restriction bound (20 allergies + 12 avoid terms); and direct `ajos`/`ajo` coverage.

Residual limitation: unmatched synonyms and unparsed prose are not proven safe. This finding remains a limitation, not a claim that all possible synonyms/prose have been validated.

The allergy-blocker task is COMPLETE. Next phase is the full non-connected M2.1 gates and broad final review before the already-authorized connected E2E. The user authorization is staged: halt on any future failed gate and do not proceed downstream. No connected E2E, full M2.1 gates, commit/PR/merge, migration apply, production operation, or deployment is claimed as performed. M2.1 remains INCOMPLETE; M2.2 remains NOT STARTED. Preserve M1 Issue #6 open and do not start Step 8. Ask for environment-specific production details before any actual production operation; all existing privacy, isolation, migration, and safety constraints remain in force.

## Superseding full-local-gates result and new allergy-synonym P1 — E2E STOPPED
This supersedes the prior no-blocker review status and the next-step claim that full non-connected gates were still pending. User-reported passing local evidence: full frontend unit suite (52 files / 459 tests); coverage (81.58% statements, 75.44% branches, 85.89% functions, 83.79% lines); full lint; frontend typecheck; migration static and integration checks, including fresh and legacy 001–013 chains, verification, no-op rerun, and exact cleanup. These are recorded as user-reported results and were not rerun in this documentation update. No E2E, build, PR, or deployment has occurred.

A new independent re-review supersedes the prior no-blocker disposition with one HIGH/P1: exact-token matching misses common peanut synonyms, e.g. allergy `cacahuate` versus generated ingredient `maní`, allowing a bypass in meal-plan and recipe/cache validation. Preserve all previously recorded allergy safeguards, but require strict-TDD synonym canonicalization and focused behavior tests, then independent re-review, before connected E2E. E2E is authorized but currently STOPPED until both requirements pass.

M2.1 remains INCOMPLETE; M2.2 remains NOT STARTED. Keep M1 Issue #6 open; do not start Step 8. No production operation is claimed. Do not read `.env*` files; preserve all existing privacy, isolation, migration, and safety constraints.

## Superseding review — peanut plural and stale saved-plan P1s; E2E STOPPED
The matcher recognizes `mani` but misses unaccented plural `manis`. Add exact strict-TDD regression and canonical mapping so `maní`, `mani`, `manis`, and `cacahuate` resolve to the same peanut restriction key, preserving exact whole-token matching.

Persisted meal-plan GET currently returns a structurally valid saved plan without checking the authenticated user's current `allergies`/`avoid`. Validate saved plans against current restrictions on GET; a conflict must return controlled HTTP 409 without deleting or mutating saved history. The UI must show specific guidance to regenerate the plan.

Required tests: both synonym directions/inflections; conflicting stale plan returns 409 with no mutation; non-conflicting saved plan still returns; UI conflict/regeneration message. Obtain independent re-review after all pass. Connected E2E remains authorized but STOPPED until all tests and re-review pass. User reports existing full local gates remain green; no build, E2E, PR, or deployment has occurred. M2.1 remains INCOMPLETE; M2.2 remains NOT STARTED. Full release authorization is conditional; no production operation is claimed. Preserve M1 no-Step-8 and all existing safety constraints. ODD-only update; no source edits or tests.

## Latest documentation-only status — UI P2 and tooling deviation
The stale saved-plan restriction message is now rendered through an accessible alert; focused tests passed (user-reported). This resolves the UI P2 presentation finding only; it does not establish that the broader saved-plan safety finding, updated independent review, or full regression gates are complete. Connected E2E remains STOPPED pending updated independent review and completion of all regression gates.

Tooling deviation: a worker invoked `cd frontend && npx eslint ...` once despite the user's explicit prohibition on local `npx`. The repo-local ESLint dependency was already installed, and command output showed no package installation or download. This is not proof that network access was absent at runtime. No dependency or global changes were made. An earlier `npm --prefix frontend exec eslint -- paths` failed because paths resolved from the repository root. Use the approved `npm --prefix frontend run lint -- <paths>` form henceforth. No further `npx`.

No tests or E2E were run in that documentation-only update. M2.1 remains INCOMPLETE; M2.2 remains NOT STARTED.

## Superseding latest M2.1 gate status — allergy review clear, E2E still stopped
Final independent allergy-safety review found no blockers after `manis` peanut canonicalization. Saved meal-plan GET now validates against the authenticated current profile and returns a controlled, non-mutating 409 on conflict; the UI wires the regeneration guidance through an accessible alert. User-reported focused coverage passed 8 files / 96 tests, including recipe/meal-plan route and helper/component tests; `tsc --noEmit` passed. A full lint rerun found unsafe `.plan` member access in `route.test.ts`; replacing it with typed `objectContaining` yielded a focused route-test PASS (31 tests) and scoped lint PASS.

## Superseding latest pre-E2E gate status — connected E2E in progress
User-reported pre-E2E gates are green: coverage suite 54 files / 475 tests, statements 81.64%, branches 75.56%, functions 86.03%, lines 83.82%; full lint exit 0; `tsc --noEmit` exit 0; non-connected harness contract/lifecycle/redaction suites pass (6 lifecycle categories and 9 synchronous + 7 subprocess redaction fixtures). Isolated migration static and legacy/fresh 001–013 verify/no-op/cleanup passed earlier after migration changes. Independent allergy review found no blockers.

A contained production build passed using temporary source and dependency copies excluding `.env*`, followed by exact temporary cleanup. Superseded build attempts failed because Next rejected an external `node_modules` symlink and because copy-links broke the Next `.bin` relative path; the final rsync copy preserving links passed. The first attempt created a panic log that was not inspected or cleaned; this remains an artifact-handling note. The connected E2E has since been reported passed. M2.1 local gates and connected E2E are reported passed; M2.2 may start. This supersedes the prior in-progress/no-result statement above. Preserve the `npx` incident, do not read `.env*`, keep M1 Issue #6 open, and do not start Step 8. No PR, commit, merge, deployment, migration application, or production operation is claimed.

## Latest status — M2.2 authorized to start
User reports M2.1 local gates and connected E2E passed. M2.1 is complete for phase-transition purposes; M2.2 implementation is now in progress under its separate task record. This documentation update does not claim new tests or independently rerun gates. The prior contained build's panic-log artifact-handling note remains recorded above. Retain the `npx` deviation: do not use `npx` again; the previous tool call's output was not proof that network access was absent. Do not read `.env*`. Keep all existing privacy, allergy/restriction, tenant, bounded-lookback, truthful-degradation, canonical handoff, isolation and migration safety requirements. No commit, release, push, PR, merge, migration application, production access or deployment is authorized or claimed.
