begin;

create table if not exists public.inventory_movements (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  inventory_item_id uuid not null references public.recipe_inventory_items(id) on delete cascade,
  movement_type text not null check (movement_type in ('purchase', 'recipe_consumption', 'manual_adjustment', 'correction')),
  quantity numeric not null check (quantity > 0),
  unit text not null,
  normalized_name text not null,
  source text not null default 'manual',
  source_recipe text null,
  source_meal_plan_id uuid null references public.user_meal_plans(id) on delete set null,
  notes text null,
  created_at timestamptz not null default timezone('utc'::text, now())
);

create index if not exists idx_inventory_movements_tenant_user_created
  on public.inventory_movements (tenant_id, user_id, created_at desc);

create index if not exists idx_inventory_movements_inventory_item
  on public.inventory_movements (inventory_item_id, created_at desc);

alter table public.inventory_movements enable row level security;

drop policy if exists "Members can read own inventory movements" on public.inventory_movements;
create policy "Members can read own inventory movements"
  on public.inventory_movements
  for select
  using (tenant_id = public.get_auth_tenant_id() and user_id = auth.uid());

drop policy if exists "Members can insert own inventory movements" on public.inventory_movements;
create policy "Members can insert own inventory movements"
  on public.inventory_movements
  for insert
  with check (tenant_id = public.get_auth_tenant_id() and user_id = auth.uid());

commit;
