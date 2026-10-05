# M1 Step 7 — Git integration

## Goal
Audit, validate, stage, commit, open/review/merge a CocinaCore M1 deployment-hardening PR on `fix/pawtech-production-deploy`, without production access or deployment and without starting Step 8.

## Constraints
- ODD only. No RDD, SDD, OpenSpec, M2, or production access/mutation/deploy.
- Preserve exact starting base: branch `fix/pawtech-production-deploy`, HEAD `a1e008c392c76b6d586a1b1e9cf10ef0df56b7f0`, `origin/main` same. If upstream diverges, stop; never auto-rebase/merge.
- Never read real `.env*`, print secrets, stage production dumps/credentials/temp artifacts, or blindly stage the worktree.
- No dependency install, npx, npm audit fix. Use approved Node v22.22.3/npm 10.9.8.
- Commit/push/PR/merge only as explicitly authorized by Step 7; do not deploy. Stop if a material review blocker exists; Step 8 is not authorized.
- No commit until every requested quality gate passes. No PR until issue/label requirements and delivery-size policy are resolved.

## Current state and evidence
- Fresh `git fetch origin` passed. Branch and both expected refs matched; staged count was 0.
- Initial status: 12 tracked modifications, 12 untracked files, no deletions. The actual path set matched the user's expected list exactly.
- Static map found 354 tracked additions + 439 tracked deletions; untracked files add 3,274 lines; estimated total authored diff is 4,067 lines before this Step 7 tracking document.
- Redacted audit result: `SECRET_SCAN=PASS`; no suspected real credential literals. No secret values were reported.
- Initial material findings are addressed in the current diff: explicit `permissions: contents: read`; runtime `ssh-keyscan` trust removed; required `VPS_SSH_KNOWN_HOSTS` is checked for nonempty and matching host, and deploy/rollback both require strict checking with only the configured user known-hosts file trusted. The PM must provision this GitHub Environment secret from an independent trusted source before any future deployment; its existence/value remains unverified. No deploy/production operation was run.
- PR size exceeds the 400-line review budget; user explicitly approved one PR with `size:exception`. Approved linked issue #6 is OPEN with `status:approved` (verified via GitHub issue metadata). Branch-PR policy still requires exactly one `type:*` label before PR creation.
- Original requested gates passed before security remediation. Both strict-TDD focused RED/GREEN cycles passed after their respective changes; contract, `bash -n scripts/deploy-pawtech-production.sh`, and `git diff --check` passed. Full requested suite and final redacted audit must now be rerun. No staging/commit/push/PR/merge has occurred.

## Stable task checklist
1. [x] Fresh Git preflight: fetch, exact branch/HEAD/origin/main, no staged files.
2. [x] Inventory/audit actual changed and untracked M1 files against the user's list; preliminary secret scan reports PASS.
3. [x] User authorized workflow hardening, selected strict TDD, accepted one-PR `size:exception`, and approved issue #6 (OPEN, `status:approved`). Two RED/GREEN cycles updated only `.github/workflows/deploy.yml`, `scripts/tests/test-pawtech-production-deploy-contract.sh`, and `docs/production/runbook.md`: `permissions: contents: read`; required `VPS_SSH_KNOWN_HOSTS` with fail-closed empty/host validation; no keyscan; strict checking on both deploy and rollback; `GlobalKnownHostsFile=/dev/null` so the configured secret is the sole host-trust source; documented independent-source provisioning prerequisite. Secret value/existence is not accessed or verified.
4. [x] Post-remediation verification passed under Node v22.22.3/npm 10.9.8: Bash syntax x3; rehearsal, production, Step4, Step5, bootstrap config, deploy contract; frontend lint (0 errors, 1 warning), coverage (49 files/411 tests; statements 81.37%, branches 74.69%, functions 87.08%, lines 83.66%), typecheck, build, and `git diff --check`. Vite configLoader warning non-blocking. SC2154 absent; raw ShellCheck exit 1 reports pre-existing/unmodified SC1007, SC2034, SC2155 warnings and SC2015/SC2016 info; no fixes made to unrelated scripts. The local Docker/PostgreSQL integration driver was not rerun after workflow-only changes because its resource cleanup was not established; it passed on the pre-remediation baseline. This skip is disclosed.
5. [x] Final audit matched exact candidate scope: 12 tracked modified + 13 expected untracked, zero staged, zero deletions/unexpected. Redacted scan reports `SECRET_SCAN=PASS` on audited files; latest additions contain only a secret reference, no value. `git diff --check` clean; no `.env*` content read. Independent risk review found one low test-guard gap (permissions assertion) which was corrected; focused contract passed, no material security finding remains. The required GitHub secret remains unconfigured/unverified; no deployment.
6. [x] Explicitly staged exactly the 25 audited M1/ODD paths; cached path list matches the audited set, no unstaged changes/deletions/unexpected paths, `git diff --cached --check` passes. Size is 3,727 insertions / 440 deletions.
7. [x] Created Conventional Commit `feat(deploy): prepare PawTech M1 production release`: `d41c70ccc1db516edbd9bd57417b5e2b8467a3b0`. Active pre-commit GGA review returned `STATUS: PASSED`; no bypass used. Commit contains exactly the 25 audited paths (3,727 insertions / 440 deletions).
8. [x] Pushed `fix/pawtech-production-deploy` without force/rebase and opened PR #7 (`https://github.com/yabreu65/cocinacore/pull/7`) linked to approved issue #6, with exactly one `type:feature` label and the approved single-PR size exception documented in the body. The post-commit `.atl/skill-registry.md` generated local diff (23 insertions / 32 deletions) remains unstaged and excluded.
9. [~] PR #7 CI is blocked: run `37341981284`, `frontend-quality` job `111871038759`, failed at **Test canonical email PostgreSQL invariant** with `Database provisioning failed: Connection terminated unexpectedly` (exit 1). Steps 1–9 succeeded; lint, coverage, typecheck, and build were skipped after failure. Per user instruction stop on gate failure: no retry, no edits/remediation, no merge. Keep PR open pending human direction.
10. [x] Record current Step 7 gate failure and stop; no remediation/merge/Step 8 until PM direction.

## Authorized continuation — CI PostgreSQL readiness fix (2026-10-05)

PM authorized exactly one minimal Strict-TDD correction, one commit, one push to existing PR #7, and exactly one resulting CI run. No merge, production, Step 8, new infrastructure/database service, dependency changes, or production-script changes.

Root cause: both integration helpers use `docker exec ... pg_isready -U ... -d "$DB"`, which probes PostgreSQL's Unix socket and can observe the temporary initialization server; host-side Node provisioning then connects through the dynamically published TCP port before final TCP readiness. This is a test-harness readiness race, not migration 011, application, or production behavior.

Exact implementation surfaces:
- `scripts/tests/test-bootstrap-migrator-config.sh` — existing narrow shell contract; assert BOTH integration helpers require TCP readiness (`pg_isready -h 127.0.0.1`) before host-side Node provisioning and reject socket-only readiness.
- `scripts/test-bootstrap-migrator-integration.sh`
- `scripts/test-canonical-email-integration.sh`
- This ODD task record only, if needed.

One work unit / one commit: contract RED first, then change both helpers to `pg_isready -h 127.0.0.1 -U ... -d "$DB"`; preserve existing bounded 60-attempt loop, dynamically published port, container lifecycle and exact cleanup. No arbitrary sleep, provision/migration retry, Docker service architecture change, production script, migration, app, dependency, or workflow change.

Local validation, in user-specified order: approved Node/npm; focused RED/GREEN contract; `sh scripts/tests/test-bootstrap-migrator-config.sh`; `sh scripts/test-bootstrap-migrator-integration.sh`; `sh scripts/test-canonical-email-integration.sh`; affected production/Step contracts if shared contract file changes; frontend lint, coverage, direct local tsc, build; `git diff --check`. No npx. If any check fails or Docker cleanup is not exact, stop. If all pass, make one Conventional Commit and one push to existing branch/PR #7, then observe exactly the CI run triggered by that push. No manual rerun; if canonical still fails, stop; if fully green, report and stop. Never merge.

### Writer implementation evidence
- Strict-TDD RED: `sh scripts/tests/test-bootstrap-migrator-config.sh` failed with `config failure: test-bootstrap-migrator-integration.sh TCP readiness probe is missing` against the original socket-only probes.
- Strict-TDD GREEN: after changing both helper probes to `pg_isready -h 127.0.0.1 -U cocinacore -d "$DB"`, the same focused contract passed with `bootstrap/migrator static config passed`.
- Static triangulation: only the probe predicate token changed in each helper; `-U cocinacore -d "$DB"`, the 60-attempt bound, one-second existing delay, dynamically published port, provision path, and cleanup functions remain unchanged. No provision retries or other readiness behavior were added. `git diff --check` passed. Docker integration scripts were not run in this writer phase, as directed.
- Exact changed paths: `scripts/tests/test-bootstrap-migrator-config.sh`, `scripts/test-bootstrap-migrator-integration.sh`, `scripts/test-canonical-email-integration.sh`, and `odd/tasks/m1-step7-git-integration.md`.

### Parent local validation stop
- Approved toolchain passed: Node v22.22.3/npm 10.9.8; Docker uses local Unix socket context and required image already existed; focused bootstrap config contract passed.
- `sh scripts/test-bootstrap-migrator-integration.sh`: exit 0, but exact PRE/POST cleanup check FAILED because container/network/temp listings matched while Docker volume inventory changed. POST included two volume IDs absent from PRE (prefixes `58a1b385`, `6a3de5c2`). No manual cleanup attempted.
- Per user instruction STOP here. Canonical integration, affected production/Step contracts, frontend checks, typecheck/build, and final diff check were not run. No commit, push, or new CI run.

### Second PM authorization — exact volume cleanup and harness fix (2026-10-05)
PM attributed exactly these two anonymous volumes to the prior bootstrap integration run and authorized deletion only after fresh verification that each exists, is anonymous, and has no attached containers:
- `58a1b385235ac81280a60b748f4e72428bf68dd69a1404c3dc4dcaa0396acb4f`
- `6a3de5c26f8c06937a9d11da0c64874fc7dacad540d84a9e47fb46fad2f065da`
If either is attached or the attribution criteria fail, stop. Delete only those exact IDs, then confirm absent; no prune or unrelated volume operations.

Authorized Strict-TDD correction: add cleanup assertions to `scripts/tests/test-bootstrap-migrator-config.sh` rejecting `docker rm -f` without anonymous-volume removal for helper-owned containers; change only the two integration helpers to `docker rm -fv` consistently in normal stop, EXIT cleanup, and unique-prefix leftover cleanup. Preserve TCP readiness. No production Docker cleanup changes.

After GREEN, run the config contract and the two integrations exactly once, comparing each run's volume inventory to a fresh immediate PRE (count, sorted IDs, hash). Stop on any mismatch; do not manually clean test residue. Only if both integrations match PRE run remaining static contracts and frontend lint/coverage/tsc/build and diff check. If all local gates pass, create one focused commit, one push to `fix/pawtech-production-deploy`, observe its single CI run, and stop without merge. No production/Step 8/new infrastructure.

### Authorized volume deletion evidence
- Fresh recheck passed for both exact IDs: each existed as a local anonymous volume (`com.docker.volume.anonymous` label present with empty value), and `docker ps -a --filter volume=<ID>` returned empty. Docker context was local Unix socket; `DOCKER_HOST` unset.
- Deleted only the two authorized exact IDs. Neither remains. Volume inventory PRE count/hash: `233` / `98961343395511f44516b22d2907f8e6ed4d142b317c88a4db96265c9a098099`; POST count/hash: `231` / `42d66dae0c6c7c809cda411e1ed4b0bf30d0c4086200a2ce79e296e53cd7108a`. POST exactly equaled PRE minus those two IDs; `UNRELATED_VOLUMES_TOUCHED=NO`. This is cleanup evidence only; the next integration authority still requires a fresh immediate PRE inventory.

### Strict-TDD anonymous-volume cleanup correction — writer evidence (2026-10-05)
- RED: after changing only `scripts/tests/test-bootstrap-migrator-config.sh`, `sh scripts/tests/test-bootstrap-migrator-config.sh` exited 1 with `config failure: test-bootstrap-migrator-integration.sh normal stop does not remove anonymous volumes`; the failure specifically detected missing volume-aware cleanup.
- GREEN: after updating both helpers, the same focused contract exited 0 and printed exactly `bootstrap/migrator static config passed`.
- Cleanup-only edits: `scripts/test-bootstrap-migrator-integration.sh` normal `stop_container` (`docker rm -fv "$CONTAINER"`), EXIT `$CONTAINER` cleanup (same, preserving `|| true`), and PREFIX-scoped leftover loop (`docker rm -fv "$leftover"`, preserving `grep "^$PREFIX"`); the same three call sites were changed in `scripts/test-canonical-email-integration.sh`.
- Both helpers retain their TCP readiness probes exactly: `pg_isready -h 127.0.0.1 -U cocinacore -d "$DB"`. The focused contract now asserts both helpers' normal, EXIT, and PREFIX-scoped anonymous-volume cleanup, requires prefix scoping, and rejects volume-unaware `docker rm -f`.
- `git diff --check` exited 0 with no output. No Docker command or integration test was run in this writer task; the parent will perform its single authorized local validation after review. No production changes, dependency/infrastructure/CI changes, staging, commit, push, or CI run. `.atl/skill-registry.md` remains untouched and unstaged.
- Prior requirements remain in force: preserve approved TCP readiness; remove only anonymous volumes attached to these test-owned containers via `docker rm -fv`; retain container variables, unique PREFIX filters, lifecycle, and `|| true`; do not broaden cleanup or touch named volumes; parent owns review and any further validation/delivery decision; no production access, deployment, Step 8, merge, or other unauthorized operation.

### Parent post-GREEN local validation — STOP (2026-10-05)
- Toolchain and safety passed: Node `v22.22.3`, npm `10.9.8`, local Unix Docker context, `DOCKER_HOST` unset, pgvector image already present. Config contract passed.
- Fresh bootstrap PRE inventory: 231 volumes; SHA-256 `42d66dae0c6c7c809cda411e1ed4b0bf30d0c4086200a2ce79e296e53cd7108a`. Bootstrap integration passed (exit 0); immediate POST count/hash remained 231/same, and exact sorted-ID list comparison passed.
- Canonical integration failed (exit 1): `fresh ledger count is not 11`. Immediate POST count/hash remained 231/same, but the verifier ran the canonical test in a separate shell and did not retain the bootstrap PRE ID list; exact final list equality is therefore UNVERIFIED, not claimed. No manual cleanup or retry.
- Per user instruction stop after this failed gate. Remaining static contracts, frontend lint/coverage/tsc/build, and final diff check were not run. No commit, push, new CI, production, or merge. The previous CI `37341981284` remains the last workflow run.

### Third PM authorization — manifest-driven canonical ledger expectation (2026-10-05)
PM confirmed the latest canonical failure is a stale test expectation: trusted `db/migrations/manifest.json` contains 12 migrations (001–012), while `scripts/test-canonical-email-integration.sh` hardcodes the fresh ledger count as 11. This is not an application, migration 011, PostgreSQL, or infrastructure defect.

Authorized one minimal Strict-TDD correction, one canonical integration rerun, and only if green with exact Docker cleanup, the remaining local gates followed by one commit/push and its single CI run. No new infrastructure, production, merge, or Step 8.

Exact surfaces: existing `scripts/tests/test-bootstrap-migrator-config.sh`, `scripts/test-canonical-email-integration.sh`, and this ODD record. RED assertions must require manifest-derived fresh count, reject a hardcoded 11 ledger comparison, and keep explicit completion/presence verification of `011_canonical_email_invariant.sql`. GREEN must obtain `EXPECTED_MIGRATION_COUNT` dynamically from `db/migrations/manifest.json` and compare the fresh ledger against it; never replace 11 with a literal 12. Do not touch migrations 011/012, `run-migrations.js`, or application source.

Preserve both TCP readiness probes (`pg_isready -h 127.0.0.1 ...`) and all `docker rm -fv` cleanup paths. Bootstrap integration already passed once after the cleanup correction with exact volume PRE/POST equality; do not rerun it for this canonical-only fix. After GREEN run the focused contract, capture a fresh sorted-ID volume PRE immediately before canonical integration (persist the list in the same validation process), run canonical once, then immediately compare exact IDs/count/hash. Any failure or mismatch is terminal: no retry or manual cleanup. Only if canonical passes clean run Step4/Step5/production contracts, lint, coverage/tests, direct tsc, build, and `git diff --check`. Only all local gates green permit one focused commit, one push to existing `fix/pawtech-production-deploy`/PR #7, and one triggered CI observation. No manual CI rerun or merge.

## Categorized audit draft
- A — production workflow: `.github/workflows/ci.yml`, `.github/workflows/deploy.yml`.
- B — backup: `scripts/backup-pawtech-cocinacore-predeploy.sh`.
- C — migration verification: `frontend/scripts/run-migrations.js`.
- D — Docker/runtime: `Dockerfile`, `docker-compose.prod.yml`.
- E — auth/session: `frontend/src/lib/auth/session.ts`, `frontend/src/lib/auth/session.test.ts`, password-reset request test.
- F — tests/contracts: bootstrap integration/config tests, M1 rehearsal/production/Step4/Step5 contracts.
- G — docs/ODD: README, production runbook/reality-first, Step5/Step6/deploy-contract tasks.

## Progress rule
Update this document, Engram mirror, and visible TODO projection after each task transition and material scope/decision change. Stage/commit/PR state is not inferred from a checkbox; record command evidence and exact identities.

## Current outcome
`STEP7_COMPLETE=NO`; `CI_READY_FOR_FINAL_PR_REVIEW=NO`. PR #7 remains open. Commit `8f23a14d44689cda67091153c107c15a540284ac` carries the E2E Gemini isolation fix. PM confirms run `37369506685` cancelled before E2E execution (no steps/logs/tests), with no code-failure evidence. Under new PM authority, the Step5 contract now verifies every CI `node-version` is exactly `22.22.3` (RED observed on floating `22`); only the E2E Setup Node pin was aligned (GREEN). Local contracts/frontend gates and diff check are passing. Fresh fetch/scope audit passed; stage/review, one new commit/push, and its exact triggered CI run remain. No app/dependency/topology change, manual rerun of cancelled run, production, merge, or Step 8. `.atl/skill-registry.md` remains excluded.

### Manifest-driven canonical ledger expectation — writer evidence (2026-10-05)
- Strict-TDD RED: `sh scripts/tests/test-bootstrap-migrator-config.sh` exited 1 with exactly `config failure: canonical fresh ledger count is hardcoded to 11`. The newly added static contract rejected the stale assertion before the canonical helper was changed.
- Strict-TDD GREEN: after the canonical helper began deriving `EXPECTED_MIGRATION_COUNT` from `$ROOT/db/migrations/manifest.json` using `m.migrations.length` and comparing the fresh ledger count with that variable, `sh scripts/tests/test-bootstrap-migrator-config.sh` exited 0 and printed exactly `bootstrap/migrator static config passed`.
- The explicit `DONE 011_canonical_email_invariant.sql` completion assertion remains; the config contract now also checks it, rejects a hardcoded fresh ledger count of 11, verifies manifest-derived expectation, and verifies the fresh ledger comparison uses the variable. The trusted manifest currently contains 12 migrations; no literal 12 was added.
- `git diff --check` exited 0 with no output. Both helpers' TCP readiness probes (`pg_isready -h 127.0.0.1 -U cocinacore -d "$DB"`) and every existing `docker rm -fv` cleanup path are unchanged. `.atl/skill-registry.md` was preserved; no Docker integration was run here.
- Authorized remainder: parent owns exactly one canonical integration run under the fresh-inventory/PRE-POST-ID constraints. Do not rerun bootstrap integration. If canonical fails or cleanup inventory differs, stop; no retry, manual cleanup, or downstream gates. No commit, push, CI, production, merge, or Step 8 is performed by this writer.

### Canonical rerun after manifest fix — parent evidence (2026-10-05)
- `sh scripts/tests/test-bootstrap-migrator-config.sh` passed. Immediately before canonical, the same shell retained the exact sorted volume ID list: count `231`, SHA-256 `42d66dae0c6c7c809cda411e1ed4b0bf30d0c4086200a2ce79e296e53cd7108a`.
- `sh scripts/test-canonical-email-integration.sh` ran exactly once and passed, output `canonical email integration passed: fresh duplicates updates bypass empties concurrency invitations legacy rollback`.
- Immediate POST count/hash were `231` / `42d66dae0c6c7c809cda411e1ed4b0bf30d0c4086200a2ce79e296e53cd7108a`; exact sorted-ID list equality with retained PRE, count equality, and hash equality all passed. No retry or manual cleanup.
- The wrapper emitted two `printf: --: invalid option` separator-label diagnostics; integration test and inventory comparisons returned success.

### Remaining local gates — parent evidence (2026-10-05)
- Static contracts passed: `scripts/tests/test-pawtech-production-deploy-contract.sh`, `scripts/tests/test-pawtech-step4-contract.sh`, and `scripts/tests/test-pawtech-step5-workflow-contract.sh`.
- Approved Node/npm: `v22.22.3` / `10.9.8`. `frontend/.env*` names showed `.env.example` only; no environment-file contents were read.
- Frontend lint passed (0 errors, 1 existing navigation warning at `frontend/src/app/app/page.tsx:83`). Coverage passed: 49 files / 411 tests; statements 81.37%, branches 74.69%, functions 87.08%, lines 83.66%. Vite config-loader warning and expected test warning/error logs were non-blocking.
- Direct local `./node_modules/.bin/tsc --noEmit` passed. `npm run build` passed, compiled and generated all 52 static pages; Next noted the `clientTraceMetadata` experiment.
- Final `git diff --check` passed. `git status --short` contained exactly the four authorized tracked paths plus pre-existing `.atl/skill-registry.md`; no other tracked changes. No stage/commit/push/CI yet.
- Precommit fresh fetch verified branch `fix/pawtech-production-deploy`, HEAD/remote parent `68c6dbfd70e4285120e60893d1c63c0b361196b0`, unchanged `origin/main` `a1e008c392c76b6d586a1b1e9cf10ef0df56b7f0`, zero staged paths, and only the authorized four paths plus pre-existing `.atl` modified.
- Commit `73c253936c096b38654382ef7d6307c911d59d79` (`test: harden PostgreSQL integration checks`) succeeded; pre-commit GGA returned `STATUS: PASSED`. Exactly four authorized paths committed; `.atl` excluded.
- Push `73c253936c096b38654382ef7d6307c911d59d79` completed exactly once to PR #7.

### Post-push CI — STOP (2026-10-05)
- Exact-SHA workflow run `37354185797` completed with failure: https://github.com/yabreu65/cocinacore/actions/runs/37354185797. No other workflows appeared for the pushed SHA.
- `frontend-quality` passed the bootstrap/migrator PostgreSQL boundary, canonical email PostgreSQL invariant, lint, coverage, typecheck, and build.
- `E2E Tests`: migration-role provisioning, migrations, and ledger verification passed; `Run E2E tests` failed: 28 passed, two connected meal-planner/recipe tests failed while waiting for generated-result headings.
- Per the preceding authorization, no rerun/fix/push/merge was performed at that time; this status is superseded only by the new E2E isolation authorization below.

### Fourth PM authorization — E2E Gemini fixture environment isolation (2026-10-05)
PM-confirmed root cause for run `37354185797`: CI provides `GEMINI_API_KEY=CHANGE_ME`; Playwright standalone `webServer.env` currently uses `process.env.GEMINI_API_KEY ?? 'e2e-gemini-key'`, so the defined placeholder survives; `getGeminiApiKey()` correctly returns null for `CHANGE_ME`. The local deterministic provider fixture on `http://127.0.0.1:4319` was running, but ambient key/base URL contaminated app config. This is an E2E configuration defect only, not application, feature, migration, DB, PostgreSQL, or production defect.

Authorized Strict-TDD scope: extend the existing focused environment/config test contract (`frontend/src/services/__tests__/env.test.ts`) to prove the standalone Playwright app ignores ambient `GEMINI_API_KEY` and `GEMINI_BASE_URL`, explicitly uses `e2e-gemini-key` and `http://127.0.0.1:4319/v1beta`, and leaves `getGeminiApiKey()` returning null when `process.env.GEMINI_API_KEY` is `CHANGE_ME`. Observe RED before changing only `frontend/playwright.config.ts`. No change to `frontend/src/lib/ai/gemini-config.ts`, application behavior, CI job-level placeholder, provider fixture response, timeouts, retries, assertions, dependencies, or production config. No real provider key/call.

Local focused run must use Node `v22.22.3`/npm `10.9.8`, only `meal-planner-connected.spec.ts` and `recipe-connected.spec.ts` via the existing Chromium E2E stack. Simulate ambient values only with placeholder `CHANGE_ME` and a reserved invalid external base URL; verify the local fixture request counters are exercised. Scout confirmed these specs do not create Docker resources; they use local PostgreSQL/Redis fixtures and Playwright-managed app/provider servers. No real `.env*` reads. If either spec fails, stop without another fix. If both pass, run relevant static contracts, lint, coverage, direct tsc, build, and diff check. Only all-local-green permits one focused commit/push to the existing branch/PR #7 and one CI observation; no manual rerun or merge.

### Gemini fixture isolation — writer evidence
- Strict-TDD RED: `cd frontend && ./node_modules/.bin/vitest run src/services/__tests__/env.test.ts` failed exactly the two isolation expectations: standalone `GEMINI_API_KEY` was `CHANGE_ME` instead of `e2e-gemini-key`, and standalone `GEMINI_BASE_URL` was `https://ambient.invalid/v1beta` instead of `http://127.0.0.1:4319/v1beta`. The other 10 tests passed, including direct unchanged application `getGeminiApiKey()` returning null for `CHANGE_ME`.
- GREEN: after fixing only the standalone app server Gemini entries in `frontend/playwright.config.ts`, the same focused command passed: 1 test file, 12 tests.
- `git diff --check` passed with no output. CI-level `CHANGE_ME`, application Gemini semantics, fixture response, and all other Playwright settings remain unchanged; exact standalone fixture values are `e2e-gemini-key` and `http://127.0.0.1:4319/v1beta`.
- Parent completed the single authorized Chromium E2E run using local-only PostgreSQL `127.0.0.1:5433/cocinacore_local_db`, Redis `127.0.0.1:6379/15`, synthetic ambient `GEMINI_API_KEY=CHANGE_ME`, reserved `GEMINI_BASE_URL=https://ambient.invalid/v1beta`, and `CI` unset (zero local retries). Node/npm were exactly `v22.22.3`/`10.9.8`; Redis `SELECT 15` returned `+OK`, `PING` returned `+PONG`; PostgreSQL loopback readiness had accepted. Only `.env.example` existed at the top level; no contents read. No Docker command or real provider call.
- Both requested specs passed in 18.3s: 4 tests total. Existing fixture assertions exercised generation counters: meal-plan generation count was 1 and 0 after reload; recipe generation count was 1 and remained 1 after its cached request. The ambient `.invalid` URL was not used; Playwright standalone app config targets local fixture values.
### PM diagnosis — false static-contract failure (2026-10-05)
- The earlier run incorrectly invoked Bash-only `scripts/tests/test-pawtech-m1-rehearsal-contract.sh` using `sh`; its line-412 process substitution is valid Bash. PM independently verified `bash -n` passes and `sh -n` fails. This is not a source defect. Do not rewrite the contract, remove process substitution, or change rehearsal/production logic.
- New PM authority resumes the same fixture-isolation work: run Bash syntax and the contract using Bash, run all remaining contracts by their intended interpreters, then lint/coverage/direct tsc/build/diff check. Only all-green local gates allow the audited three-file stage, exactly one commit and push to the existing branch/PR #7, and observation of only the triggered CI run. No CI rerun, merge, Step 8, production, or further correction after any failure.
- CI must show frontend-quality and full Playwright green; even then `STEP7_COMPLETE=NO` pending PM's final PR review. `VPS_SSH_KNOWN_HOSTS` remains required before Step 8. Do not change the workflow's Node 22 pin in this authorization.

### Corrected local contract invocation — parent evidence (2026-10-05)
- Approved Node/npm preflight passed: `v22.22.3` / `10.9.8`.
- `bash -n scripts/tests/test-pawtech-m1-rehearsal-contract.sh` and `bash scripts/tests/test-pawtech-m1-rehearsal-contract.sh` both passed. No contract source change.
- `scripts/tests/test-pawtech-production-deploy-contract.sh` passed. The initial direct execution of non-executable step4 contract returned permission denied before execution; its declared `#!/bin/sh` interpreter was then used: `sh scripts/tests/test-pawtech-step4-contract.sh` passed. `sh scripts/tests/test-pawtech-step5-workflow-contract.sh` and `sh scripts/tests/test-bootstrap-migrator-config.sh` passed. Thus all named static contracts passed; no integration/migration/Docker command was run.
- Frontend `npm run lint` passed with 0 errors and 1 warning at `frontend/src/app/app/page.tsx:83` (`window.location.href`). `npm run test:coverage` passed 49 files / 414 tests; statements 81.26%, branches 74.46%, functions 86.49%, lines 83.52%. `./node_modules/.bin/tsc --noEmit` passed; `npm run build` passed; final `git diff --check` passed.
- Precommit `git fetch origin` ran exactly once. Branch `fix/pawtech-production-deploy` remained at `73c253936c096b38654382ef7d6307c911d59d79`, equal to `origin/fix/pawtech-production-deploy`; PR #7 remains open, targets `main`, and points to this branch/SHA. `origin/main` remains the previously recorded `a1e008c392c76b6d586a1b1e9cf10ef0df56b7f0` (zero new commits). Node/npm were independently confirmed before/after fetch as `v22.22.3`/`10.9.8`.
- Before staging, cached diff was empty. Modified paths were exactly the three authorized files plus the pre-existing `.atl/skill-registry.md`; no production source/dependency changes or unexpected paths. The final `git diff --check` returned 0.
- Staged and reviewed exactly `frontend/playwright.config.ts`, `frontend/src/services/__tests__/env.test.ts`, and this ODD task file; staged `git diff --check` passed. `.atl/skill-registry.md` stayed unstaged.
- Commit `8f23a14d44689cda67091153c107c15a540284ac` (`test: isolate E2E Gemini provider configuration`) was created with the staged GGA pre-commit review `STATUS: PASSED`. Parent is `73c253936c096b38654382ef7d6307c911d59d79`; committed paths are exactly the three intended files.
- The post-commit ODD evidence update is local/uncommitted to avoid a second commit. The sole unrelated `.atl/skill-registry.md` diff remains preserved.

### Triggered CI after Gemini isolation commit — STOP (2026-10-05)
- Pushed exactly once: commit `8f23a14d44689cda67091153c107c15a540284ac` to `fix/pawtech-production-deploy` / PR #7. Exact triggered workflow run `37369506685`: https://github.com/yabreu65/cocinacore/actions/runs/37369506685; head SHA matches the commit.
- Overall run failed. `frontend-quality` succeeded, including bootstrap integration, canonical integration, lint, coverage, typecheck and build.
- `E2E Tests` was cancelled. No full Playwright totals or `meal-planner-connected` / `recipe-connected` CI spec results are available; do not infer PASS.
- Stop after this run: no manual rerun, correction, push, merge, or Step 8. `CI_READY_FOR_FINAL_PR_REVIEW=NO`; `STEP7_COMPLETE=NO` pending PM final PR review. GitHub workflow Node 22 resolved to 22.23.3; PM will disposition, and this authorization did not allow changing the workflow pin.
- Production accessed/modified/deployed: NO. Merge: NO. The post-commit task-record result is local/uncommitted; `.atl/skill-registry.md` remains excluded.

### Final CI toolchain alignment — new PM authorization (2026-10-05)
PM diagnosis for run `37369506685`: E2E Tests was cancelled before execution (`conclusion=cancelled`, `steps=null`, no job log, no tests); no newer CI run displaced it, and `ci.yml` has no cancellation concurrency or timeout rule. Therefore `E2E_CODE_FAILURE=NO_EVIDENCE`, `APPLICATION_DEFECT=NO_EVIDENCE`, `TEST_FAILURE=NO_EVIDENCE`. Do not change application code or manually rerun that cancelled run.

Authorized Strict-TDD scope: only `.github/workflows/ci.yml`, `scripts/tests/test-pawtech-step5-workflow-contract.sh`, and this ODD record. Extend the existing static contract to require that every `node-version` entry in CI equals exactly `22.22.3`; it must fail on the current floating E2E `22` and must prove there are no other values, not merely at least one pinned version. Observe RED before changing only the E2E Setup Node value from `22` to `22.22.3`. No service/topology/job/dependency/retry/timeout/concurrency/application changes.

Then run user-listed local gates with Node `v22.22.3`/npm `10.9.8`: Step5, production-deploy, Step4, bootstrap contracts via `sh`; Bash rehearsal contract via `bash -n` and `bash`; frontend lint/coverage/direct tsc/build; `git diff --check`. No npx, no E2E rerun. Stop on any failure.

If all local gates pass, fresh-fetch/scope audit, stage only the workflow, Step5 contract and ODD task record; exclude `.atl`; review diff; one commit `ci: pin E2E Node to M1 toolchain`, one push to existing PR #7, observe only the new SHA's CI run. Any check failure/cancellation stops without correction/rerun. Even all green means `STEP7_COMPLETE=NO` pending PM final PR review; `CI_READY_FOR_FINAL_PR_REVIEW=YES` only if the new full CI run is green. Do not alter Node other than the E2E pin; no production/merge/Step8. `VPS_SSH_KNOWN_HOSTS` remains a separate Step 8 prerequisite.

### Final CI toolchain alignment — writer evidence (2026-10-05)
- PM diagnosis: run `37369506685` had E2E cancelled before execution (`conclusion=cancelled`, `steps=null`, no job log or tests); there is no evidence of E2E code, application, or test failure. No manual rerun was requested or performed.
- Strict-TDD RED: after extending only `scripts/tests/test-pawtech-step5-workflow-contract.sh`, `sh scripts/tests/test-pawtech-step5-workflow-contract.sh` exited 1 with exactly `pawtech Step 5 workflow contract failure: every CI node-version must be pinned to 22.22.3`. The offending E2E `node-version: 22` was the mismatch; no different contract failure occurred.
- Strict-TDD GREEN: after changing only the E2E Setup Node value to `node-version: 22.22.3`, the same command exited 0 and printed exactly `pawtech Step 5 workflow contract passed`.
- The contract collects every `node-version:` entry, requires at least one, and rejects any entry not exactly unquoted `22.22.3`; it therefore rejects floating/different values even if another entry is correctly pinned.
- Intended remaining local validation before delivery: `sh scripts/tests/test-pawtech-step5-workflow-contract.sh`, `sh scripts/tests/test-pawtech-production-deploy-contract.sh`, `sh scripts/tests/test-pawtech-step4-contract.sh`, `sh scripts/tests/test-bootstrap-migrator-config.sh`, `bash -n scripts/tests/test-pawtech-m1-rehearsal-contract.sh`, `bash scripts/tests/test-pawtech-m1-rehearsal-contract.sh`, frontend lint/coverage/direct tsc/build, and `git diff --check`, under Node `v22.22.3`/npm `10.9.8`. These broader gates were not run in this writer task.
- Intended delivery hold: only if all authorized local gates pass, fresh-fetch/scope audit, stage exactly the three authorized paths (excluding `.atl/skill-registry.md`), review, make one `ci: pin E2E Node to M1 toolchain` commit, push once to the existing PR #7, and observe only the new SHA's CI run. No stage, commit, push, CI run, merge, production, Step 8, or rerun of `37369506685` occurred here; PM final PR review remains required.

### Toolchain pin local gates — parent evidence (2026-10-05)
- Approved toolchain passed: Node `v22.22.3`, npm `10.9.8`; no `npx` or installation.
- All listed static contracts passed: Step5, production deploy, Step4, bootstrap via `sh`; rehearsal syntax and contract via `bash -n` / `bash`. No E2E rerun.
- Frontend gates passed: lint 0 errors, 1 existing warning (`frontend/src/app/app/page.tsx:83`, `window.location.href`); coverage 49 files / 414 tests (81.26% statements, 74.46% branches, 86.49% functions, 83.52% lines); direct `./node_modules/.bin/tsc --noEmit`; build; `git diff --check`. Vite emitted a non-blocking config-loader warning.

### Toolchain pin precommit audit — parent evidence (2026-10-05)
- Read-only precommit audits fetched `origin`; the latest fetch ran after the final ODD evidence update. Branch `fix/pawtech-production-deploy`, HEAD and remote branch remain `8f23a14d44689cda67091153c107c15a540284ac`; PR #7 is open with this head branch/SHA and base `main`. `origin/main` remains `a1e008c392c76b6d586a1b1e9cf10ef0df56b7f0`.
- No staged or untracked paths. Modified files are exactly `.github/workflows/ci.yml`, `scripts/tests/test-pawtech-step5-workflow-contract.sh`, this ODD file, plus preserved `.atl/skill-registry.md`. Diff review confirmed the workflow only changes E2E `node-version: 22` to `22.22.3`; contract adds the all-entry exact-pin assertion; no app/dependency changes.
- Final `git diff --check` passed. Stage only the three allowed files, review staged diff, then commit/push once and observe the new exact-SHA CI run. `.atl/skill-registry.md` must remain excluded.