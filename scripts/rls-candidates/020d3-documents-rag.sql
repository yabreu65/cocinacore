-- Candidate component for a future 020. Apply only in the reviewed runner transaction.
-- app.* values are assertions from a verified server session, not authentication.
DO $preflight$
DECLARE
  runtime_oid oid;
  identity_probe_oid oid;
  global_writer_oid oid;
  global_writer_owner_oid oid;
  metrics_view_owner_oid oid;
  table_owner_oid oid;
  target_relations oid[];
  target_policy_count integer;
  installed_policy_contract boolean;
  d4a_policy_contract boolean;
  base_policy_contract boolean;
  initial_state boolean;
  installed_state boolean;
  match_chunks_oid oid;
BEGIN
  IF current_user IN (
    'cocinacore_runtime_rls',
    'cocinacore_auth',
    'cocinacore_global_writer'
  ) THEN
    RAISE EXCEPTION 'Apply 020D3 with the controlled migration identity';
  END IF;

  IF to_regclass('public.tenant_books') IS NULL
     OR to_regclass('public.tenant_pdf_library') IS NULL
     OR to_regclass('public.book_chunks') IS NULL
     OR to_regclass('public.users') IS NULL
     OR to_regclass('public.tenants') IS NULL
     OR to_regclass('public.tenant_memberships') IS NULL
     OR to_regclass('public.runtime_identity_probe') IS NULL THEN
    RAISE EXCEPTION '020D3 requires document tables and the reviewed 020C identity probe';
  END IF;
  target_relations := ARRAY[
    'public.tenant_books'::regclass::oid,
    'public.tenant_pdf_library'::regclass::oid,
    'public.book_chunks'::regclass::oid
  ];

  SELECT oid INTO runtime_oid
    FROM pg_roles
   WHERE rolname = 'cocinacore_runtime_rls'
     AND rolcanlogin
     AND NOT rolsuper
     AND NOT rolbypassrls
     AND NOT rolcreatedb
     AND NOT rolcreaterole
     AND NOT rolreplication
     AND NOT rolinherit
     AND COALESCE(rolconfig @> ARRAY['row_security=on'], false);
  IF runtime_oid IS NULL
     OR EXISTS (
       SELECT 1 FROM pg_auth_members
        WHERE member = runtime_oid OR roleid = runtime_oid
     )
     OR EXISTS (
       SELECT 1 FROM pg_shdepend
        WHERE refclassid = 'pg_authid'::regclass
          AND refobjid = runtime_oid
          AND deptype = 'o'
     )
     OR has_database_privilege(runtime_oid, current_database(), 'CREATE')
     OR has_database_privilege(runtime_oid, current_database(), 'TEMP')
     OR has_schema_privilege(runtime_oid, 'public', 'CREATE')
     OR NOT has_schema_privilege(runtime_oid, 'public', 'USAGE') THEN
    RAISE EXCEPTION '020D3 requires the isolated runtime identity without escalation';
  END IF;

  SELECT oid INTO identity_probe_oid
    FROM pg_roles
   WHERE rolname = 'cocinacore_identity_probe'
     AND NOT rolcanlogin
     AND NOT rolsuper
     AND NOT rolbypassrls
     AND NOT rolcreatedb
     AND NOT rolcreaterole
     AND NOT rolreplication
     AND NOT rolinherit;
  IF identity_probe_oid IS NULL
     OR EXISTS (
       SELECT 1 FROM pg_auth_members
        WHERE member = identity_probe_oid OR roleid = identity_probe_oid
     )
     OR NOT has_table_privilege(runtime_oid, 'public.runtime_identity_probe', 'SELECT')
     OR NOT EXISTS (
       SELECT 1 FROM pg_class c
        WHERE c.oid = 'public.runtime_identity_probe'::regclass
          AND c.relkind = 'v'
          AND c.relowner = identity_probe_oid
          AND 'security_barrier=true' = ANY(COALESCE(c.reloptions, ARRAY[]::text[]))
          AND pg_get_viewdef(c.oid, true) = E' SELECT u.id,\n    u.tenant_id\n   FROM users u\n     JOIN tenant_memberships m ON m.user_id = u.id AND m.tenant_id = u.tenant_id;'
     ) THEN
    RAISE EXCEPTION '020D3 requires the restricted 020C identity-probe contract';
  END IF;
  IF has_table_privilege(runtime_oid, 'public.runtime_identity_probe', 'INSERT')
     OR has_table_privilege(runtime_oid, 'public.runtime_identity_probe', 'UPDATE')
     OR has_table_privilege(runtime_oid, 'public.runtime_identity_probe', 'DELETE')
     OR has_table_privilege(runtime_oid, 'public.runtime_identity_probe', 'TRUNCATE')
     OR EXISTS (
       SELECT 1
         FROM pg_class c
         CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl, acldefault('r', c.relowner))) acl
        WHERE c.oid = 'public.runtime_identity_probe'::regclass
          AND NOT (
            acl.grantee = c.relowner
            OR (acl.grantee = runtime_oid AND acl.privilege_type = 'SELECT' AND NOT acl.is_grantable)
          )
     ) THEN
    RAISE EXCEPTION '020D3 requires runtime-only SELECT on the identity probe';
  END IF;
  IF (
    SELECT count(*) FROM pg_class
     WHERE oid IN ('public.users'::regclass, 'public.tenants'::regclass, 'public.tenant_memberships'::regclass)
       AND relrowsecurity AND relforcerowsecurity
  ) <> 3 THEN
    RAISE EXCEPTION '020D3 requires FORCE RLS on all reviewed 020C identity tables';
  END IF;
  -- Fixed PostgreSQL 16 fingerprints from the reviewed 020C and 020C1 candidates.
  -- A PostgreSQL deparser/version change requires explicit review; never relearn these values.
  IF (
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
      ('users','identity_auth_users_insert','a','cocinacore_auth','-','b326b5062b2f0e69046810717534cb09'),
      ('users','identity_auth_users_read','r','cocinacore_auth','b326b5062b2f0e69046810717534cb09','-'),
      ('users','identity_auth_users_update','w','cocinacore_auth','b326b5062b2f0e69046810717534cb09','b326b5062b2f0e69046810717534cb09'),
      ('users','identity_probe_users','r','cocinacore_identity_probe','bbff2be2eae4e15a233c59e536f8461f','-'),
      ('users','identity_users_read','r','cocinacore_runtime_rls','6b335f66fa8463708d4e1a9d5d5b12cc','-'),
      ('users','identity_users_update','w','cocinacore_runtime_rls','3b59a39dcf3fed953adc7f0cc90a6308','3b59a39dcf3fed953adc7f0cc90a6308'),
      ('users','signup_bootstrap_users_insert','a','cocinacore_signup_bootstrap','-','21603c513e869db33e8949609c606a1d'),
      ('users','signup_bootstrap_users_read','r','cocinacore_signup_bootstrap','b326b5062b2f0e69046810717534cb09','-'),
      ('tenants','owner_metrics_tenants_select','r','cocinacore_metrics_view_owner','b326b5062b2f0e69046810717534cb09','-'),
      ('users','owner_metrics_users_select','r','cocinacore_metrics_view_owner','b326b5062b2f0e69046810717534cb09','-')
    ), expected_base AS (
      SELECT * FROM expected_full WHERE pol NOT IN ('owner_metrics_tenants_select','owner_metrics_users_select')
    ), expected_full_oids AS (
      SELECT e.tbl, e.pol, e.cmd, r.oid AS role_oid, true AS permissive, e.qual_hash, e.check_hash
        FROM expected_full e JOIN pg_roles r ON r.rolname = e.role_name
    ), expected_base_oids AS (
      SELECT e.tbl, e.pol, e.cmd, r.oid AS role_oid, true AS permissive, e.qual_hash, e.check_hash
        FROM expected_base e JOIN pg_roles r ON r.rolname = e.role_name
    ), actual AS (
      SELECT c.relname::text, p.polname::text, p.polcmd::text,
        CASE WHEN cardinality(p.polroles) = 1 THEN p.polroles[1] END,
        p.polpermissive,
        COALESCE(md5(pg_get_expr(p.polqual, p.polrelid)), '-'),
        COALESCE(md5(pg_get_expr(p.polwithcheck, p.polrelid)), '-')
        FROM pg_policy p
        JOIN pg_class c ON c.oid = p.polrelid
       WHERE c.oid IN ('public.users'::regclass, 'public.tenants'::regclass, 'public.tenant_memberships'::regclass)
    ), full_diff AS (
      (SELECT * FROM expected_full_oids EXCEPT SELECT * FROM actual)
      UNION ALL (SELECT * FROM actual EXCEPT SELECT * FROM expected_full_oids)
    ), base_diff AS (
      (SELECT * FROM expected_base_oids EXCEPT SELECT * FROM actual)
      UNION ALL (SELECT * FROM actual EXCEPT SELECT * FROM expected_base_oids)
    )
    SELECT EXISTS (SELECT 1 FROM full_diff) AND EXISTS (SELECT 1 FROM base_diff)
  ) THEN
    RAISE EXCEPTION '020D3 requires exact identity baseline A (17) or complete baseline B (19)';
  END IF;

  SELECT oid INTO global_writer_oid
    FROM pg_roles
   WHERE rolname = 'cocinacore_global_writer'
     AND rolcanlogin
     AND NOT rolsuper
     AND NOT rolbypassrls
     AND NOT rolcreatedb
     AND NOT rolcreaterole
     AND NOT rolreplication
     AND NOT rolinherit
     AND COALESCE(rolconfig @> ARRAY['row_security=on'], false);
  SELECT oid INTO global_writer_owner_oid
    FROM pg_roles
   WHERE rolname = 'cocinacore_global_writer_view_owner'
     AND NOT rolcanlogin
     AND NOT rolsuper
     AND NOT rolbypassrls
     AND NOT rolcreatedb
     AND NOT rolcreaterole
     AND NOT rolreplication
     AND NOT rolinherit;
  IF global_writer_oid IS NULL OR global_writer_owner_oid IS NULL
     OR EXISTS (SELECT 1 FROM pg_auth_members WHERE member IN (global_writer_oid, global_writer_owner_oid)
                  OR roleid IN (global_writer_oid, global_writer_owner_oid))
     OR EXISTS (
       SELECT 1 FROM pg_class
        WHERE oid = ANY(target_relations)
          AND relowner IN (runtime_oid, global_writer_oid, global_writer_owner_oid)
     )
     OR NOT EXISTS (
       SELECT 1 FROM pg_class c
        WHERE c.oid = 'public.owner_write_global_books'::regclass
          AND c.relkind = 'v' AND c.relowner = global_writer_owner_oid
     )
     OR NOT EXISTS (
       SELECT 1 FROM pg_class c
        WHERE c.oid = 'public.owner_write_global_pdfs'::regclass
          AND c.relkind = 'v' AND c.relowner = global_writer_owner_oid
     )
     OR NOT EXISTS (
       SELECT 1 FROM pg_class c
        WHERE c.oid = 'public.owner_write_global_chunks'::regclass
          AND c.relkind = 'v' AND c.relowner = global_writer_owner_oid
     ) THEN
    RAISE EXCEPTION '020D3 requires the existing isolated global writer roles and fixed views';
  END IF;
  SELECT oid INTO metrics_view_owner_oid
    FROM pg_roles
   WHERE rolname = 'cocinacore_metrics_view_owner'
     AND NOT rolcanlogin
     AND NOT rolsuper
     AND NOT rolbypassrls
     AND NOT rolcreatedb
     AND NOT rolcreaterole
     AND NOT rolreplication
     AND NOT rolinherit;
  IF metrics_view_owner_oid IS NULL
     OR EXISTS (
       SELECT 1 FROM pg_auth_members
        WHERE member = metrics_view_owner_oid OR roleid = metrics_view_owner_oid
     )
     OR NOT EXISTS (
       SELECT 1 FROM pg_class c
        WHERE c.oid = 'public.owner_global_metrics'::regclass
          AND c.relkind = 'v' AND c.relowner = metrics_view_owner_oid
     ) THEN
    RAISE EXCEPTION '020D3 requires the existing restricted metrics-view owner';
  END IF;

  SELECT relowner INTO table_owner_oid FROM pg_class WHERE oid = 'public.users'::regclass;
  IF table_owner_oid IN (runtime_oid, global_writer_oid, global_writer_owner_oid)
     OR EXISTS (SELECT 1 FROM pg_class WHERE oid = ANY(target_relations) AND relowner <> table_owner_oid) THEN
    RAISE EXCEPTION '020D3 protected table owners must match the protected identity-table owner';
  END IF;

  -- Runtime may read/delete tenant documents and read/write private chunks only.
  -- Global catalogue writes are reserved for the separate, currently RLS-blocked writer.
  IF NOT (
       has_table_privilege(runtime_oid, 'public.tenant_books', 'SELECT')
   AND has_table_privilege(runtime_oid, 'public.tenant_books', 'DELETE')
   AND NOT has_table_privilege(runtime_oid, 'public.tenant_books', 'INSERT')
   AND NOT has_table_privilege(runtime_oid, 'public.tenant_books', 'UPDATE')
   AND has_table_privilege(runtime_oid, 'public.tenant_pdf_library', 'SELECT')
   AND has_table_privilege(runtime_oid, 'public.tenant_pdf_library', 'DELETE')
   AND NOT has_table_privilege(runtime_oid, 'public.tenant_pdf_library', 'INSERT')
   AND NOT has_table_privilege(runtime_oid, 'public.tenant_pdf_library', 'UPDATE')
   AND has_table_privilege(runtime_oid, 'public.book_chunks', 'SELECT')
   AND has_table_privilege(runtime_oid, 'public.book_chunks', 'INSERT')
   AND NOT has_table_privilege(runtime_oid, 'public.book_chunks', 'UPDATE')
   AND NOT has_table_privilege(runtime_oid, 'public.book_chunks', 'DELETE')
   AND has_table_privilege(runtime_oid, 'public.global_books', 'SELECT')
   AND NOT has_table_privilege(runtime_oid, 'public.global_books', 'INSERT')
   AND NOT has_table_privilege(runtime_oid, 'public.global_books', 'UPDATE')
   AND NOT has_table_privilege(runtime_oid, 'public.global_books', 'DELETE')
   AND has_table_privilege(runtime_oid, 'public.global_pdf_library', 'SELECT')
   AND NOT has_table_privilege(runtime_oid, 'public.global_pdf_library', 'INSERT')
   AND NOT has_table_privilege(runtime_oid, 'public.global_pdf_library', 'UPDATE')
   AND NOT has_table_privilege(runtime_oid, 'public.global_pdf_library', 'DELETE')
  ) THEN
    RAISE EXCEPTION '020D3 runtime grants do not match the reviewed read/private-chunk matrix';
  END IF;
  IF EXISTS (
    SELECT 1
      FROM pg_class c
      CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl, acldefault('r', c.relowner))) acl
     WHERE c.oid IN (
       'public.tenant_books'::regclass, 'public.tenant_pdf_library'::regclass,
       'public.book_chunks'::regclass, 'public.global_books'::regclass,
       'public.global_pdf_library'::regclass
     )
       AND (
         acl.grantee = 0
         OR acl.is_grantable
         OR (acl.grantee = runtime_oid AND NOT (
           (c.relname IN ('tenant_books','tenant_pdf_library') AND acl.privilege_type IN ('SELECT','DELETE'))
           OR (c.relname = 'book_chunks' AND acl.privilege_type IN ('SELECT','INSERT'))
           OR (c.relname IN ('global_books','global_pdf_library') AND acl.privilege_type = 'SELECT')
         ))
         OR (acl.grantee = global_writer_owner_oid AND NOT (
           (c.relname = 'global_books' AND acl.privilege_type IN ('SELECT','INSERT'))
           OR (c.relname = 'global_pdf_library' AND acl.privilege_type = 'INSERT')
           OR (c.relname = 'book_chunks' AND acl.privilege_type = 'INSERT')
         ))
         OR acl.grantee NOT IN (c.relowner, runtime_oid, global_writer_owner_oid)
       )
  ) OR EXISTS (
    SELECT 1
      FROM pg_attribute a
      JOIN pg_class c ON c.oid = a.attrelid
      CROSS JOIN LATERAL aclexplode(a.attacl) acl
     WHERE c.oid IN (
       'public.tenant_books'::regclass, 'public.tenant_pdf_library'::regclass,
       'public.book_chunks'::regclass, 'public.global_books'::regclass,
       'public.global_pdf_library'::regclass
     )
       AND a.attnum > 0 AND NOT a.attisdropped
       AND (
         acl.grantee = 0
         OR acl.is_grantable
         OR acl.grantee NOT IN (c.relowner, global_writer_owner_oid, metrics_view_owner_oid)
         OR (acl.grantee = global_writer_owner_oid AND
             (c.relname <> 'book_chunks' OR acl.privilege_type <> 'SELECT'
               OR a.attname NOT IN ('tenant_id','tenant_book_id','global_book_id','source_type')))
         OR (acl.grantee = metrics_view_owner_oid AND NOT (
           acl.privilege_type = 'SELECT'
           AND (
             (c.relname IN ('global_books','global_pdf_library') AND a.attname = 'id')
             OR (c.relname = 'book_chunks' AND a.attname IN ('id','global_book_id'))
           )
         ))
       )
  ) THEN
    RAISE EXCEPTION '020D3 refuses PUBLIC, grant-option, or unexpected document ACLs';
  END IF;

  SELECT to_regprocedure('public.match_chunks(vector,double precision,integer,uuid)')::oid
    INTO match_chunks_oid;
  IF match_chunks_oid IS NULL
     OR has_function_privilege(runtime_oid, match_chunks_oid, 'EXECUTE')
     OR (SELECT prosecdef FROM pg_proc WHERE oid = match_chunks_oid)
     OR EXISTS (
       SELECT 1
         FROM pg_proc p
         CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) acl
        WHERE p.oid = match_chunks_oid
          AND acl.grantee <> p.proowner
     ) THEN
    RAISE EXCEPTION '020D3 requires legacy match_chunks to remain invoker-only and EXECUTE-denied except to its owner';
  END IF;

  SELECT count(*) INTO target_policy_count FROM pg_policy WHERE polrelid = ANY(target_relations);
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
      SELECT * FROM expected_full WHERE pol NOT IN (
        'owner_metrics_chunks_select','owner_global_writer_global_chunks_insert')
    ), expected_d4a AS (
      SELECT * FROM expected_full WHERE pol <> 'owner_global_writer_global_chunks_insert'
    ), expected_full_oids AS (
      SELECT e.tbl,e.pol,e.cmd,r.oid AS role_oid,true AS permissive,e.qual_hash,e.check_hash
        FROM expected_full e JOIN pg_roles r ON r.rolname=e.role_name
    ), expected_base_oids AS (
      SELECT e.tbl,e.pol,e.cmd,r.oid AS role_oid,true AS permissive,e.qual_hash,e.check_hash
        FROM expected_base e JOIN pg_roles r ON r.rolname=e.role_name
    ), expected_d4a_oids AS (
      SELECT e.tbl,e.pol,e.cmd,r.oid AS role_oid,true AS permissive,e.qual_hash,e.check_hash
        FROM expected_d4a e JOIN pg_roles r ON r.rolname=e.role_name
    ), actual AS (
      SELECT c.relname::text, p.polname::text, p.polcmd::text,
        CASE WHEN cardinality(p.polroles) = 1 THEN p.polroles[1] END,
        p.polpermissive,
        COALESCE(md5(pg_get_expr(p.polqual, p.polrelid)), '-'),
        COALESCE(md5(pg_get_expr(p.polwithcheck, p.polrelid)), '-')
        FROM pg_policy p
        JOIN pg_class c ON c.oid = p.polrelid
       WHERE c.oid = ANY(target_relations)
    ), full_diff AS (
      (SELECT * FROM expected_full_oids EXCEPT SELECT * FROM actual)
      UNION ALL (SELECT * FROM actual EXCEPT SELECT * FROM expected_full_oids)
    ), base_diff AS (
      (SELECT * FROM expected_base_oids EXCEPT SELECT * FROM actual)
      UNION ALL (SELECT * FROM actual EXCEPT SELECT * FROM expected_base_oids)
    ), d4a_diff AS (
      (SELECT * FROM expected_d4a_oids EXCEPT SELECT * FROM actual)
      UNION ALL (SELECT * FROM actual EXCEPT SELECT * FROM expected_d4a_oids)
    )
  SELECT NOT EXISTS (SELECT 1 FROM full_diff), NOT EXISTS (SELECT 1 FROM d4a_diff),
         NOT EXISTS (SELECT 1 FROM base_diff)
    INTO installed_policy_contract, d4a_policy_contract, base_policy_contract;

  SELECT count(*) = 3
         AND bool_and(relrowsecurity AND relforcerowsecurity)
    INTO installed_state
    FROM pg_class
   WHERE oid = ANY(target_relations);
  installed_state := COALESCE(installed_state, false) AND (
    (target_policy_count = 6 AND base_policy_contract)
    OR (target_policy_count = 7 AND d4a_policy_contract)
    OR (target_policy_count = 8 AND installed_policy_contract)
  );
  SELECT count(*) = 3
         AND bool_and(NOT relrowsecurity AND NOT relforcerowsecurity)
    INTO initial_state
    FROM pg_class
   WHERE oid = ANY(target_relations);
  initial_state := COALESCE(initial_state, false) AND target_policy_count = 0;

  IF NOT initial_state AND NOT installed_state THEN
    RAISE EXCEPTION '020D3 target tables are partial or differ from the fixed six-, seven-, or eight-policy contract';
  END IF;

  IF initial_state THEN
    EXECUTE 'ALTER TABLE public.tenant_books ENABLE ROW LEVEL SECURITY';
    EXECUTE 'ALTER TABLE public.tenant_books FORCE ROW LEVEL SECURITY';
    EXECUTE 'ALTER TABLE public.tenant_pdf_library ENABLE ROW LEVEL SECURITY';
    EXECUTE 'ALTER TABLE public.tenant_pdf_library FORCE ROW LEVEL SECURITY';
    EXECUTE 'ALTER TABLE public.book_chunks ENABLE ROW LEVEL SECURITY';
    EXECUTE 'ALTER TABLE public.book_chunks FORCE ROW LEVEL SECURITY';
    EXECUTE $policy$
      CREATE POLICY documents_tenant_books_select ON public.tenant_books
        FOR SELECT TO cocinacore_runtime_rls
        USING (
          tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
          AND EXISTS (SELECT 1 FROM public.runtime_identity_probe)
        )
    $policy$;
    EXECUTE $policy$
      CREATE POLICY documents_tenant_books_delete ON public.tenant_books
        FOR DELETE TO cocinacore_runtime_rls
        USING (
          tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
          AND EXISTS (SELECT 1 FROM public.runtime_identity_probe)
        )
    $policy$;
    EXECUTE $policy$
      CREATE POLICY documents_tenant_pdfs_select ON public.tenant_pdf_library
        FOR SELECT TO cocinacore_runtime_rls
        USING (
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
        )
    $policy$;
    EXECUTE $policy$
      CREATE POLICY documents_tenant_pdfs_delete ON public.tenant_pdf_library
        FOR DELETE TO cocinacore_runtime_rls
        USING (
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
        )
    $policy$;
    EXECUTE $policy$
      CREATE POLICY documents_chunks_select ON public.book_chunks
        FOR SELECT TO cocinacore_runtime_rls
        USING (
          (
            (
              source_type = 'global_pdf'
              AND tenant_id IS NULL
              AND global_book_id IS NOT NULL
              AND tenant_book_id IS NULL
              AND EXISTS (
                SELECT 1 FROM public.global_books AS parent_book
                 WHERE parent_book.id = book_chunks.global_book_id
              )
            )
            OR (
              source_type = 'tenant_pdf'
              AND tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
              AND global_book_id IS NULL
              AND tenant_book_id IS NOT NULL
              AND EXISTS (
                SELECT 1 FROM public.tenant_books AS parent_book
                 WHERE parent_book.id = book_chunks.tenant_book_id
                   AND parent_book.tenant_id = book_chunks.tenant_id
              )
            )
          )
          AND EXISTS (SELECT 1 FROM public.runtime_identity_probe)
        )
    $policy$;
    EXECUTE $policy$
      CREATE POLICY documents_private_chunks_insert ON public.book_chunks
        FOR INSERT TO cocinacore_runtime_rls
        WITH CHECK (
          source_type = 'tenant_pdf'
          AND tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
          AND global_book_id IS NULL
          AND tenant_book_id IS NOT NULL
          AND EXISTS (
            SELECT 1 FROM public.tenant_books AS parent_book
             WHERE parent_book.id = book_chunks.tenant_book_id
               AND parent_book.tenant_id = book_chunks.tenant_id
          )
          AND EXISTS (SELECT 1 FROM public.runtime_identity_probe)
        )
    $policy$;
  END IF;
END
$preflight$;
