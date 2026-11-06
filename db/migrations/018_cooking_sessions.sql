-- Migration 018: durable guided cooking sessions and idempotent progress events
-- This migration records session progress only. It never mutates inventory or consumption.

-- These composite keys make tenant-safe foreign keys possible without changing row identity.
alter table public.user_meal_plans
  add constraint user_meal_plans_id_tenant_id_user_id_key
  unique (id, tenant_id, user_id);

alter table public.user_recipe_versions
  add constraint user_recipe_versions_id_recipe_id_tenant_id_user_id_key
  unique (id, recipe_id, tenant_id, user_id);

create table public.cooking_sessions (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid not null,
    user_id uuid not null,
    meal_plan_id uuid not null,
    day_index integer not null,
    meal_type text not null,
    recipe_id uuid not null,
    recipe_version_id uuid not null,
    status text not null default 'active',
    current_step integer not null default 1,
    total_steps integer not null,
    instruction_snapshot jsonb not null,
    source_updated_at timestamptz not null,
    source_calendar_payload_hash text not null,
    version integer not null default 1,
    started_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    completed_at timestamptz null,
    cancelled_at timestamptz null,
    retention_until timestamptz null,
    constraint cooking_sessions_day_index_check
      check (day_index between 1 and 30),
    constraint cooking_sessions_meal_type_check
      check (meal_type in ('breakfast', 'lunch', 'dinner')),
    constraint cooking_sessions_status_check
      check (status in ('active', 'paused', 'completed', 'cancelled')),
    constraint cooking_sessions_current_step_check
      check (current_step between 1 and total_steps),
    constraint cooking_sessions_total_steps_check
      check (total_steps between 1 and 100),
    constraint cooking_sessions_instruction_snapshot_check
      check (jsonb_typeof(instruction_snapshot) = 'object'),
    constraint cooking_sessions_source_hash_check
      check (source_calendar_payload_hash ~ '^[0-9a-f]{64}$'),
    constraint cooking_sessions_version_check
      check (version >= 1),
    constraint cooking_sessions_lifecycle_check
      check (
        (status in ('active', 'paused')
          and completed_at is null
          and cancelled_at is null
          and retention_until is null)
        or (status = 'completed'
          and current_step = total_steps
          and completed_at is not null
          and cancelled_at is null
          and retention_until = completed_at + interval '365 days')
        or (status = 'cancelled'
          and completed_at is null
          and cancelled_at is not null
          and retention_until = cancelled_at + interval '90 days')
      ),
    constraint cooking_sessions_plan_owner_fkey
      foreign key (meal_plan_id, tenant_id, user_id)
      references public.user_meal_plans (id, tenant_id, user_id),
    constraint cooking_sessions_recipe_owner_fkey
      foreign key (recipe_id, tenant_id, user_id)
      references public.user_recipes (id, tenant_id, user_id),
    constraint cooking_sessions_version_owner_fkey
      foreign key (recipe_version_id, recipe_id, tenant_id, user_id)
      references public.user_recipe_versions (id, recipe_id, tenant_id, user_id),
    constraint cooking_sessions_id_tenant_id_user_id_key
      unique (id, tenant_id, user_id)
);

create unique index cooking_sessions_one_open_slot
  on public.cooking_sessions (tenant_id, user_id, meal_plan_id, day_index, meal_type)
  where status in ('active', 'paused');

create index idx_cooking_sessions_tenant_user_updated_at
  on public.cooking_sessions (tenant_id, user_id, updated_at desc);

create index idx_cooking_sessions_meal_plan_slot
  on public.cooking_sessions (tenant_id, user_id, meal_plan_id, day_index, meal_type);

create table public.cooking_session_events (
    id uuid primary key default gen_random_uuid(),
    session_id uuid not null,
    tenant_id uuid not null,
    user_id uuid not null,
    operation_type text not null,
    previous_step integer not null,
    next_step integer not null,
    previous_status text not null,
    next_status text not null,
    idempotency_key text not null,
    payload_hash text not null,
    created_at timestamptz not null default now(),
    constraint cooking_session_events_operation_type_check
      check (operation_type in ('start', 'resume', 'pause', 'advance', 'complete', 'cancel')),
    constraint cooking_session_events_previous_step_check
      check (previous_step >= 1),
    constraint cooking_session_events_next_step_check
      check (next_step >= 1),
    constraint cooking_session_events_previous_status_check
      check (previous_status in ('active', 'paused', 'completed', 'cancelled')),
    constraint cooking_session_events_next_status_check
      check (next_status in ('active', 'paused', 'completed', 'cancelled')),
    constraint cooking_session_events_idempotency_key_check
      check (length(btrim(idempotency_key)) between 1 and 200),
    constraint cooking_session_events_payload_hash_check
      check (payload_hash ~ '^[0-9a-f]{64}$'),
    constraint cooking_session_events_session_owner_fkey
      foreign key (session_id, tenant_id, user_id)
      references public.cooking_sessions (id, tenant_id, user_id),
    constraint cooking_session_events_session_id_idempotency_key_key
      unique (session_id, idempotency_key)
);

create index idx_cooking_session_events_session_created_at
  on public.cooking_session_events (session_id, created_at, id);

alter table public.cooking_sessions enable row level security;
alter table public.cooking_sessions force row level security;

create policy cooking_sessions_tenant_user_isolation
  on public.cooking_sessions
  using (
    tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
    and user_id = nullif(current_setting('app.user_id', true), '')::uuid
  )
  with check (
    tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
    and user_id = nullif(current_setting('app.user_id', true), '')::uuid
  );

alter table public.cooking_session_events enable row level security;
alter table public.cooking_session_events force row level security;

create policy cooking_session_events_tenant_user_isolation
  on public.cooking_session_events
  using (
    tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
    and user_id = nullif(current_setting('app.user_id', true), '')::uuid
  )
  with check (
    tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
    and user_id = nullif(current_setting('app.user_id', true), '')::uuid
  );
