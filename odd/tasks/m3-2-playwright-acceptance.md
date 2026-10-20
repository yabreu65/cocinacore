# M3.2 U5/U6 Playwright acceptance runner

## Authorization

PM authorized a permanent local/production Playwright solution with progressive evidence to close M3.2 U5/U6. Work starts on a new branch from `origin/main`; existing dirty worktrees and local changes remain untouched.

The previously revealed production password is not reusable. Production testing requires owner-approved rotation and secure secret-manager/session injection. No password, cookie, token, or account identifier may be printed, stored in repository files, passed through command arguments, or written to logs/tmux/GitHub.

## Phase gates

- [x] **P1 — Audit: PASS.** Existing config/fixture findings are recorded below; no production execution was performed.
- [x] **P2 — Runner: PASS.** The isolated runner, validator, tests, documentation, and static contract passed focused verification. The validator returns only `baseURL` while retaining exact mode, URL, signup, and auth-presence validation.
- [x] **P3 — Auth implementation: PASS; live production gate: BLOCKED.** Runtime-only credential injection, login/session verification, and exact user/tenant checks passed local verification. The real `/api/auth/session` path was traced and confirmed compatible: tenant-backed sessions expose `user.id` and `user.tenant.tenantId`; unauthenticated or tenantless sessions are rejected. Live U5 remains blocked until rotated credentials are injected through an owner-approved mechanism; no password from chat may be reused.
- [x] **P4 — U5 specs: PASS (not executed).** Added bounded read-only and explicitly gated synthetic lifecycle specs; no production execution or U5 PASS is claimed. Synthetic cleanup is archive-only because no DELETE route exists; residual cleanup remains pending the U6/product decision.
- [x] **P5 — CI workflow: PASS (not executed).** Added a protected, manual-only workflow and static workflow contract; the job requires the exact audited branch and confirmation token before protected secrets can be used. Native review approved and acknowledged the correction; the workflow has not been run.
- [x] **P6 — Local verification: PASS; production execution: BLOCKED.** Focused tests, lint, typecheck, contracts, shell checks, YAML parsing, diff-check, and fail-closed Playwright listing passed locally. No production execution occurred.
- [ ] **U6 — Close: NOT STARTED.** No U6 closure or production cleanup is claimed.

## Current work plan

- [x] Create clean branch/worktree from `origin/main`.
- [x] Audit P1 Playwright suite/config/security.
- [x] Verify P2 runner separation with focused unit, static contract, lint, typecheck, shell syntax, ShellCheck, and diff checks.
- [x] Commit P1/P2 work unit and record its identity below.
- [x] P3 implementation and local verification complete; live production auth remains blocked on rotated approved secrets.
- [x] P4/P5 implementation and P6 local verification complete; the manual workflow and production specs were not run. The native trusted-ref correction was approved and acknowledged.
- [ ] P4 live U5, U6, and M3.3 remain pending; production execution requires rotated approved secrets and a separate explicit run decision.
- [x] Branch published to `origin/feat/m3-2-playwright-acceptance`; PR creation is blocked by the mandatory issue-first rule because no semantically suitable `status:approved` issue exists. Do not link unrelated issues.
- [x] GitHub environment `production-acceptance` created without secrets. Exact branch policy restricts it to `feat/m3-2-playwright-acceptance`. Required reviewers could not be configured: the plan/API did not support `wait_timer`, and GitHub rejected `prevent_self_review` without at least one reviewer; only the authenticated actor was available. No production or staging secrets were touched.

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

Implementation and local verification complete. Added an explicit runtime auth-environment reader while preserving the baseURL-only validator; added a production-only login/session identity helper with mocked deterministic tests, a static isolation contract, and runtime secret-injection guidance. Evidence: 34 focused Vitest tests passed; ESLint passed with `--max-warnings=0`; `tsc --noEmit`, both static contracts, and `git diff --check` passed. Vitest emitted a non-failing Vite config-loader warning. The production auth gate remains BLOCKED until rotated credentials are injected through an approved mechanism. No live U5 result is claimed. No production access or credential use occurred.

## P4/P5 implementation status

P4 uses only the public application API through Playwright `request` and the P3 auth helper. The synthetic suite requires exact `E2E_PRODUCTION_SYNTHETIC_WRITES=approved`, authenticates and verifies expected identity first, scopes all operations to one observed synthetic recipe ID, and archives it in `finally`. There is no DELETE endpoint, so cleanup is intentionally archive-only and U6/product policy must decide any residual data handling.

P5 is a manual `workflow_dispatch` only workflow with protected environment `production-acceptance`, contents-read permission, concurrency lock, required confirmation, secret-only runtime injection, signup disabled, and synthetic writes disabled unless the boolean input is explicitly enabled. Following native review R1-001, the job-level gate now also requires `github.ref` to equal `refs/heads/feat/m3-2-playwright-acceptance`; the bounded correction passed local checks and native review. It does not deploy, migrate, backup, SSH, upload artifacts, or trigger automatically.

P6 evidence: 34 focused Vitest tests passed; ESLint with `--max-warnings=0` passed; TypeScript passed; runner/auth/workflow contracts passed; ShellCheck and `bash -n` passed; workflow YAML parsed; production config listing without mode exited 1 before collection with the fail-closed mode error; `git diff --check` passed. No production command, workflow, browser, login, signup, DB/Redis, or credential access occurred.

## P1 audit evidence

PASS: `frontend/playwright.config.ts` uses loopback and starts local provider/app servers; `frontend/e2e/database-target.ts`, connected fixtures, and related setup include DB/Redis writes and signup/cleanup paths. The existing suite had no production URL mode, allowlist, fail-closed distinction, or expected user/tenant validation. P1 audit is complete; no production access was used.

## Commit evidence

P1/P2 work-unit commit: `6b404272025a5959048e881ea1c3f205bacc49b9` (`feat(e2e): add fail-closed production runner`). P3 work-unit commit: `dec20477c63403f3df6faf37aafd208a2534f19f` (`feat(e2e): verify production test identity`). P4/P5 work-unit commit: `41da59eea8bd7e1181b8571f1c25a000e9f4091f` (`feat(e2e): add gated U5 production acceptance`). Contract alignment commit: `e5f8b310831c5a9b65d7a91a63d30b2e3cb1e046` (`test(e2e): align auth contract with production specs`). Trusted-ref correction commit: `b007af10c592a94b6b5f64d67133b385541bab98` (`fix(ci): restrict production acceptance to trusted branch`), natively reviewed and acknowledged. Environment/PR readiness record is documentation-only and remains to be committed/published. No merge/deploy. Live U5, U6, and M3.3 remain pending.
