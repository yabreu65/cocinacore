# Apply Progress — rag-pdf-library (Slice 3+4 / Phase 3 Integration + Phase 4 Verification)

## Scope Executed
- Delivery mode: chained PRs
- Chain strategy: stacked-to-main
- Implemented slices: Phase 3 tasks 3.1, 3.2 and Phase 4 tasks 4.1, 4.2 only

## Completed Tasks
- [x] 1.1 Create `supabase/migrations/*_rag_pdf_library.sql` for PDF metadata, limits, and source checks.
- [x] 1.2 Update `match_chunks` and RLS tests for global + current tenant only.
- [x] 2.1 Update `frontend/src/services/types.ts` with citation and source DTOs.
- [x] 2.2 Refactor `frontend/src/services/supabaseAdapter.ts` to typed RPC rows and inserts.
- [x] 2.3 Update `frontend/src/services/ragEngine.ts` to return citations.
- [x] 3.1 Add server-only embedding/generation API boundary before PDF ingestion.
- [x] 3.2 Add upload-limit checks before storing PDFs.
- [x] 4.1 Test Home/Professional limits and cross-tenant retrieval denial.
- [x] 4.2 Run lint, typecheck, and build.

## Files Changed
- `frontend/src/services/ragEngine.ts`
- `frontend/src/services/supabaseAdapter.ts`
- `frontend/src/services/types.ts`
- `frontend/src/services/__tests__/ragEngine.test.ts`
- `frontend/src/services/__tests__/supabaseAdapter.test.ts`
- `openspec/changes/rag-pdf-library/tasks.md`
- `openspec/changes/rag-pdf-library/apply-progress.md`

## Validation / Evidence
- Added server-only runtime boundary in `RagEngine` before embedding/generation flows (`pdf ingestion` and `recipe generation`).
- Added pre-store upload-limit check in `RagEngine` using tenant plan limits (Home=5, Professional=15) and `getTenantPdfCount` adapter capability.
- Added defense-in-depth filter in `SupabaseAdapter.searchChunks` to drop private chunks from other tenants if an unexpected RPC row appears.
- Tests added:
  - `blocks Home tenant uploads at the 5 PDF limit before storing chunks`
  - `allows Professional tenant upload under the 15 PDF limit`
  - `denies cross-tenant private chunks even if an unexpected row leaks from RPC`
- Executed frontend validations:
  - `npm run lint` ✅
  - `npx tsc --noEmit` ✅
  - `npm test` ✅ (5 files, 19 tests)
  - `npm run build` ✅

## Remaining Tasks
- None.

## Status
9 / 9 tasks complete for this change. Ready for verify.
