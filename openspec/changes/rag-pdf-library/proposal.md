# Proposal: RAG PDF Library

## Intent
Define secure PDF ingestion and retrieval for tenant-private and global cookbook content, preserving strict tenant isolation.

## Scope
### In Scope
- Tenant-private PDFs by default; global PDFs readable by all tenants.
- Platform Owner-only global PDF deletion/management.
- Upload limits: Home 5 PDFs, Professional 15 PDFs.
- Retrieval searches global plus current tenant private chunks only.
- Source citation as global PDF, tenant PDF, or AI-generated.

### Out of Scope
- Cross-tenant PDF sharing.
- OCR quality tuning beyond MVP.
- Public marketplace for PDFs.

## Capabilities
### New Capabilities
- `rag-pdf-library`: PDF ownership, upload limits, RAG retrieval boundaries, and source citation.

### Modified Capabilities
- None

## Approach
Extend existing `global_books`, `tenant_books`, `book_chunks`, and `match_chunks` design with upload limit enforcement, source metadata, typed adapters, and tests proving RLS-filtered retrieval.

## Affected Areas
| Area | Impact | Description |
|------|--------|-------------|
| `supabase/migrations/` | Modified | PDF ownership, limits, and global management policies. |
| `frontend/src/services/ragEngine.ts` | Modified | Source-aware retrieval contract. |
| `frontend/src/services/supabaseAdapter.ts` | Modified | Typed RPC and no unsafe `any`. |

## Risks
| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Cross-tenant retrieval leak | High | RLS + RPC tests with two tenants. |
| Secret exposure during embeddings | Med | Server-only API keys; no `NEXT_PUBLIC` secrets. |

## Rollback Plan
Disable upload/generation entry points, preserve stored PDFs/chunks, and revert new policies if retrieval behavior fails verification.

## Dependencies
- Supabase Storage or equivalent private PDF object storage.
- Embedding provider configured server-side.

## Success Criteria
- [ ] Home cannot upload more than 5 PDFs; Professional cannot upload more than 15.
- [ ] Retrieval returns only global and current-tenant chunks.
- [ ] Every answer cites source type.
