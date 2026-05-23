# Tasks: Engineering Standards

## Review Workload Forecast
| Field | Value |
|-------|-------|
| Estimated changed lines | 350-550 |
| 400-line budget risk | Medium |
| Chained PRs recommended | Yes |
| Suggested split | Lint/no-any cleanup -> test/RLS scaffolding |
| Delivery strategy | chained PRs confirmed |
| Chain strategy | stacked-to-main |

Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: Medium

### Suggested Work Units
| Unit | Goal | Likely PR | Notes |
|------|------|-----------|-------|
| 1 | Enforce and fix no-any | PR 1 | Must make lint pass. |
| 2 | Add tests/docs gates | PR 2 | Depends on chosen runner. |

## Phase 1: Static Safety
- [x] 1.1 Update `frontend/eslint.config.mjs` to error on explicit and unsafe `any` rules.
- [x] 1.2 Replace `any` in `frontend/src/services/types.ts`, `gemini.ts`, and `supabaseAdapter.ts` with safe types.

## Phase 2: Boundaries
- [x] 2.1 Add typed env validation for server-only AI/Supabase secrets.
- [x] 2.2 Define typed API/RPC response DTOs for external data.

## Phase 3: Test Gates
- [x] 3.1 Add minimal unit test runner and mapper/env validation tests.
- [x] 3.2 Add `supabase/tests/` RLS fixtures for tenant allow/deny cases.

## Phase 4: Documentation
- [x] 4.1 Update `README.md` with lint/typecheck/build/test/RLS gates.
- [x] 4.2 Run `npm run lint`, `npx tsc --noEmit`, and `npm run build`.
