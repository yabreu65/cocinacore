# Tasks: Fase 1 — Seguridad Bloqueante

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | 650–850 |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR 1 (deps+config+boundaries) → PR 2 (middleware+validation+rate-limit) → PR 3 (API wiring+cleanup) |
| Delivery strategy | ask-always |
| Chain strategy | stacked-to-main |

Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: High

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|------|------|-----------|-------|
| 1 | Dependencies, .env.example, security headers, error boundaries | PR 1 | Base branch: main. Self-contained, no behavior change. ~150 lines |
| 2 | Auth middleware, Zod schemas, rate limiter lib | PR 2 | Base branch: main (stacked). Core security layer. ~350 lines |
| 3 | Wire validation+rate-limit into 5 API routes, delete dev routes | PR 3 | Base branch: PR 2 branch. Integration + cleanup. ~200 lines |

## Phase 1: Foundation / Dependencies & Config

- [ ] 1.1 Install `zod` and `@supabase/ssr` as direct dependencies (`npm i zod @supabase/ssr`)
- [ ] 1.2 Create `frontend/.env.example` documenting all required env vars (SUPABASE_URL, SUPABASE_ANON_KEY, GEMINI_API_KEY, AI_API_KEY, REDIS_URL, etc.) with descriptions and placeholder values
- [ ] 1.3 Modify `frontend/next.config.ts` to add 6 security headers (X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy, HSTS, CSP) via `headers()` config
- [ ] 1.4 Modify `frontend/next.config.ts` to add compile-time dev route exclusion via conditional `pageExtensions` when `NODE_ENV=production`

## Phase 2: Core Security Layer

- [ ] 2.1 Create `frontend/src/lib/validation.ts` with Zod schemas for recipe-generate, meal-plan, embeddings, inventory-suggestion, meal-plan/warmup and a generic `validateRequest<T>()` helper
- [ ] 2.2 Create `frontend/src/lib/rate-limit.ts` with ioredis sliding window implementation, in-memory Map fallback, and `RateLimitResult` interface
- [ ] 2.3 Create `frontend/middleware.ts` with Supabase SSR auth, protected route prefixes matcher, public route whitelist, redirect to `/login?next=...` for unauthenticated, 401 JSON for API routes
- [ ] 2.4 Create unit tests for Zod schemas (`frontend/src/lib/validation.test.ts`) — valid/invalid payloads per schema
- [ ] 2.5 Create unit tests for rate limiter (`frontend/src/lib/rate-limit.test.ts`) — ioredis mock, sliding window, fallback behavior

## Phase 3: API Wiring & Integration

- [ ] 3.1 Modify `frontend/src/app/api/recipe-generate/route.ts` — add Zod validation before body parsing, add rate limit check (10 req/60s), remove manual `as Body` casting
- [ ] 3.2 Modify `frontend/src/app/api/meal-plan/route.ts` — add Zod validation, add rate limit check (5 req/60s), remove manual `as Body` casting
- [ ] 3.3 Modify `frontend/src/app/api/meal-plan/warmup/route.ts` — add Zod validation for calendar/targetDays arrays, add rate limit check (3 req/60s)
- [ ] 3.4 Modify `frontend/src/app/api/meal-plan/inventory-suggestion/route.ts` — add Zod validation for menuContent/peopleCount, add rate limit check (8 req/60s)
- [ ] 3.5 Modify `frontend/src/app/api/embeddings/route.ts` — replace in-memory rate limit with ioredis rate limiter, add Zod validation for texts array
- [ ] 3.6 Delete `frontend/src/app/api/dev/ai-config/route.ts` and `frontend/src/app/api/dev/openrouter-test/route.ts` (compile-time exclusion handles prod, but remove from dev graph too)

## Phase 4: Error Boundaries & UX

- [ ] 4.1 Create `frontend/src/app/error.tsx` — global error boundary, branded UI with Tailwind, no stack trace in production, "Try again" button with `router.refresh()`
- [ ] 4.2 Create `frontend/src/app/not-found.tsx` — branded 404 page with navigation back to `/app`
- [ ] 4.3 Create `frontend/src/app/loading.tsx` — global loading skeleton/spinner consistent with existing design system

## Phase 5: Verification

- [ ] 5.1 Run `npm run build` — verify build passes with dev routes excluded in production mode
- [ ] 5.2 Run `npm run test` — verify existing 75 unit tests still pass + new validation/rate-limit tests pass
- [ ] 5.3 Verify `curl -I /app` returns all 6 security headers
- [ ] 5.4 Verify `NODE_ENV=production next build` does not include `/api/dev/*` routes (check `.next/server/app/` output)

## Dependency Graph

```
1.1 (deps) ──┐
1.2 (env)    ├──▶ 2.1 (validation) ──┐
1.3 (headers)┘                       │
1.4 (dev isol)                       │
                                     ├──▶ 3.1-3.5 (API wiring)
2.2 (rate-limit) ────────────────────┤
                                     │
2.3 (middleware) ────────────────────┘

4.1-4.3 (boundaries) ── independent (no deps)

5.1-5.4 (verification) ── depends on ALL above
```

## Acceptance Criteria per Work Unit

### PR 1: Foundation
- [ ] `zod` and `@supabase/ssr` in `package.json` dependencies
- [ ] `.env.example` exists with all vars documented
- [ ] `next.config.ts` has all 6 security headers configured
- [ ] `next.config.ts` has conditional `pageExtensions` for dev route exclusion
- [ ] `error.tsx`, `not-found.tsx`, `loading.tsx` exist at app root
- [ ] Build passes, existing tests pass

### PR 2: Core Security Layer
- [ ] `middleware.ts` redirects unauthenticated from `/app/*` to `/login`
- [ ] `middleware.ts` returns 401 JSON for unauthenticated API requests
- [ ] `validation.ts` exports all 5 Zod schemas + `validateRequest<T>()`
- [ ] `rate-limit.ts` uses ioredis with sliding window + Map fallback
- [ ] Unit tests for schemas and rate limiter pass

### PR 3: API Wiring + Cleanup
- [ ] All 5 API routes reject invalid bodies with 400 + structured error
- [ ] All 5 AI routes return 429 with Retry-After when rate limited
- [ ] Dev routes return 404 in production build
- [ ] No `as Body` casting remains in API routes
- [ ] Build passes, all tests pass (75 existing + new)
