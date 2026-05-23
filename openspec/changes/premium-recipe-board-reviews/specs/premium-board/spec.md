# Premium Board Specification

## Purpose
Define global premium recipe publication, review, moderation, and withdrawal behavior.

## Requirements

### Requirement: Publication eligibility and opt-in
Recipes with value/rating above 95% MAY be published globally only when the creator opts in.

#### Scenario: Eligible opt-in publishes
- GIVEN a recipe is above 95% and creator opts in
- WHEN publication is requested
- THEN the recipe SHALL appear on the Premium Board

#### Scenario: No opt-in no publish
- GIVEN a recipe is above 95%
- WHEN the creator has not opted in
- THEN it MUST NOT be published

### Requirement: Read-only cross-tenant access
Published premium recipes SHALL be visible to all tenants and MUST be read-only for non-creators.

#### Scenario: Other tenant reads recipe
- GIVEN a premium recipe is published
- WHEN another tenant views the board
- THEN they SHALL see the recipe

#### Scenario: Fork denied
- GIVEN a non-creator views a premium recipe
- WHEN they attempt to copy, adapt, or fork it
- THEN the action MUST be unavailable or denied

### Requirement: Reviews and spam prevention
Members MAY leave public star ratings and short comments; duplicate spam reviews per member/recipe MUST be prevented.

#### Scenario: First review accepted
- GIVEN a member has not reviewed a premium recipe
- WHEN they submit stars and a short comment
- THEN the review SHALL be saved

#### Scenario: Duplicate review blocked
- GIVEN a member already reviewed a recipe
- WHEN they submit another review
- THEN the system MUST update existing review or reject duplicate insert

### Requirement: Moderation and withdrawal
Members MAY report reviews/recipes; creators MAY withdraw their recipe, making it visible only to Platform Owner.

#### Scenario: Creator withdraws recipe
- GIVEN a creator owns a published recipe
- WHEN they withdraw it
- THEN it SHALL be archived/withdrawn and hidden from public board

#### Scenario: Platform Owner sees withdrawn
- GIVEN a recipe is withdrawn
- WHEN Platform Owner reviews moderation history
- THEN the recipe SHALL remain visible to them

### Requirement: Attribution
Every premium recipe MUST carry creator attribution, while display mode SHALL be deferred.

#### Scenario: Attribution stored
- GIVEN a recipe is published
- WHEN the public record is created
- THEN creator attribution SHALL be persisted
