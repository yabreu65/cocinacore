# M5 U4 — Real Consumption Reconciliation Schema Proposal

**Status: SCHEMA DESIGN GO for review; implementation and migration execution NOT AUTHORIZED.**

U4 is the explicit reconciliation of what was actually used after a guided cooking session. It must remain separate from M4's planned-consumption ledger and from U3's session-progress tables. This proposal defines the additive persistence boundary required before U4 endpoints or inventory writes can be implemented.

## Quick path

1. Approve the additive migration and the application compatibility gate described below.
2. Re-check the migration ledger and object manifest; the next migration is expected to be `019`.
3. Implement the schema and RLS on a fresh disposable PostgreSQL database only.
4. Update both the legacy planned-consumption path and the new U4 command path to use the same slot claim guard before enabling either inventory mutation.
5. Run transaction, concurrency, idempotency, tenant-isolation, and no-write regression tests before any production consideration.

## Contract boundary

### Existing behavior that remains unchanged

`POST /api/meal-plan/consumption` accepts only `{ mealPlanId, dayIndex, mealType }`. It locks the plan, reads `calendar_payload`, finds the planned ingredients, locks tenant inventory, decrements comparable quantities, inserts `inventory_movements` with `movement_type = 'recipe_consumption'`, and stores an idempotent record in `user_meal_plans.consumption_payload` keyed by `dayIndex:mealType`.

That path is planned consumption evidence. It does not accept actual quantities, substitutions, omissions, or a user assertion of unknown usage. U4 must not reinterpret or overwrite it.

### U4 operation

A future authenticated command accepts exactly one completed U3 session and a bounded reconciliation payload:

```ts
type RealConsumptionReconciliation = {
  sessionId: string;
  expectedSessionVersion: number;
  idempotencyKey: string;
  items: Array<{
    originalIngredient: string;
    outcome: 'used' | 'omitted' | 'unknown' | 'substituted';
    quantity: number | null;
    unit: string | null;
    inventoryItemId: string | null;
    substituteIngredient: string | null;
    substituteInventoryItemId: string | null;
  }>;
};
```

Rules:

- `tenant_id` and `user_id` come from the authenticated server session.
- The session must be `completed`, belong to the caller, reference the exact confirmed slot and recipe/version, and still match its source snapshot hash.
- `used` and valid `substituted` items require a positive known quantity, a recognized unit, an owned inventory item, and a compatible conversion.
- `omitted` requires no quantity and creates no movement.
- `unknown` requires `quantity = null`, creates no movement, and is preserved as an explicit uncertainty.
- A substitution records both the original ingredient and the effective substitute; it never changes the recipe or slot.
- Empty items, duplicate originals, duplicate substitutions, unsupported fields, oversized payloads, incompatible units, stale versions, and mismatched slot references are rejected before any write.
- The response is a sanitized operation result; it does not expose foreign-resource existence or raw request data.

## Proposed migration 019 (design only; not executable)

The design uses a slot claim guard, an immutable operation header, normalized detail rows, substitutions, and movement links. The guard is necessary because the legacy endpoint currently stores its idempotency marker only inside JSON and cannot otherwise be atomically coordinated with U4.

### 1. `meal_consumption_claims`

One row owns the inventory-consumption boundary for a tenant/user/plan slot:

```sql
create table public.meal_consumption_claims (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  user_id uuid not null,
  meal_plan_id uuid not null,
  day_index integer not null,
  meal_type text not null,
  mode text not null check (mode in ('planned_legacy', 'real_reconciliation')),
  operation_id uuid null,
  created_at timestamptz not null default now(),
  constraint meal_consumption_claims_slot_key
    unique (tenant_id, user_id, meal_plan_id, day_index, meal_type),
  constraint meal_consumption_claims_plan_owner_fk
    foreign key (meal_plan_id, tenant_id, user_id)
    references public.user_meal_plans (id, tenant_id, user_id)
);
```

The legacy repository must acquire this row, or observe the existing row, inside its existing plan lock transaction. A slot already claimed by either mode returns the existing planned or reconciled result and performs no second decrement. This is an application compatibility requirement, not something migration SQL alone can retrofit into the old endpoint.

### 2. `real_consumption_operations`

The immutable operation header stores the request identity and source evidence:

```sql
create table public.real_consumption_operations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  user_id uuid not null,
  cooking_session_id uuid not null,
  meal_plan_id uuid not null,
  day_index integer not null,
  meal_type text not null,
  recipe_id uuid not null,
  recipe_version_id uuid not null,
  idempotency_key text not null,
  request_hash text not null,
  source_snapshot_hash text not null,
  status text not null check (status in ('confirmed', 'rejected')),
  created_at timestamptz not null default now(),
  confirmed_at timestamptz null,
  constraint real_consumption_operations_idempotency_key
    unique (tenant_id, user_id, idempotency_key),
  constraint real_consumption_operations_id_tenant_user_key
    unique (id, tenant_id, user_id),
  constraint real_consumption_operations_slot_key
    unique (tenant_id, user_id, cooking_session_id),
  constraint real_consumption_operations_session_fk
    foreign key (cooking_session_id, tenant_id, user_id)
    references public.cooking_sessions (id, tenant_id, user_id),
  constraint real_consumption_operations_plan_fk
    foreign key (meal_plan_id, tenant_id, user_id)
    references public.user_meal_plans (id, tenant_id, user_id)
);
```

`request_hash` is a canonical SHA-256 hash of the validated, sorted payload, not of raw JSON. A retry with the same tenant/user/key and the same hash returns the original operation. A different hash returns an idempotency conflict and changes nothing. A confirmed operation is immutable; rejected attempts may be retained only as bounded audit evidence if the retention policy is approved.

### 3. `real_consumption_items`

```sql
create table public.real_consumption_items (
  id uuid primary key default gen_random_uuid(),
  operation_id uuid not null,
  tenant_id uuid not null,
  user_id uuid not null,
  original_ingredient text not null,
  outcome text not null check (outcome in ('used', 'omitted', 'unknown', 'substituted')),
  effective_ingredient text null,
  quantity numeric(12,4) null,
  unit text null,
  quantity_status text not null check (quantity_status in ('known', 'unknown')),
  inventory_item_id uuid null,
  created_at timestamptz not null default now(),
  constraint real_consumption_items_operation_fk
    foreign key (operation_id, tenant_id, user_id)
    references public.real_consumption_operations (id, tenant_id, user_id),
  constraint real_consumption_items_id_operation_owner_key
    unique (id, operation_id, tenant_id, user_id),
  constraint real_consumption_items_inventory_fk
    foreign key (inventory_item_id)
    references public.recipe_inventory_items (id),
  constraint real_consumption_items_quantity_check
    check ((quantity_status = 'unknown' and quantity is null)
       or (quantity_status = 'known' and quantity is not null and quantity > 0)),
  constraint real_consumption_items_outcome_check
    check ((outcome in ('omitted', 'unknown') and inventory_item_id is null)
       or (outcome in ('used', 'substituted') and inventory_item_id is not null)
  )
);
```

The future implementation must add a tenant-safe inventory foreign key after verifying the available composite key, or lock and validate ownership in the same transaction until that key exists. The plain `inventory_item_id` reference above is conceptual and must not be adopted without the corresponding tenant-safe key.

A unique normalized original ingredient per operation is required in the implementation. The exact expression/index must be compatible with the existing normalization rules; duplicate needs must be consolidated before persistence rather than silently double-counted.

### 4. `real_consumption_substitutions`

```sql
create table public.real_consumption_substitutions (
  id uuid primary key default gen_random_uuid(),
  operation_id uuid not null,
  item_id uuid not null,
  tenant_id uuid not null,
  user_id uuid not null,
  original_ingredient text not null,
  substitute_ingredient text not null,
  substitute_inventory_item_id uuid not null,
  created_at timestamptz not null default now(),
  constraint real_consumption_substitutions_item_fk
    foreign key (item_id, operation_id, tenant_id, user_id)
    references public.real_consumption_items (id, operation_id, tenant_id, user_id),
  constraint real_consumption_substitutions_operation_fk
    foreign key (operation_id, tenant_id, user_id)
    references public.real_consumption_operations (id, tenant_id, user_id)
);
```

The required composite unique keys must be created before these foreign keys. A substitution is valid only when the item outcome is `substituted`, both ingredient names are bounded and non-empty, and the substitute inventory row belongs to the same tenant/user.

### 5. `real_consumption_movement_links`

```sql
create table public.real_consumption_movement_links (
  operation_id uuid not null,
  movement_id uuid not null,
  tenant_id uuid not null,
  user_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (operation_id, movement_id),
  unique (movement_id),
  foreign key (operation_id, tenant_id, user_id)
    references public.real_consumption_operations (id, tenant_id, user_id),
  foreign key (movement_id)
    references public.inventory_movements (id)
);
```

The link is the audit join between a confirmed operation and its inventory movements. It does not modify `consumption_payload` and does not permit an operation to claim the same movement twice.

## Atomic command transaction

A future U4 command must execute all of the following on one connection and transaction:

1. Derive tenant/user from authentication and set `app.tenant_id` and `app.user_id` locally.
2. Lock the U3 session with `FOR UPDATE`; require `completed`, exact recipe/version, confirmed slot, and matching source hash/version.
3. Lock the plan slot and acquire the unique `meal_consumption_claims` row. If the legacy JSON marker or claim exists, return a typed already-consumed/conflict result without touching inventory.
4. Validate and canonicalize the complete payload, including normalized ingredient identity, positive quantities, known/unknown semantics, substitutions, unit compatibility, and bounded limits.
5. Check the idempotency key and request hash. Same key/hash returns the committed prior result; same key/different hash aborts with no writes.
6. Lock all referenced inventory rows in deterministic UUID order. Reject foreign rows, expired rows where policy disallows use, incompatible units, or insufficient total available quantity before any decrement.
7. Insert the operation header, item/detail rows, substitutions, inventory movements, and movement links.
8. Update inventory quantities only for known, valid, compatible used/substitute items. Unknown and omitted items create no movement.
9. Commit. Any failure rolls back operation rows, movements, and inventory updates together.

The operation must reject quantities above available stock rather than silently clamp them. Partial availability is represented only when the explicit user payload says so and the movement amount itself remains bounded by available stock; the default safe behavior is fail closed for a known requested quantity that cannot be reconciled.

## Required invariants

| Risk | Control |
|---|---|
| Simultaneous double discount | Plan/session locks plus one unique slot claim and deterministic inventory locks. |
| Retry double discount | Unique `(tenant_id, user_id, idempotency_key)` plus canonical payload hash. |
| Legacy/U4 double discount | Both paths must acquire the same `meal_consumption_claims` row; legacy JSON alone is not sufficient. |
| Unknown quantity consumed | `quantity_status = unknown`, `quantity IS NULL`, no inventory item, no movement. |
| Invalid conversion | Reuse `normalizeUnit`, `canCompareUnits`, and `convertQuantity`; incompatible units remain rejected/unknown. |
| Foreign inventory | Auth-derived tenant/user, RLS, tenant-safe FK, ownership check under lock. |
| Excess quantity | Lock rows, compare normalized available totals, reject before mutation. |
| Stale session/source | Completed U3 session, expected version, exact source hash and recipe/version revalidation. |
| Partial writes | One transaction; no externally visible operation until all inserts and updates commit. |
| Contradictory retry | Same key with different canonical hash returns conflict and performs no write. |
| Recipe/plan mutation | U4 never updates recipe, version, plan calendar, or `consumption_payload`. |

## RLS, ownership, and permissions

All new tables must use `ENABLE ROW LEVEL SECURITY` and `FORCE ROW LEVEL SECURITY`. Policies must require both transaction settings:

```sql
using (
  tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
  and user_id = nullif(current_setting('app.user_id', true), '')::uuid
)
with check (
  tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
  and user_id = nullif(current_setting('app.user_id', true), '')::uuid
)
```

- Application roles may insert immutable operation/detail rows but may not update or delete them.
- Inventory updates and movement inserts remain inside the repository transaction; no client role receives direct table access.
- The migration must register owners, grants, indexes, constraints, policies, and dependent types through the repository's manifest workflow.
- `inventory_movements` is currently tenant-scoped by columns but lacks the U4 idempotency contract; movement links and the shared claim guard supply the missing operation-level protection.
- RLS tests must prove missing or mismatched context cannot read or mutate another tenant.

## Migration and rollback strategy

Migration 019 must be additive and must not rewrite existing rows. Before authoring SQL:

1. Re-read `db/migrations/manifest.json` and verify 018 is the trusted latest migration.
2. Verify exact composite keys available on `user_meal_plans`, `cooking_sessions`, `recipe_inventory_items`, and `inventory_movements`.
3. Create dependent unique keys before composite foreign keys.
4. Update the manifest only through the repository's checksum/inventory tooling.
5. Run provisioning, migration, ledger verification, RLS tests, concurrency tests, and repository tests against a new disposable PostgreSQL 16/pgvector instance.
6. Deploy application compatibility code before enabling U4 commands; otherwise the legacy endpoint can race with the new path.

Application rollback must not drop U4 tables or delete audit rows. A failed release rolls back application code only; recovery uses a forward fix or separately approved schema procedure. Database restore is not part of this proposal and must not be attempted as part of local design work.

## Test plan

### Pure/domain and API tests

- known used quantity, omitted item, unknown item, and valid substitution;
- duplicate original ingredients consolidated or rejected;
- incompatible units and malformed quantities remain unknown/rejected;
- expired or inaccessible inventory is never consumed;
- missing fields, excess items, oversized names, invalid IDs, and stale versions fail closed;
- anonymous, wrong-user, and wrong-tenant access are indistinguishable from not found;
- same payload/key is idempotent; same key/different payload is a conflict;
- no recipe, plan calendar, `consumption_payload`, shopping, or cooking-session mutation occurs.

### Disposable PostgreSQL concurrency tests

- two concurrent U4 commands for one session/slot produce one operation and one set of movements;
- legacy planned consumption racing U4 produces exactly one claimed mode and no double decrement;
- two inventory rows are locked in deterministic order without deadlock;
- insufficient stock rolls back all detail rows and movements;
- movement-link uniqueness rejects accidental reuse;
- RLS denies foreign session, plan, inventory, operation, and movement access;
- a failure after the first inventory update rolls back every update and preserves no partial operation.

### E2E tests

On disposable PostgreSQL/Redis only:

1. complete a U3 session;
2. submit known, omitted, unknown, and substitution outcomes;
3. reload and verify the immutable reconciliation result;
4. retry and verify no extra movement;
5. race the legacy endpoint and verify the shared slot claim;
6. verify inventory, movement, recipe, plan, shopping, and `consumption_payload` deltas explicitly;
7. verify tenant/user isolation and accessible keyboard/mobile UI.

## Runtime check

The repository declares Node `22.22.3` in `.nvmrc`, and the current runtime is already `v22.22.3`; no version switch or dependency installation was needed. The requested focused Vitest command was retried under that runtime but still failed before test collection with:

```text
Error [ERR_REQUIRE_ESM]: require() of ES Module .../node_modules/std-env/dist/index.mjs not supported
```

This is an installed dependency/toolchain mismatch, not a U4 test result. `package-lock.json` was not changed and no packages were installed.

## Decisions still requiring owner approval

- Approve the additive 019 model and the shared legacy/U4 slot claim boundary.
- Approve rejection of known quantities that exceed available stock, rather than silent partial decrement.
- Approve retention and visibility policy for rejected reconciliation attempts.
- Approve the application compatibility change to the legacy endpoint before enabling U4 writes.
- Approve disposable-only migration and concurrency validation; no production migration is implied.

## Verdict

**SCHEMA DESIGN GO**, with implementation blocked until the decisions above are approved. No SQL migration, endpoint, database, production, or GitHub operation was performed.
