# Recipe AI Specification

## Purpose
Define recipe search/generation, inventory, restrictions, history, and ratings.

## Requirements

### Requirement: Manual inventory
Members MUST be able to maintain manual ingredient inventory for their tenant/member context.

#### Scenario: Member adds ingredient
- GIVEN a Member is authenticated
- WHEN they add an ingredient
- THEN it SHALL be stored for the current tenant/member scope

### Requirement: Search without sufficient inventory
The system MUST allow PDF recipe search when inventory is missing or insufficient.

#### Scenario: Empty inventory search
- GIVEN a member has no inventory
- WHEN they search recipes from PDFs
- THEN matching PDF recipes SHALL still be returned

### Requirement: Restrictions and allergies
Restrictions/allergies MUST persist in the user profile and MAY be overridden per search.

#### Scenario: Persisted allergy applied
- GIVEN a user profile includes peanut allergy
- WHEN they generate a recipe
- THEN the recipe MUST avoid peanuts unless a valid override is supplied

#### Scenario: Per-search override
- GIVEN a user has vegetarian preference
- WHEN they override it for one search
- THEN only that search SHALL use the override

### Requirement: Recipe history
Generated and searched recipes MUST be saved per tenant/member for repeat use.

#### Scenario: Recipe saved to history
- GIVEN a member receives a generated recipe
- WHEN generation completes
- THEN the recipe SHALL be saved with tenant and member attribution

### Requirement: Ratings
Members MUST be able to rate generated recipes once per member/recipe.

#### Scenario: Duplicate rating prevented
- GIVEN a member already rated a recipe
- WHEN they rate it again
- THEN the previous rating SHALL be updated or duplicate insert denied

### Requirement: AI model routing
Home and Professional tenants SHALL use different internal AI model tiers, but UI MUST NOT describe them as cheap/top.

#### Scenario: Model hidden from UI
- GIVEN a Professional tenant generates a recipe
- WHEN the UI displays generation status
- THEN it MUST use product-safe wording, not implementation tier labels
