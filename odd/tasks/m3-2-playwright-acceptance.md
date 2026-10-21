# M3.2 U5/U6 Playwright acceptance runner

## Authorization

PM authorized a permanent local/production Playwright solution with progressive evidence to close M3.2 U5/U6. Work starts on a new branch from `origin/main`; existing dirty worktrees and local changes remain untouched.

The previously revealed production password is not reusable. Production testing requires owner-approved rotation and secure secret-manager/session injection. No password, cookie, token, or account identifier may be printed, stored in repository files, passed through command arguments, or written to logs/tmux/GitHub.

## Phase gates

- [x] **P1 — Audit: PASS.** Existing config/fixture findings are recorded below; no production execution was performed.
- [x] **P2 — Runner: PASS.** The isolated runner, validator, tests, documentation, and static contract passed focused verification. The validator returns only `baseURL` while retaining exact mode, URL, signup, and auth-presence validation.
- [x] **P3 — Auth implementation: PASS.** Runtime-only credential injection, login/session verification, and exact user/tenant checks passed local verification. U5 later passed in the authorized manual workflow; no credentials or identity values are recorded here.
- [x] **P4 — U5 specs: PASS; U5 run: PASS.** The manual workflow completed successfully. PM reports 2/2 tests PASS and explicitly approved synthetic writes. After archiving, the authenticated test reads the archived list and confirms the created recipe ID; final archive cleanup returns HTTP 200 (PM verification). Cleanup remains archive-only; no DELETE route exists.
- [x] **P5 — CI workflow: PASS; run: PASS.** The protected manual workflow completed successfully on `main` at the merged PR #41 commit. It remains manual-only and does not deploy.
- [x] **P6 — Local verification: PASS.** Focused tests, lint, typecheck, contracts, shell checks, YAML parsing, diff-check, and fail-closed Playwright listing passed locally.
- [x] **U6 — Close: CLOSED.** The authenticated archived-list readback and successful final archive cleanup provide the required API-level archive evidence; SQL verification is not required. The retention decision is archive-only; no deletion is authorized.

## Current work plan

- [x] Create clean branch/worktree from `origin/main`.
- [x] Audit P1 Playwright suite/config/security.
- [x] Verify P2 runner separation with focused unit, static contract, lint, typecheck, shell syntax, ShellCheck, and diff checks.
- [x] Commit P1/P2 work unit and record its identity below.
- [x] P3 implementation and local verification complete; live U5 later passed in the authorized workflow using the production environment. Credential values are not recorded.
- [x] P4/P5 implementation and P6 local verification complete; the authorized manual U5 workflow and production specs subsequently ran successfully. The trusted-ref correction was approved and acknowledged.
- [x] P4 live U5 completed successfully; U6 closed under the archive-only retention decision below.
- [x] M3.2 Playwright U5/U6 closeout is complete; M3.3 is a separate subsequent scope.
- [x] Branch was published to `origin/feat/m3-2-playwright-acceptance`; PR #41 was later created and merged as recorded in the U5/U6 closeout evidence.
- [x] GitHub environment `production-acceptance` was initially restricted to `feat/m3-2-playwright-acceptance`; after PR #41 its deployment branch policy is `main`, confirmed by the successful U5 run on `main`. Required reviewers could not be configured: the plan/API did not support `wait_timer`, and GitHub rejected `prevent_self_review` without at least one reviewer; only the authenticated actor was available.

## P1 findings

- Existing Playwright config hardcodes loopback and starts local provider/app servers.
- Connected fixtures can write PostgreSQL/Redis and include signup/cleanup paths; they are not production-safe.
- No production URL mode, allowlist, fail-closed environment distinction, or expected user/tenant validation exists.
- No serialized storage state is configured; session cookies are process-cached.

## P2 acceptance criteria

- A separate `frontend/playwright.production.config.ts` requires `E2E_RUN_MODE=production` exactly and validates all production configuration before tests.
- `E2E_PRODUCTION_URL` is restricted to the exact HTTPS origin `https://cocinacore.31-220-98-21.sslip.io`; only one optional trailing slash is normalized. Paths, query/hash, credentials, HTTP, other hosts, and other variants fail closed.
- Non-empty `E2E_PRODUCTION_USER_EMAIL`, `E2E_PRODUCTION_USER_PASSWORD`, `E2E_PRODUCTION_USER_ID`, and `E2E_PRODUCTION_TENANT_ID` are required, with safe errors that do not echo values; `E2E_ALLOW_SIGNUP=false` is exact. The validated result contains only the safe `baseURL`.
- Production config targets only `./e2e/production` and `*.production.spec.ts`; it has no local server/bootstrap, DB/Redis target, fixture setup, or storage state. It uses validated `baseURL`, one worker, no retries/parallelism, and trace/video off.
- Pure typed validation has focused fail-closed tests; README limits this directory to manual owner-authorized UI/API-only acceptance and requires expected user/tenant validation before synthetic writes.
- `test:e2e:production` is separate from unchanged `test:e2e`; a deterministic static contract checks gates, scope, isolation, and absence of signup in current production specs.

## P2 implementation status

Implementation and verification complete. The environment interface accepts arbitrary string keys with optional string values, preserving explicit known variables; the validator returns only `baseURL` while validating mode, exact URL, auth-variable presence, and signup mode without echoing values. Evidence: 22 focused Vitest tests passed; ESLint passed; `tsc --noEmit` passed; static contract, ShellCheck, `bash -n`, and `git diff --check` passed. Runtime fail-closed evidence: production config listing with mode unset and with `E2E_RUN_MODE=local` both exited 1 before collection with `E2E_RUN_MODE must be exactly production.` `npm ci --ignore-scripts` installed local dependencies only and reported six high-severity npm audit advisories; no dependency changes were made. No production tests, production writes, credentials, or server access are part of P2.

## P3 implementation status

Implementation and local verification complete. Added an explicit runtime auth-environment reader while preserving the baseURL-only validator; added a production-only login/session identity helper with mocked deterministic tests, a static isolation contract, and runtime secret-injection guidance. Evidence: 34 focused Vitest tests passed; ESLint passed with `--max-warnings=0`; `tsc --noEmit`, both static contracts, and `git diff --check` passed. Vitest emitted a non-failing Vite config-loader warning. **At the time this implementation record was written**, the production auth gate remained blocked pending approved credential injection and no live U5 result was claimed. The later authorized U5 outcome is documented in U5/U6 closeout evidence.

## P4/P5 implementation status

P4 uses only the public application API through Playwright `request` and the P3 auth helper. The synthetic suite requires exact `E2E_PRODUCTION_SYNTHETIC_WRITES=approved`, authenticates and verifies expected identity first, scopes all operations to one observed synthetic recipe ID, and archives it in `finally`. There is no DELETE endpoint, so cleanup is intentionally archive-only. U6 is now closed under the retention decision recorded in U5/U6 closeout evidence; no deletion is authorized.

P5 is a manual `workflow_dispatch` only workflow with protected environment `production-acceptance`, contents-read permission, concurrency lock, required confirmation, secret-only runtime injection, signup disabled, and synthetic writes disabled unless the boolean input is explicitly enabled. Following PR #41, the job-level gate requires `github.ref` to equal `refs/heads/main`; the environment deployment branch policy is also `main`. U5 run 39522319909 succeeded on main. The workflow does not deploy, migrate, back up, SSH, upload artifacts, or trigger automatically.

P6 local evidence: 34 focused Vitest tests passed; ESLint with `--max-warnings=0` passed; TypeScript passed; runner/auth/workflow contracts passed; ShellCheck and `bash -n` passed; workflow YAML parsed; production config listing without mode exited 1 before collection with the fail-closed mode error; `git diff --check` passed. This records local verification only; the later manual U5 workflow result and limited read-only database preflight are documented in U5/U6 closeout evidence.

## P1 audit evidence

PASS: `frontend/playwright.config.ts` uses loopback and starts local provider/app servers; `frontend/e2e/database-target.ts`, connected fixtures, and related setup include DB/Redis writes and signup/cleanup paths. The existing suite had no production URL mode, allowlist, fail-closed distinction, or expected user/tenant validation. P1 audit is complete; no production access was used.

## U5/U6 closeout evidence

- PR #41 merged at `01f45d3843a7c9a97f6965d7ac81cdad1387e01a`.
- Manual workflow run `39522319909` completed `success` on `main` at that SHA. The acceptance job succeeded; run started `2026-10-21T00:36:19Z`.
- PM reports 2/2 tests PASS and explicitly approved synthetic writes. The app-level test archives its created synthetic recipe in `finally`.
- **U6 API evidence:** PM verified the authenticated test's `GET /api/recipes?archived=archived` readback returned the created synthetic recipe ID after archiving; the final archive cleanup returned HTTP 200. No recipe ID or synthetic marker is recorded here. This API-level readback satisfies U6; SQL row verification is not required or claimed, and RLS was not bypassed.
- **U6 decision:** retain synthetic records archived; no deletion was authorized and no DELETE route exists.
- **M3.2 status:** U5 and U6 are closed with no remaining M3.2 Playwright acceptance tasks. M3.3 is a separate subsequent scope. No deployment is claimed.

## Commit evidence and final status

P1/P2 work-unit commit: `6b404272025a5959048e881ea1c3f205bacc49b9` (`feat(e2e): add fail-closed production runner`). P3 work-unit commit: `dec20477c63403f3df6faf37aafd208a2534f19f` (`feat(e2e): verify production test identity`). P4/P5 work-unit commit: `41da59eea8bd7e1181b8571f1c25a000e9f4091f` (`feat(e2e): add gated U5 production acceptance`). Contract alignment commit: `e5f8b310831c5a9b65d7a91a63d30b2e3cb1e046` (`test(e2e): align auth contract with production specs`). Trusted-ref correction commit: `b007af10c592a94b6b5f64d67133b385541bab98` (`fix(ci): restrict production acceptance to trusted branch`), natively reviewed and acknowledged. PR #41 is merged at `01f45d3843a7c9a97f6965d7ac81cdad1387e01a`; this is not a deployment claim.

**Final status:** M3.2 Playwright U5/U6 are closed; authenticated API evidence confirms the archived-list state and final archive cleanup. No SQL check was required. M3.3 is a separate subsequent scope.

**U6 documentation commit identity:** `beef5303863affa60f90e08addd06f4c9b6c2e89`
