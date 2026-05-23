# Design: RAG PDF Library

## Technical Approach
Keep RAG storage in Supabase PostgreSQL/pgvector and add PDF metadata, object paths, upload limits, and source typing. Retrieval continues through `match_chunks` with `security invoker`, relying on RLS plus explicit tenant filter as defense in depth.

## Architecture Decisions
| Decision | Choice | Alternatives considered | Rationale |
|----------|--------|-------------------------|-----------|
| PDF visibility | Tenant-private by default, global explicit | Shared-by-link | User chose strict tenant privacy. |
| Limits | Enforce in DB/server before upload | UI-only counters | Prevents bypass and controls costs. |
| Citations | Persist source type on chunks/recipes | Infer at render time | Auditable history requires durable provenance. |
| Secrets | Server-only embedding keys | `NEXT_PUBLIC_GEMINI_API_KEY` fallback | Current fallback is unsafe for production. |

## Data Flow
    PDF upload -> limit check -> storage path -> chunker -> embeddings -> book_chunks
    Search query -> embedding -> match_chunks(global + tenant) -> cited recipe result

## File Changes
| File | Action | Description |
|------|--------|-------------|
| `supabase/migrations/*_rag_pdf_library.sql` | Create | PDF metadata, upload limits, RLS, source metadata checks. |
| `frontend/src/services/types.ts` | Modify | Add `PdfSourceType`, `Citation`, typed RPC row metadata. |
| `frontend/src/services/supabaseAdapter.ts` | Modify | Remove `any`; type `match_chunks` response and inserts. |
| `frontend/src/services/ragEngine.ts` | Modify | Return citations and source-aware results. |
| `frontend/src/services/gemini.ts` | Modify | Use server-only API key contract in implementation phase. |

## Interfaces / Contracts
```ts
type PdfSourceType = 'global_pdf' | 'tenant_pdf' | 'ai_generated';
interface Citation { sourceType: PdfSourceType; title?: string; pageNumber?: number; chunkId?: string; }
interface RagResult { recipe: string; retrievedChunks: RecipeBookChunk[]; citations: Citation[]; }
```

## Testing Strategy
| Layer | What to Test | Approach |
|-------|-------------|----------|
| DB | Upload limits and RLS retrieval | Seed Home/Professional tenants and cross-tenant chunks. |
| Unit | Citation mapping | Typed fixtures for global, tenant, generated sources. |
| Integration | `match_chunks` scope | RPC test under tenant JWT. |

## Migration / Rollout
Add metadata columns and policies without deleting existing chunks. Backfill source type from nullable `tenant_id`/book references. Block uploads until limits verified.

## Open Questions
- [ ] Final PDF storage bucket naming and file-size limits.
