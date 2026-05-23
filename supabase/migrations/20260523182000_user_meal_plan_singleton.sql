-- Single active meal plan per user+tenant
begin;

create table if not exists public.user_meal_plans (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  period text not null check (period in ('week', 'fortnight', 'month')),
  mode text not null check (mode in ('inventory_to_menu', 'menu_to_shopping', 'balanced_ai')),
  base_cuisine text not null,
  fusion_cuisines text[] not null default '{}',
  fusion_intensity text not null check (fusion_intensity in ('sutil', 'media', 'alta')),
  goal text,
  restrictions text[] not null default '{}',
  inventory_snapshot jsonb not null default '[]'::jsonb,
  calendar_payload jsonb not null,
  ai_content text,
  created_at timestamptz not null default timezone('utc'::text, now()),
  updated_at timestamptz not null default timezone('utc'::text, now()),
  constraint uq_user_meal_plan_singleton unique (tenant_id, user_id)
);

create index if not exists idx_user_meal_plans_tenant_user
  on public.user_meal_plans (tenant_id, user_id, updated_at desc);

alter table public.user_meal_plans enable row level security;

drop policy if exists "Members can read own meal plan" on public.user_meal_plans;
create policy "Members can read own meal plan"
  on public.user_meal_plans
  for select
  using (tenant_id = public.get_auth_tenant_id() and user_id = auth.uid());

drop policy if exists "Members can insert own meal plan" on public.user_meal_plans;
create policy "Members can insert own meal plan"
  on public.user_meal_plans
  for insert
  with check (tenant_id = public.get_auth_tenant_id() and user_id = auth.uid());

drop policy if exists "Members can update own meal plan" on public.user_meal_plans;
create policy "Members can update own meal plan"
  on public.user_meal_plans
  for update
  using (tenant_id = public.get_auth_tenant_id() and user_id = auth.uid())
  with check (tenant_id = public.get_auth_tenant_id() and user_id = auth.uid());

drop policy if exists "Members can delete own meal plan" on public.user_meal_plans;
create policy "Members can delete own meal plan"
  on public.user_meal_plans
  for delete
  using (tenant_id = public.get_auth_tenant_id() and user_id = auth.uid());

commit;
