-- Candidate for isolated disposable PostgreSQL only. No credentials are created.
\set ON_ERROR_STOP on
BEGIN;
SELECT pg_advisory_xact_lock(hashtextextended('cocinacore:signup-bootstrap-roles',0));
DO $$
DECLARE n text; r record;
BEGIN
  -- Hashes are fixed PostgreSQL 16 pg_get_expr output from the reviewed candidates.
  IF to_regclass('public.runtime_identity_probe') IS NULL AND to_regprocedure('public.signup_new_account(text,text,text,timestamptz,text)') IS NULL THEN
    IF EXISTS (SELECT 1 FROM pg_policy WHERE polrelid IN ('public.users'::regclass,'public.tenants'::regclass,'public.tenant_memberships'::regclass))
       OR EXISTS (SELECT 1 FROM pg_class WHERE oid IN ('public.users'::regclass,'public.tenants'::regclass,'public.tenant_memberships'::regclass) AND (relrowsecurity OR relforcerowsecurity))
    THEN RAISE EXCEPTION 'Unexpected initial identity policy state'; END IF;
  ELSE
    IF (
      WITH expected_full(tbl,pol,cmd,role_name,qual_hash,check_hash) AS (VALUES
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
        SELECT c.relname::text tbl,p.polname::text pol,p.polcmd::text cmd,
          CASE WHEN cardinality(p.polroles)=1 AND p.polpermissive THEN target_role.rolname::text END role_name,
          coalesce(md5(pg_get_expr(p.polqual,p.polrelid)),'-') qual_hash,
          coalesce(md5(pg_get_expr(p.polwithcheck,p.polrelid)),'-') check_hash
        FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid
        LEFT JOIN pg_roles target_role ON target_role.oid=p.polroles[1]
        WHERE c.oid IN ('public.users'::regclass,'public.tenants'::regclass,'public.tenant_memberships'::regclass)
      ), full_diff AS (
        (SELECT * FROM expected_full EXCEPT SELECT * FROM actual)
        UNION ALL (SELECT * FROM actual EXCEPT SELECT * FROM expected_full)
      ), base_diff AS (
        (SELECT * FROM expected_base EXCEPT SELECT * FROM actual)
        UNION ALL (SELECT * FROM actual EXCEPT SELECT * FROM expected_base)
      )
      SELECT EXISTS (SELECT 1 FROM full_diff) AND EXISTS (SELECT 1 FROM base_diff)
    ) THEN RAISE EXCEPTION 'Identity policy contract must match exact baseline A or complete baseline B'; END IF;
  END IF;
  IF to_regprocedure('public.signup_new_account(text,text,text,timestamptz,text)') IS NOT NULL AND EXISTS (
    SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
    WHERE p.oid=to_regprocedure('public.signup_new_account(text,text,text,timestamptz,text)')
      AND NOT (a.privilege_type='EXECUTE' AND NOT a.is_grantable AND
        a.grantee IN (p.proowner,(SELECT oid FROM pg_roles WHERE rolname='cocinacore_auth')))
  ) THEN RAISE EXCEPTION 'Unexpected signup function ACL'; END IF;
  IF to_regclass('public.runtime_identity_probe') IS NOT NULL AND EXISTS (
    SELECT 1 FROM pg_class c CROSS JOIN LATERAL aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a
    WHERE c.oid=to_regclass('public.runtime_identity_probe') AND a.grantee<>c.relowner
      AND NOT (a.grantee=(SELECT oid FROM pg_roles WHERE rolname='cocinacore_runtime_rls') AND a.privilege_type='SELECT' AND NOT a.is_grantable)
  ) THEN RAISE EXCEPTION 'Unexpected identity probe ACL'; END IF;
  IF (to_regclass('public.runtime_identity_probe') IS NULL) <> (to_regprocedure('public.signup_new_account(text,text,text,timestamptz,text)') IS NULL)
    THEN RAISE EXCEPTION 'Partial identity candidate installation'; END IF;
  IF to_regclass('public.runtime_identity_probe') IS NOT NULL AND (
    (SELECT relowner FROM pg_class WHERE oid=to_regclass('public.runtime_identity_probe')) IS DISTINCT FROM (SELECT oid FROM pg_roles WHERE rolname='cocinacore_identity_probe')
    OR (SELECT proowner FROM pg_proc WHERE oid=to_regprocedure('public.signup_new_account(text,text,text,timestamptz,text)')) IS DISTINCT FROM (SELECT oid FROM pg_roles WHERE rolname='cocinacore_signup_bootstrap')
    OR NOT has_table_privilege('cocinacore_runtime_rls','public.runtime_identity_probe','SELECT')
    OR NOT has_function_privilege('cocinacore_auth','public.signup_new_account(text,text,text,timestamptz,text)','EXECUTE')
    OR EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid IN ('public.users'::regclass,'public.tenants'::regclass,'public.tenant_memberships'::regclass)
      AND a.attnum>0 AND NOT a.attisdropped AND has_column_privilege('cocinacore_auth',a.attrelid,a.attnum,'INSERT'))
  ) THEN RAISE EXCEPTION 'Identity object owner or required ACL mismatch'; END IF;
  IF to_regclass('public.runtime_identity_probe') IS NOT NULL AND EXISTS (
    SELECT 1 FROM pg_class c WHERE c.oid IN ('public.users'::regclass,'public.tenants'::regclass,'public.tenant_memberships'::regclass)
      AND (NOT c.relrowsecurity OR NOT c.relforcerowsecurity)
  ) THEN RAISE EXCEPTION 'Identity FORCE RLS missing'; END IF;
  IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace ns ON ns.oid=c.relnamespace
      CROSS JOIN LATERAL aclexplode(c.relacl) a WHERE ns.nspname='public'
      AND c.relname IN ('users','tenants','tenant_memberships','sessions','password_reset_tokens') AND a.grantee=0)
    OR EXISTS (SELECT 1 FROM pg_attribute col JOIN pg_class c ON c.oid=col.attrelid JOIN pg_namespace ns ON ns.oid=c.relnamespace
      CROSS JOIN LATERAL aclexplode(col.attacl) a WHERE ns.nspname='public'
      AND c.relname IN ('users','tenants','tenant_memberships','sessions','password_reset_tokens') AND a.grantee=0)
    OR EXISTS (SELECT 1 FROM pg_default_acl d CROSS JOIN LATERAL aclexplode(d.defaclacl) a
      JOIN pg_roles grantee ON grantee.oid=a.grantee WHERE grantee.rolname IN ('cocinacore_signup_bootstrap','cocinacore_identity_probe'))
  THEN RAISE EXCEPTION 'Unexpected PUBLIC or default ACL on sensitive identity surfaces'; END IF;
  FOREACH n IN ARRAY ARRAY['cocinacore_signup_bootstrap','cocinacore_identity_probe'] LOOP
    SELECT * INTO r FROM pg_roles WHERE rolname=n;
    IF FOUND THEN
      IF r.rolcanlogin OR r.rolsuper OR r.rolbypassrls OR r.rolcreatedb OR r.rolcreaterole OR r.rolinherit OR r.rolreplication
        OR shobj_description(r.oid,'pg_authid') IS DISTINCT FROM 'CocinaCore isolated signup role v1'
        OR r.rolconfig IS NOT NULL OR r.rolvaliduntil IS NOT NULL OR r.rolconnlimit <> -1
        OR EXISTS (SELECT 1 FROM pg_db_role_setting WHERE setrole=r.oid)
        OR EXISTS (SELECT 1 FROM pg_default_acl WHERE defaclrole=r.oid)
        OR EXISTS (SELECT 1 FROM pg_auth_members WHERE member=r.oid OR roleid=r.oid)
        OR EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace ns ON ns.oid=c.relnamespace
          WHERE c.relowner=r.oid AND NOT (n='cocinacore_identity_probe' AND ns.nspname='public' AND c.relname='runtime_identity_probe' AND c.relkind='v' AND c.reloptions=ARRAY['security_barrier=true'] AND pg_get_viewdef(c.oid,true)=E' SELECT u.id,\n    u.tenant_id\n   FROM users u\n     JOIN tenant_memberships m ON m.user_id = u.id AND m.tenant_id = u.tenant_id;'))
        OR EXISTS (SELECT 1 FROM pg_namespace ns WHERE ns.nspowner=r.oid)
        OR EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace ns ON ns.oid=p.pronamespace
          WHERE p.proowner=r.oid AND NOT (n='cocinacore_signup_bootstrap' AND ns.nspname='public' AND p.proname='signup_new_account' AND p.prokind='f' AND p.prosecdef AND p.proconfig=ARRAY['search_path=pg_catalog'] AND md5(p.prosrc)='5358b46b5b10a8878408f2ffa5a2f223' AND pg_get_function_identity_arguments(p.oid)='p_email text, p_password_hash text, p_full_name text, p_terms_accepted_at timestamp with time zone, p_terms_version text'))
        OR EXISTS (SELECT 1 FROM pg_class c CROSS JOIN LATERAL aclexplode(c.relacl) a WHERE a.grantee=r.oid AND c.relowner<>r.oid)
        OR EXISTS (SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(p.proacl) a WHERE a.grantee=r.oid AND p.proowner<>r.oid)
        OR EXISTS (SELECT 1 FROM pg_database d CROSS JOIN LATERAL aclexplode(d.datacl) a WHERE a.grantee=r.oid)
        OR EXISTS (SELECT 1 FROM pg_namespace ns CROSS JOIN LATERAL aclexplode(ns.nspacl) a WHERE a.grantee=r.oid AND NOT (ns.nspname='public' AND a.privilege_type='USAGE' AND NOT a.is_grantable))
        OR EXISTS (SELECT 1 FROM pg_attribute col JOIN pg_class c ON c.oid=col.attrelid JOIN pg_namespace ns ON ns.oid=c.relnamespace CROSS JOIN LATERAL aclexplode(col.attacl) a
          WHERE a.grantee=r.oid AND NOT (ns.nspname='public' AND NOT a.is_grantable AND (
            (n='cocinacore_identity_probe' AND a.privilege_type='SELECT' AND ((c.relname='users' AND col.attname IN ('id','tenant_id')) OR (c.relname='tenant_memberships' AND col.attname IN ('tenant_id','user_id')))) OR
            (n='cocinacore_signup_bootstrap' AND ((a.privilege_type='SELECT' AND col.attname='id' AND c.relname IN ('users','tenants')) OR (a.privilege_type='INSERT' AND ((c.relname='tenants' AND col.attname IN ('name','tenant_type','trial_started_at','trial_ends_at')) OR (c.relname='users' AND col.attname IN ('email','password_hash','full_name','tenant_id','role','terms_accepted_at','terms_version','email_confirmed')) OR (c.relname='tenant_memberships' AND col.attname IN ('tenant_id','user_id','role'))))))
          ))) THEN
        RAISE EXCEPTION 'Refusing incompatible role %',n;
      END IF;
    ELSE
      EXECUTE format('CREATE ROLE %I NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION', n);
      EXECUTE format('COMMENT ON ROLE %I IS %L', n, 'CocinaCore isolated signup role v1');
    END IF;
  END LOOP;
END $$;
GRANT USAGE ON SCHEMA public TO cocinacore_signup_bootstrap, cocinacore_identity_probe;
GRANT SELECT (id) ON public.tenants TO cocinacore_signup_bootstrap;
GRANT SELECT (id) ON public.users TO cocinacore_signup_bootstrap;
GRANT INSERT (name,tenant_type,trial_started_at,trial_ends_at) ON public.tenants TO cocinacore_signup_bootstrap;
GRANT INSERT (email,password_hash,full_name,tenant_id,role,terms_accepted_at,terms_version,email_confirmed) ON public.users TO cocinacore_signup_bootstrap;
GRANT INSERT (tenant_id,user_id,role) ON public.tenant_memberships TO cocinacore_signup_bootstrap;
COMMIT;
