# PR #22 Coverage/E2E Config Isolation

**Status:** Implementation, checks, independent review, and Guardian passed; commit created, push/CI pending.
**Branch:** `feat/m3-1-shopping-inventory-transfer-closeout-20261017`
**Current base commit:** `1a3e6a161e8488ae4fa1415a1993a6f3d50add39`

## Goal and safeguards

Prevent unit coverage from evaluating Playwright's E2E target validation when testing standalone-server fixture environment, while keeping all real E2E database/Redis/loopback/port validation mandatory. Do not inject dummy E2E URLs or credentials. Do not access habitual DB/Redis, `localhost:3000`, production, or protected files; do not edit `main`, merge, or deploy.

Redis cache error messages observed during coverage are emitted by intentional rejected-promise mocks in `recipe-cache.test.ts`; the cache catches them and tests its in-memory fallback. With `REDIS_URL` unset, the cache returns before constructing a Redis client. No real Redis connection was established.

## Tasks

1. [x] Confirm `env.test.ts` dynamically imports `playwright.config.ts`; compare with `origin/main` and trace the new top-level E2E target validation.
2. [x] Distinguish intentional Redis mock error logs from failed coverage assertions and real service access.
3. [x] Extract the standalone-server fixture environment into a pure testable helper; keep validated DB/Redis targets and mandatory port/target checks in Playwright config.
4. [x] Run `test:coverage`, the no-credentials Playwright fail-closed guard, lint, formatting, typecheck, and scoped diff-check without real services.
5. [ ] Independent review and standard Guardian passed; implementation committed as `03c5a8f52a5a314bb19904db74091fd502bf766f`; push and PR #22 CI verification pending.

## Allowed edit surfaces

- `frontend/e2e/standalone-server-env.ts`
- `frontend/playwright.config.ts`
- `frontend/src/services/__tests__/env.test.ts`

No application routes, migrations, database fixtures, or production behavior are in scope.

## Evidence

- CI failure: run `39041106714`, `npm run test:coverage`, two failures in `src/services/__tests__/env.test.ts` caused by its dynamic import of `../../../playwright.config`, which calls `applyValidatedTargetsToRunner(process.env)` at module load.
- Local pre-fix reproduction without E2E/DB/Redis variables: the same two failures; the Redis `Connection refused` logs came from mocked ioredis rejections caught by the memory-fallback path, not from a real service connection.
- `env.test.ts` is unchanged vs `origin/main` (`ffd8afa`); the top-level E2E validation was added to `playwright.config.ts` on this branch.
- Post-fix `npm run test:coverage`: 69 files passed, 3 skipped; 631 tests passed, 8 skipped. Coverage: statements 77.34%, branches 71.34%, functions 77.77%, lines 79.72%.
- Playwright `--list` with E2E URLs unset failed closed on required `E2E_DATABASE_URL` before listing/starting servers. ESLint, Prettier, TypeScript, and scoped diff-check passed.
- Implementation commit: `03c5a8f52a5a314bb19904db74091fd502bf766f` (`test(e2e): decouple coverage from playwright config`).
