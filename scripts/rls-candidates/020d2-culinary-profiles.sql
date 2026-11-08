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
  IF NOT has_table_privilege(runtime_oid, 'public.runtime_identity_probe', 'SELECT') THEN
    RAISE EXCEPTION '020D2 requires the runtime SELECT grant on the identity probe';
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
           OR (acl.grantee = runtime_oid AND acl.privilege_type = 'SELECT' AND NOT acl.is_grantable)
         )
     ) THEN
    RAISE EXCEPTION '020D2 requires the runtime-only SELECT identity-probe grant';
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
