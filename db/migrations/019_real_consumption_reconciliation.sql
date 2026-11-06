-- Migration 019: M5 U4 real-consumption reconciliation schema.
-- This migration creates durable audit boundaries only. It never mutates inventory
-- and does not retrofit the legacy consumption endpoint.

-- Composite keys make every new foreign key tenant-safe. They are redundant with
-- existing UUID primary keys but prevent cross-tenant references at the database
-- boundary without changing row identity.
alter table public.recipe_inventory_items
  add constraint recipe_inventory_items_id_tenant_id_user_id_key
  unique (id, tenant_id, user_id);

alter table public.inventory_movements
  add constraint inventory_movements_id_tenant_id_user_id_key
  unique (id, tenant_id, user_id);

alter table public.cooking_sessions
  add constraint cooking_sessions_reconciliation_identity_key
  unique (id, tenant_id, user_id, meal_plan_id, day_index, meal_type, recipe_id, recipe_version_id);

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
    status text not null default 'confirmed',
    created_at timestamptz not null default now(),
    confirmed_at timestamptz null,
    constraint real_consumption_operations_id_tenant_id_user_id_key
      unique (id, tenant_id, user_id),
    constraint real_consumption_operations_idempotency_key_key
      unique (tenant_id, user_id, idempotency_key),
    constraint real_consumption_operations_session_key
      unique (cooking_session_id, tenant_id, user_id),
    constraint real_consumption_operations_aggregate_status_key
      unique (id, tenant_id, user_id, meal_plan_id, day_index, meal_type, status),
    constraint real_consumption_operations_day_index_check
      check (day_index between 1 and 30),
    constraint real_consumption_operations_meal_type_check
      check (meal_type in ('breakfast', 'lunch', 'dinner')),
    constraint real_consumption_operations_idempotency_key_check
      check (length(btrim(idempotency_key)) between 1 and 200),
    constraint real_consumption_operations_request_hash_check
      check (request_hash ~ '^[0-9a-f]{64}$'),
    constraint real_consumption_operations_source_hash_check
      check (source_snapshot_hash ~ '^[0-9a-f]{64}$'),
    constraint real_consumption_operations_status_check
      check (status in ('confirmed', 'rejected')),
    constraint real_consumption_operations_confirmation_check
      check ((status = 'confirmed' and confirmed_at is not null)
          or (status = 'rejected' and confirmed_at is null)),
    constraint real_consumption_operations_session_aggregate_fkey
      foreign key (cooking_session_id, tenant_id, user_id, meal_plan_id, day_index, meal_type, recipe_id, recipe_version_id)
      references public.cooking_sessions
        (id, tenant_id, user_id, meal_plan_id, day_index, meal_type, recipe_id, recipe_version_id),
    constraint real_consumption_operations_plan_owner_fkey
      foreign key (meal_plan_id, tenant_id, user_id)
      references public.user_meal_plans (id, tenant_id, user_id),
    constraint real_consumption_operations_recipe_owner_fkey
      foreign key (recipe_id, tenant_id, user_id)
      references public.user_recipes (id, tenant_id, user_id),
    constraint real_consumption_operations_version_owner_fkey
      foreign key (recipe_version_id, recipe_id, tenant_id, user_id)
      references public.user_recipe_versions (id, recipe_id, tenant_id, user_id)
);

create unique index real_consumption_operations_confirmed_slot_key
  on public.real_consumption_operations
    (tenant_id, user_id, meal_plan_id, day_index, meal_type)
  where status = 'confirmed';

create index idx_real_consumption_operations_tenant_user_created_at
  on public.real_consumption_operations (tenant_id, user_id, created_at desc);

create table public.meal_consumption_claims (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid not null,
    user_id uuid not null,
    meal_plan_id uuid not null,
    day_index integer not null,
    meal_type text not null,
    mode text not null,
    operation_id uuid null,
    operation_status text null,
    created_at timestamptz not null default now(),
    constraint meal_consumption_claims_slot_key
      unique (tenant_id, user_id, meal_plan_id, day_index, meal_type),
    constraint meal_consumption_claims_operation_key
      unique (operation_id),
    constraint meal_consumption_claims_day_index_check
      check (day_index between 1 and 30),
    constraint meal_consumption_claims_meal_type_check
      check (meal_type in ('breakfast', 'lunch', 'dinner')),
    constraint meal_consumption_claims_mode_check
      check (mode in ('planned_legacy', 'real_reconciliation')),
    constraint meal_consumption_claims_mode_operation_check
      check ((mode = 'planned_legacy' and operation_id is null and operation_status is null)
          or (mode = 'real_reconciliation'
              and operation_id is not null
              and operation_status = 'confirmed')),
    constraint meal_consumption_claims_operation_status_check
      check (operation_status is null or operation_status = 'confirmed'),
    constraint meal_consumption_claims_plan_owner_fkey
      foreign key (meal_plan_id, tenant_id, user_id)
      references public.user_meal_plans (id, tenant_id, user_id),
    constraint meal_consumption_claims_operation_owner_fkey
      foreign key (operation_id, tenant_id, user_id, meal_plan_id, day_index, meal_type, operation_status)
      references public.real_consumption_operations
        (id, tenant_id, user_id, meal_plan_id, day_index, meal_type, status)
);

create index idx_meal_consumption_claims_operation_id
  on public.meal_consumption_claims (operation_id)
  where operation_id is not null;

create table public.real_consumption_items (
    id uuid primary key default gen_random_uuid(),
    operation_id uuid not null,
    tenant_id uuid not null,
    user_id uuid not null,
    original_ingredient text not null,
    normalized_original_ingredient text not null,
    outcome text not null,
    effective_ingredient text null,
    normalized_effective_ingredient text null,
    quantity numeric(12,4) null,
    unit text null,
    quantity_status text not null,
    inventory_item_id uuid null,
    created_at timestamptz not null default now(),
    constraint real_consumption_items_id_operation_owner_key
      unique (id, operation_id, tenant_id, user_id),
    constraint real_consumption_items_original_key
      unique (operation_id, normalized_original_ingredient),
    constraint real_consumption_items_operation_owner_fkey
      foreign key (operation_id, tenant_id, user_id)
      references public.real_consumption_operations (id, tenant_id, user_id),
    constraint real_consumption_items_inventory_owner_fkey
      foreign key (inventory_item_id, tenant_id, user_id)
      references public.recipe_inventory_items (id, tenant_id, user_id),
    constraint real_consumption_items_outcome_check
      check (outcome in ('used', 'omitted', 'unknown', 'substituted')),
    constraint real_consumption_items_quantity_status_check
      check (quantity_status in ('known', 'unknown')),
    constraint real_consumption_items_quantity_check
      check ((quantity_status = 'unknown' and quantity is null and unit is null)
          or (quantity_status = 'known' and quantity is not null and quantity > 0
              and unit is not null and length(btrim(unit)) between 1 and 64)),
    constraint real_consumption_items_quantity_outcome_check
      check ((quantity_status = 'unknown' and outcome in ('omitted', 'unknown')
              and inventory_item_id is null)
          or (quantity_status = 'known' and outcome in ('used', 'substituted')
              and inventory_item_id is not null)),
    constraint real_consumption_items_outcome_data_check
      check ((outcome in ('omitted', 'unknown') and inventory_item_id is null
              and effective_ingredient is null and normalized_effective_ingredient is null)
          or (outcome in ('used', 'substituted') and inventory_item_id is not null
              and effective_ingredient is not null
              and normalized_effective_ingredient is not null)),
    constraint real_consumption_items_ingredient_bounds_check
      check (length(btrim(original_ingredient)) between 1 and 200
          and length(btrim(normalized_original_ingredient)) between 1 and 200),
    constraint real_consumption_items_effective_bounds_check
      check (effective_ingredient is null or length(btrim(effective_ingredient)) between 1 and 200),
    constraint real_consumption_items_normalized_effective_bounds_check
      check (normalized_effective_ingredient is null
          or length(btrim(normalized_effective_ingredient)) between 1 and 200)
);

create index idx_real_consumption_items_operation_id
  on public.real_consumption_items (operation_id, created_at, id);

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
    constraint real_consumption_substitutions_item_owner_fkey
      foreign key (item_id, operation_id, tenant_id, user_id)
      references public.real_consumption_items (id, operation_id, tenant_id, user_id),
    constraint real_consumption_substitutions_operation_owner_fkey
      foreign key (operation_id, tenant_id, user_id)
      references public.real_consumption_operations (id, tenant_id, user_id),
    constraint real_consumption_substitutions_inventory_owner_fkey
      foreign key (substitute_inventory_item_id, tenant_id, user_id)
      references public.recipe_inventory_items (id, tenant_id, user_id),
    constraint real_consumption_substitutions_bounds_check
      check (length(btrim(original_ingredient)) between 1 and 200
          and length(btrim(substitute_ingredient)) between 1 and 200)
);

create unique index real_consumption_substitutions_item_key
  on public.real_consumption_substitutions (item_id);

create table public.real_consumption_movement_links (
    operation_id uuid not null,
    item_id uuid not null,
    movement_id uuid not null,
    tenant_id uuid not null,
    user_id uuid not null,
    created_at timestamptz not null default now(),
    constraint real_consumption_movement_links_pkey
      primary key (operation_id, item_id, movement_id),
    constraint real_consumption_movement_links_movement_key
      unique (movement_id),
    constraint real_consumption_movement_links_operation_owner_fkey
      foreign key (operation_id, tenant_id, user_id)
      references public.real_consumption_operations (id, tenant_id, user_id),
    constraint real_consumption_movement_links_item_owner_fkey
      foreign key (item_id, operation_id, tenant_id, user_id)
      references public.real_consumption_items (id, operation_id, tenant_id, user_id),
    constraint real_consumption_movement_links_movement_owner_fkey
      foreign key (movement_id, tenant_id, user_id)
      references public.inventory_movements (id, tenant_id, user_id)
);

create index idx_real_consumption_movement_links_operation_id
  on public.real_consumption_movement_links (operation_id, created_at);

create function public.validate_real_consumption_substitution()
returns trigger
language plpgsql
as $$
declare
  item record;
begin
  select original_ingredient, outcome, effective_ingredient, inventory_item_id
    into item
    from public.real_consumption_items
   where id = new.item_id
     and operation_id = new.operation_id
     and tenant_id = new.tenant_id
     and user_id = new.user_id;
  if not found
     or item.outcome <> 'substituted'
     or btrim(item.original_ingredient) <> btrim(new.original_ingredient)
     or btrim(item.effective_ingredient) <> btrim(new.substitute_ingredient)
     or item.inventory_item_id <> new.substitute_inventory_item_id then
    raise exception 'REAL_CONSUMPTION_SUBSTITUTION_MISMATCH';
  end if;
  return new;
end;
$$;

create trigger real_consumption_substitutions_consistency
before insert on public.real_consumption_substitutions
for each row execute function public.validate_real_consumption_substitution();

create function public.validate_real_consumption_movement_link()
returns trigger
language plpgsql
as $$
declare
  item record;
  movement record;
begin
  select inventory_item_id
    into item
    from public.real_consumption_items
   where id = new.item_id
     and operation_id = new.operation_id
     and tenant_id = new.tenant_id
     and user_id = new.user_id;
  select inventory_item_id, movement_type, source, quantity, unit
    into movement
    from public.inventory_movements
   where id = new.movement_id
     and tenant_id = new.tenant_id
     and user_id = new.user_id;
  if not found
     or item.inventory_item_id is null
     or movement.inventory_item_id <> item.inventory_item_id
     or movement.movement_type <> 'recipe_consumption'
     or movement.quantity <= 0
     or movement.source <> 'real-consumption:' || new.operation_id::text
     or movement.unit <> (select unit from public.real_consumption_items where id = new.item_id)
     or movement.quantity <> (select quantity from public.real_consumption_items where id = new.item_id) then
    raise exception 'REAL_CONSUMPTION_MOVEMENT_LINK_MISMATCH';
  end if;
  return new;
end;
$$;

create trigger real_consumption_movement_links_consistency
before insert on public.real_consumption_movement_links
for each row execute function public.validate_real_consumption_movement_link();

-- Immutable audit records. The operation header is inserted before its claim in
-- one transaction, so the claim itself never needs an update after insertion.
create function public.reject_real_consumption_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'REAL_CONSUMPTION_AUDIT_APPEND_ONLY';
end;
$$;

create trigger real_consumption_operations_append_only
before update or delete on public.real_consumption_operations
for each row execute function public.reject_real_consumption_mutation();

create trigger real_consumption_items_append_only
before update or delete on public.real_consumption_items
for each row execute function public.reject_real_consumption_mutation();

create trigger real_consumption_substitutions_append_only
before update or delete on public.real_consumption_substitutions
for each row execute function public.reject_real_consumption_mutation();

create trigger real_consumption_movement_links_append_only
before update or delete on public.real_consumption_movement_links
for each row execute function public.reject_real_consumption_mutation();

create trigger meal_consumption_claims_append_only
before update or delete on public.meal_consumption_claims
for each row execute function public.reject_real_consumption_mutation();

alter table public.real_consumption_operations enable row level security;
alter table public.real_consumption_operations force row level security;
alter table public.meal_consumption_claims enable row level security;
alter table public.meal_consumption_claims force row level security;
alter table public.real_consumption_items enable row level security;
alter table public.real_consumption_items force row level security;
alter table public.real_consumption_substitutions enable row level security;
alter table public.real_consumption_substitutions force row level security;
alter table public.real_consumption_movement_links enable row level security;
alter table public.real_consumption_movement_links force row level security;

create policy real_consumption_operations_tenant_user_isolation
  on public.real_consumption_operations
  using (
    tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
    and user_id = nullif(current_setting('app.user_id', true), '')::uuid
  )
  with check (
    tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
    and user_id = nullif(current_setting('app.user_id', true), '')::uuid
  );

create policy meal_consumption_claims_tenant_user_isolation
  on public.meal_consumption_claims
  using (
    tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
    and user_id = nullif(current_setting('app.user_id', true), '')::uuid
  )
  with check (
    tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
    and user_id = nullif(current_setting('app.user_id', true), '')::uuid
  );

create policy real_consumption_items_tenant_user_isolation
  on public.real_consumption_items
  using (
    tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
    and user_id = nullif(current_setting('app.user_id', true), '')::uuid
  )
  with check (
    tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
    and user_id = nullif(current_setting('app.user_id', true), '')::uuid
  );

create policy real_consumption_substitutions_tenant_user_isolation
  on public.real_consumption_substitutions
  using (
    tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
    and user_id = nullif(current_setting('app.user_id', true), '')::uuid
  )
  with check (
    tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
    and user_id = nullif(current_setting('app.user_id', true), '')::uuid
  );

create policy real_consumption_movement_links_tenant_user_isolation
  on public.real_consumption_movement_links
  using (
    tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
    and user_id = nullif(current_setting('app.user_id', true), '')::uuid
  )
  with check (
    tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
    and user_id = nullif(current_setting('app.user_id', true), '')::uuid
  );

comment on table public.meal_consumption_claims is
  'Shared per-slot claim that coordinates planned legacy consumption with M5 U4 reconciliation.';
comment on table public.real_consumption_operations is
  'Immutable M5 U4 actual-use reconciliation operation header.';
comment on table public.real_consumption_items is
  'Immutable M5 U4 actual-use, omitted, unknown, and substitution details.';
comment on table public.real_consumption_substitutions is
  'Immutable M5 U4 substitution audit details.';
comment on table public.real_consumption_movement_links is
  'Immutable links from M5 U4 operations to inventory movements.';
