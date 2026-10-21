# M3.3 Cocina autónoma — planning proposal

**Status: proposal for PM/owner decision only.** No explicit M3.3 scope was found in the inspected roadmap/closure evidence. This document proposes a bounded next slice; it does not establish a roadmap commitment, authorize implementation, or imply production readiness.

## Proposed bounded vertical slice

Build one **user-controlled next-cooking-action** experience that combines existing profile, inventory, meal-plan, and recipe context to present a small set of advisory suggestions (for example, what to cook next using known available ingredients). The system may explain which existing context informed each suggestion, but the user must explicitly choose and confirm any consequential action. A recommendation must not silently change the meal plan, inventory, recipe library, shopping list, or account state.

This is a proposal, not a confirmed product requirement. PM should select the exact user, trigger, recommendation shape, and outcome before implementation.

## Evidence-backed context

| Evidence class | Repository evidence | What it supports |
|---|---|---|
| Confirmed closure record | M1 closure: `docs/production/m1-production-closure.md:1-5`; M2 closure: `docs/production/m2-production-closure.md:1-5`; M3.1 closure: `docs/production/m3-1-production-closure.md:1-5` | These records document prior milestone boundaries and explicitly retain conditions/follow-ups. They are historical closure records, not evidence that current M3.3 work is approved. |
| Confirmed task scope / reported prior work | M3.2 U0–U5 records: `odd/tasks/m3-2-u0-e2e-target-hardening.md:1-20`, `odd/tasks/m3-2-u1-persistent-recipe-model.md:1-20`, `odd/tasks/m3-2-u2-recipes-api.md:1-20`, `odd/tasks/m3-2-u3-recipe-library-ui.md:1-20`, `odd/tasks/m3-2-u4-integration-quality.md:1-20`, `odd/tasks/m3-2-u5-backup-force-rls.md:1-20`, `odd/tasks/m3-2-u5-migration-baseline-gate.md:1-20`, `odd/tasks/m3-2-u5-release-production.md:1-20` | U0–U4 describe target hardening, persistent recipes, scoped APIs, library/history, and AI import; U5 records separate gated migration/release/acceptance work. Task-record validations are reported evidence, not rerun here. |
| Confirmed existing recipe surfaces | API identity scoping: `frontend/src/app/api/recipes/route.ts:16-25`; library: `frontend/src/app/recipes/RecipeLibraryClient.tsx:208-232`; recipe scale helper: `frontend/src/app/recipes/recipe-ui.ts:31-74` | Existing persistent recipe context and UI are potential integration points, subject to product/API review. |
| Existing context surfaces identified in exploration | Today recommendations: `frontend/src/app/app/today-recommendations.tsx`; meal planner: `frontend/src/app/meal-planner/page.tsx`; profile: `frontend/src/app/profile/page.tsx`; recipe generation/history and inventory projection/optimizer are described in the M2/M3.2 task/closure records cited above. | These are candidate inputs/surfaces only. This proposal does not assert their current production availability, readiness, or a particular endpoint contract. |
| Reported gate | M3.2 U5 release record: `odd/tasks/m3-2-u5-release-production.md:1-20` | M3.2 production release and acceptance are separate gated work. Do not infer production readiness from U0–U4. |

## Scope boundary

**In scope for the proposed slice:**

- Read existing user-authorized profile/preferences, inventory projection, meal-plan, and recipe context through current supported application boundaries.
- Produce advisory candidate(s) with concise rationale and clear uncertainty where inventory/context is incomplete.
- Require explicit user confirmation before any separately approved consequential write or navigation action.
- Keep existing recipe, inventory, and meal-plan data unchanged when the user merely views or dismisses suggestions.

**Out of scope unless separately approved:**

- Autonomous purchasing, checkout, or external commerce actions.
- Silent inventory mutation, meal-plan writes, recipe edits, or cross-context synchronization.
- Guarantees that inventory is complete/current, recipes are safe for allergies, or recommendations are nutritionally/medically safe.
- New migrations, data-model changes, background schedules, roles/services, production operations, or AI cost commitments.
- Replacing existing Today, meal-plan, recipe, or inventory flows.

## Dependencies and sequence

1. **PM decision:** confirm target user/problem, entry point, exact advisory output, success signal, and explicit non-goals. Stop if those remain ambiguous.
2. **Readiness review:** confirm M2/M3.1 functional closure conditions and the separate M3.2 U5 release/acceptance gate; obtain owner evidence rather than inferring from task records.
3. **Contract/design:** map current profile/inventory/meal-plan/recipe data boundaries, freshness and missing-data semantics, and the confirmation boundary. Prefer existing APIs; any contract or migration need requires separate approval.
4. **Small implementation plan:** define one vertical slice with user-visible loading/empty/error/uncertainty behavior and tests for no implicit writes and explicit confirmation.
5. **Validation and release:** use authorized isolated tests first. Production acceptance, deployment, migrations, and live smoke require their own explicit gates and evidence.

## Risks and assumptions

- **Confirmed:** no explicit M3.3 scope was found in the supplied roadmap exploration; U5 remains a separate release/acceptance gate in its task record.
- **Assumption:** existing profile, inventory, meal-plan, and recipe data can be composed without a new schema. Validate this before committing to scope.
- **Unknown:** current freshness/availability semantics for inventory and meal-plan context, how preferences are represented, and whether a safe recommendation contract already exists.
- **Unknown:** whether users want suggestions in Today, meal planner, or another entry point; PM decision required.
- **Risk:** incomplete inventory can make a suggestion appear feasible when ingredients are missing. Show uncertainty; do not make availability guarantees.
- **Risk:** AI-generated content can be incorrect or conflict with dietary needs. Treat recommendations as advisory and avoid health/safety claims.
- **Risk:** combining contexts may widen data access or create unintended writes. Enforce existing ownership boundaries and verify no write occurs before explicit confirmation.

## Planning-artifact acceptance criteria

This proposal is ready for PM review when:

- [ ] It clearly labels M3.3 as unscoped and the vertical slice as a proposal, not a commitment.
- [ ] It distinguishes repository-backed context from PM decisions and unresolved assumptions.
- [ ] It defines a bounded user-confirmed slice and explicit exclusions for autonomous actions.
- [ ] It identifies dependencies, sequence, risks, and the independent U5 release gate.
- [ ] No application code, tests, migrations, production artifacts, or live systems are changed or exercised by this planning artifact.
