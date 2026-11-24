-- Migration 025: narrowly scoped private document creation by the runtime role.
-- The runner attests the complete 024 state before this transactional migration.
DO $preflight$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname='cocinacore_runtime_rls'
      AND rolcanlogin AND NOT rolsuper AND NOT rolbypassrls AND NOT rolcreatedb
      AND NOT rolcreaterole AND NOT rolreplication AND NOT rolinherit)
     OR (SELECT count(*) FROM pg_catalog.pg_class WHERE oid IN
       ('public.tenant_books'::regclass, 'public.tenant_pdf_library'::regclass)
       AND relrowsecurity AND relforcerowsecurity) <> 2
     OR pg_catalog.has_table_privilege('cocinacore_runtime_rls','public.tenant_books','INSERT')
     OR pg_catalog.has_any_column_privilege('cocinacore_runtime_rls','public.tenant_books','INSERT')
     OR pg_catalog.has_table_privilege('cocinacore_runtime_rls','public.tenant_pdf_library','INSERT')
     OR pg_catalog.has_any_column_privilege('cocinacore_runtime_rls','public.tenant_pdf_library','INSERT')
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_policy WHERE polrelid IN
       ('public.tenant_books'::regclass, 'public.tenant_pdf_library'::regclass)
       AND polname IN ('documents_tenant_books_insert','documents_tenant_pdfs_insert')) THEN
    RAISE EXCEPTION '025_PRIVATE_PDF_PREFLIGHT_MISMATCH';
  END IF;
END
$preflight$;

GRANT INSERT (tenant_id, title, author, description) ON public.tenant_books TO cocinacore_runtime_rls;
GRANT INSERT (tenant_id, tenant_book_id, storage_path, file_size_bytes, page_count, checksum_sha256,
  uploaded_by, processing_status, processed_chunks_count) ON public.tenant_pdf_library TO cocinacore_runtime_rls;

CREATE POLICY documents_tenant_books_insert ON public.tenant_books
  FOR INSERT TO cocinacore_runtime_rls
  WITH CHECK (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND EXISTS (SELECT 1 FROM public.runtime_identity_probe)
  );

CREATE POLICY documents_tenant_pdfs_insert ON public.tenant_pdf_library
  FOR INSERT TO cocinacore_runtime_rls
  WITH CHECK (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND (
      tenant_book_id IS NULL
      OR EXISTS (
        SELECT 1 FROM public.tenant_books AS parent_book
         WHERE parent_book.id = tenant_pdf_library.tenant_book_id
           AND parent_book.tenant_id = tenant_pdf_library.tenant_id
      )
    )
    AND EXISTS (SELECT 1 FROM public.runtime_identity_probe)
    AND tenant_book_id IS NOT NULL
  );
