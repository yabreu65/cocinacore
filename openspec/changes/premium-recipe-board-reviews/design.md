# Design: Premium Recipe Board Reviews

## Technical Approach
Add premium publication tables linked to recipe history. Publication is a state transition requiring creator opt-in and eligibility. Global read access uses RLS for published rows only; creator and Platform Owner retain management visibility. Reviews and reports use unique constraints and moderation statuses.

## Architecture Decisions
| Decision | Choice | Alternatives considered | Rationale |
|----------|--------|-------------------------|-----------|
| Publication | Derived from saved recipe history | Free-form public recipe entry | Ensures provenance and creator attribution. |
| Access | Published global read, no copy/fork actions | Clone into tenant library | User deferred copy/adapt/fork. |
| Withdrawal | Archived/withdrawn status | Hard delete | Preserves moderation audit and future book candidates. |
| Review spam | Unique member/recipe review | Rate limit only | DB uniqueness is deterministic and cheap. |

## Data Flow
    Recipe history + rating >95 + creator opt-in
       -> premium_recipe(published)
       -> global board read
       -> reviews/reports
       -> creator withdrawal -> withdrawn -> Platform Owner only

## File Changes
| File | Action | Description |
|------|--------|-------------|
| `supabase/migrations/*_premium_board.sql` | Create | Premium recipes, reviews, reports, statuses, RLS. |
| `frontend/src/services/types.ts` | Modify | Premium recipe, review, report, attribution DTOs. |
| `frontend/src/app/premium/...` | Create | Board, recipe detail, review/report, creator withdrawal screens. |

## Interfaces / Contracts
```ts
type PremiumStatus = 'published' | 'withdrawn' | 'moderation_hidden';
interface PremiumRecipe { id: string; sourceRecipeId: string; creatorUserId: string; status: PremiumStatus; }
interface PremiumReview { recipeId: string; userId: string; stars: 1|2|3|4|5; comment: string; }
```

## Testing Strategy
| Layer | What to Test | Approach |
|-------|-------------|----------|
| DB | Opt-in, read-only access, withdrawal visibility | RLS fixtures across tenants and Platform Owner. |
| Unit | Eligibility and status transitions | Pure functions with edge cases. |
| E2E | Publish, review, report, withdraw | Browser smoke after test runner exists. |

## Migration / Rollout
Add tables with no public rows initially. Release board read UI only after publication controls and RLS tests pass. Withdrawal is non-destructive.

## Open Questions
- [ ] Final attribution display choice: real name, username, or anonymous.
