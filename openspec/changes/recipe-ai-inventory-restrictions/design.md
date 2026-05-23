# Design: Recipe AI Inventory Restrictions

## Technical Approach
Add tenant/member-scoped tables for inventory, preferences, recipe history, and ratings. Extend the existing `RagEngine` contract to accept restrictions and return persisted history metadata. Model routing belongs in a server-side AI service so client bundles never expose provider secrets or tier wording.

## Architecture Decisions
| Decision | Choice | Alternatives considered | Rationale |
|----------|--------|-------------------------|-----------|
| Inventory | Manual member-maintained entries | Automated pantry integrations | MVP stays simple and user-confirmed. |
| Restrictions | Profile defaults + per-search overrides | Search-only text input | Defaults reduce safety mistakes; overrides keep flexibility. |
| History | Persist per tenant/member | Local browser history | Must support repeat use across devices and members. |
| Model routing | Server-side by tenant type | Client-selected model | Prevents secret/tier leakage and misuse. |

## Data Flow
    Inventory + profile restrictions + search override
       -> server recipe request -> RAG retrieval -> AI generation
       -> recipe_generations/history -> rating by member

## File Changes
| File | Action | Description |
|------|--------|-------------|
| `supabase/migrations/*_recipe_ai.sql` | Create | Inventory, profile preferences, history details, ratings, RLS. |
| `frontend/src/services/types.ts` | Modify | Ingredient, restriction, recipe history, rating DTOs. |
| `frontend/src/services/ragEngine.ts` | Modify | Accept restrictions/overrides and return saveable result. |
| `frontend/src/services/gemini.ts` | Modify | Generate with allergy/restriction guardrails via typed prompt input. |
| `frontend/src/app/` | Modify | Search, inventory, history, and rating screens. |

## Interfaces / Contracts
```ts
interface RestrictionProfile { allergies: string[]; dietaryRules: string[]; }
interface RecipeSearchInput { ingredients?: string[]; overrideRestrictions?: RestrictionProfile; }
interface RecipeHistoryItem { tenantId: string; userId: string; recipe: string; citations: Citation[]; rating?: number; }
```

## Testing Strategy
| Layer | What to Test | Approach |
|-------|-------------|----------|
| DB | Tenant/member history and rating uniqueness | SQL constraints + RLS fixtures. |
| Unit | Restriction merge/override | Deterministic pure function tests. |
| E2E | Search with empty inventory and rate result | Smoke flow after test setup. |

## Migration / Rollout
Add schema and server contracts first. Keep existing `recipe_generations` rows and add nullable metadata fields/backfill. Enable UI after generation gates pass.

## Open Questions
- [ ] Exact rating scale representation for generated recipes.
