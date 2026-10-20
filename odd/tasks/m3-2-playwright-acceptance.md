# M3.2 U5/U6 Playwright acceptance runner

## Authorization

PM authorized a permanent local/production Playwright solution with progressive evidence to close M3.2 U5/U6. Work starts on a new branch from `origin/main`; existing dirty worktrees and local changes remain untouched.

The previously revealed production password is not reusable. Production testing requires owner-approved rotation and secure secret-manager/session injection. No password, cookie, token, or account identifier may be printed, stored in repository files, passed through command arguments, or written to logs/tmux/GitHub.

## Phase gates

- [x] **P1 — Audit: PASS.** Existing config/fixture findings are recorded below; no production execution was performed.
- [x] **P2 — Runner: PASS.** The isolated runner, validator, tests, documentation, and static contract passed focused verification. The validator returns only `baseURL` while retaining exact mode, URL, signup, and auth-presence validation.
- [ ] **P3 — Auth: NOT STARTED.** Requires owner-approved rotation of the previously revealed password and secure secret-manager injection; no password from chat may be reused.
- [ ] **P4 — U5: NOT STARTED.** No production specs or writes are included in P2.
- [ ] **P5 — CI: NOT STARTED.** No workflow changes.
- [ ] **P6 — Verify: NOT STARTED.** No production execution.
- [ ] **U6 — Close: NOT STARTED.** No cleanup or worktree changes.

## Current work plan

- [x] Create clean branch/worktree from `origin/main`.
- [x] Audit P1 Playwright suite/config/security.
- [x] Verify P2 runner separation with focused unit, static contract, lint, typecheck, shell syntax, ShellCheck, and diff checks.
- [ ] Commit P1/P2 work unit and record its identity below.
- [ ] P3–P6, U6, and M3.3 are explicitly not started; do not begin until separately authorized.

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

Implementation and verification complete. The environment interface accepts arbitrary string keys with optional string values, preserving explicit known variables; the validator returns only `baseURL` while validating mode, exact URL, auth-variable presence, and signup mode without echoing values. Evidence: 22 focused Vitest tests passed; ESLint passed; `tsc --noEmit` passed; static contract, ShellCheck, `bash -n`, and `git diff --check` passed. `npm ci --ignore-scripts` installed local dependencies only and reported six high-severity npm audit advisories; no dependency changes were made. No production tests, production writes, credentials, or server access are part of P2.

## P1 audit evidence

PASS: `frontend/playwright.config.ts` uses loopback and starts local provider/app servers; `frontend/e2e/database-target.ts`, connected fixtures, and related setup include DB/Redis writes and signup/cleanup paths. The existing suite had no production URL mode, allowlist, fail-closed distinction, or expected user/tenant validation. P1 audit is complete; no production access was used.

## Commit evidence

Commit pending. P1/P2 implementation is ready for one work-unit commit; push/PR are not authorized. P3–P6, U6, and M3.3 remain not started.
