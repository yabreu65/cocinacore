-- Migration 003: Recipe inventory items, inventory movements, and AI recipe history

-- ==========================================
-- 1. RECIPE INVENTORY ITEMS
-- ==========================================
create table public.recipe_inventory_items (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid not null references public.tenants(id) on delete cascade,
    user_id uuid not null references public.users(id) on delete cascade,
    ingredient_name text not null,
    quantity text null,
    unit text null,
    category text null,
    expiration_date timestamptz null,
    estimated_unit_price numeric(12, 4) null,
    purchase_location text null,
    low_stock_threshold numeric(12, 4) null,
    normalized_name text null,
    notes text null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

comment on table public.recipe_inventory_items is 'Tenant-scoped inventory ingredients.';

-- ==========================================
-- 2. INVENTORY MOVEMENTS
-- ==========================================
create table public.inventory_movements (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid not null references public.tenants(id) on delete cascade,
    user_id uuid not null references public.users(id) on delete cascade,
    inventory_item_id uuid not null references public.recipe_inventory_items(id) on delete cascade,
    movement_type text not null check (movement_type in ('purchase', 'recipe_consumption', 'manual_adjustment', 'correction')),
    quantity numeric(12, 4) not null,
    unit text not null,
    normalized_name text not null,
    source text not null default 'manual',
    source_recipe text null,
    source_meal_plan_id uuid null,
    notes text null,
    created_at timestamptz not null default now()
);

comment on table public.inventory_movements is 'Audit trail of inventory changes.';

-- ==========================================
-- 3. RECIPE AI HISTORY
-- ==========================================
create table public.recipe_ai_history (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid not null references public.tenants(id) on delete cascade,
    user_id uuid not null references public.users(id) on delete cascade,
    source text not null,
    recipe_title text null,
    recipe_payload jsonb not null,
    restrictions_snapshot jsonb not null default '{}'::jsonb,
    inventory_snapshot jsonb not null default '{}'::jsonb,
    user_feedback text null check (user_feedback in ('accepted', 'discarded')),
    user_feedback_at timestamptz null,
    is_saved boolean not null default false,
    expires_at timestamptz null,
    created_at timestamptz not null default now()
);

comment on table public.recipe_ai_history is 'History of AI-generated recipes with optional user feedback.';

-- ==========================================
-- 4. RECIPE AI RATINGS
-- ==========================================
create table public.recipe_ai_ratings (
    id uuid primary key default gen_random_uuid(),
    generation_id uuid not null references public.recipe_ai_history(id) on delete cascade,
    tenant_id uuid not null references public.tenants(id) on delete cascade,
    user_id uuid not null references public.users(id) on delete cascade,
    rating int not null check (rating between 1 and 5),
    comment text null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

comment on table public.recipe_ai_ratings is 'User ratings for AI-generated recipes.';
