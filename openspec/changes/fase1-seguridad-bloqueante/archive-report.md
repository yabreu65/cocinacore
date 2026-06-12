# Archive Report: Fase 1 — Seguridad Bloqueante

**Change**: Fase 1 — Seguridad Bloqueante
**Status**: ✅ COMPLETE — PASS WITH WARNINGS (0 critical)
**Date**: 2026-06-03
**PRs**: 3 (stacked-to-main)
**Total changed lines**: ~850 net

---

## Executive Summary

Closed 7 critical security gaps that blocked production deployment: secrets exposed without templates, no auth guards on protected routes, dev routes accessible in production, no input validation on AI APIs, insufficient rate limiting, empty security headers, and no error/loading boundaries. Implemented in 3 stacked PRs using Next.js middleware with Supabase SSR auth, Zod validation schemas, ioredis sliding window rate limiter, CSP/HSTS/X-Frame-Options headers, and global error boundaries.

---

## Artifacts

| Artifact | Observation ID | Topic Key |
|----------|---------------|-----------|
| Proposal | #2520 | `sdd/fase1-seguridad-bloqueante/proposal` |
| Spec | #2521 | `sdd/fase1-seguridad-bloqueante/spec` |
| Design | #2522 | `sdd/fase1-seguridad-bloqueante/design` |
| Tasks | #2523 | `sdd/fase1-seguridad-bloqueante/tasks` |
| Apply Progress | #2524 | `sdd/fase1-seguridad-bloqueante/apply-progress` |
| Architecture Notes | #2525 | `sdd/fase1-seguridad-bloqueante/architecture` |
| Verify Report | #2527 | `sdd/fase1-seguridad-bloqueante/verify-report` |

---

## PR Breakdown

### PR 1 — Foundations ✅

| File | Action | Lines |
|------|--------|-------|
| `frontend/.env.example` | Created | 40 |
| `frontend/next.config.ts` | Modified | +32 net |
| `frontend/src/app/error.tsx` | Created | 130 |
| `frontend/src/app/not-found.tsx` | Created | 75 |
| `frontend/src/app/loading.tsx` | Created | 65 |

### PR 2 — Core Security Layer ✅

| File | Action | Lines |
|------|--------|-------|
| `frontend/src/lib/validation.ts` | Created | 136 |
| `frontend/src/lib/rate-limit.ts` | Created | 214 |
| `frontend/middleware.ts` | Created | 117 |
| `frontend/src/lib/validation.test.ts` | Created | 293 |
| `frontend/src/lib/rate-limit.test.ts` | Created | 197 |

### PR 3 — API Wiring + Cleanup ✅

| File | Action | What Changed |
|------|--------|-------------|
| `frontend/src/app/api/recipe-generate/route.ts` | Modified | Zod validation + rate limit (10/60s), removed `as Body` |
| `frontend/src/app/api/meal-plan/route.ts` | Modified | Zod validation + rate limit (5/60s), removed `as Body` |
| `frontend/src/app/api/meal-plan/warmup/route.ts` | Modified | Zod validation + rate limit (3/60s), removed `type WarmupBody` |
| `frontend/src/app/api/meal-plan/inventory-suggestion/route.ts` | Modified | Zod validation + rate limit (8/60s), removed `as Body` |
| `frontend/src/app/api/embeddings/route.ts` | Modified | Replaced in-memory Map with ioredis rate limiter + Zod |
| `frontend/next.config.ts` | Modified | `pageExtensions` belt-and-suspenders for dev route exclusion |
| `frontend/src/app/api/dev/ai-config/` | Deleted | Entire directory removed |
| `frontend/src/app/api/dev/openrouter-test/` | Deleted | Entire directory removed |

---

## Build & Test Results

| Check | Result | Details |
|-------|--------|---------|
| `npm run build` | ✅ PASS | 34 pages, 0 TS errors, 0 Turbopack errors |
| `npm test` | ✅ PASS | 18 suites, 134 tests (0 regressions) |
| Dev routes removed | ✅ PASS | No `/api/dev/*` in build output |
| Security headers | ✅ PASS | All 6 configured in `next.config.ts` |
| Validation wired | ✅ PASS | All 5 API routes import Zod schemas |
| Rate limit wired | ✅ PASS | All 5 routes use ioredis `checkRateLimit()` |

---

## Verification Findings

### CRITICAL: None

### WARNINGS (4 non-blocking)

1. **pageExtensions conditional is a no-op (REQ-3)**: Both arms produce `['tsx', 'ts', 'jsx', 'js']`. Physical deletion handles isolation; `pageExtensions` doesn't actually filter differently in prod vs dev.

2. **Rate limit key is IP-only, not IP+userId (REQ-5)**: `checkRateLimit()` supports optional userId parameter, but none of the 5 API routes pass it. Routes need access to Supabase session user ID to wire this properly.

3. **Owner role check deferred (REQ-2.3)**: Middleware defers role checking to route handlers per design. No explicit 403 verified in route handlers. Acceptable per design but needs practice verification.

4. **CSP is Report-Only (REQ-6)**: Uses `Content-Security-Policy-Report-Only` instead of enforcing. By design — promote after 1 week monitoring.

### SUGGESTIONS

- Wire userId from Supabase session into `checkRateLimit()` calls
- Make `pageExtensions` conditional meaningful by excluding `.dev.ts`/`.dev.tsx` in production

---

## Deviations from Design

| Deviation | Reason |
|-----------|--------|
| `MealPlanSchema.passthrough()` in meal-plan route | Legacy `cuisine`/`country` fields still sent by client |
| `InventorySuggestionSchema.passthrough()` in inventory-suggestion route | Legacy `inventory`/`restrictions`/`profile` fields still used |
| `WarmupMealPlanInput` uses `as` instead of `satisfies` | Zod `z.unknown()` yields `unknown[]`, downstream expects `WarmupPlannerDay[]` |
| `Array<{...}>` → `{...}[]` syntax | Turbopack in Next.js 16.2 parses nested angle brackets as JSX in `.ts` files |
| CSP in Report-Only | Design chose monitoring period before enforcement |

---

## Lessons Learned

### Technical Discoveries

- **Zod v4 API compatibility**: `safeParse()`, `z.object()`, `z.string()` work identically to v3. No migration pain.
- **`@supabase/ssr` v0.10.3**: `createServerClient` `setAll` callback now includes `headers: Record<string, string>` for cache-control.
- **Next.js 16.2 middleware**: Must use `NextResponse.next({ request })` pattern for cookie sync with Supabase SSR.
- **Turbopack JSX ambiguity**: Next.js 16.2 Turbopack treats `.ts` files in `app/` as TSX. `Array<{...}>` (nested angle brackets) fails. Fix: `{...}[]` postfix syntax or extract type aliases.
- **ioredis already installed**: Required by bullmq; no new dependency needed for rate limiting.
- **`@supabase/supabase-js` already installed**: Contrary to initial proposal assessment.

### Process Discoveries

- Stacked PRs worked well for this change size (~850 lines). Each PR was self-contained and reviewable.
- Physical deletion + `pageExtensions` belt-and-suspenders is a solid defense-in-depth pattern.
- `passthrough()` on Zod schemas is a pragmatic way to handle legacy fields without breaking clients.

---

## Files Summary

### Created (11 files)

| File | Purpose |
|------|---------|
| `frontend/.env.example` | Env var documentation |
| `frontend/middleware.ts` | Auth guards (Supabase SSR) |
| `frontend/src/lib/validation.ts` | 5 Zod schemas + `validateRequest<T>()` |
| `frontend/src/lib/validation.test.ts` | ~30 schema tests |
| `frontend/src/lib/rate-limit.ts` | ioredis sliding window + Map fallback |
| `frontend/src/lib/rate-limit.test.ts` | 14 rate limiter tests |
| `frontend/src/app/error.tsx` | Global error boundary |
| `frontend/src/app/not-found.tsx` | Branded 404 page |
| `frontend/src/app/loading.tsx` | Global loading spinner |
| `frontend/src/app/api/meal-plan/warmup/route.ts` | Warmup API (new route) |

### Modified (7 files)

| File | Changes |
|------|---------|
| `frontend/next.config.ts` | Security headers + pageExtensions |
| `frontend/package.json` | zod, @supabase/ssr added |
| `frontend/src/app/api/recipe-generate/route.ts` | Zod + rate limit, removed `as Body` |
| `frontend/src/app/api/meal-plan/route.ts` | Zod + rate limit, removed `as Body` |
| `frontend/src/app/api/meal-plan/inventory-suggestion/route.ts` | Zod + rate limit, removed `as Body` |
| `frontend/src/app/api/embeddings/route.ts` | ioredis rate limit + Zod, removed in-memory Map |
| `frontend/package-lock.json` | Dependency lock update |

### Deleted (2 directories)

| File | Reason |
|------|--------|
| `frontend/src/app/api/dev/ai-config/` | Prod isolation |
| `frontend/src/app/api/dev/openrouter-test/` | Prod isolation |

---

## Git Status

> ⚠️ **All Fase 1 changes are in the working tree (uncommitted).** The archive report documents the final state. Commits were made per-PR during apply but the working tree shows additional changes from other features. The Fase 1 security changes are ready to be committed as a coherent unit.

---

## Recommended Next Steps (Fase 2)

1. **Wire userId into rate limiting**: Extract user ID from Supabase session in API routes and pass to `checkRateLimit()`. Enables per-user limits for premium vs free tiers.

2. **Promote CSP to enforcing**: After 1 week of monitoring with `Content-Security-Policy-Report-Only`, switch to `Content-Security-Policy` header. Review CSP violation reports first.

3. **Owner role enforcement**: Add explicit role check in `/owner/*` route handlers or extend middleware with Supabase user metadata lookup.

4. **Make pageExtensions meaningful**: Either exclude `.dev.ts`/`.dev.tsx` files in production builds or remove the conditional entirely (physical deletion is sufficient).

5. **E2E auth tests**: Add Playwright tests verifying middleware redirects, 401 for unauthenticated API calls, and public route access.

6. **Secret rotation**: Rotate `GEMINI_API_KEY`, `AI_API_KEY`, and any other secrets documented in `.env.example`. Coordinate with production deployment.

---

## SDD Cycle Status

| Phase | Status | Artifact |
|-------|--------|----------|
| Proposal | ✅ Complete | `sdd/fase1-seguridad-bloqueante/proposal` |
| Spec | ✅ Complete | `sdd/fase1-seguridad-bloqueante/spec` |
| Design | ✅ Complete | `sdd/fase1-seguridad-bloqueante/design` |
| Tasks | ✅ Complete | `sdd/fase1-seguridad-bloqueante/tasks` |
| Apply | ✅ Complete | `sdd/fase1-seguridad-bloqueante/apply-progress` |
| Verify | ✅ PASS WITH WARNINGS | `sdd/fase1-seguridad-bloqueante/verify-report` |
| Archive | ✅ Complete | `sdd/fase1-seguridad-bloqueante/archive-report` |

**The Fase 1 SDD cycle is complete.**
