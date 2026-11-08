-- Fixed 020E-A1-P inert catalog contract; maintained together with the reviewed preparer.
DO $attest$
DECLARE r record; expected_comment text; role_name text;
BEGIN
  IF EXISTS (
    WITH expected(name,owner_name,definition_hash,options) AS (VALUES
      ('owner_write_global_books','cocinacore_global_writer_view_owner','158e764a6af66977e575135a28ea2b2c',NULL::text[]),
      ('owner_write_global_pdfs','cocinacore_global_writer_view_owner','6faa61bf38a8fb2510439274c2df9e49',NULL::text[]),
      ('owner_write_global_chunks','cocinacore_global_writer_view_owner','0bd8cd5e0a83eb114d2306b6dd0af4df',ARRAY['check_option=cascaded']),
      ('owner_metrics_rls_guard','cocinacore_metrics_view_owner','8da147bc319c202a2ee4c8401c3d93ae',NULL::text[]),
      ('owner_global_metrics','cocinacore_metrics_view_owner','59035b254a488a1015d641a81cc928ff',NULL::text[])
    ), actual AS (
      SELECT c.relname::text name, pg_get_userbyid(c.relowner)::text owner_name,
        CASE WHEN c.relkind='v' THEN md5(pg_get_viewdef(c.oid,true)) END definition_hash,c.reloptions options
      FROM pg_class c JOIN pg_namespace ns ON ns.oid=c.relnamespace
      WHERE ns.nspname='public' AND c.relname IN ('owner_write_global_books','owner_write_global_pdfs','owner_write_global_chunks','owner_metrics_rls_guard','owner_global_metrics')
    )
    SELECT 1 FROM expected e FULL JOIN actual a USING(name)
      WHERE e.name IS NULL OR a.name IS NULL OR e.owner_name IS DISTINCT FROM a.owner_name OR
        e.definition_hash IS DISTINCT FROM a.definition_hash OR e.options IS DISTINCT FROM a.options
  ) THEN RAISE EXCEPTION '020 inert prepared view definition, owner, or options mismatch'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace ns ON ns.oid=c.relnamespace
     WHERE ns.nspname='public' AND c.relname='runtime_identity_probe' AND c.relkind='v'
       AND c.relowner=(SELECT oid FROM pg_roles WHERE rolname='cocinacore_identity_probe')
       AND c.reloptions=ARRAY['security_barrier=true']::text[]
       AND pg_get_viewdef(c.oid,true)=E' SELECT u.id,\n    u.tenant_id\n   FROM users u\n     JOIN tenant_memberships m ON m.user_id = u.id AND m.tenant_id = u.tenant_id;'
  ) THEN RAISE EXCEPTION '020 inert identity probe definition, owner, or options mismatch'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace ns ON ns.oid=p.pronamespace JOIN pg_language l ON l.oid=p.prolang
     WHERE ns.nspname='public' AND p.oid=to_regprocedure('public.signup_new_account(text,text,text,timestamptz,text)')
       AND p.proowner=(SELECT oid FROM pg_roles WHERE rolname='cocinacore_signup_bootstrap')
       AND p.prokind='f' AND p.prosecdef AND NOT p.proleakproof AND NOT p.proisstrict
       AND p.provolatile='v' AND p.proparallel='u' AND p.proretset AND p.pronargdefaults=0
       AND l.lanname='plpgsql' AND p.proconfig=ARRAY['search_path=pg_catalog']::text[]
       AND md5(p.prosrc)='5358b46b5b10a8878408f2ffa5a2f223'
       AND pg_get_function_identity_arguments(p.oid)='p_email text, p_password_hash text, p_full_name text, p_terms_accepted_at timestamp with time zone, p_terms_version text'
       AND pg_get_function_result(p.oid)='TABLE(user_id uuid, tenant_id uuid)'
  ) THEN RAISE EXCEPTION '020 inert signup function definition, signature, owner, or options mismatch'; END IF;
  IF EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace ns ON ns.oid=c.relnamespace
    CROSS JOIN LATERAL aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a
    WHERE ns.nspname='public' AND c.relname IN ('runtime_identity_probe','owner_write_global_books','owner_write_global_pdfs','owner_write_global_chunks','owner_metrics_rls_guard','owner_global_metrics')
      AND (a.grantee<>c.relowner OR a.grantor<>c.relowner OR a.is_grantable OR a.privilege_type NOT IN ('SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'))
  ) OR EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace ns ON ns.oid=c.relnamespace
    WHERE ns.nspname='public' AND c.relname IN ('runtime_identity_probe','owner_write_global_books','owner_write_global_pdfs','owner_write_global_chunks','owner_metrics_rls_guard','owner_global_metrics')
      AND (SELECT count(*) FROM aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))))<>7
  ) OR EXISTS (
    SELECT 1 FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace ns ON ns.oid=c.relnamespace
    CROSS JOIN LATERAL aclexplode(a.attacl) x WHERE ns.nspname='public'
      AND c.relname IN ('runtime_identity_probe','owner_write_global_books','owner_write_global_pdfs','owner_write_global_chunks','owner_metrics_rls_guard','owner_global_metrics')
  ) THEN RAISE EXCEPTION '020 inert view ACL mismatch'; END IF;
  IF EXISTS (
    SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
    WHERE p.oid=to_regprocedure('public.signup_new_account(text,text,text,timestamptz,text)')
      AND (a.grantee<>p.proowner OR a.grantor<>p.proowner OR a.is_grantable OR a.privilege_type<>'EXECUTE')
  ) OR (SELECT count(*) FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE p.oid=to_regprocedure('public.signup_new_account(text,text,text,timestamptz,text)'))<>1 THEN
    RAISE EXCEPTION '020 inert signup function ACL mismatch';
  END IF;
  FOREACH role_name IN ARRAY ARRAY['cocinacore_identity_probe','cocinacore_signup_bootstrap','cocinacore_metrics_view_owner','cocinacore_global_writer_view_owner'] LOOP
    SELECT * INTO r FROM pg_roles WHERE rolname=role_name;
    expected_comment := CASE WHEN role_name IN ('cocinacore_identity_probe','cocinacore_signup_bootstrap') THEN 'CocinaCore isolated signup role v1'
      WHEN role_name='cocinacore_metrics_view_owner' THEN 'CocinaCore isolated metrics role v1' ELSE 'CocinaCore isolated global writer v1' END;
    IF NOT FOUND OR r.rolcanlogin OR r.rolsuper OR r.rolbypassrls OR r.rolcreatedb OR r.rolcreaterole OR r.rolinherit OR r.rolreplication OR r.rolconfig IS NOT NULL OR r.rolvaliduntil IS NOT NULL OR r.rolconnlimit<>-1 OR shobj_description(r.oid,'pg_authid') IS DISTINCT FROM expected_comment OR
      EXISTS (SELECT 1 FROM pg_auth_members WHERE member=r.oid OR roleid=r.oid) OR
      EXISTS (SELECT 1 FROM pg_default_acl d CROSS JOIN LATERAL aclexplode(d.defaclacl) a WHERE d.defaclrole=r.oid OR a.grantee=r.oid) OR
      EXISTS (SELECT 1 FROM pg_shdepend s WHERE s.refclassid='pg_authid'::regclass AND s.refobjid=r.oid AND s.deptype='o' AND NOT (
        s.dbid=(SELECT oid FROM pg_database WHERE datname=current_database()) AND (
          (s.classid='pg_class'::regclass AND s.objid IN (to_regclass('public.runtime_identity_probe'),to_regclass('public.owner_write_global_books'),to_regclass('public.owner_write_global_pdfs'),to_regclass('public.owner_write_global_chunks'),to_regclass('public.owner_metrics_rls_guard'),to_regclass('public.owner_global_metrics'))) OR
          (s.classid='pg_proc'::regclass AND s.objid=to_regprocedure('public.signup_new_account(text,text,text,timestamptz,text)'))))) OR
      EXISTS (SELECT 1 FROM pg_shdepend s WHERE s.refclassid='pg_authid'::regclass AND s.refobjid=r.oid AND s.deptype='a' AND NOT (
        s.dbid=(SELECT oid FROM pg_database WHERE datname=current_database()) AND (
          (s.classid='pg_class'::regclass AND s.objid IN ('public.users'::regclass,'public.tenants'::regclass,'public.tenant_memberships'::regclass,'public.global_books'::regclass,'public.global_pdf_library'::regclass,'public.book_chunks'::regclass,'public.premium_review_reports'::regclass,'public.platform_owners'::regclass)) OR
          (s.classid='pg_namespace'::regclass AND s.objid='public'::regnamespace)))) OR
      EXISTS (SELECT 1 FROM pg_namespace ns CROSS JOIN LATERAL aclexplode(ns.nspacl) a WHERE a.grantee=r.oid AND (ns.nspname<>'public' OR a.privilege_type<>'USAGE' OR a.is_grantable)) OR
      NOT has_schema_privilege(r.oid,'public','USAGE') OR has_schema_privilege(r.oid,'public','CREATE') OR
      EXISTS (SELECT 1 FROM pg_database d CROSS JOIN LATERAL aclexplode(d.datacl) a WHERE a.grantee=r.oid) OR
      EXISTS (SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(p.proacl) a WHERE a.grantee=r.oid AND p.proowner<>r.oid)
    THEN RAISE EXCEPTION '020 inert owner role or ownership mismatch: %',role_name; END IF;
  END LOOP;

  IF EXISTS (
    WITH expected(role_name,rel_name,privilege_type,is_grantable) AS (VALUES
      ('cocinacore_global_writer_view_owner','global_books','SELECT',false),
      ('cocinacore_global_writer_view_owner','global_books','INSERT',false),
      ('cocinacore_global_writer_view_owner','global_pdf_library','INSERT',false),
      ('cocinacore_global_writer_view_owner','book_chunks','INSERT',false)
    ), actual AS (
      SELECT granted_role.rolname::text,c.relname::text,a.privilege_type,a.is_grantable
      FROM pg_class c JOIN pg_namespace ns ON ns.oid=c.relnamespace
      CROSS JOIN LATERAL aclexplode(c.relacl) a JOIN pg_roles granted_role ON granted_role.oid=a.grantee
      WHERE ns.nspname='public' AND c.relowner<>a.grantee AND granted_role.rolname IN
        ('cocinacore_identity_probe','cocinacore_signup_bootstrap','cocinacore_metrics_view_owner','cocinacore_global_writer_view_owner')
    ), differences AS ((SELECT * FROM expected EXCEPT SELECT * FROM actual) UNION ALL (SELECT * FROM actual EXCEPT SELECT * FROM expected))
    SELECT 1 FROM differences
  ) THEN RAISE EXCEPTION '020 inert source table ACL mismatch'; END IF;
  IF EXISTS (
    WITH expected(role_name,rel_name,column_name,privilege_type,is_grantable) AS (VALUES
      ('cocinacore_identity_probe','users','id','SELECT',false),
      ('cocinacore_identity_probe','users','tenant_id','SELECT',false),
      ('cocinacore_identity_probe','tenant_memberships','tenant_id','SELECT',false),
      ('cocinacore_identity_probe','tenant_memberships','user_id','SELECT',false),
      ('cocinacore_signup_bootstrap','tenants','id','SELECT',false),
      ('cocinacore_signup_bootstrap','tenants','name','INSERT',false),
      ('cocinacore_signup_bootstrap','tenants','tenant_type','INSERT',false),
      ('cocinacore_signup_bootstrap','tenants','trial_started_at','INSERT',false),
      ('cocinacore_signup_bootstrap','tenants','trial_ends_at','INSERT',false),
      ('cocinacore_signup_bootstrap','users','id','SELECT',false),
      ('cocinacore_signup_bootstrap','users','email','INSERT',false),
      ('cocinacore_signup_bootstrap','users','password_hash','INSERT',false),
      ('cocinacore_signup_bootstrap','users','full_name','INSERT',false),
      ('cocinacore_signup_bootstrap','users','tenant_id','INSERT',false),
      ('cocinacore_signup_bootstrap','users','role','INSERT',false),
      ('cocinacore_signup_bootstrap','users','terms_accepted_at','INSERT',false),
      ('cocinacore_signup_bootstrap','users','terms_version','INSERT',false),
      ('cocinacore_signup_bootstrap','users','email_confirmed','INSERT',false),
      ('cocinacore_signup_bootstrap','tenant_memberships','tenant_id','INSERT',false),
      ('cocinacore_signup_bootstrap','tenant_memberships','user_id','INSERT',false),
      ('cocinacore_signup_bootstrap','tenant_memberships','role','INSERT',false),
      ('cocinacore_metrics_view_owner','tenants','id','SELECT',false),
      ('cocinacore_metrics_view_owner','users','id','SELECT',false),
      ('cocinacore_metrics_view_owner','global_books','id','SELECT',false),
      ('cocinacore_metrics_view_owner','global_pdf_library','id','SELECT',false),
      ('cocinacore_metrics_view_owner','premium_review_reports','id','SELECT',false),
      ('cocinacore_metrics_view_owner','platform_owners','user_id','SELECT',false),
      ('cocinacore_metrics_view_owner','book_chunks','id','SELECT',false),
      ('cocinacore_metrics_view_owner','book_chunks','global_book_id','SELECT',false),
      ('cocinacore_global_writer_view_owner','book_chunks','tenant_id','SELECT',false),
      ('cocinacore_global_writer_view_owner','book_chunks','tenant_book_id','SELECT',false),
      ('cocinacore_global_writer_view_owner','book_chunks','global_book_id','SELECT',false),
      ('cocinacore_global_writer_view_owner','book_chunks','source_type','SELECT',false)
    ), actual AS (
      SELECT granted_role.rolname::text,c.relname::text,col.attname::text,a.privilege_type,a.is_grantable
      FROM pg_attribute col JOIN pg_class c ON c.oid=col.attrelid JOIN pg_namespace ns ON ns.oid=c.relnamespace
      CROSS JOIN LATERAL aclexplode(col.attacl) a JOIN pg_roles granted_role ON granted_role.oid=a.grantee
      WHERE ns.nspname='public' AND col.attnum>0 AND NOT col.attisdropped AND granted_role.rolname IN
        ('cocinacore_identity_probe','cocinacore_signup_bootstrap','cocinacore_metrics_view_owner','cocinacore_global_writer_view_owner')
    ), differences AS ((SELECT * FROM expected EXCEPT SELECT * FROM actual) UNION ALL (SELECT * FROM actual EXCEPT SELECT * FROM expected))
    SELECT 1 FROM differences
  ) THEN RAISE EXCEPTION '020 inert source column ACL mismatch'; END IF;
  IF EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace ns ON ns.oid=c.relnamespace
      CROSS JOIN LATERAL aclexplode(c.relacl) a JOIN pg_roles granted_role ON granted_role.oid=a.grantee
    WHERE ns.nspname='public' AND c.relowner<>a.grantee AND a.grantor<>c.relowner AND granted_role.rolname IN
      ('cocinacore_identity_probe','cocinacore_signup_bootstrap','cocinacore_metrics_view_owner','cocinacore_global_writer_view_owner')
  ) OR EXISTS (
    SELECT 1 FROM pg_attribute col JOIN pg_class c ON c.oid=col.attrelid JOIN pg_namespace ns ON ns.oid=c.relnamespace
      CROSS JOIN LATERAL aclexplode(col.attacl) a JOIN pg_roles granted_role ON granted_role.oid=a.grantee
    WHERE ns.nspname='public' AND a.grantor<>c.relowner AND granted_role.rolname IN
      ('cocinacore_identity_probe','cocinacore_signup_bootstrap','cocinacore_metrics_view_owner','cocinacore_global_writer_view_owner')
  ) THEN RAISE EXCEPTION '020 inert source privilege grantor mismatch'; END IF;
  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace ns ON ns.oid=p.pronamespace
    CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
    WHERE ns.nspname='public' AND a.grantee=0 AND a.privilege_type='EXECUTE' AND NOT EXISTS (
      SELECT 1 FROM pg_depend d WHERE d.classid='pg_proc'::regclass AND d.objid=p.oid AND d.refclassid='pg_extension'::regclass AND d.deptype='e')
  ) THEN RAISE EXCEPTION '020 inert preparation refuses PUBLIC application function EXECUTE'; END IF;
END
$attest$;

DO $inert_guard$
DECLARE
  role_name text;
  role_row record;
  target oid;
BEGIN
  FOREACH role_name IN ARRAY ARRAY[
    'cocinacore_identity_probe', 'cocinacore_signup_bootstrap',
    'cocinacore_metrics_view_owner', 'cocinacore_global_writer_view_owner',
    'cocinacore_runtime_rls', 'cocinacore_auth',
    'cocinacore_owner_metrics', 'cocinacore_global_writer'
  ] LOOP
    SELECT * INTO role_row FROM pg_catalog.pg_roles WHERE rolname = role_name;
    IF NOT FOUND OR role_row.rolsuper OR role_row.rolbypassrls OR role_row.rolcreatedb
      OR role_row.rolcreaterole OR role_row.rolreplication OR role_row.rolinherit
      OR role_row.rolcanlogin IS DISTINCT FROM (role_name IN (
        'cocinacore_runtime_rls', 'cocinacore_auth', 'cocinacore_owner_metrics', 'cocinacore_global_writer'
      ))
      OR EXISTS (SELECT 1 FROM pg_catalog.pg_auth_members WHERE member = role_row.oid OR roleid = role_row.oid)
    THEN RAISE EXCEPTION 'Inert capability guard: missing or untrusted role %', role_name; END IF;
  END LOOP;

  FOREACH role_name IN ARRAY ARRAY['cocinacore_owner_metrics', 'cocinacore_global_writer'] LOOP
    IF EXISTS (
      SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'f') AND (
        pg_catalog.has_table_privilege(role_name, c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
        OR pg_catalog.has_any_column_privilege(role_name, c.oid, 'SELECT,INSERT,UPDATE,REFERENCES')
      )
    ) THEN RAISE EXCEPTION 'Inert capability guard: login % has direct table access', role_name; END IF;
  END LOOP;

  target := pg_catalog.to_regprocedure('public.signup_new_account(text,text,text,timestamptz,text)');
  IF target IS NOT NULL AND EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles r WHERE r.rolcanlogin AND NOT r.rolsuper
      AND pg_catalog.has_function_privilege(r.oid, target, 'EXECUTE')
  ) THEN
    RAISE EXCEPTION 'Inert capability guard: a login can execute signup';
  END IF;
  target := pg_catalog.to_regclass('public.runtime_identity_probe');
  IF target IS NOT NULL AND EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles r WHERE r.rolcanlogin AND NOT r.rolsuper
      AND (pg_catalog.has_table_privilege(r.oid, target, 'SELECT')
        OR pg_catalog.has_any_column_privilege(r.oid, target, 'SELECT'))
  ) THEN
    RAISE EXCEPTION 'Inert capability guard: a login can read identity probe';
  END IF;
  target := pg_catalog.to_regclass('public.owner_global_metrics');
  IF target IS NOT NULL AND EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles r WHERE r.rolcanlogin AND NOT r.rolsuper
      AND (pg_catalog.has_table_privilege(r.oid, target, 'SELECT')
        OR pg_catalog.has_any_column_privilege(r.oid, target, 'SELECT'))
  ) THEN RAISE EXCEPTION 'Inert capability guard: a login can read metrics view'; END IF;
  target := pg_catalog.to_regclass('public.owner_metrics_rls_guard');
  IF target IS NOT NULL AND EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles r WHERE r.rolcanlogin AND NOT r.rolsuper
      AND (pg_catalog.has_table_privilege(r.oid, target, 'SELECT')
        OR pg_catalog.has_any_column_privilege(r.oid, target, 'SELECT'))
  ) THEN RAISE EXCEPTION 'Inert capability guard: a login can read metrics guard'; END IF;

  FOREACH role_name IN ARRAY ARRAY['owner_write_global_books', 'owner_write_global_pdfs', 'owner_write_global_chunks'] LOOP
    target := pg_catalog.to_regclass('public.' || role_name);
    IF target IS NOT NULL AND EXISTS (
      SELECT 1 FROM pg_catalog.pg_roles r WHERE r.rolcanlogin AND NOT r.rolsuper AND (
        pg_catalog.has_table_privilege(r.oid, target, 'INSERT')
        OR pg_catalog.has_table_privilege(r.oid, target, 'UPDATE')
        OR pg_catalog.has_table_privilege(r.oid, target, 'DELETE')
        OR pg_catalog.has_table_privilege(r.oid, target, 'SELECT')
        OR pg_catalog.has_any_column_privilege(r.oid, target, 'INSERT')
        OR pg_catalog.has_any_column_privilege(r.oid, target, 'UPDATE')
        OR pg_catalog.has_any_column_privilege(r.oid, target, 'SELECT')
      )
    ) THEN RAISE EXCEPTION 'Inert capability guard: a login can access writer view %', role_name; END IF;
  END LOOP;
END
$inert_guard$;
