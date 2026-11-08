-- Candidate for explicitly authorized isolated databases only. Never run on a shared service database.
-- Password is supplied via psql variable; do not enable query echo or shell tracing.
\set ON_ERROR_STOP on
\set ECHO none
\if :{?auth_password}
\else
  \echo 'auth_password is required'
  \quit 1
\endif
select length(:'auth_password') > 0 as auth_password_present \gset
\if :auth_password_present
\else
  \echo 'auth_password must not be empty'
  \quit 1
\endif
begin;
select pg_advisory_xact_lock(hashtextextended('cocinacore:provision-auth-role', 0));
do $$
declare
  existing record;
  auth_oid oid;
  auth_role_exists boolean;
  legacy_identity boolean;
  secure_identity boolean := false;
  identity_policy_contract boolean := false;
begin
  if current_user = 'cocinacore_auth' then raise exception 'Use a separate provisioning identity'; end if;
  if not exists (select 1 from public.schema_migrations where filename = '019_real_consumption_reconciliation.sql') then
    raise exception 'Apply and verify migrations 001-019 before provisioning';
  end if;
  select oid into auth_oid from pg_roles where rolname = 'cocinacore_auth';
  select * into existing from pg_roles where rolname = 'cocinacore_auth';
  auth_role_exists := FOUND;

  -- Accept only the pre-020 identity baseline or a complete 020C1 signup installation.
  -- The secure state may also include the two reviewed 020D4-A metrics policies.
  legacy_identity :=
    NOT EXISTS (SELECT 1 FROM pg_policy WHERE polrelid IN (
      'public.users'::regclass, 'public.tenants'::regclass, 'public.tenant_memberships'::regclass
    ))
    AND NOT EXISTS (SELECT 1 FROM pg_class WHERE oid IN (
      'public.users'::regclass, 'public.tenants'::regclass, 'public.tenant_memberships'::regclass
    ) AND (relrowsecurity OR relforcerowsecurity))
    AND to_regclass('public.runtime_identity_probe') IS NULL
    AND to_regprocedure('public.signup_new_account(text,text,text,timestamptz,text)') IS NULL
    AND NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname IN (
      'cocinacore_signup_bootstrap', 'cocinacore_identity_probe'
    ));

  IF NOT legacy_identity THEN
    IF auth_oid IS NULL
      OR to_regclass('public.runtime_identity_probe') IS NULL
      OR to_regprocedure('public.signup_new_account(text,text,text,timestamptz,text)') IS NULL
      OR EXISTS (SELECT 1 FROM pg_class WHERE oid IN (
        'public.users'::regclass, 'public.tenants'::regclass, 'public.tenant_memberships'::regclass
      ) AND (NOT relrowsecurity OR NOT relforcerowsecurity)) THEN
      RAISE EXCEPTION 'Refusing partial 020C1 identity installation';
    END IF;

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
    SELECT NOT EXISTS (SELECT 1 FROM full_diff) OR NOT EXISTS (SELECT 1 FROM base_diff)
    INTO identity_policy_contract;

    IF NOT identity_policy_contract THEN
      RAISE EXCEPTION 'Refusing altered or incomplete 020C1 identity policy contract';
    END IF;

    IF (SELECT relowner FROM pg_class WHERE oid=to_regclass('public.runtime_identity_probe'))
         IS DISTINCT FROM (SELECT oid FROM pg_roles WHERE rolname='cocinacore_identity_probe')
      OR (SELECT pg_get_viewdef(to_regclass('public.runtime_identity_probe'),true))
         IS DISTINCT FROM E' SELECT u.id,\n    u.tenant_id\n   FROM users u\n     JOIN tenant_memberships m ON m.user_id = u.id AND m.tenant_id = u.tenant_id;'
      OR (SELECT proowner FROM pg_proc WHERE oid=to_regprocedure('public.signup_new_account(text,text,text,timestamptz,text)'))
         IS DISTINCT FROM (SELECT oid FROM pg_roles WHERE rolname='cocinacore_signup_bootstrap')
      OR (SELECT md5(prosrc) FROM pg_proc WHERE oid=to_regprocedure('public.signup_new_account(text,text,text,timestamptz,text)'))
         IS DISTINCT FROM '5358b46b5b10a8878408f2ffa5a2f223'
      OR (SELECT proconfig FROM pg_proc WHERE oid=to_regprocedure('public.signup_new_account(text,text,text,timestamptz,text)'))
         IS DISTINCT FROM ARRAY['search_path=pg_catalog']::text[]
      OR (SELECT prosecdef FROM pg_proc WHERE oid=to_regprocedure('public.signup_new_account(text,text,text,timestamptz,text)')) IS DISTINCT FROM true
      OR NOT has_function_privilege(auth_oid,'public.signup_new_account(text,text,text,timestamptz,text)','EXECUTE')
      OR has_function_privilege('public','public.signup_new_account(text,text,text,timestamptz,text)','EXECUTE')
      OR has_function_privilege('cocinacore_runtime_rls','public.signup_new_account(text,text,text,timestamptz,text)','EXECUTE')
      OR EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
        CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
        WHERE n.nspname='public' AND a.grantee=0 AND a.privilege_type='EXECUTE'
          AND p.oid<>to_regprocedure('public.signup_new_account(text,text,text,timestamptz,text)')
          AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid='pg_proc'::regclass
            AND d.objid=p.oid AND d.refclassid='pg_extension'::regclass AND d.deptype='e'))
      OR EXISTS (SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
        WHERE p.oid=to_regprocedure('public.signup_new_account(text,text,text,timestamptz,text)')
          AND (a.grantee NOT IN (p.proowner,auth_oid) OR a.privilege_type <> 'EXECUTE' OR a.is_grantable))
      OR EXISTS (SELECT 1 FROM pg_class c CROSS JOIN LATERAL aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a
        WHERE c.oid=to_regclass('public.runtime_identity_probe')
          AND (a.grantee NOT IN (c.relowner,(SELECT oid FROM pg_roles WHERE rolname='cocinacore_runtime_rls'))
            OR a.is_grantable OR (a.grantee=(SELECT oid FROM pg_roles WHERE rolname='cocinacore_runtime_rls') AND a.privilege_type <> 'SELECT')))
      OR NOT has_table_privilege('cocinacore_runtime_rls','public.runtime_identity_probe','SELECT')
      OR has_table_privilege(auth_oid,'public.tenants','INSERT')
      OR has_table_privilege(auth_oid,'public.users','INSERT')
      OR has_table_privilege(auth_oid,'public.tenant_memberships','INSERT')
      OR has_any_column_privilege(auth_oid,'public.tenants','INSERT')
      OR has_any_column_privilege(auth_oid,'public.users','INSERT')
      OR has_any_column_privilege(auth_oid,'public.tenant_memberships','INSERT') THEN
      RAISE EXCEPTION 'Refusing altered 020C1 signup function, identity view, ACL, or auth INSERT privileges';
    END IF;

    IF (SELECT count(*) FROM pg_roles WHERE rolname IN ('cocinacore_signup_bootstrap','cocinacore_identity_probe')) <> 2
      OR EXISTS (SELECT 1 FROM pg_roles r WHERE r.rolname IN ('cocinacore_signup_bootstrap','cocinacore_identity_probe')
        AND (r.rolcanlogin OR r.rolsuper OR r.rolbypassrls OR r.rolcreatedb OR r.rolcreaterole
          OR r.rolinherit OR r.rolreplication OR EXISTS (SELECT 1 FROM pg_auth_members m WHERE m.member=r.oid OR m.roleid=r.oid))) THEN
      RAISE EXCEPTION 'Refusing untrusted 020C1 support roles';
    END IF;
    secure_identity := true;
  END IF;

  if auth_role_exists then
    if existing.rolsuper or existing.rolbypassrls or existing.rolcreatedb or existing.rolcreaterole
       or existing.rolreplication or existing.rolinherit or NOT existing.rolcanlogin
       or shobj_description(existing.oid, 'pg_authid') is distinct from 'CocinaCore isolated database auth v1'
       or existing.rolconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog, public','row_security=on']::text[] THEN
      raise exception 'Refusing to repurpose an existing or privileged role';
    end if;
    if exists (select 1 from pg_auth_members where member = existing.oid or roleid = existing.oid)
       or exists (select 1 from pg_shdepend where refclassid = 'pg_authid'::regclass and refobjid = existing.oid and deptype = 'o') then
      raise exception 'Auth must have no memberships, members or owned objects';
    end if;
  end if;
  IF auth_oid IS NOT NULL AND EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      CROSS JOIN LATERAL aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a
    WHERE n.nspname='public' AND a.grantee=auth_oid
      AND NOT ((c.relname='tenants' AND a.privilege_type='SELECT')
        OR (c.relname='users' AND a.privilege_type='SELECT')
        OR (c.relname='sessions' AND a.privilege_type IN ('SELECT','DELETE'))
        OR (c.relname='password_reset_tokens' AND a.privilege_type='SELECT'))
  ) THEN RAISE EXCEPTION 'Unexpected auth relation privileges'; END IF;

  IF auth_oid IS NOT NULL AND EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      CROSS JOIN LATERAL aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a
    WHERE n.nspname='public' AND a.grantee=auth_oid AND a.privilege_type IN ('INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER')
      AND NOT (c.relname='sessions' AND a.privilege_type='DELETE')
  ) THEN RAISE EXCEPTION 'Unexpected auth table-level write privileges'; END IF;

  IF auth_oid IS NOT NULL AND EXISTS (
    SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
    WHERE a.grantee=auth_oid
      AND NOT (secure_identity AND p.oid=to_regprocedure('public.signup_new_account(text,text,text,timestamptz,text)')
        AND a.privilege_type='EXECUTE' AND NOT a.is_grantable)
  ) THEN RAISE EXCEPTION 'Unexpected direct auth function privileges'; END IF;

  if exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    cross join lateral aclexplode(c.relacl) acl where n.nspname = 'public' and acl.grantee = 0)
    or exists (select 1 from pg_attribute a join pg_class c on c.oid = a.attrelid
    join pg_namespace n on n.oid = c.relnamespace cross join lateral aclexplode(a.attacl) acl
    where n.nspname = 'public' and (acl.grantee = 0 or (
      acl.grantee = (select oid from pg_roles where rolname = 'cocinacore_auth')
      and not (
        (legacy_identity and c.relname = 'tenants' and acl.privilege_type = 'INSERT' and a.attname in ('name', 'tenant_type', 'trial_started_at', 'trial_ends_at'))
        or (legacy_identity and c.relname = 'users' and acl.privilege_type = 'INSERT' and a.attname in ('email', 'password_hash', 'full_name', 'tenant_id', 'role', 'terms_accepted_at', 'terms_version', 'email_confirmed'))
        or (c.relname = 'users' and acl.privilege_type = 'UPDATE' and a.attname in ('password_hash', 'updated_at'))
        or (legacy_identity and c.relname = 'tenant_memberships' and acl.privilege_type = 'INSERT' and a.attname in ('tenant_id', 'user_id', 'role'))
        or (c.relname = 'sessions' and acl.privilege_type = 'INSERT' and a.attname in ('user_id', 'token_hash', 'expires_at'))
        or (c.relname = 'sessions' and acl.privilege_type = 'UPDATE' and a.attname = 'last_seen_at')
        or (c.relname = 'password_reset_tokens' and acl.privilege_type = 'INSERT' and a.attname in ('user_id', 'token_hash', 'requested_ip_hash', 'expires_at'))
        or (c.relname = 'password_reset_tokens' and acl.privilege_type = 'UPDATE' and a.attname = 'used_at')
      )
    ))) then raise exception 'Unexpected PUBLIC relation or auth column privileges'; end if;
end;
$$;
-- The preflight above guarantees that function presence means the exact secure 020C1 state.
select to_regprocedure('public.signup_new_account(text,text,text,timestamptz,text)') is not null
  as secure_signup_installed \gset
select 'create role cocinacore_auth login nosuperuser nobypassrls nocreatedb nocreaterole noinherit noreplication'
where not exists (select 1 from pg_roles where rolname = 'cocinacore_auth') \gexec
comment on role cocinacore_auth is 'CocinaCore isolated database auth v1';
select format('alter role cocinacore_auth password %L', :'auth_password') \gexec
\unset auth_password
alter role cocinacore_auth login nosuperuser nobypassrls nocreatedb nocreaterole noinherit noreplication;
alter role cocinacore_auth set search_path = pg_catalog, public;
alter role cocinacore_auth set row_security = on;
select format('revoke all privileges on database %I from cocinacore_auth', current_database()) \gexec
revoke all privileges on schema public from cocinacore_auth;
revoke all privileges on all tables in schema public from cocinacore_auth;
revoke all privileges on all sequences in schema public from cocinacore_auth;
revoke all privileges on all functions in schema public from cocinacore_auth;
-- Table-level REVOKE does not clear column ACLs; explicitly clear legacy signup writes.
revoke insert (name, tenant_type, trial_started_at, trial_ends_at) on public.tenants from cocinacore_auth;
revoke insert (email, password_hash, full_name, tenant_id, role, terms_accepted_at, terms_version, email_confirmed)
  on public.users from cocinacore_auth;
revoke insert (tenant_id, user_id, role) on public.tenant_memberships from cocinacore_auth;
select format('grant connect on database %I to cocinacore_auth', current_database()) \gexec
grant usage on schema public to cocinacore_auth;
grant select on public.tenants to cocinacore_auth;
grant select on public.users to cocinacore_auth;
grant update (password_hash, updated_at) on public.users to cocinacore_auth;
grant select, delete on public.sessions to cocinacore_auth;
grant insert (user_id, token_hash, expires_at) on public.sessions to cocinacore_auth;
grant update (last_seen_at) on public.sessions to cocinacore_auth;
grant select on public.password_reset_tokens to cocinacore_auth;
grant insert (user_id, token_hash, requested_ip_hash, expires_at) on public.password_reset_tokens to cocinacore_auth;
grant update (used_at) on public.password_reset_tokens to cocinacore_auth;
\if :secure_signup_installed
grant execute on function public.signup_new_account(text,text,text,timestamptz,text) to cocinacore_auth;
\else
grant insert (name, tenant_type, trial_started_at, trial_ends_at) on public.tenants to cocinacore_auth;
grant insert (email, password_hash, full_name, tenant_id, role, terms_accepted_at, terms_version, email_confirmed)
  on public.users to cocinacore_auth;
grant insert (tenant_id, user_id, role) on public.tenant_memberships to cocinacore_auth;
\endif
commit;
\echo 'Provisioned cocinacore_auth in the connected isolated database.'
