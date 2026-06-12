-- Migration: Initial schema with multi-tenancy RLS and vector search
-- Created at: 2026-05-21T14:43:43-03:00

-- ==========================================
-- 1. EXTENSIONS & SYSTEM SETUP
-- ==========================================

-- Enable pgvector for semantic search and embeddings
create extension if not exists vector with schema public;

-- ==========================================
-- 2. CORE SCHEMAS & TABLES
-- ==========================================

-- 2.1 Tenants Table (The foundation of our multi-tenancy)
create table public.tenants (
    id uuid primary key default gen_random_uuid(),
    name text not null,
    created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

comment on table public.tenants is 'Stores isolated tenant organizations.';

-- 2.2 Public Users Table (Links to Supabase auth.users)
create table public.users (
    id uuid primary key references auth.users(id) on delete cascade,
    tenant_id uuid not null references public.tenants(id) on delete cascade,
    email text not null,
    role text not null default 'user' check (role in ('superadmin', 'admin', 'user')),
    created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

comment on table public.users is 'Profiles for users linked to Supabase auth, bound to a specific tenant.';

-- 2.3 Global Books Table (Content shared across all tenants)
create table public.global_books (
    id uuid primary key default gen_random_uuid(),
    title text not null,
    author text,
    description text,
    created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

comment on table public.global_books is 'Shared recipe and culinary books accessible to all tenants.';

-- 2.4 Tenant-Specific Books Table (Private content per tenant)
create table public.tenant_books (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid not null references public.tenants(id) on delete cascade,
    title text not null,
    author text,
    description text,
    created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

comment on table public.tenant_books is 'Private books owned and accessible only by a single tenant.';

-- 2.5 Book Chunks Table (Holds text chunks and vector embeddings)
create table public.book_chunks (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid references public.tenants(id) on delete cascade, -- null for global_books chunks
    global_book_id uuid references public.global_books(id) on delete cascade,
    tenant_book_id uuid references public.tenant_books(id) on delete cascade,
    content text not null,
    metadata jsonb default '{}'::jsonb not null,
    embedding vector(1536) not null, -- 1536 dimensions for OpenAI/standard embeddings
    created_at timestamp with time zone default timezone('utc'::text, now()) not null,
    
    -- Ensure a chunk belongs to exactly one book type
    constraint chunk_book_relationship check (
        (global_book_id is not null and tenant_book_id is null and tenant_id is null) or
        (tenant_book_id is not null and global_book_id is null and tenant_id is not null)
    )
);

comment on table public.book_chunks is 'Granular text slices with high-dimensional vector embeddings for RAG.';

-- 2.6 Recipe Generations Table (History of AI recipe creations)
create table public.recipe_generations (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid not null references public.tenants(id) on delete cascade,
    user_id uuid not null references public.users(id) on delete cascade,
    prompt text not null,
    generated_recipe jsonb not null,
    created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

comment on table public.recipe_generations is 'Maintains history of AI-generated recipes per tenant and user.';

-- ==========================================
-- 3. INDEXES FOR PERFORMANCE
-- ==========================================

-- Standard B-Tree indexes for foreign keys and queries
create index idx_users_tenant on public.users(tenant_id);
create index idx_tenant_books_tenant on public.tenant_books(tenant_id);
create index idx_book_chunks_tenant on public.book_chunks(tenant_id);
create index idx_book_chunks_global_book on public.book_chunks(global_book_id);
create index idx_book_chunks_tenant_book on public.book_chunks(tenant_book_id);
create index idx_recipe_generations_tenant on public.recipe_generations(tenant_id);
create index idx_recipe_generations_user on public.recipe_generations(user_id);

-- Advanced HNSW index on vector embeddings for high-performance cosine similarity search
create index idx_book_chunks_embedding_hnsw 
on public.book_chunks 
using hnsw (embedding vector_cosine_ops);

-- ==========================================
-- 4. SECURITY & UTILITY FUNCTIONS
-- ==========================================

-- 4.1 Helper to securely resolve the current user's tenant ID
-- Defined as SECURITY DEFINER to bypass RLS when querying public.users
create or replace function public.get_auth_tenant_id()
returns uuid
language sql
security definer
set search_path = public
stable
as $$
    select tenant_id from public.users where id = auth.uid();
$$;

-- 4.2 Helper to check if the current user is an admin
create or replace function public.is_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
    select coalesce(role in ('admin', 'superadmin'), false) 
    from public.users 
    where id = auth.uid();
$$;

-- ==========================================
-- 5. ROW LEVEL SECURITY (RLS) POLICIES
-- ==========================================

-- Enable Row Level Security on all tables
alter table public.tenants enable row level security;
alter table public.users enable row level security;
alter table public.global_books enable row level security;
alter table public.tenant_books enable row level security;
alter table public.book_chunks enable row level security;
alter table public.recipe_generations enable row level security;

-- 5.1 Tenants Policies
create policy "Users can view their own tenant"
    on public.tenants
    for select
    using (id = public.get_auth_tenant_id());

create policy "Admins can update their tenant details"
    on public.tenants
    for update
    using (id = public.get_auth_tenant_id() and public.is_admin());

-- 5.2 Users Policies
create policy "Users can view members of their same tenant"
    on public.users
    for select
    using (tenant_id = public.get_auth_tenant_id());

create policy "Users can update their own profile"
    on public.users
    for update
    using (id = auth.uid());

create policy "Admins can manage tenant users"
    on public.users
    for all
    using (tenant_id = public.get_auth_tenant_id() and public.is_admin());

-- 5.3 Global Books Policies
create policy "Anyone authenticated can read global books"
    on public.global_books
    for select
    using (auth.uid() is not null);

create policy "Only superadmins can manage global books"
    on public.global_books
    for all
    using (
        coalesce(
            (select role from public.users where id = auth.uid()) = 'superadmin',
            false
        )
    );

-- 5.4 Tenant Books Policies
create policy "Users can view their tenant's books"
    on public.tenant_books
    for select
    using (tenant_id = public.get_auth_tenant_id());

create policy "Users can manage books within their tenant"
    on public.tenant_books
    for all
    using (tenant_id = public.get_auth_tenant_id());

-- 5.5 Book Chunks Policies
create policy "Users can read global chunks or their own tenant's chunks"
    on public.book_chunks
    for select
    using (
        (global_book_id is not null and auth.uid() is not null) or
        (tenant_id = public.get_auth_tenant_id())
    );

create policy "Users can manage chunks within their tenant"
    on public.book_chunks
    for all
    using (
        (tenant_id = public.get_auth_tenant_id()) or
        (global_book_id is not null and public.is_admin())
    );

-- 5.6 Recipe Generations Policies
create policy "Users can read generations from their tenant"
    on public.recipe_generations
    for select
    using (tenant_id = public.get_auth_tenant_id());

create policy "Users can manage their own generations"
    on public.recipe_generations
    for all
    using (
        tenant_id = public.get_auth_tenant_id() and 
        user_id = auth.uid()
    );

-- ==========================================
-- 6. SYSTEM AUTOMATIONS (TRIGGERS)
-- ==========================================

-- Trigger to automatically create a user profile in public.users on signup.
-- Automatically creates a new tenant if 'tenant_name' is provided without a 'tenant_id'.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    v_tenant_id uuid;
    v_tenant_name text;
    v_role text;
begin
    -- Extract optional parameters from user_metadata
    v_tenant_id := ((new.raw_user_meta_data ->> 'tenant_id')::uuid);
    v_tenant_name := coalesce(new.raw_user_meta_data ->> 'tenant_name', 'Default Tenant');
    v_role := coalesce(new.raw_user_meta_data ->> 'role', 'user');

    -- If no tenant_id is supplied, create a new tenant
    if v_tenant_id is null then
        insert into public.tenants (name)
        values (v_tenant_name)
        returning id into v_tenant_id;
    end if;

    -- Create public user profile
    insert into public.users (id, tenant_id, email, role)
    values (new.id, v_tenant_id, new.email, v_role);

    return new;
end;
$$;

-- Create the trigger on auth.users
create trigger on_auth_user_created
    after insert on auth.users
    for each row execute procedure public.handle_new_user();

-- ==========================================
-- 7. VECTOR SEARCH / RAG FUNCTIONS
-- ==========================================

-- Function for matching similar book chunks using cosine distance.
-- Set to SECURITY INVOKER to strictly enforce RLS policies during search.
create or replace function public.match_chunks(
    query_embedding vector(1536),
    match_threshold float,
    match_count int,
    filter_tenant_id uuid default null
)
returns table (
    id uuid,
    tenant_id uuid,
    global_book_id uuid,
    tenant_book_id uuid,
    content text,
    metadata jsonb,
    similarity float
)
language plpgsql
security invoker
stable
as $$
begin
    return query
    select
        bc.id,
        bc.tenant_id,
        bc.global_book_id,
        bc.tenant_book_id,
        bc.content,
        bc.metadata,
        1 - (bc.embedding <=> query_embedding) as similarity
    from public.book_chunks bc
    where 
        -- Filter by similarity threshold (cosine distance operator <=> )
        (1 - (bc.embedding <=> query_embedding)) > match_threshold
        -- Allow optional tenant filtering, while letting RLS enforce absolute isolation
        and (
            filter_tenant_id is null 
            or bc.tenant_id = filter_tenant_id 
            or bc.tenant_id is null
        )
    order by bc.embedding <=> query_embedding
    limit match_count;
end;
$$;
