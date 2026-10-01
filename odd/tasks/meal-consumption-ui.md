# M1.6.2 — Planner “Ya cociné” UI

## Objective

Expose the M1.6.1 consumption contract in Meal Planner so the user explicitly confirms a planned meal as cooked and immediately sees durable cooked state plus the resulting inventory impact.

## Starting point

- Branch: `feature/meta1-m1-2-meal-planner-contract`
- Base HEAD: `87b12cdda83a47896af496f9c8e30796a4021a2b`
- M1.6.1 backend contract: CLOSED.
- Preserve unrelated `.atl/skill-registry.md` and `.codegraph/`.

## Product behavior

- Only persisted plans (`activePlanId`) can expose cooking actions.
- Each planned meal has one `Ya cociné` action.
- Previously consumed meals rehydrate as cooked after reload.
- A pending confirmation disables only that meal action and prevents duplicate clicks.
- Successful confirmation updates the exact meal locally and refreshes Planner shopping shortages from the newly decremented inventory.

## UX contract

- Success copy must distinguish actual decrements from ingredients that were not safely decrementable.
- No inventory arithmetic is duplicated in the browser; server response is authoritative.
- No shopping-list row is created or mutated by cooking.
- Regenerating a menu clears old consumption UI state before the new plan is persisted.
- Stale async responses from an older plan must not overwrite the current plan state.

## Scope

1. Load persisted consumption state with the active plan.
2. Add per-meal `Ya cociné` confirmation action and durable cooked state.
3. Show concise success/error feedback and refresh shopping suggestions after confirmed consumption.
4. Add pure UI-state regression tests plus TypeScript/lint/build gates.

## Out of scope

- Full connected browser + PostgreSQL inventory proof (M1.6.3).
- Reversing/undoing a cooked meal.
- Manual consumption outside Planner.
- Push, PR, staging, production, or M1.7.

## Tasks

1. [x] Consumption load/race state.
2. [x] Per-meal confirmation UI.
3. [x] Focused UI-state tests and full gates.
4. [x] Guardian-reviewed commit and M1.6.2 local closure.

## Verification evidence

- Focused M1.6.2 + consumption regressions: **4 files / 19 tests PASS** on Node 20.20.2.
- Full unit gate: **48 files / 397 tests PASS** on Node 20.20.2.
- TypeScript: PASS. ESLint: PASS. Production build: PASS (**52 pages**). `git diff --check`: PASS.
- Persisted consumption state is loaded with stale-response guards before meal actions become usable.
- Per-meal confirmation is exact-plan scoped; successful consumption refreshes shopping shortages from server inventory state.
- No browser-side inventory arithmetic, shopping mutation, push, PR, staging, production, or M1.6.3 work performed.

## Current closure note

- UI implementation commit: `adc1a27` (`feat(meal-plan): add cooked meal confirmation UI`).
- M1.6.2 verification remains green: 4 files / 19 tests focused, 48 files / 397 tests full after M1.6.3, TypeScript/ESLint/build PASS.
- Guardian-reviewed documentary closure commit: `9140080` (`docs(odd): close cooked meal planner UI`).
- M1.6.2 status: **CLOSED locally**.
