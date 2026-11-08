-- Candidate only; compose after 020C/020C1 and 020D1-020D3 in a runner-managed transaction.
-- The view owner receives narrowly scoped SELECT policies; the LOGIN receives only the fixed view.
DO $preflight$
DECLARE
  runtime_oid oid;
  auth_oid oid;
  metrics_login_oid oid;
  metrics_owner_oid oid;
  identity_probe_oid oid;
  signup_bootstrap_oid oid;
  global_writer_oid oid;
  global_writer_owner_oid oid;
  source_owner_oid oid;
  identity_baseline boolean;
  identity_expanded boolean;
  documents_baseline boolean;
  documents_expanded boolean;
  documents_writer boolean;
  baseline_rls boolean;
  installed_rls boolean;
  baseline_view boolean;
  installed_view boolean;
  current_policies boolean;
  writer_policies boolean;
  apply_policies boolean;
BEGIN
  IF current_user IN (
    'cocinacore_runtime_rls', 'cocinacore_auth', 'cocinacore_owner_metrics',
    'cocinacore_metrics_view_owner', 'cocinacore_global_writer'
  ) THEN
    RAISE EXCEPTION 'Apply 020D4-A with the controlled migration identity';
  END IF;

  IF EXISTS (
    SELECT 1 FROM unnest(ARRAY[
      'public.users'::regclass, 'public.tenants'::regclass,
      'public.tenant_memberships'::regclass, 'public.tenant_books'::regclass,
      'public.tenant_pdf_library'::regclass, 'public.book_chunks'::regclass,
      'public.global_books'::regclass, 'public.global_pdf_library'::regclass,
      'public.premium_review_reports'::regclass, 'public.platform_owners'::regclass
    ]) AS rel(oid)
    WHERE rel.oid IS NULL
  ) OR to_regclass('public.runtime_identity_probe') IS NULL
     OR to_regclass('public.owner_global_metrics') IS NULL THEN
    RAISE EXCEPTION '020D4-A requires the complete identity, document, and metrics baseline';
  END IF;

  SELECT oid INTO runtime_oid FROM pg_roles
   WHERE rolname = 'cocinacore_runtime_rls' AND rolcanlogin AND NOT rolsuper
     AND NOT rolbypassrls AND NOT rolcreatedb AND NOT rolcreaterole
     AND NOT rolreplication AND NOT rolinherit;
  SELECT oid INTO auth_oid FROM pg_roles
   WHERE rolname = 'cocinacore_auth' AND rolcanlogin AND NOT rolsuper
     AND NOT rolbypassrls AND NOT rolcreatedb AND NOT rolcreaterole
     AND NOT rolreplication AND NOT rolinherit;
  SELECT oid INTO metrics_login_oid FROM pg_roles
   WHERE rolname = 'cocinacore_owner_metrics' AND rolcanlogin AND NOT rolsuper
     AND NOT rolbypassrls AND NOT rolcreatedb AND NOT rolcreaterole
     AND NOT rolreplication AND NOT rolinherit
     AND COALESCE(cardinality(rolconfig)=2 AND rolconfig @> ARRAY['row_security=on','search_path=pg_catalog, public'], false);
  SELECT oid INTO metrics_owner_oid FROM pg_roles
   WHERE rolname = 'cocinacore_metrics_view_owner' AND NOT rolcanlogin
     AND NOT rolsuper AND NOT rolbypassrls AND NOT rolcreatedb
     AND NOT rolcreaterole AND NOT rolreplication AND NOT rolinherit;
  SELECT oid INTO identity_probe_oid FROM pg_roles
   WHERE rolname='cocinacore_identity_probe' AND NOT rolcanlogin AND NOT rolsuper
     AND NOT rolbypassrls AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolreplication AND NOT rolinherit;
  SELECT oid INTO signup_bootstrap_oid FROM pg_roles
   WHERE rolname='cocinacore_signup_bootstrap' AND NOT rolcanlogin AND NOT rolsuper
     AND NOT rolbypassrls AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolreplication AND NOT rolinherit;
  SELECT oid INTO global_writer_oid FROM pg_roles
   WHERE rolname='cocinacore_global_writer' AND rolcanlogin AND NOT rolsuper AND NOT rolbypassrls
     AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolreplication AND NOT rolinherit
     AND COALESCE(cardinality(rolconfig)=2 AND rolconfig @> ARRAY['row_security=on','search_path=pg_catalog, public'],false);
  SELECT oid INTO global_writer_owner_oid FROM pg_roles
   WHERE rolname='cocinacore_global_writer_view_owner' AND NOT rolcanlogin AND NOT rolsuper
     AND NOT rolbypassrls AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolreplication AND NOT rolinherit;
  IF runtime_oid IS NULL OR auth_oid IS NULL OR metrics_login_oid IS NULL OR metrics_owner_oid IS NULL
     OR identity_probe_oid IS NULL OR signup_bootstrap_oid IS NULL OR global_writer_oid IS NULL
     OR global_writer_owner_oid IS NULL
     OR EXISTS (
       SELECT 1 FROM pg_auth_members
        WHERE member IN (runtime_oid, auth_oid, metrics_login_oid, metrics_owner_oid, identity_probe_oid, signup_bootstrap_oid,global_writer_oid,global_writer_owner_oid)
           OR roleid IN (runtime_oid, auth_oid, metrics_login_oid, metrics_owner_oid, identity_probe_oid, signup_bootstrap_oid,global_writer_oid,global_writer_owner_oid)
     ) THEN
    RAISE EXCEPTION '020D4-A requires the isolated runtime, auth, and metrics roles';
  END IF;

  IF NOT has_schema_privilege(metrics_login_oid, 'public', 'USAGE')
     OR has_schema_privilege(metrics_login_oid, 'public', 'CREATE')
     OR NOT has_database_privilege(metrics_login_oid, current_database(), 'CONNECT')
     OR has_database_privilege(metrics_login_oid, current_database(), 'CREATE')
     OR has_database_privilege(metrics_login_oid, current_database(), 'TEMP')
     OR NOT has_table_privilege(metrics_login_oid, 'public.owner_global_metrics', 'SELECT')
     OR has_table_privilege(metrics_login_oid, 'public.owner_global_metrics', 'INSERT')
     OR has_table_privilege(metrics_login_oid, 'public.owner_global_metrics', 'UPDATE')
     OR has_table_privilege(metrics_login_oid, 'public.owner_global_metrics', 'DELETE')
     OR has_table_privilege(metrics_login_oid, 'public.owner_global_metrics', 'TRUNCATE')
     OR has_table_privilege(metrics_login_oid, 'public.owner_global_metrics', 'REFERENCES')
     OR has_table_privilege(metrics_login_oid, 'public.owner_global_metrics', 'TRIGGER')
     OR NOT has_schema_privilege(metrics_owner_oid, 'public', 'USAGE')
     OR has_schema_privilege(metrics_owner_oid, 'public', 'CREATE')
     OR has_table_privilege(runtime_oid, 'public.owner_global_metrics', 'SELECT')
     OR has_table_privilege(auth_oid, 'public.owner_global_metrics', 'SELECT') THEN
    RAISE EXCEPTION '020D4-A metrics LOGIN/view access does not match the fixed read-only contract';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind IN ('r','p','v','m','f')
       AND c.oid <> 'public.owner_global_metrics'::regclass
       AND (has_table_privilege(metrics_login_oid, c.oid, 'SELECT')
         OR has_table_privilege(metrics_login_oid, c.oid, 'INSERT')
         OR has_table_privilege(metrics_login_oid, c.oid, 'UPDATE')
         OR has_table_privilege(metrics_login_oid, c.oid, 'DELETE')
         OR has_any_column_privilege(metrics_login_oid, c.oid, 'SELECT'))
  ) OR EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl, acldefault('r', c.relowner))) acl
     WHERE n.nspname='public' AND acl.grantee=0
  ) OR EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl, acldefault('r', c.relowner))) acl
     WHERE n.nspname = 'public' AND c.oid = 'public.owner_global_metrics'::regclass
       AND (acl.grantee = 0 OR acl.grantee IN (runtime_oid, auth_oid)
         OR (acl.grantee = metrics_login_oid AND
             (acl.privilege_type <> 'SELECT' OR acl.is_grantable)))
  ) THEN
    RAISE EXCEPTION '020D4-A detected direct, PUBLIC, or grantable metrics access';
  END IF;

  IF EXISTS (
    SELECT 1 FROM unnest(ARRAY[
      'public.global_books'::regclass,'public.global_pdf_library'::regclass,'public.book_chunks'::regclass
    ]) AS source(oid)
     WHERE has_table_privilege(global_writer_oid,source.oid,'SELECT')
        OR has_table_privilege(global_writer_oid,source.oid,'INSERT')
        OR has_table_privilege(global_writer_oid,source.oid,'UPDATE')
        OR has_table_privilege(global_writer_oid,source.oid,'DELETE')
        OR has_any_column_privilege(global_writer_oid,source.oid,'SELECT')
  ) OR EXISTS (
    SELECT 1 FROM pg_namespace n
     WHERE n.nspname NOT IN ('pg_catalog','information_schema','public')
       AND has_schema_privilege(global_writer_oid,n.oid,'USAGE')
  ) OR has_database_privilege(global_writer_oid,current_database(),'CREATE')
     OR has_database_privilege(global_writer_oid,current_database(),'TEMP')
     OR has_schema_privilege(global_writer_oid,'public','CREATE')
     OR NOT has_schema_privilege(global_writer_oid,'public','USAGE')
     OR NOT has_database_privilege(global_writer_oid,current_database(),'CONNECT')
     OR has_schema_privilege(global_writer_owner_oid,'public','CREATE') THEN
    RAISE EXCEPTION '020D4-A requires the separate global writer to remain unprivileged on source tables';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_class c
      CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl, acldefault('r', c.relowner))) acl
     WHERE c.oid='public.owner_global_metrics'::regclass
       AND (acl.grantee NOT IN (metrics_owner_oid,metrics_login_oid)
         OR (acl.grantee=metrics_login_oid AND (acl.privilege_type <> 'SELECT' OR acl.is_grantable))
         OR (acl.grantee=metrics_owner_oid AND acl.is_grantable))
  ) OR (to_regclass('public.owner_metrics_rls_guard') IS NOT NULL AND EXISTS (
    SELECT 1 FROM pg_class c
      CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl, acldefault('r', c.relowner))) acl
     WHERE c.oid=to_regclass('public.owner_metrics_rls_guard')
       AND (acl.grantee <> metrics_owner_oid OR acl.is_grantable)
  )) THEN
    RAISE EXCEPTION '020D4-A metrics view ACL differs from the fixed owner/LOGIN contract';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_class c WHERE c.oid = 'public.owner_global_metrics'::regclass
      AND c.relkind = 'v' AND c.relowner = metrics_owner_oid
  ) OR EXISTS (
    SELECT 1 FROM pg_class c
     WHERE c.relowner = metrics_login_oid
  ) OR EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relowner = metrics_owner_oid
       AND NOT (c.relkind='v' AND c.relname IN ('owner_global_metrics','owner_metrics_rls_guard'))
  ) OR EXISTS (SELECT 1 FROM pg_proc WHERE proowner IN (metrics_login_oid,metrics_owner_oid))
    OR EXISTS (SELECT 1 FROM pg_class WHERE relkind='S' AND relowner IN (metrics_login_oid,metrics_owner_oid))
    OR EXISTS (SELECT 1 FROM pg_namespace WHERE nspowner IN (metrics_login_oid,metrics_owner_oid))
    OR EXISTS (SELECT 1 FROM pg_database WHERE datdba IN (metrics_login_oid,metrics_owner_oid)) THEN
    RAISE EXCEPTION '020D4-A metrics identities own unexpected SQL objects';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_namespace n
     WHERE n.nspname NOT IN ('pg_catalog','information_schema','public')
       AND has_schema_privilege(metrics_login_oid,n.oid,'USAGE')
  ) OR EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) acl
     WHERE n.nspname NOT IN ('pg_catalog','information_schema')
       AND acl.privilege_type='EXECUTE'
       AND (
         acl.grantee IN (metrics_login_oid,metrics_owner_oid)
         OR (acl.grantee=0 AND NOT EXISTS (
           SELECT 1 FROM pg_depend d JOIN pg_extension e ON e.oid=d.refobjid
            WHERE d.classid='pg_proc'::regclass AND d.objid=p.oid
              AND d.refclassid='pg_extension'::regclass AND d.deptype='e'
              AND e.extname IN ('vector','pgcrypto') AND e.extnamespace='public'::regnamespace
         ))
       )
  ) THEN
    RAISE EXCEPTION '020D4-A metrics roles must not receive application-function EXECUTE';
  END IF;

  SELECT relowner INTO source_owner_oid FROM pg_class WHERE oid='public.users'::regclass;
  IF source_owner_oid IN (runtime_oid,auth_oid,metrics_login_oid,metrics_owner_oid,
       global_writer_oid,global_writer_owner_oid,signup_bootstrap_oid,identity_probe_oid)
     OR EXISTS (
       SELECT 1 FROM pg_class c WHERE c.oid IN (
         'public.users'::regclass,'public.tenants'::regclass,'public.tenant_memberships'::regclass,
         'public.tenant_books'::regclass,'public.tenant_pdf_library'::regclass,'public.book_chunks'::regclass,
         'public.global_books'::regclass,'public.global_pdf_library'::regclass,
         'public.premium_review_reports'::regclass,'public.platform_owners'::regclass
       ) AND c.relowner <> source_owner_oid
     ) OR EXISTS (
       SELECT 1 FROM pg_database d WHERE d.datname=current_database()
        AND d.datdba IN (runtime_oid,auth_oid,metrics_login_oid,metrics_owner_oid)
     ) OR EXISTS (
       SELECT 1 FROM pg_namespace n WHERE n.nspname='public'
        AND n.nspowner IN (runtime_oid,auth_oid,metrics_login_oid,metrics_owner_oid)
     ) THEN
    RAISE EXCEPTION '020D4-A protected source tables must share the trusted schema owner';
  END IF;

  IF EXISTS (
    SELECT 1 FROM unnest(ARRAY[
      'public.users'::regclass,'public.tenants'::regclass,'public.global_books'::regclass,
      'public.global_pdf_library'::regclass,'public.book_chunks'::regclass,
      'public.premium_review_reports'::regclass,'public.platform_owners'::regclass
    ]) AS source(oid)
     WHERE has_table_privilege(metrics_owner_oid,source.oid,'SELECT')
        OR has_table_privilege(metrics_owner_oid,source.oid,'INSERT')
        OR has_table_privilege(metrics_owner_oid,source.oid,'UPDATE')
        OR has_table_privilege(metrics_owner_oid,source.oid,'DELETE')
        OR has_table_privilege(metrics_owner_oid,source.oid,'TRUNCATE')
        OR has_table_privilege(metrics_owner_oid,source.oid,'REFERENCES')
        OR has_table_privilege(metrics_owner_oid,source.oid,'TRIGGER')
  ) THEN
    RAISE EXCEPTION '020D4-A metrics view owner must use only reviewed source-column SELECT grants';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      CROSS JOIN LATERAL aclexplode(a.attacl) acl
     WHERE n.nspname = 'public' AND a.attnum > 0 AND NOT a.attisdropped
       AND (acl.grantee = 0 OR acl.grantee = metrics_login_oid
         OR (acl.grantee = metrics_owner_oid AND (acl.is_grantable OR NOT (
           acl.privilege_type = 'SELECT' AND (
             (c.relname IN ('tenants','users','global_books','global_pdf_library','premium_review_reports') AND a.attname = 'id')
             OR (c.relname = 'platform_owners' AND a.attname = 'user_id')
             OR (c.relname = 'book_chunks' AND a.attname IN ('id','global_book_id'))
           )
         )))
  )) THEN
    RAISE EXCEPTION '020D4-A detected unexpected PUBLIC or metrics source-column privileges';
  END IF;

  -- Compare fixed 020C/020C1 baseline A (17 policies) and B (the same 17 plus two
  -- reviewed metrics-owner policies). Names, commands, role OIDs, permissiveness and
  -- PostgreSQL 16 expression hashes are fixed; catalog state never defines the contract.
  WITH expected_full(tbl, pol, cmd, role_name, qual_hash, check_hash) AS (VALUES
    ('tenant_memberships','identity_auth_membership_insert','a','cocinacore_auth','-','58562a0d6b68a2566468ae99509b86f4'),
    ('tenant_memberships','identity_memberships_read','r','cocinacore_runtime_rls','2785c7d2a02276201066b47944f808a1','-'),
    ('tenant_memberships','identity_probe_memberships','r','cocinacore_identity_probe','c37f28a891160223cf64cb92fee37152','-'),
    ('tenant_memberships','signup_bootstrap_memberships_insert','a','cocinacore_signup_bootstrap','-','21603c513e869db33e8949609c606a1d'),
    ('tenants','identity_auth_tenants_insert','a','cocinacore_auth','-','b326b5062b2f0e69046810717534cb09'),
    ('tenants','identity_auth_tenants_read','r','cocinacore_auth','b326b5062b2f0e69046810717534cb09','-'),
    ('tenants','identity_tenants_read','r','cocinacore_runtime_rls','8663c2b7582c099ed48444ddc50aeca7','-'),
    ('tenants','signup_bootstrap_tenants_insert','a','cocinacore_signup_bootstrap','-','b326b5062b2f0e69046810717534cb09'),
    ('tenants','signup_bootstrap_tenants_read','r','cocinacore_signup_bootstrap','b326b5062b2f0e69046810717534cb09','-'),
    ('tenants','owner_metrics_tenants_select','r','cocinacore_metrics_view_owner','b326b5062b2f0e69046810717534cb09','-'),
    ('users','identity_auth_users_insert','a','cocinacore_auth','-','b326b5062b2f0e69046810717534cb09'),
    ('users','identity_auth_users_read','r','cocinacore_auth','b326b5062b2f0e69046810717534cb09','-'),
    ('users','identity_auth_users_update','w','cocinacore_auth','b326b5062b2f0e69046810717534cb09','b326b5062b2f0e69046810717534cb09'),
    ('users','identity_probe_users','r','cocinacore_identity_probe','bbff2be2eae4e15a233c59e536f8461f','-'),
    ('users','identity_users_read','r','cocinacore_runtime_rls','6b335f66fa8463708d4e1a9d5d5b12cc','-'),
    ('users','identity_users_update','w','cocinacore_runtime_rls','3b59a39dcf3fed953adc7f0cc90a6308','3b59a39dcf3fed953adc7f0cc90a6308'),
    ('users','signup_bootstrap_users_insert','a','cocinacore_signup_bootstrap','-','21603c513e869db33e8949609c606a1d'),
    ('users','signup_bootstrap_users_read','r','cocinacore_signup_bootstrap','b326b5062b2f0e69046810717534cb09','-'),
    ('users','owner_metrics_users_select','r','cocinacore_metrics_view_owner','b326b5062b2f0e69046810717534cb09','-')
  ), expected_base AS (
    SELECT * FROM expected_full WHERE pol NOT IN ('owner_metrics_tenants_select','owner_metrics_users_select')
  ), expected_full_oids AS (
    SELECT e.tbl,e.pol,e.cmd,r.oid role_oid,true permissive,e.qual_hash,e.check_hash
      FROM expected_full e JOIN pg_roles r ON r.rolname=e.role_name
  ), expected_base_oids AS (
    SELECT e.tbl,e.pol,e.cmd,r.oid role_oid,true permissive,e.qual_hash,e.check_hash
      FROM expected_base e JOIN pg_roles r ON r.rolname=e.role_name
  ), actual AS (
    SELECT c.relname::text,p.polname::text,p.polcmd::text,
      CASE WHEN cardinality(p.polroles)=1 THEN p.polroles[1] END,
      p.polpermissive,COALESCE(md5(pg_get_expr(p.polqual,p.polrelid)),'-'),
      COALESCE(md5(pg_get_expr(p.polwithcheck,p.polrelid)),'-')
      FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid
     WHERE c.oid IN ('public.users'::regclass,'public.tenants'::regclass,'public.tenant_memberships'::regclass)
  )
  SELECT NOT EXISTS ((SELECT * FROM expected_base_oids EXCEPT SELECT * FROM actual)
                     UNION ALL (SELECT * FROM actual EXCEPT SELECT * FROM expected_base_oids)),
         NOT EXISTS ((SELECT * FROM expected_full_oids EXCEPT SELECT * FROM actual)
                     UNION ALL (SELECT * FROM actual EXCEPT SELECT * FROM expected_full_oids))
    INTO identity_baseline, identity_expanded;

  -- Fixed D3 baseline A is six policies; B adds only the reviewed metrics SELECT on chunks.
  WITH expected_full(tbl, pol, cmd, role_name, qual_hash, check_hash) AS (VALUES
    ('tenant_books','documents_tenant_books_select','r','cocinacore_runtime_rls','049b61188bb1ee07a817bc83960a81f7','-'),
    ('tenant_books','documents_tenant_books_delete','d','cocinacore_runtime_rls','049b61188bb1ee07a817bc83960a81f7','-'),
    ('tenant_pdf_library','documents_tenant_pdfs_select','r','cocinacore_runtime_rls','1deacc6991bf727baedd33eecb9377b6','-'),
    ('tenant_pdf_library','documents_tenant_pdfs_delete','d','cocinacore_runtime_rls','1deacc6991bf727baedd33eecb9377b6','-'),
    ('book_chunks','documents_chunks_select','r','cocinacore_runtime_rls','205860f497f39ba01e5846d4b386ee7d','-'),
    ('book_chunks','documents_private_chunks_insert','a','cocinacore_runtime_rls','-','74e8083d1e9741029cb74c86f16af19f'),
    ('book_chunks','owner_metrics_chunks_select','r','cocinacore_metrics_view_owner','527d9306231a2e81421147e4681374df','-'),
    ('book_chunks','owner_global_writer_global_chunks_insert','a','cocinacore_global_writer_view_owner','-','683297ded201a155b416052089484b8f')
  ), expected_base AS (
    SELECT * FROM expected_full WHERE pol NOT IN ('owner_metrics_chunks_select','owner_global_writer_global_chunks_insert')
  ), expected_d4a AS (
    SELECT * FROM expected_full WHERE pol <> 'owner_global_writer_global_chunks_insert'
  ), full_oids AS (
    SELECT e.tbl,e.pol,e.cmd,r.oid role_oid,true permissive,e.qual_hash,e.check_hash
      FROM expected_full e JOIN pg_roles r ON r.rolname=e.role_name
  ), base_oids AS (
    SELECT e.tbl,e.pol,e.cmd,r.oid role_oid,true permissive,e.qual_hash,e.check_hash
      FROM expected_base e JOIN pg_roles r ON r.rolname=e.role_name
  ), d4a_oids AS (
    SELECT e.tbl,e.pol,e.cmd,r.oid role_oid,true permissive,e.qual_hash,e.check_hash
      FROM expected_d4a e JOIN pg_roles r ON r.rolname=e.role_name
  ), actual AS (
    SELECT c.relname::text,p.polname::text,p.polcmd::text,
      CASE WHEN cardinality(p.polroles)=1 THEN p.polroles[1] END,
      p.polpermissive,COALESCE(md5(pg_get_expr(p.polqual,p.polrelid)),'-'),
      COALESCE(md5(pg_get_expr(p.polwithcheck,p.polrelid)),'-')
      FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid
     WHERE c.oid IN ('public.tenant_books'::regclass,'public.tenant_pdf_library'::regclass,'public.book_chunks'::regclass)
  )
  SELECT NOT EXISTS ((SELECT * FROM base_oids EXCEPT SELECT * FROM actual)
                     UNION ALL (SELECT * FROM actual EXCEPT SELECT * FROM base_oids)),
         NOT EXISTS ((SELECT * FROM d4a_oids EXCEPT SELECT * FROM actual)
                     UNION ALL (SELECT * FROM actual EXCEPT SELECT * FROM d4a_oids)),
         NOT EXISTS ((SELECT * FROM full_oids EXCEPT SELECT * FROM actual)
                     UNION ALL (SELECT * FROM actual EXCEPT SELECT * FROM full_oids))
    INTO documents_baseline, documents_expanded, documents_writer;

  WITH expected(tbl, pol, cmd, role_name, qual_hash, check_hash) AS (VALUES
    ('global_books','runtime_global_books_select','r','cocinacore_runtime_rls','b326b5062b2f0e69046810717534cb09','-'),
    ('global_books','owner_metrics_global_books_select','r','cocinacore_metrics_view_owner','b326b5062b2f0e69046810717534cb09','-'),
    ('global_pdf_library','runtime_global_pdfs_select','r','cocinacore_runtime_rls','b326b5062b2f0e69046810717534cb09','-'),
    ('global_pdf_library','owner_metrics_global_pdfs_select','r','cocinacore_metrics_view_owner','b326b5062b2f0e69046810717534cb09','-'),
    ('premium_review_reports','runtime_owner_premium_reports_select','r','cocinacore_runtime_rls','5d656339b8672845d2bd61b5d9dba285','-'),
    ('premium_review_reports','owner_metrics_reports_select','r','cocinacore_metrics_view_owner','b326b5062b2f0e69046810717534cb09','-'),
    ('platform_owners','runtime_platform_owners_self_select','r','cocinacore_runtime_rls','9c2cfb07a30d07b070aa20a4c06f84b6','-'),
    ('platform_owners','owner_metrics_platform_owners_select','r','cocinacore_metrics_view_owner','b326b5062b2f0e69046810717534cb09','-'),
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
     WHERE c.oid IN ('public.global_books'::regclass,'public.global_pdf_library'::regclass,
                     'public.premium_review_reports'::regclass,'public.platform_owners'::regclass)
  ), expected_d4a AS (
    SELECT * FROM expected_oids WHERE pol NOT IN (
      'owner_global_writer_global_books_select','owner_global_writer_global_books_insert',
      'owner_global_writer_global_pdfs_insert','owner_global_writer_global_chunks_insert'
    )
  ), actual_with_chunks AS (
    SELECT * FROM actual
    UNION ALL
    SELECT c.relname::text,p.polname::text,p.polcmd::text,
      CASE WHEN cardinality(p.polroles)=1 THEN p.polroles[1] END,
      p.polpermissive,COALESCE(md5(pg_get_expr(p.polqual,p.polrelid)),'-'),
      COALESCE(md5(pg_get_expr(p.polwithcheck,p.polrelid)),'-')
      FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid
     WHERE c.oid='public.book_chunks'::regclass
       AND p.polname='owner_global_writer_global_chunks_insert'
  )
  SELECT NOT EXISTS ((SELECT * FROM expected_d4a EXCEPT SELECT * FROM actual)
                     UNION ALL (SELECT * FROM actual EXCEPT SELECT * FROM expected_d4a)),
         NOT EXISTS ((SELECT * FROM expected_oids EXCEPT SELECT * FROM actual_with_chunks)
                     UNION ALL (SELECT * FROM actual_with_chunks EXCEPT SELECT * FROM expected_oids))
    INTO current_policies, writer_policies;

  SELECT count(*) = 10 AND bool_and(relrowsecurity AND relforcerowsecurity)
    INTO installed_rls
    FROM pg_class WHERE oid IN (
      'public.users'::regclass,'public.tenants'::regclass,'public.tenant_memberships'::regclass,
      'public.tenant_books'::regclass,'public.tenant_pdf_library'::regclass,'public.book_chunks'::regclass,
      'public.global_books'::regclass,'public.global_pdf_library'::regclass,
      'public.premium_review_reports'::regclass,'public.platform_owners'::regclass
    );
  SELECT count(*) = 10 AND bool_and(
      CASE WHEN relname IN ('users','tenants','tenant_memberships','tenant_books','tenant_pdf_library','book_chunks')
        THEN relrowsecurity AND relforcerowsecurity
        ELSE NOT relrowsecurity AND NOT relforcerowsecurity END
    ) INTO baseline_rls
    FROM pg_class WHERE oid IN (
      'public.users'::regclass,'public.tenants'::regclass,'public.tenant_memberships'::regclass,
      'public.tenant_books'::regclass,'public.tenant_pdf_library'::regclass,'public.book_chunks'::regclass,
      'public.global_books'::regclass,'public.global_pdf_library'::regclass,
      'public.premium_review_reports'::regclass,'public.platform_owners'::regclass
    );

  SELECT EXISTS (
    SELECT 1 FROM pg_class c WHERE c.oid='public.owner_global_metrics'::regclass
      AND c.relowner=metrics_owner_oid AND md5(pg_get_viewdef(c.oid,true))='d9661b9fd079e6954af9d23c68b7ea94'
  ) AND to_regclass('public.owner_metrics_rls_guard') IS NULL INTO baseline_view;
  SELECT EXISTS (
    SELECT 1 FROM pg_class c WHERE c.oid='public.owner_global_metrics'::regclass
      AND c.relowner=metrics_owner_oid AND md5(pg_get_viewdef(c.oid,true))='59035b254a488a1015d641a81cc928ff'
  ) AND EXISTS (
    SELECT 1 FROM pg_class c WHERE c.oid=to_regclass('public.owner_metrics_rls_guard')
      AND c.relkind='v' AND c.relowner=metrics_owner_oid
      AND md5(pg_get_viewdef(c.oid,true))='8da147bc319c202a2ee4c8401c3d93ae'
  ) INTO installed_view;

  IF EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
     WHERE n.nspname='public' AND c.relowner=metrics_owner_oid
       AND c.relkind IN ('r','p','m','f')
  ) THEN
    RAISE EXCEPTION '020D4-A metrics view owner must not own source tables';
  END IF;

  IF NOT (
    identity_baseline AND documents_baseline
      AND NOT current_policies AND baseline_rls AND baseline_view
  ) AND NOT (
    identity_expanded AND (documents_expanded OR documents_writer)
      AND (current_policies OR writer_policies) AND installed_rls AND installed_view
  ) THEN
    RAISE EXCEPTION '020D4-A accepts only the exact 020C/020C1 plus D3 baseline or the complete FORCE RLS metrics state';
  END IF;
  apply_policies := identity_baseline AND documents_baseline AND NOT current_policies AND NOT writer_policies
                    AND baseline_rls AND baseline_view;
  PERFORM set_config('cocinacore.d4a.apply_policies', apply_policies::text, true);
END
$preflight$;

ALTER TABLE public.global_books ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.global_books FORCE ROW LEVEL SECURITY;
ALTER TABLE public.global_pdf_library ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.global_pdf_library FORCE ROW LEVEL SECURITY;
ALTER TABLE public.premium_review_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.premium_review_reports FORCE ROW LEVEL SECURITY;
ALTER TABLE public.platform_owners ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_owners FORCE ROW LEVEL SECURITY;

DO $install_policies$
BEGIN
  IF current_setting('cocinacore.d4a.apply_policies', true) = 'true' THEN
    EXECUTE 'CREATE POLICY owner_metrics_tenants_select ON public.tenants FOR SELECT TO cocinacore_metrics_view_owner USING (true)';
    EXECUTE 'CREATE POLICY owner_metrics_users_select ON public.users FOR SELECT TO cocinacore_metrics_view_owner USING (true)';
    EXECUTE 'CREATE POLICY runtime_global_books_select ON public.global_books FOR SELECT TO cocinacore_runtime_rls USING (true)';
    EXECUTE 'CREATE POLICY owner_metrics_global_books_select ON public.global_books FOR SELECT TO cocinacore_metrics_view_owner USING (true)';
    EXECUTE 'CREATE POLICY runtime_global_pdfs_select ON public.global_pdf_library FOR SELECT TO cocinacore_runtime_rls USING (true)';
    EXECUTE 'CREATE POLICY owner_metrics_global_pdfs_select ON public.global_pdf_library FOR SELECT TO cocinacore_metrics_view_owner USING (true)';
    EXECUTE 'CREATE POLICY owner_metrics_chunks_select ON public.book_chunks FOR SELECT TO cocinacore_metrics_view_owner USING (global_book_id IS NOT NULL)';
    EXECUTE $policy$
      CREATE POLICY runtime_owner_premium_reports_select ON public.premium_review_reports
        FOR SELECT TO cocinacore_runtime_rls
        USING (
          EXISTS (SELECT 1 FROM public.platform_owners AS owner_row
                   WHERE owner_row.user_id = NULLIF(current_setting('app.user_id', true), '')::uuid)
          AND EXISTS (SELECT 1 FROM public.runtime_identity_probe)
        )
    $policy$;
    EXECUTE 'CREATE POLICY owner_metrics_reports_select ON public.premium_review_reports FOR SELECT TO cocinacore_metrics_view_owner USING (true)';
    EXECUTE $policy$
      CREATE POLICY runtime_platform_owners_self_select ON public.platform_owners
        FOR SELECT TO cocinacore_runtime_rls
        USING (user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
               AND EXISTS (SELECT 1 FROM public.runtime_identity_probe))
    $policy$;
    EXECUTE 'CREATE POLICY owner_metrics_platform_owners_select ON public.platform_owners FOR SELECT TO cocinacore_metrics_view_owner USING (true)';
  END IF;
END
$install_policies$;

CREATE OR REPLACE VIEW public.owner_metrics_rls_guard AS
WITH expected_relations(relname) AS (
  VALUES ('users'),('tenants'),('tenant_memberships'),('tenant_books'),('tenant_pdf_library'),
         ('book_chunks'),('global_books'),('global_pdf_library'),('premium_review_reports'),('platform_owners')
), actual_relations AS (
  SELECT c.relname::text
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
   WHERE n.nspname='public' AND c.oid IN (
     'public.users'::regclass,'public.tenants'::regclass,'public.tenant_memberships'::regclass,
     'public.tenant_books'::regclass,'public.tenant_pdf_library'::regclass,'public.book_chunks'::regclass,
     'public.global_books'::regclass,'public.global_pdf_library'::regclass,
     'public.premium_review_reports'::regclass,'public.platform_owners'::regclass
   ) AND c.relkind='r'
), relation_contract AS (
  SELECT NOT EXISTS ((SELECT * FROM expected_relations EXCEPT SELECT * FROM actual_relations)
                     UNION ALL (SELECT * FROM actual_relations EXCEPT SELECT * FROM expected_relations)) AS exact
), expected(tbl,pol,cmd,role_name,qual_hash,check_hash) AS (VALUES
  ('tenant_memberships','identity_auth_membership_insert','a','cocinacore_auth','-','58562a0d6b68a2566468ae99509b86f4'),
  ('tenant_memberships','identity_memberships_read','r','cocinacore_runtime_rls','2785c7d2a02276201066b47944f808a1','-'),
  ('tenant_memberships','identity_probe_memberships','r','cocinacore_identity_probe','c37f28a891160223cf64cb92fee37152','-'),
  ('tenant_memberships','signup_bootstrap_memberships_insert','a','cocinacore_signup_bootstrap','-','21603c513e869db33e8949609c606a1d'),
  ('tenants','identity_auth_tenants_insert','a','cocinacore_auth','-','b326b5062b2f0e69046810717534cb09'),
  ('tenants','identity_auth_tenants_read','r','cocinacore_auth','b326b5062b2f0e69046810717534cb09','-'),
  ('tenants','identity_tenants_read','r','cocinacore_runtime_rls','8663c2b7582c099ed48444ddc50aeca7','-'),
  ('tenants','signup_bootstrap_tenants_insert','a','cocinacore_signup_bootstrap','-','b326b5062b2f0e69046810717534cb09'),
  ('tenants','signup_bootstrap_tenants_read','r','cocinacore_signup_bootstrap','b326b5062b2f0e69046810717534cb09','-'),
  ('tenants','owner_metrics_tenants_select','r','cocinacore_metrics_view_owner','b326b5062b2f0e69046810717534cb09','-'),
  ('users','identity_auth_users_insert','a','cocinacore_auth','-','b326b5062b2f0e69046810717534cb09'),
  ('users','identity_auth_users_read','r','cocinacore_auth','b326b5062b2f0e69046810717534cb09','-'),
  ('users','identity_auth_users_update','w','cocinacore_auth','b326b5062b2f0e69046810717534cb09','b326b5062b2f0e69046810717534cb09'),
  ('users','identity_probe_users','r','cocinacore_identity_probe','bbff2be2eae4e15a233c59e536f8461f','-'),
  ('users','identity_users_read','r','cocinacore_runtime_rls','6b335f66fa8463708d4e1a9d5d5b12cc','-'),
  ('users','identity_users_update','w','cocinacore_runtime_rls','3b59a39dcf3fed953adc7f0cc90a6308','3b59a39dcf3fed953adc7f0cc90a6308'),
  ('users','signup_bootstrap_users_insert','a','cocinacore_signup_bootstrap','-','21603c513e869db33e8949609c606a1d'),
  ('users','signup_bootstrap_users_read','r','cocinacore_signup_bootstrap','b326b5062b2f0e69046810717534cb09','-'),
  ('users','owner_metrics_users_select','r','cocinacore_metrics_view_owner','b326b5062b2f0e69046810717534cb09','-'),
  ('tenant_books','documents_tenant_books_select','r','cocinacore_runtime_rls','049b61188bb1ee07a817bc83960a81f7','-'),
  ('tenant_books','documents_tenant_books_delete','d','cocinacore_runtime_rls','049b61188bb1ee07a817bc83960a81f7','-'),
  ('tenant_pdf_library','documents_tenant_pdfs_select','r','cocinacore_runtime_rls','1deacc6991bf727baedd33eecb9377b6','-'),
  ('tenant_pdf_library','documents_tenant_pdfs_delete','d','cocinacore_runtime_rls','1deacc6991bf727baedd33eecb9377b6','-'),
  ('book_chunks','documents_chunks_select','r','cocinacore_runtime_rls','205860f497f39ba01e5846d4b386ee7d','-'),
  ('book_chunks','documents_private_chunks_insert','a','cocinacore_runtime_rls','-','74e8083d1e9741029cb74c86f16af19f'),
  ('book_chunks','owner_metrics_chunks_select','r','cocinacore_metrics_view_owner','527d9306231a2e81421147e4681374df','-'),
  ('global_books','runtime_global_books_select','r','cocinacore_runtime_rls','b326b5062b2f0e69046810717534cb09','-'),
  ('global_books','owner_metrics_global_books_select','r','cocinacore_metrics_view_owner','b326b5062b2f0e69046810717534cb09','-'),
  ('global_books','owner_global_writer_global_books_select','r','cocinacore_global_writer_view_owner','b326b5062b2f0e69046810717534cb09','-'),
  ('global_books','owner_global_writer_global_books_insert','a','cocinacore_global_writer_view_owner','-','1e2ffac12def62b379e8001d7db06492'),
  ('global_pdf_library','runtime_global_pdfs_select','r','cocinacore_runtime_rls','b326b5062b2f0e69046810717534cb09','-'),
  ('global_pdf_library','owner_metrics_global_pdfs_select','r','cocinacore_metrics_view_owner','b326b5062b2f0e69046810717534cb09','-'),
  ('global_pdf_library','owner_global_writer_global_pdfs_insert','a','cocinacore_global_writer_view_owner','-','1faec916f592851d25e78b6af91c04e4'),
  ('book_chunks','owner_global_writer_global_chunks_insert','a','cocinacore_global_writer_view_owner','-','683297ded201a155b416052089484b8f'),
  ('premium_review_reports','runtime_owner_premium_reports_select','r','cocinacore_runtime_rls','5d656339b8672845d2bd61b5d9dba285','-'),
  ('premium_review_reports','owner_metrics_reports_select','r','cocinacore_metrics_view_owner','b326b5062b2f0e69046810717534cb09','-'),
  ('platform_owners','runtime_platform_owners_self_select','r','cocinacore_runtime_rls','9c2cfb07a30d07b070aa20a4c06f84b6','-'),
  ('platform_owners','owner_metrics_platform_owners_select','r','cocinacore_metrics_view_owner','b326b5062b2f0e69046810717534cb09','-')
), expected_d4a AS (
  SELECT * FROM expected WHERE pol NOT IN (
    'owner_global_writer_global_books_select','owner_global_writer_global_books_insert',
    'owner_global_writer_global_pdfs_insert','owner_global_writer_global_chunks_insert'
  )
), expected_oids AS (
  SELECT e.tbl,e.pol,e.cmd,r.oid role_oid,true permissive,e.qual_hash,e.check_hash
    FROM expected e JOIN pg_roles r ON r.rolname=e.role_name
), expected_d4a_oids AS (
  SELECT e.tbl,e.pol,e.cmd,r.oid role_oid,true permissive,e.qual_hash,e.check_hash
    FROM expected_d4a e JOIN pg_roles r ON r.rolname=e.role_name
), actual AS (
  SELECT c.relname::text,p.polname::text,p.polcmd::text,
    CASE WHEN cardinality(p.polroles)=1 THEN p.polroles[1] END,
    p.polpermissive,COALESCE(md5(pg_get_expr(p.polqual,p.polrelid)),'-'),
    COALESCE(md5(pg_get_expr(p.polwithcheck,p.polrelid)),'-')
    FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid
   WHERE c.oid IN (
     'public.users'::regclass,'public.tenants'::regclass,'public.tenant_memberships'::regclass,
     'public.tenant_books'::regclass,'public.tenant_pdf_library'::regclass,'public.book_chunks'::regclass,
     'public.global_books'::regclass,'public.global_pdf_library'::regclass,
     'public.premium_review_reports'::regclass,'public.platform_owners'::regclass
   )
), policy_state AS (
  SELECT NOT EXISTS ((SELECT * FROM expected_d4a_oids EXCEPT SELECT * FROM actual)
                     UNION ALL (SELECT * FROM actual EXCEPT SELECT * FROM expected_d4a_oids)) AS d4a_exact,
         NOT EXISTS ((SELECT * FROM expected_oids EXCEPT SELECT * FROM actual)
                     UNION ALL (SELECT * FROM actual EXCEPT SELECT * FROM expected_oids)) AS d4b_exact,
         NOT EXISTS (
           SELECT 1 FROM pg_policy p
            WHERE p.polrelid IN (
              'public.users'::regclass,'public.tenants'::regclass,'public.tenant_memberships'::regclass,
              'public.tenant_books'::regclass,'public.tenant_pdf_library'::regclass,'public.book_chunks'::regclass,
              'public.global_books'::regclass,'public.global_pdf_library'::regclass,
              'public.premium_review_reports'::regclass,'public.platform_owners'::regclass
            )
         ) AS no_policies
), rls_state AS (
  SELECT count(*)=10 AS complete,
         bool_and(relrowsecurity AND relforcerowsecurity) AS forced,
         bool_and(NOT relrowsecurity AND NOT relforcerowsecurity) AS legacy
    FROM pg_class WHERE oid IN (
      'public.users'::regclass,'public.tenants'::regclass,'public.tenant_memberships'::regclass,
      'public.tenant_books'::regclass,'public.tenant_pdf_library'::regclass,'public.book_chunks'::regclass,
      'public.global_books'::regclass,'public.global_pdf_library'::regclass,
      'public.premium_review_reports'::regclass,'public.platform_owners'::regclass
  )
), source_owners AS (
  SELECT count(*)=10 AND bool_and(c.relowner=u.relowner)
         AND bool_and(u.relowner NOT IN (SELECT oid FROM pg_roles WHERE rolname IN (
           'cocinacore_runtime_rls','cocinacore_auth','cocinacore_owner_metrics','cocinacore_metrics_view_owner',
           'cocinacore_global_writer','cocinacore_global_writer_view_owner',
           'cocinacore_signup_bootstrap','cocinacore_identity_probe'
         ))) AS exact
    FROM pg_class c CROSS JOIN pg_class u
   WHERE c.oid IN (
     'public.users'::regclass,'public.tenants'::regclass,'public.tenant_memberships'::regclass,
     'public.tenant_books'::regclass,'public.tenant_pdf_library'::regclass,'public.book_chunks'::regclass,
     'public.global_books'::regclass,'public.global_pdf_library'::regclass,
     'public.premium_review_reports'::regclass,'public.platform_owners'::regclass
   ) AND u.oid='public.users'::regclass
), roles AS (
  SELECT
    EXISTS (SELECT 1 FROM pg_roles r WHERE r.rolname='cocinacore_owner_metrics'
      AND r.rolcanlogin AND NOT r.rolsuper AND NOT r.rolbypassrls AND NOT r.rolcreatedb
      AND NOT r.rolcreaterole AND NOT r.rolreplication AND NOT r.rolinherit
      AND COALESCE(cardinality(r.rolconfig)=2 AND r.rolconfig @> ARRAY['row_security=on','search_path=pg_catalog, public'],false)
      AND has_database_privilege(r.oid,current_database(),'CONNECT')
      AND NOT has_database_privilege(r.oid,current_database(),'CREATE')
      AND NOT has_database_privilege(r.oid,current_database(),'TEMP')
      AND has_schema_privilege(r.oid,'public','USAGE')
      AND NOT has_schema_privilege(r.oid,'public','CREATE')) AS login_ok,
    EXISTS (SELECT 1 FROM pg_roles r WHERE r.rolname='cocinacore_metrics_view_owner'
      AND NOT r.rolcanlogin AND NOT r.rolsuper AND NOT r.rolbypassrls AND NOT r.rolcreatedb
      AND NOT r.rolcreaterole AND NOT r.rolreplication AND NOT r.rolinherit
      AND r.rolconfig IS NULL AND has_schema_privilege(r.oid,'public','USAGE')
      AND NOT has_schema_privilege(r.oid,'public','CREATE')) AS owner_ok,
    NOT EXISTS (SELECT 1 FROM pg_auth_members m JOIN pg_roles r ON r.oid IN (m.member,m.roleid)
      WHERE r.rolname IN ('cocinacore_owner_metrics','cocinacore_metrics_view_owner')) AS no_memberships,
    NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_roles r ON r.oid=c.relowner
      WHERE r.rolname='cocinacore_owner_metrics'
         OR (r.rolname='cocinacore_metrics_view_owner' AND NOT
           (c.relnamespace='public'::regnamespace AND c.relkind='v'
             AND c.relname IN ('owner_global_metrics','owner_metrics_rls_guard'))))
      AND NOT EXISTS (SELECT 1 FROM pg_namespace n WHERE n.nspowner IN
        (SELECT oid FROM pg_roles WHERE rolname IN ('cocinacore_owner_metrics','cocinacore_metrics_view_owner')))
      AND NOT EXISTS (SELECT 1 FROM pg_database d WHERE d.datdba IN
        (SELECT oid FROM pg_roles WHERE rolname IN ('cocinacore_owner_metrics','cocinacore_metrics_view_owner'))) AS no_unexpected_ownership
), function_contract AS (
  SELECT NOT EXISTS (
    SELECT 1
      FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) acl
     WHERE n.nspname NOT IN ('pg_catalog','information_schema')
       AND acl.privilege_type='EXECUTE'
       AND (
         acl.grantee IN (
           SELECT oid FROM pg_roles
            WHERE rolname IN ('cocinacore_owner_metrics','cocinacore_metrics_view_owner')
         )
         OR (acl.grantee=0 AND NOT EXISTS (
           SELECT 1 FROM pg_depend d JOIN pg_extension e ON e.oid=d.refobjid
            WHERE d.classid='pg_proc'::regclass AND d.objid=p.oid
              AND d.refclassid='pg_extension'::regclass AND d.deptype='e'
              AND e.extname IN ('vector','pgcrypto') AND e.extnamespace='public'::regnamespace
         ))
       )
  ) AS exact
), grants AS (
  SELECT
    has_table_privilege('cocinacore_owner_metrics','public.owner_global_metrics','SELECT')
      AND NOT has_table_privilege('cocinacore_owner_metrics','public.owner_global_metrics','INSERT')
      AND NOT has_table_privilege('cocinacore_owner_metrics','public.owner_global_metrics','UPDATE')
      AND NOT has_table_privilege('cocinacore_owner_metrics','public.owner_global_metrics','DELETE')
      AND NOT has_table_privilege('cocinacore_owner_metrics','public.owner_global_metrics','TRUNCATE')
      AND NOT has_table_privilege('cocinacore_owner_metrics','public.owner_global_metrics','REFERENCES')
      AND NOT has_table_privilege('cocinacore_owner_metrics','public.owner_global_metrics','TRIGGER')
      AND NOT has_table_privilege('cocinacore_runtime_rls','public.owner_global_metrics','SELECT')
      AND NOT has_table_privilege('cocinacore_auth','public.owner_global_metrics','SELECT')
      AND NOT has_table_privilege('cocinacore_owner_metrics','public.owner_metrics_rls_guard','SELECT')
      AND NOT has_any_column_privilege('cocinacore_owner_metrics','public.users','SELECT')
      AND NOT has_any_column_privilege('cocinacore_owner_metrics','public.tenants','SELECT')
      AND NOT has_any_column_privilege('cocinacore_owner_metrics','public.global_books','SELECT')
      AND NOT has_any_column_privilege('cocinacore_owner_metrics','public.global_pdf_library','SELECT')
      AND NOT has_any_column_privilege('cocinacore_owner_metrics','public.book_chunks','SELECT')
      AND NOT has_any_column_privilege('cocinacore_owner_metrics','public.premium_review_reports','SELECT')
      AND NOT has_any_column_privilege('cocinacore_owner_metrics','public.platform_owners','SELECT')
      AND NOT EXISTS (
        SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
         WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m','f')
           AND c.oid <> 'public.owner_global_metrics'::regclass
           AND (has_table_privilege('cocinacore_owner_metrics',c.oid,'SELECT')
             OR has_table_privilege('cocinacore_owner_metrics',c.oid,'INSERT')
             OR has_table_privilege('cocinacore_owner_metrics',c.oid,'UPDATE')
             OR has_table_privilege('cocinacore_owner_metrics',c.oid,'DELETE')
             OR has_any_column_privilege('cocinacore_owner_metrics',c.oid,'SELECT'))
      ) AND NOT EXISTS (
        SELECT 1 FROM pg_class s JOIN pg_namespace n ON n.oid=s.relnamespace
         WHERE n.nspname='public' AND s.relkind='S'
           AND (has_sequence_privilege('cocinacore_owner_metrics',s.oid,'USAGE')
             OR has_sequence_privilege('cocinacore_owner_metrics',s.oid,'SELECT')
             OR has_sequence_privilege('cocinacore_owner_metrics',s.oid,'UPDATE'))
      ) AS login_view_only,
    has_column_privilege('cocinacore_metrics_view_owner','public.tenants','id','SELECT')
      AND has_column_privilege('cocinacore_metrics_view_owner','public.users','id','SELECT')
      AND has_column_privilege('cocinacore_metrics_view_owner','public.global_books','id','SELECT')
      AND has_column_privilege('cocinacore_metrics_view_owner','public.global_pdf_library','id','SELECT')
      AND has_column_privilege('cocinacore_metrics_view_owner','public.book_chunks','id','SELECT')
      AND has_column_privilege('cocinacore_metrics_view_owner','public.book_chunks','global_book_id','SELECT')
      AND has_column_privilege('cocinacore_metrics_view_owner','public.premium_review_reports','id','SELECT')
      AND has_column_privilege('cocinacore_metrics_view_owner','public.platform_owners','user_id','SELECT')
      AND NOT EXISTS (SELECT 1 FROM unnest(ARRAY[
        'public.users'::regclass,'public.tenants'::regclass,'public.global_books'::regclass,
        'public.global_pdf_library'::regclass,'public.book_chunks'::regclass,
        'public.premium_review_reports'::regclass,'public.platform_owners'::regclass
      ]) AS source(oid) WHERE has_table_privilege('cocinacore_metrics_view_owner',source.oid,'SELECT')
        OR has_table_privilege('cocinacore_metrics_view_owner',source.oid,'INSERT')
        OR has_table_privilege('cocinacore_metrics_view_owner',source.oid,'UPDATE')
        OR has_table_privilege('cocinacore_metrics_view_owner',source.oid,'DELETE')
        OR has_table_privilege('cocinacore_metrics_view_owner',source.oid,'TRUNCATE')
        OR has_table_privilege('cocinacore_metrics_view_owner',source.oid,'REFERENCES')
        OR has_table_privilege('cocinacore_metrics_view_owner',source.oid,'TRIGGER')) AS owner_columns
), column_contract AS (
  SELECT array_agg(a.attname::text ORDER BY a.attnum)=ARRAY['tenants','users','books','pdfs','chunks','reports','owners']::text[]
         AND bool_and(format_type(a.atttypid,a.atttypmod)='bigint') AS exact
    FROM pg_attribute a
   WHERE a.attrelid='public.owner_global_metrics'::regclass AND a.attnum>0 AND NOT a.attisdropped
), expected_source_columns(relname,attname,privilege_type,is_grantable) AS (VALUES
  ('tenants','id','SELECT',false),('users','id','SELECT',false),
  ('global_books','id','SELECT',false),('global_pdf_library','id','SELECT',false),
  ('book_chunks','id','SELECT',false),('book_chunks','global_book_id','SELECT',false),
  ('premium_review_reports','id','SELECT',false),('platform_owners','user_id','SELECT',false)
), actual_source_columns AS (
  SELECT c.relname::text,a.attname::text,acl.privilege_type,acl.is_grantable
    FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid
      CROSS JOIN LATERAL aclexplode(a.attacl) acl
   WHERE a.attnum>0 AND NOT a.attisdropped
     AND c.oid IN ('public.tenants'::regclass,'public.users'::regclass,'public.global_books'::regclass,
       'public.global_pdf_library'::regclass,'public.book_chunks'::regclass,
       'public.premium_review_reports'::regclass,'public.platform_owners'::regclass)
     AND acl.grantee=(SELECT oid FROM pg_roles WHERE rolname='cocinacore_metrics_view_owner')
), source_column_acl AS (
  SELECT NOT EXISTS ((SELECT * FROM expected_source_columns EXCEPT SELECT * FROM actual_source_columns)
                     UNION ALL (SELECT * FROM actual_source_columns EXCEPT SELECT * FROM expected_source_columns)) AS exact
), public_acl AS (
  SELECT NOT EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl,acldefault('r',c.relowner))) a
     WHERE (c.oid='public.owner_global_metrics'::regclass
         OR (n.nspname='public' AND c.relname='owner_metrics_rls_guard'))
       AND (a.grantee=0 OR a.grantee NOT IN (
         SELECT oid FROM pg_roles WHERE rolname IN ('cocinacore_metrics_view_owner','cocinacore_owner_metrics'))
         OR (a.grantee=(SELECT oid FROM pg_roles WHERE rolname='cocinacore_owner_metrics')
           AND (c.relname <> 'owner_global_metrics' OR a.privilege_type <> 'SELECT' OR a.is_grantable))
         OR (a.grantee=(SELECT oid FROM pg_roles WHERE rolname='cocinacore_metrics_view_owner') AND a.is_grantable))
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_class c CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl,acldefault('r',c.relowner))) a
     WHERE c.oid IN ('public.users'::regclass,'public.tenants'::regclass,'public.global_books'::regclass,
       'public.global_pdf_library'::regclass,'public.book_chunks'::regclass,
       'public.premium_review_reports'::regclass,'public.platform_owners'::regclass)
       AND a.grantee=0
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_attribute col JOIN pg_class c ON c.oid=col.attrelid
      CROSS JOIN LATERAL aclexplode(col.attacl) a
     WHERE c.oid IN ('public.users'::regclass,'public.tenants'::regclass,'public.global_books'::regclass,
       'public.global_pdf_library'::regclass,'public.book_chunks'::regclass,
       'public.premium_review_reports'::regclass,'public.platform_owners'::regclass)
       AND a.grantee=0
  ) AS exact
), global_writer_contract AS (
  WITH writer_roles AS (
    SELECT
      EXISTS (SELECT 1 FROM pg_roles r WHERE r.rolname='cocinacore_global_writer'
        AND r.rolcanlogin AND NOT r.rolsuper AND NOT r.rolbypassrls AND NOT r.rolcreatedb
        AND NOT r.rolcreaterole AND NOT r.rolreplication AND NOT r.rolinherit
        AND shobj_description(r.oid,'pg_authid')='CocinaCore isolated global writer v1'
        AND cardinality(r.rolconfig)=2
        AND r.rolconfig @> ARRAY['row_security=on','search_path=pg_catalog, public']
        AND has_database_privilege(r.oid,current_database(),'CONNECT')
        AND NOT has_database_privilege(r.oid,current_database(),'CREATE')
        AND NOT has_database_privilege(r.oid,current_database(),'TEMP')
        AND has_schema_privilege(r.oid,'public','USAGE')
        AND NOT has_schema_privilege(r.oid,'public','CREATE')) AS login_ok,
      EXISTS (SELECT 1 FROM pg_roles r WHERE r.rolname='cocinacore_global_writer_view_owner'
        AND NOT r.rolcanlogin AND NOT r.rolsuper AND NOT r.rolbypassrls AND NOT r.rolcreatedb
        AND NOT r.rolcreaterole AND NOT r.rolreplication AND NOT r.rolinherit
        AND shobj_description(r.oid,'pg_authid')='CocinaCore isolated global writer v1'
        AND r.rolconfig IS NULL
        AND has_schema_privilege(r.oid,'public','USAGE')
        AND NOT has_schema_privilege(r.oid,'public','CREATE')) AS owner_ok,
      NOT EXISTS (SELECT 1 FROM pg_auth_members m JOIN pg_roles r ON r.oid IN (m.member,m.roleid)
        WHERE r.rolname IN ('cocinacore_global_writer','cocinacore_global_writer_view_owner')) AS no_memberships,
      NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_roles r ON r.oid=c.relowner
        WHERE r.rolname='cocinacore_global_writer'
           OR (r.rolname='cocinacore_global_writer_view_owner' AND NOT
             (c.relnamespace='public'::regnamespace AND c.relkind='v' AND c.relname IN (
               'owner_write_global_books','owner_write_global_pdfs','owner_write_global_chunks'))))
        AND NOT EXISTS (SELECT 1 FROM pg_proc WHERE proowner IN (
          SELECT oid FROM pg_roles WHERE rolname IN ('cocinacore_global_writer','cocinacore_global_writer_view_owner')))
        AND NOT EXISTS (SELECT 1 FROM pg_class WHERE relkind='S' AND relowner IN (
          SELECT oid FROM pg_roles WHERE rolname IN ('cocinacore_global_writer','cocinacore_global_writer_view_owner')))
        AND NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspowner IN (
          SELECT oid FROM pg_roles WHERE rolname IN ('cocinacore_global_writer','cocinacore_global_writer_view_owner')))
        AND NOT EXISTS (SELECT 1 FROM pg_database WHERE datdba IN (
          SELECT oid FROM pg_roles WHERE rolname IN ('cocinacore_global_writer','cocinacore_global_writer_view_owner'))) AS ownership_ok
  ), expected_writer_views(view_name,definition_hash,check_option) AS (VALUES
    ('owner_write_global_books','158e764a6af66977e575135a28ea2b2c','NONE'),
    ('owner_write_global_pdfs','6faa61bf38a8fb2510439274c2df9e49','NONE'),
    ('owner_write_global_chunks','0bd8cd5e0a83eb114d2306b6dd0af4df','CASCADED')
  ), actual_writer_views AS (
    SELECT c.relname::text,md5(pg_get_viewdef(c.oid,true)),
           CASE
             WHEN c.relname='owner_write_global_chunks'
                  AND c.reloptions=ARRAY['check_option=cascaded'] THEN 'CASCADED'
             WHEN c.relname IN ('owner_write_global_books','owner_write_global_pdfs')
                  AND c.reloptions IS NULL THEN 'NONE'
             ELSE 'INVALID'
           END::text
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
     WHERE n.nspname='public' AND c.relname IN (
       'owner_write_global_books','owner_write_global_pdfs','owner_write_global_chunks')
       AND c.relkind='v'
       AND c.relowner=(SELECT oid FROM pg_roles WHERE rolname='cocinacore_global_writer_view_owner')
  ), view_definitions AS (
    SELECT NOT EXISTS ((SELECT * FROM expected_writer_views EXCEPT SELECT * FROM actual_writer_views)
                       UNION ALL (SELECT * FROM actual_writer_views EXCEPT SELECT * FROM expected_writer_views)) AS exact
  ), expected_view_acl(view_name,grantee_name,privilege_type,is_grantable) AS (VALUES
    ('owner_write_global_books','cocinacore_global_writer_view_owner','SELECT',false),
    ('owner_write_global_books','cocinacore_global_writer_view_owner','INSERT',false),
    ('owner_write_global_books','cocinacore_global_writer_view_owner','UPDATE',false),
    ('owner_write_global_books','cocinacore_global_writer_view_owner','DELETE',false),
    ('owner_write_global_books','cocinacore_global_writer_view_owner','TRUNCATE',false),
    ('owner_write_global_books','cocinacore_global_writer_view_owner','REFERENCES',false),
    ('owner_write_global_books','cocinacore_global_writer_view_owner','TRIGGER',false),
    ('owner_write_global_pdfs','cocinacore_global_writer_view_owner','SELECT',false),
    ('owner_write_global_pdfs','cocinacore_global_writer_view_owner','INSERT',false),
    ('owner_write_global_pdfs','cocinacore_global_writer_view_owner','UPDATE',false),
    ('owner_write_global_pdfs','cocinacore_global_writer_view_owner','DELETE',false),
    ('owner_write_global_pdfs','cocinacore_global_writer_view_owner','TRUNCATE',false),
    ('owner_write_global_pdfs','cocinacore_global_writer_view_owner','REFERENCES',false),
    ('owner_write_global_pdfs','cocinacore_global_writer_view_owner','TRIGGER',false),
    ('owner_write_global_chunks','cocinacore_global_writer_view_owner','SELECT',false),
    ('owner_write_global_chunks','cocinacore_global_writer_view_owner','INSERT',false),
    ('owner_write_global_chunks','cocinacore_global_writer_view_owner','UPDATE',false),
    ('owner_write_global_chunks','cocinacore_global_writer_view_owner','DELETE',false),
    ('owner_write_global_chunks','cocinacore_global_writer_view_owner','TRUNCATE',false),
    ('owner_write_global_chunks','cocinacore_global_writer_view_owner','REFERENCES',false),
    ('owner_write_global_chunks','cocinacore_global_writer_view_owner','TRIGGER',false),
    ('owner_write_global_books','cocinacore_global_writer','INSERT',false),
    ('owner_write_global_pdfs','cocinacore_global_writer','INSERT',false),
    ('owner_write_global_chunks','cocinacore_global_writer','INSERT',false)
  ), actual_view_acl AS (
    SELECT c.relname::text,COALESCE(r.rolname,'PUBLIC')::text,a.privilege_type,a.is_grantable
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      CROSS JOIN LATERAL aclexplode(c.relacl) a LEFT JOIN pg_roles r ON r.oid=a.grantee
     WHERE n.nspname='public' AND c.relname IN (
       'owner_write_global_books','owner_write_global_pdfs','owner_write_global_chunks')
  ), view_acl AS (
    SELECT NOT EXISTS ((SELECT * FROM expected_view_acl EXCEPT SELECT * FROM actual_view_acl)
                       UNION ALL (SELECT * FROM actual_view_acl EXCEPT SELECT * FROM expected_view_acl)) AS exact
  ), expected_view_column_acl(view_name,column_name,grantee_name,privilege_type,is_grantable) AS (VALUES
    ('owner_write_global_books','id','cocinacore_global_writer','SELECT',false)
  ), actual_view_column_acl AS (
    SELECT c.relname::text,a.attname::text,COALESCE(r.rolname,'PUBLIC')::text,acl.privilege_type,acl.is_grantable
      FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid
      JOIN pg_namespace n ON n.oid=c.relnamespace
      CROSS JOIN LATERAL aclexplode(a.attacl) acl LEFT JOIN pg_roles r ON r.oid=acl.grantee
     WHERE n.nspname='public' AND c.relname IN (
       'owner_write_global_books','owner_write_global_pdfs','owner_write_global_chunks')
       AND a.attnum>0 AND NOT a.attisdropped
  ), view_column_acl AS (
    SELECT NOT EXISTS ((SELECT * FROM expected_view_column_acl EXCEPT SELECT * FROM actual_view_column_acl)
                       UNION ALL (SELECT * FROM actual_view_column_acl EXCEPT SELECT * FROM expected_view_column_acl)) AS exact
  ), expected_source_acl(table_name,grantee_name,privilege_type,is_grantable) AS (VALUES
    ('global_books','cocinacore_global_writer_view_owner','SELECT',false),
    ('global_books','cocinacore_global_writer_view_owner','INSERT',false),
    ('global_pdf_library','cocinacore_global_writer_view_owner','INSERT',false),
    ('book_chunks','cocinacore_global_writer_view_owner','INSERT',false)
  ), actual_source_acl AS (
    SELECT c.relname::text,COALESCE(r.rolname,'PUBLIC')::text,a.privilege_type,a.is_grantable
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      CROSS JOIN LATERAL aclexplode(c.relacl) a LEFT JOIN pg_roles r ON r.oid=a.grantee
     WHERE n.nspname='public' AND c.oid IN (
       'public.global_books'::regclass,'public.global_pdf_library'::regclass,'public.book_chunks'::regclass)
       AND a.grantee=(SELECT oid FROM pg_roles WHERE rolname='cocinacore_global_writer_view_owner')
  ), source_acl AS (
    SELECT NOT EXISTS ((SELECT * FROM expected_source_acl EXCEPT SELECT * FROM actual_source_acl)
                       UNION ALL (SELECT * FROM actual_source_acl EXCEPT SELECT * FROM expected_source_acl)) AS exact
  ), expected_source_column_acl(table_name,column_name,grantee_name,privilege_type,is_grantable) AS (VALUES
    ('book_chunks','tenant_id','cocinacore_global_writer_view_owner','SELECT',false),
    ('book_chunks','tenant_book_id','cocinacore_global_writer_view_owner','SELECT',false),
    ('book_chunks','global_book_id','cocinacore_global_writer_view_owner','SELECT',false),
    ('book_chunks','source_type','cocinacore_global_writer_view_owner','SELECT',false)
  ), actual_source_column_acl AS (
    SELECT c.relname::text,a.attname::text,COALESCE(r.rolname,'PUBLIC')::text,acl.privilege_type,acl.is_grantable
      FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid
      JOIN pg_namespace n ON n.oid=c.relnamespace
      CROSS JOIN LATERAL aclexplode(a.attacl) acl LEFT JOIN pg_roles r ON r.oid=acl.grantee
     WHERE n.nspname='public' AND c.oid IN (
       'public.global_books'::regclass,'public.global_pdf_library'::regclass,'public.book_chunks'::regclass)
       AND r.rolname='cocinacore_global_writer_view_owner'
  ), source_column_acl AS (
    SELECT NOT EXISTS ((SELECT * FROM expected_source_column_acl EXCEPT SELECT * FROM actual_source_column_acl)
                       UNION ALL (SELECT * FROM actual_source_column_acl EXCEPT SELECT * FROM expected_source_column_acl)) AS exact
  ), effective_acl AS (
    SELECT NOT has_table_privilege('cocinacore_global_writer','public.global_books','SELECT')
         AND NOT has_table_privilege('cocinacore_global_writer','public.global_books','INSERT')
         AND NOT has_table_privilege('cocinacore_global_writer','public.global_pdf_library','SELECT')
         AND NOT has_table_privilege('cocinacore_global_writer','public.book_chunks','SELECT')
         AND NOT has_table_privilege('cocinacore_global_writer','public.book_chunks','INSERT')
         AND has_table_privilege('cocinacore_global_writer','public.owner_write_global_books','INSERT')
         AND has_table_privilege('cocinacore_global_writer','public.owner_write_global_pdfs','INSERT')
         AND has_table_privilege('cocinacore_global_writer','public.owner_write_global_chunks','INSERT')
         AND has_column_privilege('cocinacore_global_writer','public.owner_write_global_books','id','SELECT')
         AND NOT has_table_privilege('cocinacore_global_writer','public.owner_write_global_books','SELECT')
         AND NOT has_table_privilege('cocinacore_global_writer','public.owner_write_global_books','UPDATE')
         AND NOT has_table_privilege('cocinacore_global_writer','public.owner_write_global_books','DELETE')
         AND NOT has_table_privilege('cocinacore_global_writer','public.owner_write_global_pdfs','SELECT')
         AND NOT has_table_privilege('cocinacore_global_writer','public.owner_write_global_pdfs','UPDATE')
         AND NOT has_table_privilege('cocinacore_global_writer','public.owner_write_global_pdfs','DELETE')
         AND NOT has_table_privilege('cocinacore_global_writer','public.owner_write_global_chunks','SELECT')
         AND NOT has_table_privilege('cocinacore_global_writer','public.owner_write_global_chunks','UPDATE')
         AND NOT has_table_privilege('cocinacore_global_writer','public.owner_write_global_chunks','DELETE')
         AND NOT has_table_privilege('cocinacore_runtime_rls','public.owner_write_global_books','INSERT')
         AND NOT has_table_privilege('cocinacore_auth','public.owner_write_global_books','INSERT')
         AND NOT has_table_privilege('cocinacore_runtime_rls','public.owner_write_global_pdfs','INSERT')
         AND NOT has_table_privilege('cocinacore_auth','public.owner_write_global_pdfs','INSERT')
         AND NOT has_table_privilege('cocinacore_runtime_rls','public.owner_write_global_chunks','INSERT')
         AND NOT has_table_privilege('cocinacore_auth','public.owner_write_global_chunks','INSERT')
         AND NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
           WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m','f')
             AND c.oid NOT IN ('public.owner_write_global_books'::regclass,
               'public.owner_write_global_pdfs'::regclass,'public.owner_write_global_chunks'::regclass)
             AND (has_table_privilege('cocinacore_global_writer',c.oid,'SELECT')
               OR has_table_privilege('cocinacore_global_writer',c.oid,'INSERT')
               OR has_table_privilege('cocinacore_global_writer',c.oid,'UPDATE')
               OR has_table_privilege('cocinacore_global_writer',c.oid,'DELETE')
               OR has_any_column_privilege('cocinacore_global_writer',c.oid,'SELECT')))
         AND NOT EXISTS (SELECT 1 FROM pg_namespace n WHERE n.nspname NOT IN
           ('pg_catalog','information_schema','public')
           AND has_schema_privilege('cocinacore_global_writer',n.oid,'USAGE'))
         AND NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
           CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) acl
           WHERE n.nspname NOT IN ('pg_catalog','information_schema')
             AND acl.privilege_type='EXECUTE'
             AND (acl.grantee IN (SELECT oid FROM pg_roles WHERE rolname IN
                    ('cocinacore_global_writer','cocinacore_global_writer_view_owner'))
               OR (acl.grantee=0 AND NOT EXISTS (SELECT 1 FROM pg_depend d
                 JOIN pg_extension e ON e.oid=d.refobjid
                 WHERE d.classid='pg_proc'::regclass AND d.objid=p.oid
                   AND d.refclassid='pg_extension'::regclass AND d.deptype='e'
                   AND e.extname IN ('vector','pgcrypto') AND e.extnamespace='public'::regnamespace)))) AS exact
  )
  SELECT writer_roles.login_ok AND writer_roles.owner_ok AND writer_roles.no_memberships
      AND writer_roles.ownership_ok AND view_definitions.exact AND view_acl.exact
      AND view_column_acl.exact AND source_acl.exact AND source_column_acl.exact
      AND effective_acl.exact AS exact
    FROM writer_roles,view_definitions,view_acl,view_column_acl,source_acl,source_column_acl,effective_acl
)
SELECT
  (roles.login_ok AND roles.owner_ok AND roles.no_memberships AND roles.no_unexpected_ownership
   AND grants.login_view_only AND grants.owner_columns AND function_contract.exact AND column_contract.exact
   AND source_column_acl.exact AND public_acl.exact AND global_writer_contract.exact
   AND relation_contract.exact AND source_owners.exact
   AND rls_state.complete AND rls_state.forced
   AND EXISTS (SELECT 1 FROM policy_state WHERE d4a_exact OR d4b_exact)) AS available
FROM roles,grants,function_contract,column_contract,source_column_acl,public_acl,global_writer_contract,
     rls_state,relation_contract,source_owners;

ALTER VIEW public.owner_metrics_rls_guard OWNER TO cocinacore_metrics_view_owner;
REVOKE ALL PRIVILEGES ON public.owner_metrics_rls_guard
  FROM PUBLIC,cocinacore_runtime_rls,cocinacore_auth,cocinacore_owner_metrics;

CREATE OR REPLACE VIEW public.owner_global_metrics AS
WITH guard AS (SELECT available FROM public.owner_metrics_rls_guard)
SELECT
  CASE WHEN guard.available THEN (SELECT count(id) FROM public.tenants) ELSE NULL END AS tenants,
  CASE WHEN guard.available THEN (SELECT count(id) FROM public.users) ELSE NULL END AS users,
  CASE WHEN guard.available THEN (SELECT count(id) FROM public.global_books) ELSE NULL END AS books,
  CASE WHEN guard.available THEN (SELECT count(id) FROM public.global_pdf_library) ELSE NULL END AS pdfs,
  CASE WHEN guard.available THEN (SELECT count(id) FROM public.book_chunks WHERE global_book_id IS NOT NULL) ELSE NULL END AS chunks,
  CASE WHEN guard.available THEN (SELECT count(id) FROM public.premium_review_reports) ELSE NULL END AS reports,
  CASE WHEN guard.available THEN (SELECT count(user_id) FROM public.platform_owners) ELSE NULL END AS owners
FROM guard;
ALTER VIEW public.owner_global_metrics OWNER TO cocinacore_metrics_view_owner;
REVOKE ALL PRIVILEGES ON public.owner_global_metrics FROM PUBLIC,cocinacore_runtime_rls,cocinacore_auth;
GRANT SELECT ON public.owner_global_metrics TO cocinacore_owner_metrics;

DO $postflight$
BEGIN
  IF (SELECT available FROM public.owner_metrics_rls_guard) IS DISTINCT FROM true THEN
    RAISE EXCEPTION '020D4-A installation failed its fixed FORCE RLS metrics contract';
  END IF;
END
$postflight$;
