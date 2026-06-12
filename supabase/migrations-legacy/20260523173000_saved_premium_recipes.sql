-- Saved premium recipes per user/tenant
begin;

create table if not exists public.saved_premium_recipes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  premium_recipe_id uuid not null references public.premium_recipes(id) on delete cascade,
  notes text,
  created_at timestamptz not null default timezone('utc'::text, now()),
  updated_at timestamptz not null default timezone('utc'::text, now()),
  constraint uq_saved_premium_recipes unique (tenant_id, user_id, premium_recipe_id)
);

create index if not exists idx_saved_premium_recipes_tenant_user_created
  on public.saved_premium_recipes (tenant_id, user_id, created_at desc);

alter table public.saved_premium_recipes enable row level security;

drop policy if exists "Members can read own saved premium recipes" on public.saved_premium_recipes;
create policy "Members can read own saved premium recipes"
  on public.saved_premium_recipes
  for select
  using (tenant_id = public.get_auth_tenant_id() and user_id = auth.uid());

drop policy if exists "Members can save own premium recipes" on public.saved_premium_recipes;
create policy "Members can save own premium recipes"
  on public.saved_premium_recipes
  for insert
  with check (tenant_id = public.get_auth_tenant_id() and user_id = auth.uid());

drop policy if exists "Members can update own saved premium recipes" on public.saved_premium_recipes;
create policy "Members can update own saved premium recipes"
  on public.saved_premium_recipes
  for update
  using (tenant_id = public.get_auth_tenant_id() and user_id = auth.uid())
  with check (tenant_id = public.get_auth_tenant_id() and user_id = auth.uid());

drop policy if exists "Members can delete own saved premium recipes" on public.saved_premium_recipes;
create policy "Members can delete own saved premium recipes"
  on public.saved_premium_recipes
  for delete
  using (tenant_id = public.get_auth_tenant_id() and user_id = auth.uid());

commit;
