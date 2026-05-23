# Proposal: Premium Recipe Board Reviews

## Intent
Define a global read-only Premium Recipe Board where high-value recipes can be published by creator opt-in and reviewed safely.

## Scope
### In Scope
- Recipes above 95% value/rating may be globally published only with creator opt-in.
- Recipes visible to all tenants, read-only for non-creators.
- Creator can withdraw public recipe; archived/withdrawn visible only to Platform Owner.
- Public star ratings, short comments, basic moderation/reporting.
- Prevent duplicate spam reviews per member/recipe.
- Preserve creator attribution while deferring exact display mode.

### Out of Scope
- Copy/adapt/fork of premium recipes.
- Book/publication permission flow.
- Revenue sharing.

## Capabilities
### New Capabilities
- `premium-board`: Global premium recipe publishing, read-only access, reviews, moderation, withdrawal, and attribution.

### Modified Capabilities
- None

## Approach
Create publishable recipe records derived from tenant history with explicit creator opt-in, global read policies, creator/platform moderation controls, and anti-spam uniqueness constraints.

## Affected Areas
| Area | Impact | Description |
|------|--------|-------------|
| `supabase/migrations/` | Modified | Premium recipes, reviews, reports, archive status, RLS. |
| `frontend/src/app/` | Modified | Board, review, report, withdraw flows. |
| `frontend/src/services/` | Modified | Premium board DTOs and moderation contracts. |

## Risks
| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Accidental global publication | High | Explicit opt-in and eligibility checks. |
| Spam/abusive reviews | Med | One review per member/recipe and report queue. |

## Rollback Plan
Hide board routes and set all public recipes to withdrawn while preserving creator-owned history.

## Dependencies
- Recipe history, ratings, tenant/member identity, Platform Owner role.

## Success Criteria
- [ ] No recipe publishes without creator opt-in.
- [ ] Other tenants can read but not copy/adapt/fork in MVP.
- [ ] Creator withdrawal hides from public board and keeps Platform Owner visibility.
