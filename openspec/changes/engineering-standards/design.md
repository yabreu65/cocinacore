# Design: Engineering Standards

## Technical Approach
Make safety gates executable before large MVP features. Current `frontend/eslint.config.mjs` extends Next TypeScript rules but lint already fails on 5 explicit `any` issues in `frontend/src/services`. Strengthen config, replace unsafe boundaries with typed DTOs, and document verification commands.

## Architecture Decisions
| Decision | Choice | Alternatives considered | Rationale |
|----------|--------|-------------------------|-----------|
| `any` policy | Error, no suppression by default | Warning or selective ignores | User explicitly rejects unsafe `any`; security depends on typed trust boundaries. |
| External data | `unknown` + DTO/schema/generated types | Blind casts | Makes validation explicit and reviewable. |
| Secrets | Server-only env validation | `NEXT_PUBLIC_*` fallback | Client bundles must not expose AI keys. |
| Tests | Add minimal unit/RLS/E2E scaffolding | Build-only validation | Multi-tenant SaaS needs proof, not vibes. |

## Data Flow
    External API/DB response -> unknown/generated type -> validator/mapper -> domain DTO
    env vars -> server validation -> server service only -> client receives safe response

## File Changes
| File | Action | Description |
|------|--------|-------------|
| `frontend/eslint.config.mjs` | Modify | Enforce no explicit/unsafe any rules as errors. |
| `frontend/src/services/types.ts` | Modify | Replace index-signature `any` with safe metadata types. |
| `frontend/src/services/gemini.ts` | Modify | Type Gemini responses and remove `emb: any`; remove public key fallback. |
| `frontend/src/services/supabaseAdapter.ts` | Modify | Type injected client/RPC rows. |
| `README.md` | Modify | Document gates and no-AI-attribution commit rule. |
| `supabase/tests/` | Create | RLS proof convention and fixtures. |

## Interfaces / Contracts
```ts
type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
interface TypedApiResult<T> { data: T; error?: never } | { data?: never; error: Error };
```

## Testing Strategy
| Layer | What to Test | Approach |
|-------|-------------|----------|
| Static | No explicit/unsafe `any` | ESLint errors. |
| Unit | Mappers and env validation | Deterministic tests around unknown input. |
| DB | RLS tenant isolation | SQL fixtures for allow/deny. |
| Build | Next compatibility | `npx tsc --noEmit` and `npm run build`. |

## Migration / Rollout
Start with config/docs and existing `any` cleanup. Add test runner/scaffold in a separate review unit if it pushes diff over budget. No data migration required.

## Open Questions
- [ ] Preferred test runner for frontend unit tests.
