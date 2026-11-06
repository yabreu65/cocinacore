-- Candidate administrative preparation. Run ONLY with psql -X -1 -v ON_ERROR_STOP=1.
-- The enclosing single transaction is mandatory; never run against a persistent database
-- without a separately approved operational procedure. Existing credentials are not changed.
\set ON_ERROR_STOP on
\set ECHO none
SELECT pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('cocinacore:database-change:v1:' || pg_catalog.current_database(), 0));
DO $preflight$
DECLARE n integer; r record; role_name text;
BEGIN
  IF pg_catalog.current_setting('server_version_num')::integer / 10000 <> 16 THEN
    RAISE EXCEPTION '020 inert preparation requires PostgreSQL 16';
  END IF;
  IF to_regclass('public.schema_migrations') IS NULL THEN
    RAISE EXCEPTION '020 inert preparation requires verified boundary 019';
  END IF;
  IF EXISTS (
    WITH expected(filename,checksum) AS (VALUES
        ('001_extensions_and_core.sql','22f56f15610d16a5c7412775496df5a0908680f22eb76152e2482aadff154803'),
        ('002_books_and_rag.sql','5485d2feb5b351cde7212153ea426b3b5b01145f33348e2cca50784425102382'),
        ('003_recipes_and_inventory.sql','7f94e83006bf4687c786f3fb220d695ffaf91ee66e567cfcdc0894aaf6334052'),
        ('004_meal_plans.sql','898eb26cb1d8d1d903324808ffbad1c713ffe5de28b6c368b43469853aec840f'),
        ('005_premium_and_shopping.sql','812f93d1c5460539143d8d9c014260cc67d2859d28baf4c68a0566f12a291d11'),
        ('006_culinary_profiles.sql','b8df80adc040c68d56b17ab059f27f15fb81cc66d286165114621a49171f6b25'),
        ('007_functions.sql','b1ae050e48c4563503f0a1cb468857461dce8d06068787d9de00d8022c9191a8'),
        ('008_indexes.sql','85a29801fab66ce9ab3a03c9e776e39d1094b18182daee19ce94e39437f8a1f0'),
        ('009_seed_culinary_base.sql','b69cea987c70e7507980073b98d67b2bf59a6e185cf33a6f06f5112d58fd1d19'),
        ('010_password_reset_tokens.sql','825a350895af1fabc8680bd3c400031007c9214f660d575f78804fa357e09053'),
        ('011_canonical_email_invariant.sql','5117deadee2d72b8e8b5a7bc27559223c2fe4a3a71238787451c075a9bb6c9e0'),
        ('012_meal_plan_consumption.sql','163cac4f23aa6376d65c38c9e0132482d689a4a1faec74ce5858b665241160b9'),
        ('013_culinary_profile_context.sql','0c6d6e8dc67d2e0b0ebb8128562db1ec8b81a44f82c5e0601c38ba5fb608dfe5'),
        ('014_culinary_profile_field_constraints.sql','c7989e3250c4a066e266d4f0eed7271200c1ee8e09026266ea7c450956163df4'),
        ('015_shopping_inventory_transfer.sql','17f47c1faefb63d7bfeba95b3e503a2d5375a716a045b480779a603891026370'),
        ('016_persistent_user_recipes.sql','a5f28c75ceaa793213809d05dcbb11c888f553eeb4dc9d7eb988ec9e567890fd'),
        ('017_persistent_recipe_archive.sql','525e84bde0c63d1f2afc65a0bab7c55bec8d07fafa48732b7eb8ac7019012a87'),
        ('018_cooking_sessions.sql','b5e25bb76feed66fec8d767968aead734912d97e9cd6c98206edc99400c2cd7d'),
        ('019_real_consumption_reconciliation.sql','509ec1b9ad8bd4f480d3a78ddb6e167647b0d54231bb68e9eb947882b560d587')
    ), actual AS (SELECT filename,checksum FROM public.schema_migrations), differences AS (
      (SELECT * FROM expected EXCEPT SELECT * FROM actual)
      UNION ALL (SELECT * FROM actual EXCEPT SELECT * FROM expected)
    ) SELECT 1 FROM differences
  ) OR (SELECT count(*) FROM public.schema_migrations) <> 19 OR
    EXISTS (SELECT 1 FROM public.schema_migrations GROUP BY applied_at HAVING count(*) <> 1) OR
    (SELECT array_agg(filename ORDER BY applied_at) IS DISTINCT FROM array_agg(filename ORDER BY filename) FROM public.schema_migrations) THEN
    RAISE EXCEPTION '020 inert preparation requires exact boundary 019 checksums';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_policy WHERE polrelid IN (
       'public.users'::regclass,'public.tenants'::regclass,'public.tenant_memberships'::regclass,
       'public.recipe_inventory_items'::regclass,'public.inventory_movements'::regclass,
       'public.user_meal_plans'::regclass,'public.recipe_ai_history'::regclass,'public.shopping_list_items'::regclass,
       'public.user_culinary_profiles'::regclass,'public.user_culinary_profile_terms'::regclass,
       'public.tenant_books'::regclass,'public.tenant_pdf_library'::regclass,'public.book_chunks'::regclass,
       'public.global_books'::regclass,'public.global_pdf_library'::regclass,'public.premium_review_reports'::regclass,
       'public.platform_owners'::regclass,'public.tenant_invitations'::regclass)) OR
     EXISTS (SELECT 1 FROM pg_catalog.pg_class WHERE oid IN (
       'public.users'::regclass,'public.tenants'::regclass,'public.tenant_memberships'::regclass,
       'public.recipe_inventory_items'::regclass,'public.inventory_movements'::regclass,
       'public.user_meal_plans'::regclass,'public.recipe_ai_history'::regclass,'public.shopping_list_items'::regclass,
       'public.user_culinary_profiles'::regclass,'public.user_culinary_profile_terms'::regclass,
       'public.tenant_books'::regclass,'public.tenant_pdf_library'::regclass,'public.book_chunks'::regclass,
       'public.global_books'::regclass,'public.global_pdf_library'::regclass,'public.premium_review_reports'::regclass,
       'public.platform_owners'::regclass,'public.tenant_invitations'::regclass) AND (relrowsecurity OR relforcerowsecurity)) THEN
    RAISE EXCEPTION '020 inert preparation requires pre-020 RLS state';
  END IF;
  FOREACH role_name IN ARRAY ARRAY['cocinacore_runtime_rls','cocinacore_auth'] LOOP
    SELECT * INTO r FROM pg_catalog.pg_roles WHERE rolname=role_name;
    IF NOT FOUND OR NOT r.rolcanlogin OR r.rolsuper OR r.rolbypassrls OR r.rolcreatedb OR r.rolcreaterole OR r.rolreplication OR r.rolinherit OR
      EXISTS (SELECT 1 FROM pg_catalog.pg_auth_members WHERE member=r.oid OR roleid=r.oid) THEN
      RAISE EXCEPTION '020 inert preparation requires restricted login %', role_name;
    END IF;
  END LOOP;
  IF EXISTS (
    SELECT 1 FROM (VALUES
      ('tenants','name'),('tenants','tenant_type'),('tenants','trial_started_at'),('tenants','trial_ends_at'),
      ('users','email'),('users','password_hash'),('users','full_name'),('users','tenant_id'),('users','role'),('users','terms_accepted_at'),('users','terms_version'),('users','email_confirmed'),
      ('tenant_memberships','tenant_id'),('tenant_memberships','user_id'),('tenant_memberships','role')
    ) AS required(table_name,column_name)
    WHERE NOT has_column_privilege('cocinacore_auth',format('public.%I',required.table_name),required.column_name,'INSERT')
  ) THEN
    RAISE EXCEPTION '020 inert preparation requires legacy signup grants';
  END IF;
  FOREACH role_name IN ARRAY ARRAY['cocinacore_owner_metrics','cocinacore_global_writer','cocinacore_identity_probe','cocinacore_signup_bootstrap','cocinacore_metrics_view_owner','cocinacore_global_writer_view_owner'] LOOP
    SELECT * INTO r FROM pg_catalog.pg_roles WHERE rolname=role_name;
    IF FOUND AND (r.rolcanlogin IS DISTINCT FROM (role_name IN ('cocinacore_owner_metrics','cocinacore_global_writer')) OR r.rolsuper OR r.rolbypassrls OR r.rolcreatedb OR r.rolcreaterole OR r.rolreplication OR r.rolinherit OR r.rolconnlimit <> -1 OR r.rolvaliduntil IS NOT NULL OR
       shobj_description(r.oid,'pg_authid') IS DISTINCT FROM CASE WHEN role_name IN ('cocinacore_identity_probe','cocinacore_signup_bootstrap') THEN 'CocinaCore isolated signup role v1' WHEN role_name IN ('cocinacore_metrics_view_owner','cocinacore_owner_metrics') THEN 'CocinaCore isolated metrics role v1' ELSE 'CocinaCore isolated global writer v1' END OR
       (role_name IN ('cocinacore_owner_metrics','cocinacore_global_writer') AND NOT COALESCE(cardinality(r.rolconfig)=2 AND r.rolconfig @> ARRAY['search_path=pg_catalog, public','row_security=on'],false)) OR
       (role_name IN ('cocinacore_owner_metrics','cocinacore_global_writer') AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_authid authid WHERE authid.oid=r.oid AND authid.rolpassword IS NOT NULL)) OR
       (role_name IN ('cocinacore_owner_metrics','cocinacore_global_writer') AND (NOT has_database_privilege(r.oid,current_database(),'CONNECT') OR NOT has_schema_privilege(r.oid,'public','USAGE'))) OR
       (role_name NOT IN ('cocinacore_owner_metrics','cocinacore_global_writer') AND r.rolconfig IS NOT NULL) OR
       EXISTS (SELECT 1 FROM pg_catalog.pg_db_role_setting WHERE setrole=r.oid AND setdatabase<>0) OR
       (role_name IN ('cocinacore_owner_metrics','cocinacore_global_writer') AND EXISTS (SELECT 1 FROM pg_catalog.pg_shdepend WHERE refclassid='pg_authid'::regclass AND refobjid=r.oid AND deptype='o')) OR
       (role_name IN ('cocinacore_owner_metrics','cocinacore_global_writer') AND EXISTS (SELECT 1 FROM pg_catalog.pg_default_acl d CROSS JOIN LATERAL pg_catalog.aclexplode(d.defaclacl) a WHERE d.defaclrole=r.oid OR a.grantee=r.oid)) OR
       (role_name IN ('cocinacore_owner_metrics','cocinacore_global_writer') AND EXISTS (
         SELECT 1 FROM pg_catalog.pg_shdepend s WHERE s.refclassid='pg_authid'::regclass AND s.refobjid=r.oid AND s.deptype='a' AND NOT (
           (s.classid='pg_database'::regclass AND s.objid=(SELECT oid FROM pg_database WHERE datname=current_database())) OR
           (s.dbid=(SELECT oid FROM pg_database WHERE datname=current_database()) AND s.classid='pg_namespace'::regclass AND s.objid='public'::regnamespace)))) OR
       (role_name IN ('cocinacore_owner_metrics','cocinacore_global_writer') AND (
         has_database_privilege(r.oid,current_database(),'CREATE,TEMP') OR has_schema_privilege(r.oid,'public','CREATE') OR
         EXISTS (SELECT 1 FROM pg_catalog.pg_database d CROSS JOIN LATERAL pg_catalog.aclexplode(d.datacl) a WHERE a.grantee=r.oid AND (d.datname<>current_database() OR a.privilege_type<>'CONNECT' OR a.is_grantable)) OR
         EXISTS (SELECT 1 FROM pg_catalog.pg_namespace ns CROSS JOIN LATERAL pg_catalog.aclexplode(ns.nspacl) a WHERE a.grantee=r.oid AND (ns.nspname<>'public' OR a.privilege_type<>'USAGE' OR a.is_grantable)))) OR
       EXISTS (SELECT 1 FROM pg_catalog.pg_auth_members WHERE member=r.oid OR roleid=r.oid)) THEN
      RAISE EXCEPTION '020 inert preparation refuses untrusted role %', role_name;
    END IF;
  END LOOP;
  SELECT (SELECT count(*) FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace ns ON ns.oid=c.relnamespace WHERE ns.nspname='public' AND c.relname IN ('runtime_identity_probe','owner_write_global_books','owner_write_global_pdfs','owner_write_global_chunks','owner_metrics_rls_guard','owner_global_metrics')) +
         (SELECT count(*) FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace ns ON ns.oid=p.pronamespace WHERE ns.nspname='public' AND p.proname='signup_new_account') INTO n;
  IF n NOT IN (0,7) THEN RAISE EXCEPTION '020 inert preparation refuses partial object state'; END IF;
  IF n=0 THEN
    FOREACH role_name IN ARRAY ARRAY['cocinacore_identity_probe','cocinacore_signup_bootstrap','cocinacore_metrics_view_owner','cocinacore_global_writer_view_owner'] LOOP
      SELECT * INTO r FROM pg_catalog.pg_roles WHERE rolname=role_name;
      IF FOUND AND (
        r.rolconfig IS NOT NULL OR
        shobj_description(r.oid,'pg_authid') IS DISTINCT FROM CASE WHEN role_name IN ('cocinacore_identity_probe','cocinacore_signup_bootstrap') THEN 'CocinaCore isolated signup role v1' WHEN role_name='cocinacore_metrics_view_owner' THEN 'CocinaCore isolated metrics role v1' ELSE 'CocinaCore isolated global writer v1' END OR
        EXISTS (SELECT 1 FROM pg_catalog.pg_default_acl WHERE defaclrole=r.oid) OR
        EXISTS (SELECT 1 FROM pg_catalog.pg_default_acl d CROSS JOIN LATERAL pg_catalog.aclexplode(d.defaclacl) a WHERE a.grantee=r.oid) OR
        EXISTS (SELECT 1 FROM pg_catalog.pg_shdepend s WHERE s.refclassid='pg_authid'::regclass AND s.refobjid=r.oid AND (s.deptype='o' OR (s.deptype='a' AND NOT (
          s.dbid=(SELECT oid FROM pg_catalog.pg_database WHERE datname=current_database()) AND (
            (s.classid='pg_class'::regclass AND s.objid IN ('public.users'::regclass,'public.tenants'::regclass,'public.tenant_memberships'::regclass,'public.global_books'::regclass,'public.global_pdf_library'::regclass,'public.book_chunks'::regclass,'public.premium_review_reports'::regclass,'public.platform_owners'::regclass)) OR
            (s.classid='pg_namespace'::regclass AND s.objid='public'::regnamespace)))))) OR
        EXISTS (SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace ns ON ns.oid=c.relnamespace CROSS JOIN LATERAL pg_catalog.aclexplode(c.relacl) a WHERE a.grantee=r.oid AND NOT (
          role_name='cocinacore_global_writer_view_owner' AND ns.nspname='public' AND NOT a.is_grantable AND
          ((c.relname='global_books' AND a.privilege_type IN ('SELECT','INSERT')) OR (c.relname IN ('global_pdf_library','book_chunks') AND a.privilege_type='INSERT')))) OR
        EXISTS (SELECT 1 FROM pg_catalog.pg_attribute col JOIN pg_catalog.pg_class c ON c.oid=col.attrelid JOIN pg_catalog.pg_namespace ns ON ns.oid=c.relnamespace CROSS JOIN LATERAL pg_catalog.aclexplode(col.attacl) a WHERE a.grantee=r.oid AND NOT (
          ns.nspname='public' AND NOT a.is_grantable AND (
            (role_name='cocinacore_identity_probe' AND a.privilege_type='SELECT' AND ((c.relname='users' AND col.attname IN ('id','tenant_id')) OR (c.relname='tenant_memberships' AND col.attname IN ('tenant_id','user_id')))) OR
            (role_name='cocinacore_signup_bootstrap' AND ((a.privilege_type='SELECT' AND col.attname='id' AND c.relname IN ('users','tenants')) OR (a.privilege_type='INSERT' AND ((c.relname='tenants' AND col.attname IN ('name','tenant_type','trial_started_at','trial_ends_at')) OR (c.relname='users' AND col.attname IN ('email','password_hash','full_name','tenant_id','role','terms_accepted_at','terms_version','email_confirmed')) OR (c.relname='tenant_memberships' AND col.attname IN ('tenant_id','user_id','role')))))) OR
            (role_name='cocinacore_metrics_view_owner' AND a.privilege_type='SELECT' AND ((c.relname IN ('tenants','users','global_books','global_pdf_library','premium_review_reports') AND col.attname='id') OR (c.relname='platform_owners' AND col.attname='user_id') OR (c.relname='book_chunks' AND col.attname IN ('id','global_book_id')))) OR
            (role_name='cocinacore_global_writer_view_owner' AND a.privilege_type='SELECT' AND c.relname='book_chunks' AND col.attname IN ('tenant_id','tenant_book_id','global_book_id','source_type'))))) OR
        EXISTS (SELECT 1 FROM pg_catalog.pg_namespace ns CROSS JOIN LATERAL pg_catalog.aclexplode(ns.nspacl) a WHERE a.grantee=r.oid AND (ns.nspname<>'public' OR a.privilege_type<>'USAGE' OR a.is_grantable)) OR
        EXISTS (SELECT 1 FROM pg_catalog.pg_proc p CROSS JOIN LATERAL pg_catalog.aclexplode(p.proacl) a WHERE a.grantee=r.oid)
      ) THEN RAISE EXCEPTION '020 inert preparation refuses incompatible existing owner role %',role_name; END IF;
    END LOOP;
  END IF;
  IF n=0 AND EXISTS (
    SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace ns ON ns.oid=c.relnamespace
     WHERE ns.nspname='public' AND c.relkind IN ('r','p','f') AND EXISTS (
       SELECT 1 FROM pg_catalog.pg_roles lr WHERE lr.rolname IN ('cocinacore_owner_metrics','cocinacore_global_writer') AND (
         has_table_privilege(lr.oid,c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') OR
         has_any_column_privilege(lr.oid,c.oid,'SELECT,INSERT,UPDATE,REFERENCES')))) THEN
    RAISE EXCEPTION '020 inert preparation refuses existing LOGIN table privileges';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace ns ON ns.oid=c.relnamespace CROSS JOIN LATERAL pg_catalog.aclexplode(c.relacl) a WHERE ns.nspname='public' AND a.grantee=0) OR
     EXISTS (SELECT 1 FROM pg_catalog.pg_attribute a JOIN pg_catalog.pg_class c ON c.oid=a.attrelid JOIN pg_catalog.pg_namespace ns ON ns.oid=c.relnamespace CROSS JOIN LATERAL pg_catalog.aclexplode(a.attacl) acl WHERE ns.nspname='public' AND acl.grantee=0) THEN
    RAISE EXCEPTION '020 inert preparation refuses PUBLIC relation privileges';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace ns ON ns.oid=p.pronamespace
    CROSS JOIN LATERAL pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) a
    WHERE ns.nspname='public' AND a.grantee=0 AND a.privilege_type='EXECUTE' AND NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_depend d WHERE d.classid='pg_proc'::regclass AND d.objid=p.oid AND d.refclassid='pg_extension'::regclass AND d.deptype='e')
  ) THEN RAISE EXCEPTION '020 inert preparation refuses PUBLIC application function EXECUTE'; END IF;
END
$preflight$;
SELECT to_regclass('public.runtime_identity_probe') IS NULL AS initial_state \gset
\if :initial_state
SELECT NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='cocinacore_owner_metrics') AS create_metrics, NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='cocinacore_global_writer') AS create_writer \gset
\if :create_metrics
\if :{?metrics_password}
\else
  DO $$ BEGIN RAISE EXCEPTION 'metrics_password is required when preparing the initial state'; END $$;
\endif
SELECT length(:'metrics_password') > 0 AS valid_password \gset
\if :valid_password
\else
  DO $$ BEGIN RAISE EXCEPTION 'metrics_password must not be empty'; END $$;
\endif
SELECT format('CREATE ROLE cocinacore_owner_metrics LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION PASSWORD %L', :'metrics_password') \gexec
\unset metrics_password
COMMENT ON ROLE cocinacore_owner_metrics IS 'CocinaCore isolated metrics role v1';
ALTER ROLE cocinacore_owner_metrics SET search_path = pg_catalog, public;
ALTER ROLE cocinacore_owner_metrics SET row_security = on;
SELECT format('GRANT CONNECT ON DATABASE %I TO cocinacore_owner_metrics',current_database()) \gexec
GRANT USAGE ON SCHEMA public TO cocinacore_owner_metrics;
\endif
\if :create_writer
\if :{?global_writer_password}
\else
  DO $$ BEGIN RAISE EXCEPTION 'global_writer_password is required when preparing the initial state'; END $$;
\endif
SELECT length(:'global_writer_password') > 0 AS valid_password \gset
\if :valid_password
\else
  DO $$ BEGIN RAISE EXCEPTION 'global_writer_password must not be empty'; END $$;
\endif
SELECT format('CREATE ROLE cocinacore_global_writer LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION PASSWORD %L', :'global_writer_password') \gexec
\unset global_writer_password
COMMENT ON ROLE cocinacore_global_writer IS 'CocinaCore isolated global writer v1';
ALTER ROLE cocinacore_global_writer SET search_path = pg_catalog, public;
ALTER ROLE cocinacore_global_writer SET row_security = on;
SELECT format('GRANT CONNECT ON DATABASE %I TO cocinacore_global_writer',current_database()) \gexec
GRANT USAGE ON SCHEMA public TO cocinacore_global_writer;
\endif
SELECT 'CREATE ROLE cocinacore_identity_probe NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION' WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='cocinacore_identity_probe') \gexec
SELECT 'CREATE ROLE cocinacore_signup_bootstrap NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION' WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='cocinacore_signup_bootstrap') \gexec
SELECT 'CREATE ROLE cocinacore_metrics_view_owner NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION' WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='cocinacore_metrics_view_owner') \gexec
SELECT 'CREATE ROLE cocinacore_global_writer_view_owner NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION' WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='cocinacore_global_writer_view_owner') \gexec
COMMENT ON ROLE cocinacore_identity_probe IS 'CocinaCore isolated signup role v1';
COMMENT ON ROLE cocinacore_signup_bootstrap IS 'CocinaCore isolated signup role v1';
COMMENT ON ROLE cocinacore_metrics_view_owner IS 'CocinaCore isolated metrics role v1';
COMMENT ON ROLE cocinacore_global_writer_view_owner IS 'CocinaCore isolated global writer v1';
GRANT USAGE ON SCHEMA public TO cocinacore_identity_probe,cocinacore_signup_bootstrap,cocinacore_metrics_view_owner,cocinacore_global_writer_view_owner;
GRANT SELECT (id,tenant_id) ON public.users TO cocinacore_identity_probe;
GRANT SELECT (tenant_id,user_id) ON public.tenant_memberships TO cocinacore_identity_probe;
GRANT SELECT (id) ON public.tenants,public.users TO cocinacore_signup_bootstrap;
GRANT INSERT (name,tenant_type,trial_started_at,trial_ends_at) ON public.tenants TO cocinacore_signup_bootstrap;
GRANT INSERT (email,password_hash,full_name,tenant_id,role,terms_accepted_at,terms_version,email_confirmed) ON public.users TO cocinacore_signup_bootstrap;
GRANT INSERT (tenant_id,user_id,role) ON public.tenant_memberships TO cocinacore_signup_bootstrap;
GRANT SELECT (id) ON public.tenants,public.users,public.global_books,public.global_pdf_library,public.premium_review_reports TO cocinacore_metrics_view_owner;
GRANT SELECT (user_id) ON public.platform_owners TO cocinacore_metrics_view_owner;
GRANT SELECT (id,global_book_id) ON public.book_chunks TO cocinacore_metrics_view_owner;
GRANT SELECT,INSERT ON public.global_books TO cocinacore_global_writer_view_owner;
GRANT INSERT ON public.global_pdf_library,public.book_chunks TO cocinacore_global_writer_view_owner;
GRANT SELECT (tenant_id,tenant_book_id,global_book_id,source_type) ON public.book_chunks TO cocinacore_global_writer_view_owner;
CREATE VIEW public.runtime_identity_probe WITH (security_barrier=true) AS
 SELECT u.id,u.tenant_id FROM public.users u JOIN public.tenant_memberships m ON m.user_id=u.id AND m.tenant_id=u.tenant_id;
ALTER VIEW public.runtime_identity_probe OWNER TO cocinacore_identity_probe;
REVOKE ALL ON public.runtime_identity_probe FROM PUBLIC;
CREATE FUNCTION public.signup_new_account(p_email text,p_password_hash text,p_full_name text,p_terms_accepted_at timestamptz,p_terms_version text)
RETURNS TABLE(user_id uuid,tenant_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE new_tenant uuid; new_user uuid;
BEGIN
  INSERT INTO public.tenants(name,tenant_type,trial_started_at,trial_ends_at)
  VALUES ('Tenant of ' || pg_catalog.lower(pg_catalog.btrim(p_email)),'home',now(),now() + interval '14 days') RETURNING id INTO new_tenant;
  INSERT INTO public.users(email,password_hash,full_name,tenant_id,role,terms_accepted_at,terms_version,email_confirmed)
  VALUES (pg_catalog.lower(pg_catalog.btrim(p_email)),p_password_hash,p_full_name,new_tenant,'owner',p_terms_accepted_at,p_terms_version,true) RETURNING id INTO new_user;
  INSERT INTO public.tenant_memberships(tenant_id,user_id,role) VALUES (new_tenant,new_user,'owner');
  RETURN QUERY SELECT new_user,new_tenant;
END $$;
ALTER FUNCTION public.signup_new_account(text,text,text,timestamptz,text) OWNER TO cocinacore_signup_bootstrap;
REVOKE ALL ON FUNCTION public.signup_new_account(text,text,text,timestamptz,text) FROM PUBLIC;
create or replace view public.owner_write_global_books as select id, title, author, description, cuisine_region, cuisine_country, cuisine_style, tags from public.global_books;
create or replace view public.owner_write_global_pdfs as select global_book_id, storage_path, file_size_bytes, page_count, checksum_sha256, uploaded_by from public.global_pdf_library;
create or replace view public.owner_write_global_chunks as select tenant_id, tenant_book_id, global_book_id, source_type, content, metadata, embedding from public.book_chunks
 where source_type = 'global_pdf' and tenant_id is null and tenant_book_id is null and global_book_id is not null
 with cascaded check option;
ALTER VIEW public.owner_write_global_books OWNER TO cocinacore_global_writer_view_owner;
ALTER VIEW public.owner_write_global_pdfs OWNER TO cocinacore_global_writer_view_owner;
ALTER VIEW public.owner_write_global_chunks OWNER TO cocinacore_global_writer_view_owner;
REVOKE ALL ON public.owner_write_global_books,public.owner_write_global_pdfs,public.owner_write_global_chunks FROM PUBLIC;
-- The fixed guard resolves this relation at parse time. The placeholder has no
-- LOGIN grants and is replaced within the same transaction before attestation.
CREATE VIEW public.owner_global_metrics AS SELECT NULL::bigint tenants, NULL::bigint users,
  NULL::bigint books, NULL::bigint pdfs, NULL::bigint chunks, NULL::bigint reports, NULL::bigint owners;
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
REVOKE ALL ON public.owner_metrics_rls_guard FROM PUBLIC;
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
REVOKE ALL ON public.owner_global_metrics FROM PUBLIC;
\endif
-- Fixed PostgreSQL 16 catalog contracts, copied from the reviewed 020C/020C1/D4 candidates.
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
-- Negative pre-activation guard only. This does NOT prepare objects, validate their
-- definitions/ACLs completely, authorize activation, or replace the migration gate.
-- Execute in the same transaction as a separately reviewed preparation preflight.
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
