-- Migration 004: Meal plans, suggestions, and optimization snapshots

-- ==========================================
-- 1. USER MEAL PLANS
-- ==========================================
create table public.user_meal_plans (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid not null references public.tenants(id) on delete cascade,
    user_id uuid not null references public.users(id) on delete cascade,
    people_count int not null default 4,
    period text not null check (period in ('week', 'fortnight', 'month')),
    mode text not null check (mode in ('inventory_to_menu', 'menu_to_shopping', 'balanced_ai')),
    base_cuisine text not null default '',
    fusion_cuisines text[] not null default '{}',
    fusion_intensity text not null default 'media' check (fusion_intensity in ('sutil', 'media', 'alta')),
    goal text null,
    restrictions text[] not null default '{}',
    inventory_snapshot jsonb not null default '{}'::jsonb,
    calendar_payload jsonb not null default '{}'::jsonb,
    ai_content text null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

comment on table public.user_meal_plans is 'Generated meal plans per tenant user.';

-- ==========================================
-- 2. MEAL PLAN INVENTORY SUGGESTIONS
-- ==========================================
create table public.user_meal_plan_inventory_suggestions (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid not null references public.tenants(id) on delete cascade,
    user_id uuid not null references public.users(id) on delete cascade,
    meal_plan_id uuid not null references public.user_meal_plans(id) on delete cascade,
    people_count int not null,
    period text not null check (period in ('week', 'fortnight', 'month')),
    normalized_items jsonb not null default '{}'::jsonb,
    raw_items jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

comment on table public.user_meal_plan_inventory_suggestions is 'Inventory suggestions derived from meal plans.';

-- ==========================================
-- 3. MEAL PLAN OPTIMIZATION SNAPSHOTS
-- ==========================================
create table public.user_meal_plan_optimization_snapshots (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid not null references public.tenants(id) on delete cascade,
    user_id uuid not null references public.users(id) on delete cascade,
    meal_plan_id uuid not null references public.user_meal_plans(id) on delete cascade,
    optimization_mode text not null check (optimization_mode in ('reduce_waste', 'optimize_cost', 'prioritize_fresh', 'reduce_missing', 'reuse_proteins', 'balance_ingredients')),
    baseline_score jsonb not null default '{}'::jsonb,
    optimized_score jsonb not null default '{}'::jsonb,
    comparison jsonb not null default '{}'::jsonb,
    explainability_notes jsonb not null default '{}'::jsonb,
    baseline_calendar jsonb not null default '{}'::jsonb,
    optimized_calendar jsonb not null default '{}'::jsonb,
    metadata jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now()
);

comment on table public.user_meal_plan_optimization_snapshots is 'Snapshots of meal plan optimization runs.';
