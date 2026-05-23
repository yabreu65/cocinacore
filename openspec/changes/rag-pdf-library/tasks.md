# Tasks: RAG PDF Library

## Review Workload Forecast
| Field | Value |
|-------|-------|
| Estimated changed lines | 800-1200 |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | DB/RLS -> typed RAG contracts -> upload/retrieval UI/tests |
| Delivery strategy | chained PRs |
| Chain strategy | stacked-to-main |

Decision needed before apply: Resolved (stacked-to-main)
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: High

### Suggested Work Units
| Unit | Goal | Likely PR | Notes |
|------|------|-----------|-------|
| 1 | PDF schema, limits, RLS | PR 1 | Security proof first. |
| 2 | Typed RAG services | PR 2 | Depends on PR 1. |
| 3 | Upload/search UX and tests | PR 3 | Uses typed contracts. |

## Phase 1: Database
- [x] 1.1 Create `supabase/migrations/*_rag_pdf_library.sql` for PDF metadata, limits, and source checks.
- [x] 1.2 Update `match_chunks` and RLS tests for global + current tenant only.

## Phase 2: Services
- [x] 2.1 Update `frontend/src/services/types.ts` with citation and source DTOs.
- [x] 2.2 Refactor `frontend/src/services/supabaseAdapter.ts` to typed RPC rows and inserts.
- [x] 2.3 Update `frontend/src/services/ragEngine.ts` to return citations.

## Phase 3: Integration
- [x] 3.1 Add server-only embedding/generation API boundary before PDF ingestion.
- [x] 3.2 Add upload-limit checks before storing PDFs.

## Phase 4: Verification
- [x] 4.1 Test Home/Professional limits and cross-tenant retrieval denial.
- [x] 4.2 Run lint, typecheck, and build.
