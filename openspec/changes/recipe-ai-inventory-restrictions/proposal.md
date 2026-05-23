# Proposal: Recipe AI Inventory Restrictions

## Intent
Define MVP recipe discovery/generation using manual inventory, user restrictions/allergies, per-search overrides, and tenant/member history.

## Scope
### In Scope
- Manual ingredient inventory entry by members.
- Recipe search remains available when inventory is missing or insufficient.
- Restrictions/allergies persisted in user profile and overrideable per search.
- Generated/searched recipe history saved per tenant/member.
- Members can rate generated recipes.
- Tenant type influences internal AI model selection.

### Out of Scope
- Barcode scanning, grocery sync, or inventory automation.
- Exposing “cheap/top model” wording in UI.
- Nutrition certification or medical advice.

## Capabilities
### New Capabilities
- `recipe-ai`: Inventory, restrictions, AI routing, recipe history, and ratings.

### Modified Capabilities
- None

## Approach
Add domain tables for ingredients, preferences, recipe history, and ratings. Keep AI model routing server-side based on tenant type and hide provider/model labels from UI copy.

## Affected Areas
| Area | Impact | Description |
|------|--------|-------------|
| `supabase/migrations/` | Modified | Inventory, profile restrictions, history, ratings. |
| `frontend/src/services/ragEngine.ts` | Modified | Restrictions and inventory-aware generation. |
| `frontend/src/app/` | Modified | Search/generation/history/rating flows. |

## Risks
| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Allergy ignored | High | Prompt contract and persisted restrictions validation. |
| AI model leakage | Med | Server-only routing and product-safe UI labels. |

## Rollback Plan
Disable generation and rating UI while keeping history tables intact; revert server routes to PDF search only.

## Dependencies
- RAG PDF library retrieval and auth/trial gating.

## Success Criteria
- [ ] Search works without inventory.
- [ ] Restrictions persist and can be overridden per search.
- [ ] Recipe history and member ratings are tenant-scoped.
