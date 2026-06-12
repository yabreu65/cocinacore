-- Migration 006: Culinary taxonomy and user profiles

-- ==========================================
-- 1. CULINARY DIMENSIONS
-- ==========================================
create table public.culinary_dimensions (
    id uuid primary key default gen_random_uuid(),
    key text not null unique,
    label text not null,
    sort_order int not null default 0,
    created_at timestamptz not null default now()
);

comment on table public.culinary_dimensions is 'Dimensions for culinary taxonomy (e.g. cuisine, diet, technique).';

-- ==========================================
-- 2. CULINARY TERMS
-- ==========================================
create table public.culinary_terms (
    id uuid primary key default gen_random_uuid(),
    dimension_id uuid not null references public.culinary_dimensions(id) on delete cascade,
    label text not null,
    is_active boolean not null default true
);

comment on table public.culinary_terms is 'Terms within each culinary dimension.';

-- ==========================================
-- 3. USER CULINARY PROFILES
-- ==========================================
create table public.user_culinary_profiles (
    user_id uuid primary key references public.users(id) on delete cascade,
    tenant_id uuid not null references public.tenants(id) on delete cascade,
    level text null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

comment on table public.user_culinary_profiles is 'Culinary skill level and identity per user.';

-- ==========================================
-- 4. USER CULINARY PROFILE TERMS
-- ==========================================
create table public.user_culinary_profile_terms (
    user_id uuid not null references public.users(id) on delete cascade,
    term_id uuid not null references public.culinary_terms(id) on delete cascade,
    preference_type text not null check (preference_type in ('identity', 'prefer', 'avoid', 'goal')),
    weight numeric(5, 2) not null default 1.0,
    created_at timestamptz not null default now(),
    primary key (user_id, term_id, preference_type)
);

comment on table public.user_culinary_profile_terms is 'User preferences over culinary terms.';
