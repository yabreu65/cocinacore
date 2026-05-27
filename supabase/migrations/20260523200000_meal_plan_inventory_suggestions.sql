begin;

alter table public.user_meal_plans
  add column if not exists people_count integer not null default 4 check (people_count > 0 and people_count <= 50);

create table if not exists public.user_meal_plan_inventory_suggestions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  meal_plan_id uuid not null references public.user_meal_plans(id) on delete cascade,
  people_count integer not null check (people_count > 0 and people_count <= 50),
  period text not null check (period in ('week', 'fortnight', 'month')),
  normalized_items jsonb not null,
  raw_items jsonb not null,
  created_at timestamptz not null default timezone('utc'::text, now()),
  updated_at timestamptz not null default timezone('utc'::text, now()),
  constraint uq_user_meal_inventory_suggestion_singleton unique (tenant_id, user_id)
);

create index if not exists idx_user_meal_inventory_suggestion_tenant_user
  on public.user_meal_plan_inventory_suggestions (tenant_id, user_id, updated_at desc);

alter table public.user_meal_plan_inventory_suggestions enable row level security;

drop policy if exists "Members can read own meal inventory suggestion" on public.user_meal_plan_inventory_suggestions;
create policy "Members can read own meal inventory suggestion"
  on public.user_meal_plan_inventory_suggestions
  for select
  using (tenant_id = public.get_auth_tenant_id() and user_id = auth.uid());

drop policy if exists "Members can insert own meal inventory suggestion" on public.user_meal_plan_inventory_suggestions;
create policy "Members can insert own meal inventory suggestion"
  on public.user_meal_plan_inventory_suggestions
  for insert
  with check (tenant_id = public.get_auth_tenant_id() and user_id = auth.uid());

drop policy if exists "Members can update own meal inventory suggestion" on public.user_meal_plan_inventory_suggestions;
create policy "Members can update own meal inventory suggestion"
  on public.user_meal_plan_inventory_suggestions
  for update
  using (tenant_id = public.get_auth_tenant_id() and user_id = auth.uid())
  with check (tenant_id = public.get_auth_tenant_id() and user_id = auth.uid());

drop policy if exists "Members can delete own meal inventory suggestion" on public.user_meal_plan_inventory_suggestions;
create policy "Members can delete own meal inventory suggestion"
  on public.user_meal_plan_inventory_suggestions
  for delete
  using (tenant_id = public.get_auth_tenant_id() and user_id = auth.uid());

commit;
