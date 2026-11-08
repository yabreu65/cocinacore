-- Canonical CocinaCore tenant RLS hardening migration 020.
-- All app.* values are trusted backend assertions derived from a verified session.
-- This migration installs RLS structure only; seven LOGIN grants remain reserved for R4.
-- Run only through frontend/scripts/run-migrations.js in separated migration lane.

-- A1-P must have prepared and attested all seven fixed capability objects as inert.
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

-- Candidate component for a future 020. Apply only in a disposable database.
-- RLS authenticates neither session GUC: trusted backend must set both.
-- The policy's user/membership lookups rely on their current grants and require
-- compatible SELECT policies when users and memberships receive FORCE RLS.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cocinacore_runtime_rls' AND rolcanlogin AND NOT rolsuper AND NOT rolbypassrls AND NOT rolcreaterole AND NOT rolcreatedb) THEN
    RAISE EXCEPTION 'Expected restricted runtime role';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_auth_members m JOIN pg_roles r ON r.oid = m.member OR r.oid = m.roleid WHERE r.rolname = 'cocinacore_runtime_rls') THEN
    RAISE EXCEPTION 'Runtime role must not have memberships';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policy WHERE polrelid IN ('public.recipe_inventory_items'::regclass, 'public.inventory_movements'::regclass)) THEN
    RAISE EXCEPTION 'Existing policies require explicit composition review';
  END IF;
  IF has_table_privilege('cocinacore_runtime_rls', 'public.recipe_inventory_items', 'UPDATE')
    OR has_column_privilege('cocinacore_runtime_rls', 'public.recipe_inventory_items', 'tenant_id', 'UPDATE')
    OR has_column_privilege('cocinacore_runtime_rls', 'public.recipe_inventory_items', 'user_id', 'UPDATE')
    OR has_table_privilege('cocinacore_runtime_rls', 'public.inventory_movements', 'UPDATE')
    OR has_table_privilege('cocinacore_runtime_rls', 'public.inventory_movements', 'DELETE') THEN
    RAISE EXCEPTION 'Unexpected runtime inventory grants';
  END IF;
END $$;

ALTER TABLE public.recipe_inventory_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recipe_inventory_items FORCE ROW LEVEL SECURITY;
CREATE POLICY inventory_runtime_select ON public.recipe_inventory_items FOR SELECT TO cocinacore_runtime_rls
 USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid AND EXISTS (
   SELECT 1 FROM public.users u JOIN public.tenant_memberships m ON m.user_id=u.id AND m.tenant_id=u.tenant_id
   WHERE u.id=NULLIF(current_setting('app.user_id', true), '')::uuid AND u.tenant_id=recipe_inventory_items.tenant_id));
CREATE POLICY inventory_runtime_insert ON public.recipe_inventory_items FOR INSERT TO cocinacore_runtime_rls
 WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid AND user_id = NULLIF(current_setting('app.user_id', true), '')::uuid AND EXISTS (
   SELECT 1 FROM public.users u JOIN public.tenant_memberships m ON m.user_id=u.id AND m.tenant_id=u.tenant_id
   WHERE u.id=recipe_inventory_items.user_id AND u.tenant_id=recipe_inventory_items.tenant_id));
CREATE POLICY inventory_runtime_update ON public.recipe_inventory_items FOR UPDATE TO cocinacore_runtime_rls
 USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid AND EXISTS (
   SELECT 1 FROM public.users u JOIN public.tenant_memberships m ON m.user_id=u.id AND m.tenant_id=u.tenant_id
   WHERE u.id=NULLIF(current_setting('app.user_id', true), '')::uuid AND u.tenant_id=recipe_inventory_items.tenant_id))
 WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid AND EXISTS (
   SELECT 1 FROM public.users u JOIN public.tenant_memberships m ON m.user_id=u.id AND m.tenant_id=u.tenant_id
   WHERE u.id=NULLIF(current_setting('app.user_id', true), '')::uuid AND u.tenant_id=recipe_inventory_items.tenant_id));
CREATE POLICY inventory_runtime_delete ON public.recipe_inventory_items FOR DELETE TO cocinacore_runtime_rls
 USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid AND EXISTS (
   SELECT 1 FROM public.users u JOIN public.tenant_memberships m ON m.user_id=u.id AND m.tenant_id=u.tenant_id
   WHERE u.id=NULLIF(current_setting('app.user_id', true), '')::uuid AND u.tenant_id=recipe_inventory_items.tenant_id));

ALTER TABLE public.inventory_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_movements FORCE ROW LEVEL SECURITY;
CREATE POLICY movement_runtime_select ON public.inventory_movements FOR SELECT TO cocinacore_runtime_rls
 USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid AND EXISTS (
   SELECT 1 FROM public.users u JOIN public.tenant_memberships m ON m.user_id=u.id AND m.tenant_id=u.tenant_id
   WHERE u.id=NULLIF(current_setting('app.user_id', true), '')::uuid AND u.tenant_id=inventory_movements.tenant_id));
CREATE POLICY movement_runtime_insert ON public.inventory_movements FOR INSERT TO cocinacore_runtime_rls
 WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid AND user_id = NULLIF(current_setting('app.user_id', true), '')::uuid AND EXISTS (
   SELECT 1 FROM public.users u JOIN public.tenant_memberships m ON m.user_id=u.id AND m.tenant_id=u.tenant_id
   WHERE u.id=inventory_movements.user_id AND u.tenant_id=inventory_movements.tenant_id) AND EXISTS (
   SELECT 1 FROM public.recipe_inventory_items i WHERE i.id=inventory_movements.inventory_item_id AND i.tenant_id=inventory_movements.tenant_id));

-- 020C: tenant identity and owner-only user identity policies.
-- 020C: FORCE RLS for identity tables without recreating the A1-P identity view.
DO $identity_preflight$
DECLARE probe_oid oid;
BEGIN
  SELECT oid INTO probe_oid FROM pg_roles WHERE rolname='cocinacore_identity_probe'
    AND NOT rolcanlogin AND NOT rolsuper AND NOT rolbypassrls
    AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolreplication AND NOT rolinherit;
  IF probe_oid IS NULL OR EXISTS (
    SELECT 1 FROM pg_auth_members WHERE member=probe_oid OR roleid=probe_oid
  ) THEN RAISE EXCEPTION '020C requires the isolated identity-probe owner role'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_class c
     WHERE c.oid='public.runtime_identity_probe'::regclass AND c.relkind='v'
       AND c.relowner=probe_oid AND c.reloptions=ARRAY['security_barrier=true']::text[]
       AND md5(pg_get_viewdef(c.oid,true))='8488958e031f004f834e064a4d2f8019'
  ) THEN RAISE EXCEPTION '020C requires the exact inert A1-P identity view'; END IF;
  IF EXISTS (
    SELECT 1 FROM pg_policy WHERE polrelid IN (
      'public.users'::regclass,'public.tenants'::regclass,'public.tenant_memberships'::regclass
    )
  ) OR EXISTS (
    SELECT 1 FROM pg_class WHERE oid IN (
      'public.users'::regclass,'public.tenants'::regclass,'public.tenant_memberships'::regclass
    ) AND (relrowsecurity OR relforcerowsecurity)
  ) THEN RAISE EXCEPTION '020C refuses preexisting identity policies or RLS state'; END IF;
  IF has_table_privilege('cocinacore_runtime_rls','public.runtime_identity_probe','SELECT')
     OR has_table_privilege('cocinacore_auth','public.runtime_identity_probe','SELECT')
     OR has_table_privilege('cocinacore_owner_metrics','public.runtime_identity_probe','SELECT')
     OR has_table_privilege('cocinacore_global_writer','public.runtime_identity_probe','SELECT')
  THEN RAISE EXCEPTION '020C requires R4 identity-probe grants to remain inactive'; END IF;
END
$identity_preflight$;
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.users FORCE ROW LEVEL SECURITY;
ALTER TABLE public.tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenants FORCE ROW LEVEL SECURITY;
ALTER TABLE public.tenant_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenant_memberships FORCE ROW LEVEL SECURITY;
CREATE POLICY identity_probe_users ON public.users FOR SELECT TO cocinacore_identity_probe
 USING (id = NULLIF(current_setting('app.user_id',true),'')::uuid AND tenant_id = NULLIF(current_setting('app.tenant_id',true),'')::uuid);
CREATE POLICY identity_probe_memberships ON public.tenant_memberships FOR SELECT TO cocinacore_identity_probe
 USING (user_id = NULLIF(current_setting('app.user_id',true),'')::uuid AND tenant_id = NULLIF(current_setting('app.tenant_id',true),'')::uuid);
CREATE POLICY identity_users_read ON public.users FOR SELECT TO cocinacore_runtime_rls
 USING (tenant_id = NULLIF(current_setting('app.tenant_id',true),'')::uuid AND EXISTS (SELECT 1 FROM public.runtime_identity_probe p));
CREATE POLICY identity_users_update ON public.users FOR UPDATE TO cocinacore_runtime_rls
 USING (id = NULLIF(current_setting('app.user_id',true),'')::uuid AND tenant_id = NULLIF(current_setting('app.tenant_id',true),'')::uuid AND EXISTS (SELECT 1 FROM public.runtime_identity_probe p))
 WITH CHECK (id = NULLIF(current_setting('app.user_id',true),'')::uuid AND tenant_id = NULLIF(current_setting('app.tenant_id',true),'')::uuid AND EXISTS (SELECT 1 FROM public.runtime_identity_probe p));
CREATE POLICY identity_tenants_read ON public.tenants FOR SELECT TO cocinacore_runtime_rls
 USING (id = NULLIF(current_setting('app.tenant_id',true),'')::uuid AND EXISTS (SELECT 1 FROM public.runtime_identity_probe p));
CREATE POLICY identity_memberships_read ON public.tenant_memberships FOR SELECT TO cocinacore_runtime_rls
 USING (tenant_id = NULLIF(current_setting('app.tenant_id',true),'')::uuid AND user_id = NULLIF(current_setting('app.user_id',true),'')::uuid AND EXISTS (SELECT 1 FROM public.runtime_identity_probe p));
-- Auth needs pre-tenant lookups and password updates. These policies trust the
-- auth backend and its SQL credential; row-wide access is not user authentication.
CREATE POLICY identity_auth_users_read ON public.users FOR SELECT TO cocinacore_auth USING (true);
CREATE POLICY identity_auth_users_insert ON public.users FOR INSERT TO cocinacore_auth WITH CHECK (true);
CREATE POLICY identity_auth_users_update ON public.users FOR UPDATE TO cocinacore_auth USING (true) WITH CHECK (true);
CREATE POLICY identity_auth_tenants_read ON public.tenants FOR SELECT TO cocinacore_auth USING (true);
CREATE POLICY identity_auth_tenants_insert ON public.tenants FOR INSERT TO cocinacore_auth WITH CHECK (true);
-- This is only a partial constraint: auth can still add an owner membership for
-- any existing user in their active tenant. A narrower bootstrap capability is required.
CREATE POLICY identity_auth_membership_insert ON public.tenant_memberships FOR INSERT TO cocinacore_auth
 WITH CHECK (role='owner' AND EXISTS (SELECT 1 FROM public.users u WHERE u.id=tenant_memberships.user_id AND u.tenant_id=tenant_memberships.tenant_id));

-- 020C1: protected signup policies and removal of legacy direct auth INSERTs.

-- The exact A1-P runtime identity view was provisioned before migration 020.
DO $prepared_identity_preflight$
BEGIN
  IF to_regclass('public.runtime_identity_probe') IS NULL
     OR pg_get_userbyid((SELECT relowner FROM pg_class WHERE oid='public.runtime_identity_probe'::regclass)) <> 'cocinacore_identity_probe'
     OR md5(pg_get_viewdef('public.runtime_identity_probe'::regclass,true)) <> '8488958e031f004f834e064a4d2f8019'
     OR has_table_privilege('cocinacore_runtime_rls','public.runtime_identity_probe','SELECT')
     OR has_function_privilege('cocinacore_auth','public.signup_new_account(text,text,text,timestamptz,text)','EXECUTE')
  THEN RAISE EXCEPTION '020C1 requires inert A1-P objects; signup/probe grants belong exclusively to R4'; END IF;
END
$prepared_identity_preflight$;
-- 020C1: install signup policies over the function already prepared inertly by A1-P.
-- The function definition/owner/ACL are attested above; auth EXECUTE remains reserved for R4.
CREATE POLICY signup_bootstrap_tenants_read ON public.tenants FOR SELECT TO cocinacore_signup_bootstrap USING (true);
CREATE POLICY signup_bootstrap_tenants_insert ON public.tenants FOR INSERT TO cocinacore_signup_bootstrap WITH CHECK (true);
CREATE POLICY signup_bootstrap_users_read ON public.users FOR SELECT TO cocinacore_signup_bootstrap USING (true);
CREATE POLICY signup_bootstrap_users_insert ON public.users FOR INSERT TO cocinacore_signup_bootstrap WITH CHECK (role='owner');
CREATE POLICY signup_bootstrap_memberships_insert ON public.tenant_memberships FOR INSERT TO cocinacore_signup_bootstrap WITH CHECK (role='owner');
REVOKE INSERT (name,tenant_type,trial_started_at,trial_ends_at) ON public.tenants FROM cocinacore_auth;
REVOKE INSERT (email,password_hash,full_name,tenant_id,role,terms_accepted_at,terms_version,email_confirmed) ON public.users FROM cocinacore_auth;
REVOKE INSERT (tenant_id,user_id,role) ON public.tenant_memberships FROM cocinacore_auth;

-- 020D1: meal plans, AI history and shopping lists.
-- Candidate component for a future 020. Apply only in the reviewed runner transaction.
-- RLS is not authentication: app.* values must come from a verified server session.
DO $preflight$
DECLARE
  runtime_oid oid;
  identity_probe_oid oid;
  protected_relations oid[];
BEGIN
  IF current_user = 'cocinacore_runtime_rls' THEN
    RAISE EXCEPTION 'Apply 020D1 with the controlled migration identity';
  END IF;

  IF to_regclass('public.user_meal_plans') IS NULL
     OR to_regclass('public.recipe_ai_history') IS NULL
     OR to_regclass('public.shopping_list_items') IS NULL
     OR to_regclass('public.users') IS NULL
     OR to_regclass('public.tenants') IS NULL
     OR to_regclass('public.tenant_memberships') IS NULL
     OR to_regclass('public.runtime_identity_probe') IS NULL THEN
    RAISE EXCEPTION '020D1 requires the protected tables and 020C identity probe';
  END IF;
  protected_relations := ARRAY[
    'public.user_meal_plans'::regclass::oid,
    'public.recipe_ai_history'::regclass::oid,
    'public.shopping_list_items'::regclass::oid
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
  IF runtime_oid IS NULL THEN
    RAISE EXCEPTION '020D1 requires the restricted runtime identity';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_auth_members
     WHERE member = runtime_oid OR roleid = runtime_oid
  ) THEN
    RAISE EXCEPTION 'Runtime identity must have no role memberships';
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
     OR NOT EXISTS (
       SELECT 1 FROM pg_class c
        WHERE c.oid = 'public.runtime_identity_probe'::regclass
          AND c.relkind = 'v'
          AND c.relowner = identity_probe_oid
          AND 'security_barrier=true' = ANY(COALESCE(c.reloptions, ARRAY[]::text[]))
          AND pg_get_viewdef(c.oid, true) = E' SELECT u.id,\n    u.tenant_id\n   FROM users u\n     JOIN tenant_memberships m ON m.user_id = u.id AND m.tenant_id = u.tenant_id;'
     ) THEN
    RAISE EXCEPTION '020D1 requires the restricted 020C identity probe contract';
  END IF;
  IF has_table_privilege(runtime_oid, 'public.runtime_identity_probe', 'SELECT')
     OR has_table_privilege(runtime_oid, 'public.runtime_identity_probe', 'INSERT')
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
         )
     ) THEN
    RAISE EXCEPTION '020D1 requires the inert owner-only identity probe ACL';
  END IF;

  IF (
    SELECT count(*) FROM pg_class
     WHERE oid IN ('public.users'::regclass, 'public.tenants'::regclass, 'public.tenant_memberships'::regclass)
       AND relrowsecurity AND relforcerowsecurity
  ) <> 3 THEN
    RAISE EXCEPTION '020D1 requires FORCE RLS on the 020C identity tables';
  END IF;
  -- Fixed PostgreSQL 16 fingerprints from the reviewed 020C and 020C1
  -- candidates. Do not infer the expected policy contract from catalog state.
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
    ), actual AS (
      SELECT c.relname::text, p.polname::text, p.polcmd::text,
        CASE WHEN cardinality(p.polroles) = 1 AND p.polpermissive THEN target_role.rolname::text END,
        COALESCE(md5(pg_get_expr(p.polqual, p.polrelid)), '-'),
        COALESCE(md5(pg_get_expr(p.polwithcheck, p.polrelid)), '-')
      FROM pg_policy p
      JOIN pg_class c ON c.oid = p.polrelid
      LEFT JOIN pg_roles target_role ON target_role.oid = p.polroles[1]
       WHERE c.oid IN ('public.users'::regclass, 'public.tenants'::regclass, 'public.tenant_memberships'::regclass)
    ), full_diff AS (
      (SELECT * FROM expected_full EXCEPT SELECT * FROM actual)
      UNION ALL (SELECT * FROM actual EXCEPT SELECT * FROM expected_full)
    ), base_diff AS (
      (SELECT * FROM expected_base EXCEPT SELECT * FROM actual)
      UNION ALL (SELECT * FROM actual EXCEPT SELECT * FROM expected_base)
    )
    SELECT EXISTS (SELECT 1 FROM full_diff) AND EXISTS (SELECT 1 FROM base_diff)
  ) THEN
    RAISE EXCEPTION '020D1 requires exact identity baseline A (17) or complete baseline B (19)';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_policy WHERE polrelid = ANY(protected_relations)
  ) OR EXISTS (
    SELECT 1 FROM pg_class
     WHERE oid = ANY(protected_relations)
       AND (relrowsecurity OR relforcerowsecurity)
  ) THEN
    RAISE EXCEPTION '020D1 refuses existing policies or partial RLS on its target tables';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_class
     WHERE oid = ANY(protected_relations)
       AND relowner = runtime_oid
  ) THEN
    RAISE EXCEPTION 'Runtime identity must not own 020D1 tables';
  END IF;

  -- Effective table rights must match the reviewed runtime operation matrix.
  IF NOT (
       has_table_privilege(runtime_oid, 'public.user_meal_plans', 'SELECT')
   AND has_table_privilege(runtime_oid, 'public.user_meal_plans', 'INSERT')
   AND has_table_privilege(runtime_oid, 'public.user_meal_plans', 'UPDATE')
   AND NOT has_table_privilege(runtime_oid, 'public.user_meal_plans', 'DELETE')
   AND has_table_privilege(runtime_oid, 'public.recipe_ai_history', 'SELECT')
   AND has_table_privilege(runtime_oid, 'public.recipe_ai_history', 'INSERT')
   AND has_table_privilege(runtime_oid, 'public.recipe_ai_history', 'UPDATE')
   AND has_table_privilege(runtime_oid, 'public.recipe_ai_history', 'DELETE')
   AND has_table_privilege(runtime_oid, 'public.shopping_list_items', 'SELECT')
   AND has_table_privilege(runtime_oid, 'public.shopping_list_items', 'INSERT')
   AND has_table_privilege(runtime_oid, 'public.shopping_list_items', 'UPDATE')
   AND has_table_privilege(runtime_oid, 'public.shopping_list_items', 'DELETE')
  ) OR EXISTS (
    SELECT 1 FROM unnest(protected_relations) AS target(oid)
     WHERE has_table_privilege(runtime_oid, target.oid, 'TRUNCATE')
        OR has_table_privilege(runtime_oid, target.oid, 'REFERENCES')
        OR has_table_privilege(runtime_oid, target.oid, 'TRIGGER')
  ) THEN
    RAISE EXCEPTION 'Runtime table grants do not match the reviewed 020D1 operation matrix';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM pg_class c
      CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl, acldefault('r', c.relowner))) acl
     WHERE c.oid = ANY(protected_relations)
       AND (acl.grantee = 0 OR (acl.grantee = runtime_oid AND acl.is_grantable))
  ) OR EXISTS (
    SELECT 1
      FROM pg_attribute a
      CROSS JOIN LATERAL aclexplode(a.attacl) acl
     WHERE a.attrelid = ANY(protected_relations)
       AND a.attnum > 0
       AND NOT a.attisdropped
       AND acl.grantee IN (0, runtime_oid)
  ) THEN
    RAISE EXCEPTION '020D1 refuses PUBLIC, grant-option, or column-level target-table ACLs';
  END IF;
END
$preflight$;

ALTER TABLE public.user_meal_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_meal_plans FORCE ROW LEVEL SECURITY;
CREATE POLICY meal_plan_owner_select ON public.user_meal_plans
  FOR SELECT TO cocinacore_runtime_rls
  USING (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
    AND EXISTS (SELECT 1 FROM public.runtime_identity_probe)
  );
CREATE POLICY meal_plan_owner_insert ON public.user_meal_plans
  FOR INSERT TO cocinacore_runtime_rls
  WITH CHECK (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
    AND EXISTS (SELECT 1 FROM public.runtime_identity_probe)
  );
CREATE POLICY meal_plan_owner_update ON public.user_meal_plans
  FOR UPDATE TO cocinacore_runtime_rls
  USING (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
    AND EXISTS (SELECT 1 FROM public.runtime_identity_probe)
  )
  WITH CHECK (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
    AND EXISTS (SELECT 1 FROM public.runtime_identity_probe)
  );

ALTER TABLE public.recipe_ai_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recipe_ai_history FORCE ROW LEVEL SECURITY;
CREATE POLICY recipe_history_tenant_select ON public.recipe_ai_history
  FOR SELECT TO cocinacore_runtime_rls
  USING (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND EXISTS (SELECT 1 FROM public.runtime_identity_probe)
  );
CREATE POLICY recipe_history_owner_insert ON public.recipe_ai_history
  FOR INSERT TO cocinacore_runtime_rls
  WITH CHECK (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
    AND EXISTS (SELECT 1 FROM public.runtime_identity_probe)
  );
CREATE POLICY recipe_history_owner_update ON public.recipe_ai_history
  FOR UPDATE TO cocinacore_runtime_rls
  USING (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
    AND EXISTS (SELECT 1 FROM public.runtime_identity_probe)
  )
  WITH CHECK (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
    AND EXISTS (SELECT 1 FROM public.runtime_identity_probe)
  );
CREATE POLICY recipe_history_owner_delete ON public.recipe_ai_history
  FOR DELETE TO cocinacore_runtime_rls
  USING (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
    AND EXISTS (SELECT 1 FROM public.runtime_identity_probe)
  );

ALTER TABLE public.shopping_list_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shopping_list_items FORCE ROW LEVEL SECURITY;
CREATE POLICY shopping_list_owner_select ON public.shopping_list_items
  FOR SELECT TO cocinacore_runtime_rls
  USING (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
    AND EXISTS (SELECT 1 FROM public.runtime_identity_probe)
  );
CREATE POLICY shopping_list_owner_insert ON public.shopping_list_items
  FOR INSERT TO cocinacore_runtime_rls
  WITH CHECK (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
    AND EXISTS (SELECT 1 FROM public.runtime_identity_probe)
  );
CREATE POLICY shopping_list_owner_update ON public.shopping_list_items
  FOR UPDATE TO cocinacore_runtime_rls
  USING (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
    AND EXISTS (SELECT 1 FROM public.runtime_identity_probe)
  )
  WITH CHECK (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
    AND EXISTS (SELECT 1 FROM public.runtime_identity_probe)
  );
CREATE POLICY shopping_list_owner_delete ON public.shopping_list_items
  FOR DELETE TO cocinacore_runtime_rls
  USING (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
    AND EXISTS (SELECT 1 FROM public.runtime_identity_probe)
  );

-- 020D2: user culinary profiles and profile terms.
-- Candidate component for a future 020. Apply only in the reviewed runner transaction.
-- RLS is not authentication: app.* values must come from a verified server session.
DO $preflight$
DECLARE
  runtime_oid oid;
  identity_probe_oid oid;
  target_relations oid[];
  expected_owner oid;
BEGIN
  IF current_user IN ('cocinacore_runtime_rls', 'cocinacore_auth') THEN
    RAISE EXCEPTION 'Apply 020D2 with the controlled migration identity';
  END IF;

  IF to_regclass('public.user_culinary_profiles') IS NULL
     OR to_regclass('public.user_culinary_profile_terms') IS NULL
     OR to_regclass('public.users') IS NULL
     OR to_regclass('public.tenants') IS NULL
     OR to_regclass('public.tenant_memberships') IS NULL
     OR to_regclass('public.runtime_identity_probe') IS NULL THEN
    RAISE EXCEPTION '020D2 requires both profile tables and the 020C identity probe';
  END IF;
  target_relations := ARRAY[
    'public.user_culinary_profiles'::regclass::oid,
    'public.user_culinary_profile_terms'::regclass::oid
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
    RAISE EXCEPTION '020D2 requires the isolated runtime identity without memberships';
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
  IF identity_probe_oid IS NULL THEN
    RAISE EXCEPTION '020D2 requires the restricted identity-probe role';
  END IF;
  IF EXISTS (
       SELECT 1 FROM pg_auth_members
        WHERE member = identity_probe_oid OR roleid = identity_probe_oid
     ) THEN
    RAISE EXCEPTION '020D2 identity-probe role must have no memberships';
  END IF;
  IF has_table_privilege(runtime_oid, 'public.runtime_identity_probe', 'SELECT') THEN
    RAISE EXCEPTION '020D2 requires the R4 identity-probe grant to remain inactive';
  END IF;
  IF NOT EXISTS (
       SELECT 1 FROM pg_class c
        WHERE c.oid = 'public.runtime_identity_probe'::regclass
          AND c.relkind = 'v'
          AND c.relowner = identity_probe_oid
          AND 'security_barrier=true' = ANY(COALESCE(c.reloptions, ARRAY[]::text[]))
          AND pg_get_viewdef(c.oid, true) = E' SELECT u.id,\n    u.tenant_id\n   FROM users u\n     JOIN tenant_memberships m ON m.user_id = u.id AND m.tenant_id = u.tenant_id;'
     ) THEN
    RAISE EXCEPTION '020D2 requires the reviewed 020C identity probe owner, options and definition';
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
         )
     ) THEN
    RAISE EXCEPTION '020D2 requires the inert owner-only identity-probe ACL';
  END IF;

  IF (
    SELECT count(*) FROM pg_class
     WHERE oid IN ('public.users'::regclass, 'public.tenants'::regclass, 'public.tenant_memberships'::regclass)
       AND relrowsecurity AND relforcerowsecurity
  ) <> 3 THEN
    RAISE EXCEPTION '020D2 requires FORCE RLS on all 020C identity tables';
  END IF;
  -- Fixed PostgreSQL 16 fingerprints from the reviewed 020C and 020C1 candidates.
  -- Do not infer correctness from catalog state; deparser changes require review.
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
    ), actual AS (
      SELECT c.relname::text, p.polname::text, p.polcmd::text,
        CASE WHEN cardinality(p.polroles) = 1 AND p.polpermissive THEN target_role.rolname::text END,
        COALESCE(md5(pg_get_expr(p.polqual, p.polrelid)), '-'),
        COALESCE(md5(pg_get_expr(p.polwithcheck, p.polrelid)), '-')
      FROM pg_policy p
      JOIN pg_class c ON c.oid = p.polrelid
      LEFT JOIN pg_roles target_role ON target_role.oid = p.polroles[1]
       WHERE c.oid IN ('public.users'::regclass, 'public.tenants'::regclass, 'public.tenant_memberships'::regclass)
    ), full_diff AS (
      (SELECT * FROM expected_full EXCEPT SELECT * FROM actual)
      UNION ALL (SELECT * FROM actual EXCEPT SELECT * FROM expected_full)
    ), base_diff AS (
      (SELECT * FROM expected_base EXCEPT SELECT * FROM actual)
      UNION ALL (SELECT * FROM actual EXCEPT SELECT * FROM expected_base)
    )
    SELECT EXISTS (SELECT 1 FROM full_diff) AND EXISTS (SELECT 1 FROM base_diff)
  ) THEN
    RAISE EXCEPTION '020D2 requires exact identity baseline A (17) or complete baseline B (19)';
  END IF;

  SELECT relowner INTO expected_owner FROM pg_class WHERE oid = 'public.users'::regclass;
  IF expected_owner = runtime_oid
     OR EXISTS (
       SELECT 1 FROM pg_class
        WHERE oid = ANY(target_relations)
          AND (relowner = runtime_oid OR relowner <> expected_owner)
     ) THEN
    RAISE EXCEPTION '020D2 target table owners must match the protected identity-table owner';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_policy WHERE polrelid = ANY(target_relations)
  ) OR EXISTS (
    SELECT 1 FROM pg_class
     WHERE oid = ANY(target_relations)
       AND (relrowsecurity OR relforcerowsecurity)
  ) THEN
    RAISE EXCEPTION '020D2 refuses pre-existing policies or partial RLS on profile tables';
  END IF;

  -- The runtime may update business fields, but never the profile identity columns.
  IF NOT (
       has_table_privilege(runtime_oid, 'public.user_culinary_profiles', 'SELECT')
   AND has_table_privilege(runtime_oid, 'public.user_culinary_profiles', 'INSERT')
   AND NOT has_table_privilege(runtime_oid, 'public.user_culinary_profiles', 'UPDATE')
   AND NOT has_table_privilege(runtime_oid, 'public.user_culinary_profiles', 'DELETE')
   AND has_table_privilege(runtime_oid, 'public.user_culinary_profile_terms', 'SELECT')
   AND has_table_privilege(runtime_oid, 'public.user_culinary_profile_terms', 'INSERT')
   AND NOT has_table_privilege(runtime_oid, 'public.user_culinary_profile_terms', 'UPDATE')
   AND has_table_privilege(runtime_oid, 'public.user_culinary_profile_terms', 'DELETE')
  ) OR EXISTS (
    SELECT 1 FROM pg_attribute a
     WHERE a.attrelid = 'public.user_culinary_profiles'::regclass
       AND a.attnum > 0 AND NOT a.attisdropped
       AND has_column_privilege(runtime_oid, a.attrelid, a.attnum, 'UPDATE')
       AND a.attname NOT IN ('level', 'available_time_minutes', 'disliked_ingredients', 'allergies', 'household_members', 'updated_at')
  ) OR EXISTS (
    SELECT 1 FROM pg_attribute a
     WHERE a.attrelid = 'public.user_culinary_profiles'::regclass
       AND a.attnum > 0 AND NOT a.attisdropped
       AND NOT has_column_privilege(runtime_oid, a.attrelid, a.attnum, 'UPDATE')
       AND a.attname IN ('level', 'available_time_minutes', 'disliked_ingredients', 'allergies', 'household_members', 'updated_at')
  ) OR EXISTS (
    SELECT 1 FROM pg_attribute a
     WHERE a.attrelid = 'public.user_culinary_profile_terms'::regclass
       AND a.attnum > 0 AND NOT a.attisdropped
       AND has_column_privilege(runtime_oid, a.attrelid, a.attnum, 'UPDATE')
  ) THEN
    RAISE EXCEPTION 'Runtime profile grants do not match the reviewed operation and column matrix';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM pg_class c
      CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl, acldefault('r', c.relowner))) acl
     WHERE c.oid = ANY(target_relations)
       AND (acl.grantee = 0 OR (acl.grantee = runtime_oid AND acl.is_grantable)
         OR (acl.grantee = runtime_oid AND NOT (
           (c.relname = 'user_culinary_profiles' AND acl.privilege_type IN ('SELECT', 'INSERT'))
           OR (c.relname = 'user_culinary_profile_terms' AND acl.privilege_type IN ('SELECT', 'INSERT', 'DELETE'))
         )))
  ) OR EXISTS (
    SELECT 1
      FROM pg_attribute a
      CROSS JOIN LATERAL aclexplode(a.attacl) acl
     WHERE a.attrelid = ANY(target_relations)
       AND a.attnum > 0 AND NOT a.attisdropped
       AND (acl.grantee = 0 OR (acl.grantee = runtime_oid AND
         (acl.privilege_type <> 'UPDATE' OR acl.is_grantable
          OR a.attrelid <> 'public.user_culinary_profiles'::regclass
          OR a.attname NOT IN ('level', 'available_time_minutes', 'disliked_ingredients', 'allergies', 'household_members', 'updated_at'))))
  ) THEN
    RAISE EXCEPTION '020D2 refuses PUBLIC, grant-option, or unexpected runtime profile ACLs';
  END IF;
END
$preflight$;

ALTER TABLE public.user_culinary_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_culinary_profiles FORCE ROW LEVEL SECURITY;
CREATE POLICY culinary_profile_owner_select ON public.user_culinary_profiles
  FOR SELECT TO cocinacore_runtime_rls
  USING (
    user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
    AND tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND EXISTS (SELECT 1 FROM public.runtime_identity_probe)
  );
CREATE POLICY culinary_profile_owner_insert ON public.user_culinary_profiles
  FOR INSERT TO cocinacore_runtime_rls
  WITH CHECK (
    user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
    AND tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND EXISTS (SELECT 1 FROM public.runtime_identity_probe)
  );
CREATE POLICY culinary_profile_owner_update ON public.user_culinary_profiles
  FOR UPDATE TO cocinacore_runtime_rls
  USING (
    user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
    AND tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND EXISTS (SELECT 1 FROM public.runtime_identity_probe)
  )
  WITH CHECK (
    user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
    AND tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND EXISTS (SELECT 1 FROM public.runtime_identity_probe)
  );

ALTER TABLE public.user_culinary_profile_terms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_culinary_profile_terms FORCE ROW LEVEL SECURITY;
CREATE POLICY culinary_profile_terms_owner_select ON public.user_culinary_profile_terms
  FOR SELECT TO cocinacore_runtime_rls
  USING (
    user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
    AND EXISTS (
      SELECT 1 FROM public.user_culinary_profiles AS profiles
       WHERE profiles.user_id = user_culinary_profile_terms.user_id
         AND profiles.user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
         AND profiles.tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    )
    AND EXISTS (SELECT 1 FROM public.runtime_identity_probe)
  );
CREATE POLICY culinary_profile_terms_owner_insert ON public.user_culinary_profile_terms
  FOR INSERT TO cocinacore_runtime_rls
  WITH CHECK (
    user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
    AND EXISTS (
      SELECT 1 FROM public.user_culinary_profiles AS profiles
       WHERE profiles.user_id = user_culinary_profile_terms.user_id
         AND profiles.user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
         AND profiles.tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    )
    AND EXISTS (SELECT 1 FROM public.runtime_identity_probe)
  );
CREATE POLICY culinary_profile_terms_owner_delete ON public.user_culinary_profile_terms
  FOR DELETE TO cocinacore_runtime_rls
  USING (
    user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
    AND EXISTS (
      SELECT 1 FROM public.user_culinary_profiles AS profiles
       WHERE profiles.user_id = user_culinary_profile_terms.user_id
         AND profiles.user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
         AND profiles.tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    )
    AND EXISTS (SELECT 1 FROM public.runtime_identity_probe)
  );

-- 020D3: tenant documents and RAG chunks.
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
  IF has_table_privilege(runtime_oid, 'public.runtime_identity_probe', 'SELECT')
     OR has_table_privilege(runtime_oid, 'public.runtime_identity_probe', 'INSERT')
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
           )
     ) THEN
    RAISE EXCEPTION '020D3 requires the inert owner-only identity-probe ACL';
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

-- 020D4-A: owner metric source-table RLS policies; prepared metric views remain untouched.
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
     OR has_table_privilege(metrics_login_oid, 'public.owner_global_metrics', 'SELECT')
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
      AND c.relkind='v' AND c.relowner=metrics_owner_oid
      AND md5(pg_get_viewdef(c.oid,true))='59035b254a488a1015d641a81cc928ff'
  ) AND EXISTS (
    SELECT 1 FROM pg_class c WHERE c.oid='public.owner_metrics_rls_guard'::regclass
      AND c.relkind='v' AND c.relowner=metrics_owner_oid
      AND md5(pg_get_viewdef(c.oid,true))='8da147bc319c202a2ee4c8401c3d93ae'
  ) INTO baseline_view;
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

-- The seven A1-P objects already have independent NOLOGIN owners and owner-only ACLs.
-- Their definitions and grants are attested before 020; this stage installs policies only.
DO $d4a_postflight$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_class c WHERE c.oid='public.owner_metrics_rls_guard'::regclass
      AND c.relkind='v' AND pg_get_userbyid(c.relowner)='cocinacore_metrics_view_owner'
      AND md5(pg_get_viewdef(c.oid,true))='8da147bc319c202a2ee4c8401c3d93ae'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_class c WHERE c.oid='public.owner_global_metrics'::regclass
      AND c.relkind='v' AND pg_get_userbyid(c.relowner)='cocinacore_metrics_view_owner'
      AND md5(pg_get_viewdef(c.oid,true))='59035b254a488a1015d641a81cc928ff'
  ) OR has_table_privilege('cocinacore_owner_metrics','public.owner_global_metrics','SELECT')
    OR has_table_privilege('cocinacore_runtime_rls','public.runtime_identity_probe','SELECT')
    OR has_function_privilege('cocinacore_auth','public.signup_new_account(text,text,text,timestamptz,text)','EXECUTE')
  THEN RAISE EXCEPTION '020D4-A altered prepared objects or activated an R4-reserved LOGIN grant'; END IF;
END
$d4a_postflight$;

-- 020D4-B: global writer policies; prepared writer views remain untouched.
-- Candidate only; compose after the complete 020D4-A owner-metrics state.
-- The dedicated LOGIN can write only through its three fixed views; this candidate adds
-- FORCE RLS policies exclusively for the NOLOGIN view owner.
DO $preflight$
DECLARE
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

  -- The prepared guard intentionally reports unavailable until R4 activates its LOGIN grant.

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
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_class c WHERE c.oid='public.owner_metrics_rls_guard'::regclass
      AND c.relkind='v' AND pg_get_userbyid(c.relowner)='cocinacore_metrics_view_owner'
      AND md5(pg_get_viewdef(c.oid,true))='8da147bc319c202a2ee4c8401c3d93ae'
  ) OR has_table_privilege('cocinacore_global_writer','public.owner_write_global_books','INSERT')
    OR has_table_privilege('cocinacore_owner_metrics','public.owner_global_metrics','SELECT')
    OR has_table_privilege('cocinacore_runtime_rls','public.runtime_identity_probe','SELECT')
  THEN RAISE EXCEPTION '020D4-B altered the prepared guard or activated an R4-reserved LOGIN grant'; END IF;
END
$postflight$;


-- 020D5: tenant-scoped, summary-only invitation reads; invitation writes remain out of scope.
-- Candidate only: tenant-scoped, read-only access to invitation summaries.
-- Compose in the reviewed 020 transaction; never apply to a persistent database from this file.
DO $$
DECLARE
  invitation_table oid := to_regclass('public.tenant_invitations');
  runtime_oid oid := (SELECT oid FROM pg_roles WHERE rolname='cocinacore_runtime_rls');
  owner_oid oid;
  initial_state boolean;
  installed_state boolean;
BEGIN
  IF invitation_table IS NULL OR runtime_oid IS NULL THEN
    RAISE EXCEPTION '020D5 requires the invitation table and runtime role';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_roles r
    WHERE r.oid=runtime_oid AND r.rolcanlogin AND NOT r.rolsuper AND NOT r.rolbypassrls
      AND NOT r.rolcreatedb AND NOT r.rolcreaterole AND NOT r.rolinherit AND NOT r.rolreplication
  ) OR EXISTS (
    SELECT 1 FROM pg_auth_members m WHERE m.member=runtime_oid OR m.roleid=runtime_oid
  ) THEN
    RAISE EXCEPTION '020D5 requires a restricted, non-inheriting runtime role without memberships';
  END IF;
  SELECT relowner INTO owner_oid FROM pg_class WHERE oid=invitation_table;
  IF owner_oid IN (
    SELECT oid FROM pg_roles WHERE rolname IN (
      'cocinacore_runtime_rls','cocinacore_auth','cocinacore_owner_metrics',
      'cocinacore_metrics_view_owner','cocinacore_global_writer',
      'cocinacore_global_writer_view_owner','cocinacore_signup_bootstrap','cocinacore_identity_probe'
    )
  ) THEN
    RAISE EXCEPTION '020D5 requires a trusted schema owner for tenant_invitations';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_class c CROSS JOIN LATERAL aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a
    WHERE c.oid=invitation_table AND a.grantee=0
  ) OR EXISTS (
    SELECT 1 FROM pg_attribute column_acl CROSS JOIN LATERAL aclexplode(column_acl.attacl) a
    WHERE column_acl.attrelid=invitation_table AND a.grantee=0
  ) THEN
    RAISE EXCEPTION '020D5 refuses PUBLIC invitation privileges';
  END IF;

  IF has_table_privilege(runtime_oid,invitation_table,'SELECT')
    OR has_table_privilege(runtime_oid,invitation_table,'INSERT')
    OR has_table_privilege(runtime_oid,invitation_table,'UPDATE')
    OR has_table_privilege(runtime_oid,invitation_table,'DELETE')
    OR has_table_privilege('cocinacore_auth',invitation_table,'SELECT')
    OR has_table_privilege('cocinacore_owner_metrics',invitation_table,'SELECT')
    OR has_table_privilege('cocinacore_global_writer',invitation_table,'SELECT')
    OR has_column_privilege(runtime_oid,invitation_table,'invitation_token','SELECT')
    OR has_column_privilege(runtime_oid,invitation_table,'invited_by','SELECT')
    OR has_column_privilege(runtime_oid,invitation_table,'accepted_by','SELECT')
    OR has_column_privilege(runtime_oid,invitation_table,'accepted_at','SELECT')
    OR has_column_privilege(runtime_oid,invitation_table,'role','SELECT')
    OR NOT has_column_privilege(runtime_oid,invitation_table,'id','SELECT')
    OR NOT has_column_privilege(runtime_oid,invitation_table,'tenant_id','SELECT')
    OR NOT has_column_privilege(runtime_oid,invitation_table,'email','SELECT')
    OR NOT has_column_privilege(runtime_oid,invitation_table,'status','SELECT')
    OR NOT has_column_privilege(runtime_oid,invitation_table,'expires_at','SELECT')
    OR NOT has_column_privilege(runtime_oid,invitation_table,'created_at','SELECT') THEN
    RAISE EXCEPTION '020D5 runtime invitation access exceeds the reviewed summary projection';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_attribute a
    WHERE a.attrelid=invitation_table AND a.attnum>0 AND NOT a.attisdropped
      AND has_column_privilege(runtime_oid,invitation_table,a.attname,'SELECT')
      AND a.attname NOT IN ('id','tenant_id','email','status','expires_at','created_at')
  ) OR EXISTS (
    SELECT 1
    FROM pg_roles r
    WHERE r.rolcanlogin AND NOT r.rolsuper
      AND r.oid<>runtime_oid
      AND has_table_privilege(r.oid,invitation_table,'SELECT')
  ) OR EXISTS (
    SELECT 1
    FROM pg_roles r CROSS JOIN pg_attribute a
    WHERE r.rolcanlogin AND NOT r.rolsuper
      AND r.oid<>runtime_oid
      AND a.attrelid=invitation_table AND a.attnum>0 AND NOT a.attisdropped
      AND has_column_privilege(r.oid,invitation_table,a.attname,'SELECT')
  ) THEN
    RAISE EXCEPTION '020D5 found unexpected invitation readers outside runtime summary access';
  END IF;

  initial_state := NOT EXISTS (SELECT 1 FROM pg_policy WHERE polrelid=invitation_table)
    AND NOT (SELECT relrowsecurity OR relforcerowsecurity FROM pg_class WHERE oid=invitation_table);

  installed_state :=
    (SELECT relrowsecurity AND relforcerowsecurity FROM pg_class WHERE oid=invitation_table)
    AND (SELECT count(*)=1 FROM pg_policy WHERE polrelid=invitation_table)
    AND EXISTS (
      SELECT 1 FROM pg_policy p
      WHERE p.polrelid=invitation_table
        AND p.polname='tenant_invitations_runtime_select'
        AND p.polcmd='r'
        AND p.polpermissive
        AND p.polroles=ARRAY[runtime_oid]::oid[]
        AND coalesce(md5(pg_get_expr(p.polqual,p.polrelid)),'-')='049b61188bb1ee07a817bc83960a81f7'
        AND p.polwithcheck IS NULL
    );

  IF initial_state THEN
    EXECUTE 'ALTER TABLE public.tenant_invitations ENABLE ROW LEVEL SECURITY';
    EXECUTE 'ALTER TABLE public.tenant_invitations FORCE ROW LEVEL SECURITY';
    EXECUTE $policy$
      CREATE POLICY tenant_invitations_runtime_select ON public.tenant_invitations
      FOR SELECT TO cocinacore_runtime_rls
      USING (
        tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
        AND EXISTS (SELECT 1 FROM public.runtime_identity_probe)
      )
    $policy$;
  ELSIF NOT installed_state THEN
    RAISE EXCEPTION '020D5 refuses partial or altered tenant_invitations RLS state';
  END IF;
END
$$;

-- The runner executes activated-capabilities-attestation.sql before recording the ledger.
-- It requires all 71 reviewed policies, 27 FORCE RLS tables, and reports ACTIVATION PENDING
-- until the independent R4 administrative operation grants its exact seven LOGIN privileges.
