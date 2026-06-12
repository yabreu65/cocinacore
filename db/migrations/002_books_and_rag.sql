-- Migration 002: Books, PDF libraries, and vector chunks

-- ==========================================
-- 1. GLOBAL BOOKS
-- ==========================================
create table public.global_books (
    id uuid primary key default gen_random_uuid(),
    title text not null,
    author text null,
    description text null,
    cuisine_region text not null default '',
    cuisine_country text null,
    cuisine_style text null,
    tags text[] not null default '{}',
    created_at timestamptz not null default now()
);

comment on table public.global_books is 'Shared recipe and culinary books accessible to all tenants.';

-- ==========================================
-- 2. GLOBAL PDF LIBRARY
-- ==========================================
create table public.global_pdf_library (
    id uuid primary key default gen_random_uuid(),
    global_book_id uuid not null references public.global_books(id) on delete cascade,
    storage_path text not null,
    file_size_bytes bigint null,
    page_count int null,
    checksum_sha256 text null,
    uploaded_by uuid not null references public.users(id) on delete set null,
    created_at timestamptz not null default now()
);

comment on table public.global_pdf_library is 'Storage metadata for global PDFs.';

-- ==========================================
-- 3. TENANT BOOKS
-- ==========================================
create table public.tenant_books (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid not null references public.tenants(id) on delete cascade,
    title text not null,
    author text null,
    description text null,
    created_at timestamptz not null default now()
);

comment on table public.tenant_books is 'Private books owned by a single tenant.';

-- ==========================================
-- 4. TENANT PDF LIBRARY
-- ==========================================
create table public.tenant_pdf_library (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid not null references public.tenants(id) on delete cascade,
    tenant_book_id uuid null references public.tenant_books(id) on delete set null,
    storage_path text not null,
    file_size_bytes bigint null,
    page_count int null,
    checksum_sha256 text null,
    ocr_used boolean not null default false,
    processing_status text not null default 'processing' check (processing_status in ('processing', 'ready', 'failed')),
    processed_chunks_count int null,
    processing_error text null,
    uploaded_by uuid null references public.users(id) on delete set null,
    created_at timestamptz not null default now()
);

comment on table public.tenant_pdf_library is 'Storage metadata for tenant-uploaded PDFs.';

-- ==========================================
-- 5. BOOK CHUNKS (vector search)
-- ==========================================
create table public.book_chunks (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid null references public.tenants(id) on delete cascade,
    global_book_id uuid null references public.global_books(id) on delete cascade,
    tenant_book_id uuid null references public.tenant_books(id) on delete cascade,
    source_type text not null check (source_type in ('global_pdf', 'tenant_pdf', 'ai_generated')),
    content text not null,
    metadata jsonb not null default '{}'::jsonb,
    embedding vector(1536) not null,
    created_at timestamptz not null default now(),

    constraint chunk_book_relationship check (
        (global_book_id is not null and tenant_book_id is null and tenant_id is null) or
        (tenant_book_id is not null and global_book_id is null and tenant_id is not null) or
        (global_book_id is null and tenant_book_id is null and source_type = 'ai_generated')
    )
);

comment on table public.book_chunks is 'Text chunks with vector embeddings for RAG semantic search.';
