-- Migration: RAG PDF library phase 1 (metadata, limits, source checks, retrieval scope hardening)

begin;

-- 1) Source typing for chunk provenance.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'pdf_source_type') THEN
    CREATE TYPE public.pdf_source_type AS ENUM ('global_pdf', 'tenant_pdf', 'ai_generated');
  END IF;
END
$$;

ALTER TABLE public.book_chunks
  ADD COLUMN IF NOT EXISTS source_type public.pdf_source_type;

UPDATE public.book_chunks
SET source_type = CASE
  WHEN global_book_id IS NOT NULL THEN 'global_pdf'::public.pdf_source_type
  WHEN tenant_book_id IS NOT NULL THEN 'tenant_pdf'::public.pdf_source_type
  ELSE 'ai_generated'::public.pdf_source_type
END
WHERE source_type IS NULL;

ALTER TABLE public.book_chunks
  ALTER COLUMN source_type SET DEFAULT 'tenant_pdf'::public.pdf_source_type,
  ALTER COLUMN source_type SET NOT NULL;

ALTER TABLE public.book_chunks
  DROP CONSTRAINT IF EXISTS book_chunks_source_scope_check;

ALTER TABLE public.book_chunks
  ADD CONSTRAINT book_chunks_source_scope_check
  CHECK (
    (source_type = 'global_pdf'::public.pdf_source_type AND global_book_id IS NOT NULL AND tenant_book_id IS NULL AND tenant_id IS NULL)
    OR
    (source_type = 'tenant_pdf'::public.pdf_source_type AND tenant_book_id IS NOT NULL AND tenant_id IS NOT NULL AND global_book_id IS NULL)
    OR
    (source_type = 'ai_generated'::public.pdf_source_type)
  );

-- 2) PDF metadata and upload-limit foundation.
CREATE TABLE IF NOT EXISTS public.tenant_pdf_library (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  tenant_book_id uuid NOT NULL UNIQUE REFERENCES public.tenant_books(id) ON DELETE CASCADE,
  storage_path text NOT NULL UNIQUE,
  file_size_bytes bigint NOT NULL CHECK (file_size_bytes > 0),
  page_count integer NOT NULL CHECK (page_count > 0),
  checksum_sha256 text NOT NULL CHECK (checksum_sha256 ~ '^[0-9a-f]{64}$'),
  uploaded_by uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  created_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE TABLE IF NOT EXISTS public.global_pdf_library (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  global_book_id uuid NOT NULL UNIQUE REFERENCES public.global_books(id) ON DELETE CASCADE,
  storage_path text NOT NULL UNIQUE,
  file_size_bytes bigint NOT NULL CHECK (file_size_bytes > 0),
  page_count integer NOT NULL CHECK (page_count > 0),
  checksum_sha256 text NOT NULL CHECK (checksum_sha256 ~ '^[0-9a-f]{64}$'),
  uploaded_by uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  created_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now())
);

ALTER TABLE public.tenant_pdf_library ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.global_pdf_library ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Tenant members can read tenant PDFs" ON public.tenant_pdf_library;
CREATE POLICY "Tenant members can read tenant PDFs"
  ON public.tenant_pdf_library
  FOR SELECT
  USING (tenant_id = public.get_auth_tenant_id());

DROP POLICY IF EXISTS "Tenant members can insert tenant PDFs" ON public.tenant_pdf_library;
CREATE POLICY "Tenant members can insert tenant PDFs"
  ON public.tenant_pdf_library
  FOR INSERT
  WITH CHECK (
    tenant_id = public.get_auth_tenant_id()
    AND uploaded_by = auth.uid()
  );

DROP POLICY IF EXISTS "Tenant members can update tenant PDFs" ON public.tenant_pdf_library;
CREATE POLICY "Tenant members can update tenant PDFs"
  ON public.tenant_pdf_library
  FOR UPDATE
  USING (tenant_id = public.get_auth_tenant_id())
  WITH CHECK (tenant_id = public.get_auth_tenant_id());

DROP POLICY IF EXISTS "Tenant members can delete tenant PDFs" ON public.tenant_pdf_library;
CREATE POLICY "Tenant members can delete tenant PDFs"
  ON public.tenant_pdf_library
  FOR DELETE
  USING (tenant_id = public.get_auth_tenant_id());

DROP POLICY IF EXISTS "Authenticated users can read global PDFs" ON public.global_pdf_library;
CREATE POLICY "Authenticated users can read global PDFs"
  ON public.global_pdf_library
  FOR SELECT
  USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "Platform owners can manage global PDFs" ON public.global_pdf_library;
CREATE POLICY "Platform owners can manage global PDFs"
  ON public.global_pdf_library
  FOR ALL
  USING (public.is_platform_owner())
  WITH CHECK (public.is_platform_owner());

CREATE OR REPLACE FUNCTION public.enforce_tenant_pdf_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant_type public.tenant_type;
  v_limit integer;
  v_current_count integer;
BEGIN
  SELECT t.tenant_type
  INTO v_tenant_type
  FROM public.tenants t
  WHERE t.id = NEW.tenant_id;

  IF v_tenant_type IS NULL THEN
    RAISE EXCEPTION 'Unknown tenant for PDF upload: %', NEW.tenant_id;
  END IF;

  v_limit := CASE v_tenant_type
    WHEN 'home' THEN 5
    WHEN 'professional' THEN 15
    ELSE 5
  END;

  SELECT count(*)::integer
  INTO v_current_count
  FROM public.tenant_pdf_library tpl
  WHERE tpl.tenant_id = NEW.tenant_id;

  IF v_current_count >= v_limit THEN
    RAISE EXCEPTION 'Tenant % reached PDF limit (% for % plan)', NEW.tenant_id, v_limit, v_tenant_type
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_tenant_pdf_limit ON public.tenant_pdf_library;
CREATE TRIGGER trg_enforce_tenant_pdf_limit
  BEFORE INSERT ON public.tenant_pdf_library
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_tenant_pdf_limit();

-- 3) Retrieval hardening: global + current tenant only.
DROP FUNCTION IF EXISTS public.match_chunks(vector(1536), float, int, uuid);
CREATE OR REPLACE FUNCTION public.match_chunks(
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
    source_type public.pdf_source_type,
    similarity float
)
language plpgsql
security invoker
stable
as $$
declare
    v_auth_tenant_id uuid;
    v_effective_tenant_id uuid;
begin
    v_auth_tenant_id := public.get_auth_tenant_id();
    v_effective_tenant_id := coalesce(filter_tenant_id, v_auth_tenant_id);

    if filter_tenant_id is not null and filter_tenant_id <> v_auth_tenant_id then
      raise exception 'Cross-tenant filter denied'
        using errcode = '42501';
    end if;

    return query
    select
        bc.id,
        bc.tenant_id,
        bc.global_book_id,
        bc.tenant_book_id,
        bc.content,
        bc.metadata,
        bc.source_type,
        1 - (bc.embedding <=> query_embedding) as similarity
    from public.book_chunks bc
    where
        (1 - (bc.embedding <=> query_embedding)) > match_threshold
        and (
          (bc.global_book_id is not null and bc.tenant_id is null)
          or bc.tenant_id = v_effective_tenant_id
        )
    order by bc.embedding <=> query_embedding
    limit match_count;
end;
$$;

commit;
