-- Migration 005: Premium board, saved recipes, reviews, reports, and shopping list

-- ==========================================
-- 1. PREMIUM RECIPES
-- ==========================================
create table public.premium_recipes (
    id uuid primary key default gen_random_uuid(),
    source_recipe_history_id uuid not null references public.recipe_ai_history(id) on delete cascade,
    source_tenant_id uuid not null references public.tenants(id) on delete cascade,
    creator_user_id uuid not null references public.users(id) on delete cascade,
    creator_display_name text null,
    eligibility_score numeric(5, 2) not null default 0,
    creator_opted_in boolean not null default false,
    status text not null default 'published' check (status in ('published', 'withdrawn', 'moderation_hidden')),
    published_at timestamptz null,
    withdrawn_at timestamptz null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

comment on table public.premium_recipes is 'Recipes published to the premium marketplace.';

-- ==========================================
-- 2. SAVED PREMIUM RECIPES
-- ==========================================
create table public.saved_premium_recipes (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid not null references public.tenants(id) on delete cascade,
    user_id uuid not null references public.users(id) on delete cascade,
    premium_recipe_id uuid not null references public.premium_recipes(id) on delete cascade,
    notes text null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (tenant_id, user_id, premium_recipe_id)
);

comment on table public.saved_premium_recipes is 'User-saved premium recipes.';

-- ==========================================
-- 3. PREMIUM RECIPE REVIEWS
-- ==========================================
create table public.premium_recipe_reviews (
    id uuid primary key default gen_random_uuid(),
    premium_recipe_id uuid not null references public.premium_recipes(id) on delete cascade,
    user_id uuid not null references public.users(id) on delete cascade,
    stars int not null check (stars between 1 and 5),
    comment text null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

comment on table public.premium_recipe_reviews is 'Reviews for premium recipes.';

-- ==========================================
-- 4. PREMIUM REVIEW REPORTS
-- ==========================================
create table public.premium_review_reports (
    id uuid primary key default gen_random_uuid(),
    premium_recipe_id uuid not null references public.premium_recipes(id) on delete cascade,
    review_id uuid null references public.premium_recipe_reviews(id) on delete set null,
    reporter_user_id uuid not null references public.users(id) on delete cascade,
    reason text not null,
    status text not null default 'open' check (status in ('open', 'reviewing', 'resolved', 'dismissed')),
    created_at timestamptz not null default now(),
    resolved_at timestamptz null
);

comment on table public.premium_review_reports is 'Reports against premium recipes or their reviews.';

-- ==========================================
-- 5. SHOPPING LIST ITEMS
-- ==========================================
create table public.shopping_list_items (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid not null references public.tenants(id) on delete cascade,
    user_id uuid not null references public.users(id) on delete cascade,
    source text not null default 'manual',
    premium_recipe_id uuid null references public.premium_recipes(id) on delete set null,
    ingredient_name text not null,
    quantity text null,
    status text not null default 'pending' check (status in ('pending', 'purchased')),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

comment on table public.shopping_list_items is 'Shopping list items per tenant user.';

-- ==========================================
-- 6. TENANT INVITATIONS
-- ==========================================
create table public.tenant_invitations (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid not null references public.tenants(id) on delete cascade,
    email text not null,
    invited_by uuid not null references public.users(id) on delete cascade,
    role text not null default 'member' check (role in ('member')),
    invitation_token text not null unique,
    status text not null default 'pending' check (status in ('pending', 'accepted', 'revoked', 'expired')),
    expires_at timestamptz not null,
    accepted_at timestamptz null,
    accepted_by uuid null references public.users(id) on delete set null,
    created_at timestamptz not null default now()
);

comment on table public.tenant_invitations is 'Pending invitations to join a tenant.';
