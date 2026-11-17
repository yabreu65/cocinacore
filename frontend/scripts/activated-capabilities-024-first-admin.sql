-- Read-only attestation for the optional one-use first-admin capability.
DO $first_admin_contract$
DECLARE
  provisioner_function regprocedure := pg_catalog.to_regprocedure(
    'public.provision_first_platform_administrator(text,text,text,text)'
  );
  claim_table regclass := pg_catalog.to_regclass('public.first_platform_admin_bootstrap_claim');
  policy_contract_valid boolean;
BEGIN
  IF provisioner_function IS NULL AND claim_table IS NULL THEN
    RETURN;
  END IF;
  IF provisioner_function IS NULL OR claim_table IS NULL THEN
    RAISE EXCEPTION 'FIRST_PLATFORM_ADMIN_024_PARTIAL_CAPABILITY';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles r
     WHERE r.rolname = 'cocinacore_first_admin_function_owner'
       AND NOT r.rolcanlogin AND NOT r.rolsuper AND NOT r.rolbypassrls
       AND NOT r.rolcreatedb AND NOT r.rolcreaterole AND NOT r.rolreplication
       AND NOT r.rolinherit
       AND pg_catalog.shobj_description(r.oid, 'pg_authid') =
         'CocinaCore first platform-admin function owner v1'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles r
     WHERE r.rolname = 'cocinacore_first_admin_provisioner'
       AND r.rolcanlogin AND NOT r.rolsuper AND NOT r.rolbypassrls
       AND NOT r.rolcreatedb AND NOT r.rolcreaterole AND NOT r.rolreplication
       AND NOT r.rolinherit
       AND pg_catalog.shobj_description(r.oid, 'pg_authid') =
         'CocinaCore first platform-admin provisioner v1'
  ) THEN
    RAISE EXCEPTION 'FIRST_PLATFORM_ADMIN_024_ROLE_MISMATCH';
  END IF;

  IF (SELECT count(*) FROM pg_catalog.pg_auth_members m
       JOIN pg_catalog.pg_roles parent ON parent.oid = m.roleid
       JOIN pg_catalog.pg_roles member ON member.oid = m.member
      WHERE (parent.rolname, member.rolname) IN (
        ('cocinacore_first_admin_function_owner', 'cocinacore_schema_owner'),
        ('cocinacore_schema_owner', 'migration_admin')
      ) AND NOT m.admin_option AND NOT m.inherit_option AND m.set_option) <> 2
     OR EXISTS (
       SELECT 1 FROM pg_catalog.pg_auth_members m
       JOIN pg_catalog.pg_roles parent ON parent.oid = m.roleid
       JOIN pg_catalog.pg_roles member ON member.oid = m.member
       WHERE (member.rolname IN ('cocinacore_first_admin_function_owner', 'cocinacore_first_admin_provisioner')
         OR parent.rolname = 'cocinacore_first_admin_provisioner'
         OR (parent.rolname = 'cocinacore_first_admin_function_owner'
             AND member.rolname <> 'cocinacore_schema_owner'))
         AND NOT ((parent.rolname, member.rolname) IN (
           ('cocinacore_first_admin_function_owner', 'cocinacore_schema_owner'),
           ('cocinacore_schema_owner', 'migration_admin')
         ))
     ) THEN
    RAISE EXCEPTION 'FIRST_PLATFORM_ADMIN_024_MEMBERSHIP_MISMATCH';
  END IF;

  IF (SELECT relrowsecurity AND relforcerowsecurity
        FROM pg_catalog.pg_class WHERE oid = claim_table) IS DISTINCT FROM true
     OR (SELECT pg_catalog.pg_get_userbyid(relowner) FROM pg_catalog.pg_class WHERE oid = claim_table)
        IS DISTINCT FROM 'cocinacore_schema_owner'
     OR (SELECT count(*) FROM pg_catalog.pg_policy WHERE polrelid = claim_table) <> 2
     OR (SELECT count(*) FROM pg_catalog.pg_policy p
          WHERE p.polrelid = claim_table AND p.polroles = ARRAY[
            (SELECT oid FROM pg_catalog.pg_roles WHERE rolname='cocinacore_first_admin_function_owner')
          ]::oid[]) <> 2 THEN
    RAISE EXCEPTION 'FIRST_PLATFORM_ADMIN_024_CLAIM_RLS_MISMATCH';
  END IF;

  WITH expected(polname, tablename, command, using_expr, check_expr) AS (VALUES
    ('first_admin_bootstrap_tenants_insert','tenants','a','null','tenant_type=''home''andtrial_started_atisnullandtrial_ends_atisnull'),
    ('first_admin_bootstrap_users_insert','users','a','null','tenant_idisnotnullandrole=''member''andemail_confirmed=true'),
    ('first_admin_bootstrap_memberships_insert','tenant_memberships','a','null','role=''member'''),
    ('first_admin_bootstrap_platform_owners_select','platform_owners','r','true','null'),
    ('first_admin_bootstrap_platform_owners_insert','platform_owners','a','null','requires_manual_review=false'),
    ('first_admin_bootstrap_claim_select','first_platform_admin_bootstrap_claim','r','singleton','null'),
    ('first_admin_bootstrap_claim_insert','first_platform_admin_bootstrap_claim','a','null','operator_role=session_user')
  ), actual AS (
    SELECT p.polname::text, c.relname::text, p.polcmd::text,
      pg_catalog.regexp_replace(pg_catalog.lower(COALESCE(pg_catalog.pg_get_expr(p.polqual,p.polrelid),'NULL')), '[[:space:]()]|::text', '', 'g') AS using_expr,
      pg_catalog.regexp_replace(pg_catalog.lower(COALESCE(pg_catalog.pg_get_expr(p.polwithcheck,p.polrelid),'NULL')), '[[:space:]()]|::text', '', 'g') AS check_expr
    FROM pg_catalog.pg_policy p JOIN pg_catalog.pg_class c ON c.oid=p.polrelid
    WHERE p.polroles = ARRAY[
      (SELECT oid FROM pg_catalog.pg_roles WHERE rolname='cocinacore_first_admin_function_owner')
    ]::oid[]
  ), differences AS (
    (SELECT * FROM expected EXCEPT SELECT * FROM actual)
    UNION ALL
    (SELECT * FROM actual EXCEPT SELECT * FROM expected)
  )
  SELECT NOT EXISTS (SELECT 1 FROM differences)
     AND (SELECT count(*)=7 FROM actual)
    INTO policy_contract_valid;
  IF policy_contract_valid IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'FIRST_PLATFORM_ADMIN_024_POLICY_MISMATCH';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_roles r ON r.oid = p.proowner
    WHERE p.oid = provisioner_function AND p.prosecdef
      AND p.proconfig = ARRAY['search_path=pg_catalog']
      AND r.rolname = 'cocinacore_first_admin_function_owner'
  ) THEN
    RAISE EXCEPTION 'FIRST_PLATFORM_ADMIN_024_FUNCTION_OWNER_MISMATCH';
  END IF;
  IF NOT pg_catalog.has_function_privilege(
    'cocinacore_first_admin_provisioner', provisioner_function, 'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'FIRST_PLATFORM_ADMIN_024_PROVISIONER_EXECUTE_MISSING';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_catalog.aclexplode(
      (SELECT COALESCE(p.proacl, pg_catalog.acldefault('f', p.proowner))
         FROM pg_catalog.pg_proc p WHERE p.oid = provisioner_function)
    ) acl WHERE acl.grantee = 0 AND acl.privilege_type = 'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'FIRST_PLATFORM_ADMIN_024_PUBLIC_EXECUTE_PRESENT';
  END IF;
  IF pg_catalog.has_function_privilege('cocinacore_auth', provisioner_function, 'EXECUTE') THEN
    RAISE EXCEPTION 'FIRST_PLATFORM_ADMIN_024_AUTH_EXECUTE_PRESENT';
  END IF;
  IF pg_catalog.has_function_privilege('cocinacore_runtime_rls', provisioner_function, 'EXECUTE') THEN
    RAISE EXCEPTION 'FIRST_PLATFORM_ADMIN_024_RUNTIME_EXECUTE_PRESENT';
  END IF;

  IF pg_catalog.has_table_privilege('cocinacore_first_admin_provisioner', claim_table, 'SELECT')
     OR pg_catalog.has_table_privilege('cocinacore_first_admin_provisioner', claim_table, 'INSERT')
     OR pg_catalog.has_table_privilege('cocinacore_auth', claim_table, 'SELECT')
     OR pg_catalog.has_table_privilege('cocinacore_runtime_rls', claim_table, 'SELECT') THEN
    RAISE EXCEPTION 'FIRST_PLATFORM_ADMIN_024_CLAIM_ACL_MISMATCH';
  END IF;
END
$first_admin_contract$;
