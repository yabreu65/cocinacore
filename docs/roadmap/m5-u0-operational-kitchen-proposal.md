# M5 U0 — Operational kitchen loop proposal

**Status:** local proposal for PM/owner review. This document does not authorize U1 implementation, migrations, production work, GitHub delivery, or M5 closure.

**Baseline:** `main` at `36a40886ca03740a20447e43138aab0181d42597`. The M4 working branch remains `ci/m4-acceptance-fixture` at `8c0d9ea969b337d6bb22492dfe49658e56051ab1` and is not modified by this proposal.

## Decision in one paragraph

M5 should close the next product gap after M4: turning an evidence-backed recipe or meal-plan recommendation into a safe, user-controlled cooking operation and an auditable reconciliation of what was actually consumed. M4 already forecasts coverage, highlights waste, proposes adaptive planning, and suggests purchases. M5 must not duplicate those engines or make recommendations autonomous; it should add the operational loop around them with explicit confirmation, idempotency, tenant isolation, and honest handling of unknown quantities.

## Commercial and functional objective

For a household, the product should answer: **“I chose this meal; what do I do now, and what did I really use?”** The same domain boundary should be reusable later for restaurants, bakeries, pastry shops, and catering without assuming that all tenants have the same calendar, roles, portions, or inventory semantics.

The first M5 slice targets the existing household workflow. It improves retention and trust by reducing the gap between a recommendation and a completed meal while preserving user control. It does not promise nutritional, regulatory, allergen, or stock accuracy beyond the evidence stored by the tenant.

## What already exists and what is missing

| Capability                                                           | Current evidence                                                                                                                    | M5 implication                                                                                               |
| -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Coverage, expiry, adaptive proposal, and shopping suggestion engines | `frontend/src/lib/meal-planner/coverage-forecast.ts`, `waste-prevention.ts`, `adaptive-planning.ts`, `predictive-shopping.ts`       | Reuse as read-only evidence providers; do not create parallel engines.                                       |
| Persistent recipes and versions                                      | `frontend/src/lib/db/repositories/recipeRepository.ts`, recipe API routes, migration 016                                            | A recipe/version can be the stable reference for a cooking intent.                                           |
| Structured meal plans and schedule confirmation                      | `frontend/src/lib/db/repositories/mealPlanRepository.ts`, `/api/meal-plan/schedule`                                                 | Reuse existing confirmed slots before proposing a new persistence model.                                     |
| Consumption confirmation and inventory movements                     | `mealPlanConsumptionRepository.ts`, `/api/meal-plan/consumption`                                                                    | Reuse only where the exact planned-quantity semantics match; do not silently reinterpret them as real usage. |
| Missing operational loop                                             | No durable recipe-to-cooking-instance, step progress, actual-quantity correction, or append-only adjustment contract was identified | U1 must specify the boundary; later units may require additive schema and RLS.                               |

## Scope boundaries

### In scope for M5

- A read-only, deterministic cooking-intent preview based on an existing recipe/version or confirmed meal-plan slot.
- Explicit evidence for portions, ingredients, units, restrictions, availability, expiry, and uncertainty.
- A separate, authenticated command path for any plan, cooking, or consumption write.
- Idempotent operations, optimistic conflict detection, tenant/user scoping, and audit-friendly outcomes.
- Domain-neutral names and contracts that can later support household, restaurant, bakery, pastry, and catering tenants.

### Out of scope unless separately approved

- Autonomous purchases, checkout, supplier integrations, or external commerce.
- Automatic plan changes, stock decrements, recipe edits, or consumption writes from a read operation.
- Nutritional/medical/allergen guarantees beyond existing safety filters.
- Background jobs, new queues, microservices, external AI spending, or production data preparation.
- A migration merely to avoid deciding whether existing meal-plan JSON is sufficient.

## Proposed unit plan

| Unit                                  | Vertical outcome                                                                                                                                                          | Persistence                                                                             | Local acceptance gate                                                                               |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| **U0 — Contract and audit**           | Freeze the operational vocabulary, state machine, data ownership, threat model, and migration decision boundary.                                                          | None. This document only.                                                               | Static audit, contract review, no app changes.                                                      |
| **U1 — Cooking intent preview**       | Show a deterministic preview for one existing recipe/version or confirmed slot: steps, portions, evidence, restrictions, inventory/expiry signals, and explicit unknowns. | Read-only.                                                                              | Unit/API tests prove no writes, tenant isolation, stable output, and fail-closed safety.            |
| **U2 — Explicit plan selection**      | After user confirmation, attach a selected saved recipe/version to an existing compatible plan slot, or return a typed conflict.                                          | Prefer existing plan storage; stop for PM decision if semantics require new schema.     | Transaction, exact version, stale-plan conflict, retry idempotency, cross-tenant rejection.         |
| **U3 — Guided cooking session**       | Provide resumable step progress and a safe preview of intended quantities without decrementing stock.                                                                     | Additive session model only if existing plan payload cannot represent durable progress. | Restart/reconnect, duplicate events, authorization, accessibility, no implicit stock writes.        |
| **U4 — Actual-use reconciliation**    | Let the user confirm actual quantities, skipped items, substitutions, or unknown usage and reconcile inventory explicitly.                                                | Append-only adjustment/event model likely; no destructive rewrite.                      | Atomic inventory movement, idempotency, unit incompatibility stays unknown, correction/audit trail. |
| **U5 — Operational domain hardening** | Validate household-first behavior and define adapter seams for restaurant/bakery/pastry/catering calendars, roles, batches, and portions.                                 | No cross-domain schema until the capability boundary is proven.                         | Tenant/role matrix, bounded payloads, regression against M4, disposable DB/Redis E2E.               |
| **U6 — Release and acceptance**       | Integrate quality evidence, documentation, backup/migration plan if applicable, and separately gated production acceptance.                                               | Only approved migrations.                                                               | Exact SHA, CI, local E2E, read-only production acceptance, rollback evidence.                       |

U1 is intentionally read-only and is the recommended first implementation unit. It can be developed and validated entirely offline with fixtures and pure domain functions.

## U1 contract to prepare before implementation

### Input

- Authenticated user and tenant derived server-side; no client-supplied tenant authority.
- Exactly one source: a saved recipe/version or a confirmed meal-plan slot.
- Optional explicit `timeZone` and `asOf` only when the existing application contract can validate them; otherwise use the established safe default and expose the limitation.
- No provider call is required for the preview.

### Output

```ts
type CookingIntentEvidence = "verified" | "partial" | "unknown";
type CookingIntentStatus = "ready" | "partial" | "unknown" | "blocked";

interface CookingIntentPreview {
  status: CookingIntentStatus;
  source: "saved_recipe" | "confirmed_meal_slot";
  recipeVersion: { recipeId: string; versionId: string };
  portions: { requested: number | null; source: "recipe" | "plan" | "unknown" };
  steps: Array<{ index: number; title: string; instruction: string }>;
  ingredients: Array<{
    name: string;
    requiredQuantity: number | null;
    requiredUnit: string | null;
    availability: "sufficient" | "partial" | "missing" | "unknown";
    expiry: "fresh" | "due_today" | "due_soon" | "expired" | "unknown";
    evidence: CookingIntentEvidence;
  }>;
  restrictions: { status: "clear" | "blocked" | "unknown"; reasons: string[] };
  limitations: string[];
}
```

The exact public route and field naming remain subject to the implementation review. IDs may be returned to the authenticated client only as opaque references; logs and test reports must not publish private records or response bodies.

### Safety invariants

1. A preview performs no database write, inventory movement, shopping mutation, plan mutation, or external provider call.
2. Every read is scoped by authenticated tenant and the repository's user ownership rules.
3. Missing, malformed, stale, expired, or incompatible evidence remains `unknown`; it is never converted to zero or `sufficient`.
4. Hard restrictions and allergies fail closed. An unknown restriction state is not a green safety result.
5. Duplicate ingredient needs are consolidated only through existing validated normalization; incompatible units remain unknown.
6. The preview is deterministic for identical persisted inputs, `asOf`, and timezone.
7. A future write command is a different endpoint and must re-read state, require explicit confirmation, and carry an idempotency key.

## U1 test contract

Tests must be authored with the implementation and run offline first:

- saved recipe source and confirmed meal-slot source;
- portions from recipe, plan, and unknown;
- structured and free-text quantities;
- comparable units, incompatible units, duplicate ingredients, and unknown quantities;
- fresh, due-today, due-soon, expired, malformed, and timezone-boundary dates;
- allergies, hard avoids, soft dislikes, and unknown profile evidence;
- missing inventory and incomplete plan evidence;
- same input twice produces the same sanitized result;
- anonymous user, wrong tenant, wrong user, and cross-tenant fixture are rejected;
- read-only assertion that recipes, plans, inventory, shopping rows, consumption, and movement counts do not change;
- provider/cache calls are not required and are not invoked;
- bounded payload and error-code tests for invalid source, stale version, and unsupported horizon/context.

Recommended command sequence for the first implementation candidate:

```text
cd frontend
npm test -- --run <focused U1 contract files>
npm run lint
npx tsc --noEmit
npm run build
git diff --check
```

Use disposable PostgreSQL/Redis only for repository/API integration tests that cannot be pure unit tests. Do not reuse the ordinary local database and do not contact production.

## Architecture and dependency decisions

- Keep the domain service in the existing Next.js backend; do not add a microservice.
- Reuse `coverage-forecast`, `waste-prevention`, `adaptive-planning`, `predictive-shopping`, recipe requirements, quantity normalization, profile context, and repository scope checks where contracts match.
- Keep reads and commands separate. The preview has no command side effect.
- Treat a saved recipe/version as immutable evidence. A cooking session or actual-use correction must not mutate the recipe version.
- Prefer existing plan slots for U2. A standalone cooking instance, durable progress, or append-only correction requires a separate schema proposal with RLS tests before implementation.
- Preserve the tenant abstraction: household is the first adapter, not the universal data model. Future domain adapters must express roles, batch/production units, and portion policy explicitly rather than inferring them from `tenant_id`.

## Risks and controls

| Risk                                                    | Control                                                                                               | Stop condition                                     |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| M4 production is not closed                             | Keep M5 local-only and do not claim production readiness.                                             | Any request to use production data/services.       |
| Existing consumption semantics differ from actual use   | Keep U1 read-only; require PM decision before U4.                                                     | Need to decrement stock from a preview.            |
| JSON payload is overloaded for new lifecycle state      | Use existing fields only for proven semantics; propose additive migration otherwise.                  | New state cannot be represented without ambiguity. |
| Cross-tenant or cross-user disclosure                   | Server-derived auth scope plus negative integration tests and RLS checks.                             | Any unscoped repository path.                      |
| Unit/date uncertainty creates false confidence          | Preserve `unknown`, use one timezone contract, test boundaries.                                       | Parser would infer a value.                        |
| Domain expansion creates premature generic abstractions | Keep household implementation concrete and define adapter seams only at contracts.                    | New role/batch semantics cannot be specified.      |
| Disk is constrained (~7 GiB free)                       | Avoid Docker unless integration testing needs disposable services; reuse existing local dependencies. | New images/volumes threaten workspace stability.   |

## Dependencies and M4 relationship

- M5 development can proceed locally from `main` without modifying PR #85 or the M4 branch.
- M4 production deployment and acceptance remain external gates; they are not prerequisites for offline U1 contract work, but they are prerequisites for any claim that M5 behavior is production-compatible.
- No M5 unit should alter the M4 engines or weaken their `unknown`, tenant, expiry, quantity, or no-write guarantees.
- Any migration, external API usage, production data, or GitHub delivery requires a later explicit authorization and a separate work unit.

## Closure criteria

### Local

- U1 focused tests, relevant full Vitest, TypeScript, ESLint, build, formatting/diff checks, and offline security tests pass.
- If integration services are needed, they use named disposable resources and are removed after evidence capture.
- No production endpoint, secret, database, or persistent local stack is used.
- Contract review confirms no duplicate M4 engine and no hidden write boundary.

### Productive

- Only after all M5 units are merged with exact-head CI, approved by the PM/owner, and covered by the current production backup/migration/rollback gates.
- Production acceptance must be explicit about whether it is read-only or includes a controlled write journey; no synthetic write is implied by this proposal.

## Recommended next action

PM should approve or reject this M5 boundary and the U1 contract. If approved, implement only U1 on `feat/m5-u0-planning` or a new child branch from the approved M5 base, starting with the pure preview domain function and its tests. Do not implement U2–U6, add migrations, touch PR #85, or execute production operations as part of this preparation.
