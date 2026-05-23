-- Migration: Recipe AI phase 1 (inventory, restrictions profile fields, history, ratings, RLS)

begin;

-- 1) Restrictions/allergies persisted at user profile level.
alter table public.users
  add column if not exists allergies text[] not null default '{}',
  add column if not exists dietary_rules text[] not null default '{}';

-- 2) Manual inventory scoped per tenant/member.
create table if not exists public.recipe_inventory_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  ingredient_name text not null,
  quantity text,
  notes text,
  created_at timestamp with time zone not null default timezone('utc'::text, now()),
  updated_at timestamp with time zone not null default timezone('utc'::text, now()),
  constraint recipe_inventory_items_ingredient_not_blank check (char_length(btrim(ingredient_name)) > 0)
);

create unique index if not exists uq_recipe_inventory_items_member_ingredient
  on public.recipe_inventory_items (tenant_id, user_id, lower(ingredient_name));

create index if not exists idx_recipe_inventory_items_tenant_user
  on public.recipe_inventory_items (tenant_id, user_id);

-- 3) Search/generation history scoped per tenant/member.
create table if not exists public.recipe_ai_history (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  source text not null check (source in ('pdf_search', 'ai_generation')),
  recipe_title text,
  recipe_payload jsonb not null,
  restrictions_snapshot jsonb not null default '{}'::jsonb,
  inventory_snapshot jsonb not null default '[]'::jsonb,
  created_at timestamp with time zone not null default timezone('utc'::text, now())
);

create index if not exists idx_recipe_ai_history_tenant_user_created
  on public.recipe_ai_history (tenant_id, user_id, created_at desc);

-- 4) Member ratings: one rating per member per history recipe.
create table if not exists public.recipe_ai_ratings (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  recipe_history_id uuid not null references public.recipe_ai_history(id) on delete cascade,
  rating smallint not null check (rating between 1 and 5),
  comment text,
  created_at timestamp with time zone not null default timezone('utc'::text, now()),
  updated_at timestamp with time zone not null default timezone('utc'::text, now())
);

create unique index if not exists uq_recipe_ai_ratings_member_history
  on public.recipe_ai_ratings (tenant_id, user_id, recipe_history_id);

create index if not exists idx_recipe_ai_ratings_tenant_history
  on public.recipe_ai_ratings (tenant_id, recipe_history_id);

-- 5) RLS for tenant/member isolation.
alter table public.recipe_inventory_items enable row level security;
alter table public.recipe_ai_history enable row level security;
alter table public.recipe_ai_ratings enable row level security;

drop policy if exists "Members can read own inventory" on public.recipe_inventory_items;
create policy "Members can read own inventory"
  on public.recipe_inventory_items
  for select
  using (tenant_id = public.get_auth_tenant_id() and user_id = auth.uid());

drop policy if exists "Members can insert own inventory" on public.recipe_inventory_items;
create policy "Members can insert own inventory"
  on public.recipe_inventory_items
  for insert
  with check (tenant_id = public.get_auth_tenant_id() and user_id = auth.uid());

drop policy if exists "Members can update own inventory" on public.recipe_inventory_items;
create policy "Members can update own inventory"
  on public.recipe_inventory_items
  for update
  using (tenant_id = public.get_auth_tenant_id() and user_id = auth.uid())
  with check (tenant_id = public.get_auth_tenant_id() and user_id = auth.uid());

drop policy if exists "Members can delete own inventory" on public.recipe_inventory_items;
create policy "Members can delete own inventory"
  on public.recipe_inventory_items
  for delete
  using (tenant_id = public.get_auth_tenant_id() and user_id = auth.uid());

drop policy if exists "Members can read own recipe history" on public.recipe_ai_history;
create policy "Members can read own recipe history"
  on public.recipe_ai_history
  for select
  using (tenant_id = public.get_auth_tenant_id() and user_id = auth.uid());

drop policy if exists "Members can insert own recipe history" on public.recipe_ai_history;
create policy "Members can insert own recipe history"
  on public.recipe_ai_history
  for insert
  with check (tenant_id = public.get_auth_tenant_id() and user_id = auth.uid());

drop policy if exists "Members can update own recipe history" on public.recipe_ai_history;
create policy "Members can update own recipe history"
  on public.recipe_ai_history
  for update
  using (tenant_id = public.get_auth_tenant_id() and user_id = auth.uid())
  with check (tenant_id = public.get_auth_tenant_id() and user_id = auth.uid());

drop policy if exists "Members can delete own recipe history" on public.recipe_ai_history;
create policy "Members can delete own recipe history"
  on public.recipe_ai_history
  for delete
  using (tenant_id = public.get_auth_tenant_id() and user_id = auth.uid());

drop policy if exists "Members can read own recipe ratings" on public.recipe_ai_ratings;
create policy "Members can read own recipe ratings"
  on public.recipe_ai_ratings
  for select
  using (tenant_id = public.get_auth_tenant_id() and user_id = auth.uid());

drop policy if exists "Members can insert own recipe ratings" on public.recipe_ai_ratings;
create policy "Members can insert own recipe ratings"
  on public.recipe_ai_ratings
  for insert
  with check (
    tenant_id = public.get_auth_tenant_id()
    and user_id = auth.uid()
    and exists (
      select 1
      from public.recipe_ai_history h
      where h.id = recipe_history_id
        and h.tenant_id = public.get_auth_tenant_id()
        and h.user_id = auth.uid()
    )
  );

drop policy if exists "Members can update own recipe ratings" on public.recipe_ai_ratings;
create policy "Members can update own recipe ratings"
  on public.recipe_ai_ratings
  for update
  using (tenant_id = public.get_auth_tenant_id() and user_id = auth.uid())
  with check (
    tenant_id = public.get_auth_tenant_id()
    and user_id = auth.uid()
    and exists (
      select 1
      from public.recipe_ai_history h
      where h.id = recipe_history_id
        and h.tenant_id = public.get_auth_tenant_id()
        and h.user_id = auth.uid()
    )
  );

drop policy if exists "Members can delete own recipe ratings" on public.recipe_ai_ratings;
create policy "Members can delete own recipe ratings"
  on public.recipe_ai_ratings
  for delete
  using (tenant_id = public.get_auth_tenant_id() and user_id = auth.uid());

commit;
