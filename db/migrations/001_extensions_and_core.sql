-- Migration 001: Extensions, tenants, users, sessions, tenant memberships
-- Replaces Supabase auth.users + RLS with application-controlled auth.

-- Enable required extensions
create extension if not exists vector with schema public;
create extension if not exists pgcrypto with schema public;

-- ==========================================
-- 1. TENANTS
-- ==========================================
create table public.tenants (
    id uuid primary key default gen_random_uuid(),
    tenant_type text not null default 'home' check (tenant_type in ('home', 'professional')),
    name text not null default '',
    trial_started_at timestamptz null,
    trial_ends_at timestamptz null,
    trial_soft_blocked_at timestamptz null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

comment on table public.tenants is 'Isolated tenant organizations.';

-- ==========================================
-- 2. USERS (application-managed auth)
-- ==========================================
create table public.users (
    id uuid primary key default gen_random_uuid(),
    email text not null unique,
    password_hash text not null,
    email_confirmed boolean not null default false,
    full_name text null,
    tenant_id uuid references public.tenants(id) on delete set null,
    role text not null default 'member' check (role in ('owner', 'admin', 'member')),
    terms_accepted_at timestamptz null,
    terms_version text null,
    onboarding_completed boolean not null default false,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

comment on table public.users is 'Application-managed user accounts with password hashing and tenant scoping.';

-- ==========================================
-- 3. SESSIONS
-- ==========================================
create table public.sessions (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references public.users(id) on delete cascade,
    token_hash text not null unique,
    expires_at timestamptz not null,
    created_at timestamptz not null default now(),
    last_seen_at timestamptz not null default now()
);

comment on table public.sessions is 'Server-side sessions for cookie-based authentication.';

-- ==========================================
-- 4. TENANT MEMBERSHIPS
-- ==========================================
create table public.tenant_memberships (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid not null references public.tenants(id) on delete cascade,
    user_id uuid not null references public.users(id) on delete cascade,
    role text not null default 'member' check (role in ('owner', 'admin', 'member')),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (tenant_id, user_id)
);

comment on table public.tenant_memberships is 'Normalized many-to-many relationship between users and tenants.';

-- ==========================================
-- 5. PLATFORM OWNERS
-- ==========================================
create table public.platform_owners (
    user_id uuid primary key references public.users(id) on delete cascade,
    created_at timestamptz not null default now(),
    requires_manual_review boolean not null default true
);

comment on table public.platform_owners is 'Platform-level owners requiring manual review for privilege activation.';
