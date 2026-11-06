-- Candidate only; compose after the complete 020D4-A owner-metrics state.
-- The dedicated LOGIN can write only through its three fixed views; this candidate adds
-- FORCE RLS policies exclusively for the NOLOGIN view owner.
DO $preflight$
DECLARE
  guard_available boolean;
  d4a_state boolean;
  d4b_state boolean;
  apply_policies boolean;
BEGIN
  IF current_user IN (
    'cocinacore_runtime_rls','cocinacore_auth','cocinacore_owner_metrics',
    'cocinacore_metrics_view_owner','cocinacore_global_writer',
    'cocinacore_global_writer_view_owner'
  ) THEN
    RAISE EXCEPTION 'Apply 020D4-B with the controlled migration identity';
  END IF;

  IF to_regclass('public.owner_global_metrics') IS NULL
     OR to_regclass('public.owner_metrics_rls_guard') IS NULL
     OR md5(pg_get_viewdef('public.owner_global_metrics'::regclass,true)) <> '59035b254a488a1015d641a81cc928ff'
     OR md5(pg_get_viewdef('public.owner_metrics_rls_guard'::regclass,true)) <> '8da147bc319c202a2ee4c8401c3d93ae'
     OR (SELECT relowner FROM pg_class WHERE oid='public.owner_global_metrics'::regclass)
         <> (SELECT oid FROM pg_roles WHERE rolname='cocinacore_metrics_view_owner')
     OR (SELECT relowner FROM pg_class WHERE oid='public.owner_metrics_rls_guard'::regclass)
         <> (SELECT oid FROM pg_roles WHERE rolname='cocinacore_metrics_view_owner') THEN
    RAISE EXCEPTION '020D4-B requires the exact fixed 020D4-A views and owners';
  END IF;

  SELECT available INTO guard_available FROM public.owner_metrics_rls_guard;
  IF guard_available IS DISTINCT FROM true THEN
    RAISE EXCEPTION '020D4-B requires the complete valid 020D4-A FORCE RLS state';
  END IF;

  WITH expected(tbl,pol,cmd,role_name,qual_hash,check_hash) AS (VALUES
    ('global_books','owner_global_writer_global_books_select','r','cocinacore_global_writer_view_owner','b326b5062b2f0e69046810717534cb09','-'),
    ('global_books','owner_global_writer_global_books_insert','a','cocinacore_global_writer_view_owner','-','1e2ffac12def62b379e8001d7db06492'),
    ('global_pdf_library','owner_global_writer_global_pdfs_insert','a','cocinacore_global_writer_view_owner','-','1faec916f592851d25e78b6af91c04e4'),
    ('book_chunks','owner_global_writer_global_chunks_insert','a','cocinacore_global_writer_view_owner','-','683297ded201a155b416052089484b8f')
  ), expected_oids AS (
    SELECT e.tbl,e.pol,e.cmd,r.oid AS role_oid,true AS permissive,e.qual_hash,e.check_hash
      FROM expected e JOIN pg_roles r ON r.rolname=e.role_name
  ), actual AS (
    SELECT c.relname::text,p.polname::text,p.polcmd::text,
      CASE WHEN cardinality(p.polroles)=1 THEN p.polroles[1] END,
      p.polpermissive,COALESCE(md5(pg_get_expr(p.polqual,p.polrelid)),'-'),
      COALESCE(md5(pg_get_expr(p.polwithcheck,p.polrelid)),'-')
      FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid
     WHERE p.polname LIKE 'owner_global_writer_%'
  )
  SELECT NOT EXISTS (
           SELECT 1 FROM pg_policy p
            WHERE p.polrelid IN ('public.global_books'::regclass,
              'public.global_pdf_library'::regclass,'public.book_chunks'::regclass)
              AND p.polname LIKE 'owner_global_writer_%'
         ),
         NOT EXISTS ((SELECT * FROM expected_oids EXCEPT SELECT * FROM actual)
                     UNION ALL (SELECT * FROM actual EXCEPT SELECT * FROM expected_oids))
    INTO d4a_state,d4b_state;

  IF NOT d4a_state AND NOT d4b_state THEN
    RAISE EXCEPTION '020D4-B accepts only the exact D4-A state or the complete D4-B policy set';
  END IF;
  apply_policies := d4a_state;
  PERFORM set_config('cocinacore.d4b.apply_policies',apply_policies::text,true);
END
$preflight$;

DO $install_policies$
BEGIN
  IF current_setting('cocinacore.d4b.apply_policies',true)='true' THEN
    EXECUTE $policy$
      CREATE POLICY owner_global_writer_global_books_select
        ON public.global_books FOR SELECT TO cocinacore_global_writer_view_owner
        USING (true)
    $policy$;
    EXECUTE $policy$
      CREATE POLICY owner_global_writer_global_books_insert
        ON public.global_books FOR INSERT TO cocinacore_global_writer_view_owner
        WITH CHECK (length(btrim(title)) > 0)
    $policy$;
    EXECUTE $policy$
      CREATE POLICY owner_global_writer_global_pdfs_insert
        ON public.global_pdf_library FOR INSERT TO cocinacore_global_writer_view_owner
        WITH CHECK (
          global_book_id IS NOT NULL AND uploaded_by IS NOT NULL
          AND EXISTS (
            SELECT 1 FROM public.global_books AS parent_book
             WHERE parent_book.id=global_pdf_library.global_book_id
          )
        )
    $policy$;
    EXECUTE $policy$
      CREATE POLICY owner_global_writer_global_chunks_insert
        ON public.book_chunks FOR INSERT TO cocinacore_global_writer_view_owner
        WITH CHECK (
          source_type='global_pdf' AND tenant_id IS NULL AND tenant_book_id IS NULL
          AND global_book_id IS NOT NULL
          AND EXISTS (
            SELECT 1 FROM public.global_books AS parent_book
             WHERE parent_book.id=book_chunks.global_book_id
          )
        )
    $policy$;
  END IF;
END
$install_policies$;

DO $postflight$
DECLARE available boolean;
BEGIN
  SELECT owner_metrics_rls_guard.available INTO available
    FROM public.owner_metrics_rls_guard;
  IF available IS DISTINCT FROM true THEN
    RAISE EXCEPTION '020D4-B policy installation failed the fixed owner-metrics and writer contract';
  END IF;
END
$postflight$;
