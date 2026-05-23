-- Shopping list persistence for premium detail and planner actions
begin;

create table if not exists public.shopping_list_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  source text not null default 'manual',
  premium_recipe_id uuid references public.premium_recipes(id) on delete set null,
  ingredient_name text not null,
  quantity text,
  status text not null default 'pending' check (status in ('pending', 'purchased')),
  created_at timestamptz not null default timezone('utc'::text, now()),
  updated_at timestamptz not null default timezone('utc'::text, now())
);

create index if not exists idx_shopping_list_items_tenant_user_created
  on public.shopping_list_items (tenant_id, user_id, created_at desc);

create unique index if not exists uq_shopping_list_items_user_pending_ingredient
  on public.shopping_list_items (tenant_id, user_id, ingredient_name, status)
  where status = 'pending';

alter table public.shopping_list_items enable row level security;

drop policy if exists "Members can read own shopping list items" on public.shopping_list_items;
create policy "Members can read own shopping list items"
  on public.shopping_list_items
  for select
  using (tenant_id = public.get_auth_tenant_id() and user_id = auth.uid());

drop policy if exists "Members can insert own shopping list items" on public.shopping_list_items;
create policy "Members can insert own shopping list items"
  on public.shopping_list_items
  for insert
  with check (tenant_id = public.get_auth_tenant_id() and user_id = auth.uid());

drop policy if exists "Members can update own shopping list items" on public.shopping_list_items;
create policy "Members can update own shopping list items"
  on public.shopping_list_items
  for update
  using (tenant_id = public.get_auth_tenant_id() and user_id = auth.uid())
  with check (tenant_id = public.get_auth_tenant_id() and user_id = auth.uid());

drop policy if exists "Members can delete own shopping list items" on public.shopping_list_items;
create policy "Members can delete own shopping list items"
  on public.shopping_list_items
  for delete
  using (tenant_id = public.get_auth_tenant_id() and user_id = auth.uid());

commit;
