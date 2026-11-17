-- Migration 024: one-use, restricted first platform-administrator provisioning.
-- The two dedicated roles are prepared by the owner-controlled role provisioner
-- after migrations 001-023; this migration grants no new capability to runtime.
DO $preflight$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles
     WHERE rolname = 'cocinacore_first_admin_function_owner'
       AND NOT rolcanlogin AND NOT rolsuper AND NOT rolbypassrls
       AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolreplication
       AND NOT rolinherit
  ) THEN
    RAISE EXCEPTION '024_RESTRICTED_FUNCTION_OWNER_REQUIRED';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles
     WHERE rolname = 'cocinacore_first_admin_provisioner'
       AND rolcanlogin AND NOT rolsuper AND NOT rolbypassrls
       AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolreplication
       AND NOT rolinherit
  ) THEN
    RAISE EXCEPTION '024_RESTRICTED_PROVISIONER_REQUIRED';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_auth_members m
      JOIN pg_catalog.pg_roles member_role ON member_role.oid = m.member
      JOIN pg_catalog.pg_roles granted_role ON granted_role.oid = m.roleid
     WHERE member_role.rolname = 'cocinacore_schema_owner'
       AND granted_role.rolname = 'cocinacore_first_admin_function_owner'
       AND NOT m.admin_option AND NOT m.inherit_option AND m.set_option
  ) THEN
    RAISE EXCEPTION '024_SCHEMA_OWNER_FUNCTION_MEMBERSHIP_REQUIRED';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_auth_members m
      JOIN pg_catalog.pg_roles member_role ON member_role.oid = m.member
      JOIN pg_catalog.pg_roles granted_role ON granted_role.oid = m.roleid
     WHERE member_role.rolname IN ('cocinacore_first_admin_function_owner', 'cocinacore_first_admin_provisioner')
        OR granted_role.rolname = 'cocinacore_first_admin_provisioner'
        OR (granted_role.rolname = 'cocinacore_first_admin_function_owner'
            AND member_role.rolname <> 'cocinacore_schema_owner')
  ) THEN
    RAISE EXCEPTION '024_UNEXPECTED_PROVISIONER_ROLE_MEMBERSHIP';
  END IF;
  IF (SELECT rolconfig FROM pg_catalog.pg_roles WHERE rolname='cocinacore_first_admin_function_owner') IS NOT NULL
     OR NOT COALESCE((
       SELECT cardinality(rolconfig) = 2
          AND rolconfig @> ARRAY['search_path=pg_catalog, public', 'row_security=on']
         FROM pg_catalog.pg_roles WHERE rolname='cocinacore_first_admin_provisioner'
     ), false)
     OR pg_catalog.shobj_description(
       (SELECT oid FROM pg_catalog.pg_roles WHERE rolname='cocinacore_first_admin_function_owner'), 'pg_authid'
     ) IS DISTINCT FROM 'CocinaCore first platform-admin function owner v1'
     OR pg_catalog.shobj_description(
       (SELECT oid FROM pg_catalog.pg_roles WHERE rolname='cocinacore_first_admin_provisioner'), 'pg_authid'
     ) IS DISTINCT FROM 'CocinaCore first platform-admin provisioner v1' THEN
    RAISE EXCEPTION '024_RESTRICTED_ROLE_CONFIGURATION_MISMATCH';
  END IF;
END
$preflight$;

GRANT INSERT (id, name, tenant_type) ON public.tenants TO cocinacore_first_admin_function_owner;
GRANT INSERT (id, email, password_hash, email_confirmed, full_name, tenant_id, role)
  ON public.users TO cocinacore_first_admin_function_owner;
GRANT INSERT (tenant_id, user_id, role)
  ON public.tenant_memberships TO cocinacore_first_admin_function_owner;
GRANT SELECT (user_id) ON public.platform_owners TO cocinacore_first_admin_function_owner;
GRANT INSERT (user_id, requires_manual_review)
  ON public.platform_owners TO cocinacore_first_admin_function_owner;

-- Permanent single-use claim survives account deletion and is the durable audit
-- record for the authorization, target, operator database role, and outcome.
CREATE TABLE public.first_platform_admin_bootstrap_claim (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  user_id uuid NOT NULL,
  email text NOT NULL CHECK (email = pg_catalog.lower(pg_catalog.btrim(email))),
  operator_role text NOT NULL,
  approval_reference text NOT NULL
    CHECK (approval_reference ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{2,127}$'),
  created_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.first_platform_admin_bootstrap_claim IS
  'Permanent one-use claim and audit record for first platform administrator provisioning.';
ALTER TABLE public.first_platform_admin_bootstrap_claim ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.first_platform_admin_bootstrap_claim FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.first_platform_admin_bootstrap_claim
  FROM PUBLIC, cocinacore_auth, cocinacore_runtime_rls, cocinacore_first_admin_provisioner;
GRANT SELECT (singleton) ON public.first_platform_admin_bootstrap_claim
  TO cocinacore_first_admin_function_owner;
GRANT INSERT (user_id, email, operator_role, approval_reference)
  ON public.first_platform_admin_bootstrap_claim TO cocinacore_first_admin_function_owner;

-- These additive policies are limited to a NOLOGIN function owner. They do not
-- change or broaden any existing runtime, auth, or tenant policy.
CREATE POLICY first_admin_bootstrap_tenants_insert
  ON public.tenants FOR INSERT TO cocinacore_first_admin_function_owner
  WITH CHECK (tenant_type = 'home' AND trial_started_at IS NULL AND trial_ends_at IS NULL);
CREATE POLICY first_admin_bootstrap_users_insert
  ON public.users FOR INSERT TO cocinacore_first_admin_function_owner
  WITH CHECK (tenant_id IS NOT NULL AND role = 'member' AND email_confirmed = true);
CREATE POLICY first_admin_bootstrap_memberships_insert
  ON public.tenant_memberships FOR INSERT TO cocinacore_first_admin_function_owner
  WITH CHECK (role = 'member');
CREATE POLICY first_admin_bootstrap_platform_owners_select
  ON public.platform_owners FOR SELECT TO cocinacore_first_admin_function_owner
  USING (true);
CREATE POLICY first_admin_bootstrap_platform_owners_insert
  ON public.platform_owners FOR INSERT TO cocinacore_first_admin_function_owner
  WITH CHECK (requires_manual_review = false);
CREATE POLICY first_admin_bootstrap_claim_select
  ON public.first_platform_admin_bootstrap_claim FOR SELECT TO cocinacore_first_admin_function_owner
  USING (singleton);
CREATE POLICY first_admin_bootstrap_claim_insert
  ON public.first_platform_admin_bootstrap_claim FOR INSERT TO cocinacore_first_admin_function_owner
  WITH CHECK (operator_role = session_user);

-- Function ownership transfer requires CREATE on the containing schema. Keep
-- that capability only for the transaction that creates/transfers this function.
GRANT CREATE ON SCHEMA public TO cocinacore_first_admin_function_owner;

CREATE FUNCTION public.provision_first_platform_administrator(
  p_email text,
  p_password_hash text,
  p_full_name text,
  p_approval_reference text
)
RETURNS TABLE(user_id uuid, email text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  canonical_email text;
  canonical_name text;
  created_user_id uuid;
  created_tenant_id uuid;
  canonical_approval_reference text;
BEGIN
  canonical_email := pg_catalog.lower(pg_catalog.btrim(p_email));
  canonical_name := pg_catalog.btrim(p_full_name);
  canonical_approval_reference := pg_catalog.btrim(p_approval_reference);

  IF canonical_email IS NULL
     OR pg_catalog.length(canonical_email) > 254
     OR canonical_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
     OR canonical_name IS NULL
     OR canonical_name = ''
     OR pg_catalog.length(canonical_name) > 120
     OR canonical_approval_reference IS NULL
     OR canonical_approval_reference !~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{2,127}$'
     OR p_password_hash IS NULL
     OR p_password_hash !~ '^\$2[aby]\$12\$[./A-Za-z0-9]{53}$'
  THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'FIRST_PLATFORM_ADMIN_INVALID_INPUT';
  END IF;

  -- Serialize competing first-admin attempts. The statement's transaction keeps
  -- this lock through both inserts and commit, so only one caller can succeed.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('cocinacore:first-platform-admin-bootstrap:v1', 0)
  );

  IF EXISTS (SELECT 1 FROM public.first_platform_admin_bootstrap_claim LIMIT 1)
     OR EXISTS (SELECT 1 FROM public.platform_owners LIMIT 1) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'FIRST_PLATFORM_ADMIN_ALREADY_EXISTS';
  END IF;

  -- A minimal member tenant is required by the existing session/RLS identity
  -- contract. The account is never granted tenant owner/admin membership.
  created_tenant_id := pg_catalog.gen_random_uuid();
  INSERT INTO public.tenants (id, name, tenant_type)
  VALUES (created_tenant_id, 'Tenant of ' || canonical_email, 'home');

  created_user_id := pg_catalog.gen_random_uuid();
  INSERT INTO public.users (id, email, password_hash, email_confirmed, full_name, tenant_id, role)
  VALUES (created_user_id, canonical_email, p_password_hash, true, canonical_name, created_tenant_id, 'member');

  INSERT INTO public.tenant_memberships (tenant_id, user_id, role)
  VALUES (created_tenant_id, created_user_id, 'member');

  INSERT INTO public.platform_owners (user_id, requires_manual_review)
  VALUES (created_user_id, false);

  INSERT INTO public.first_platform_admin_bootstrap_claim
    (user_id, email, operator_role, approval_reference)
  VALUES (created_user_id, canonical_email, session_user::text, canonical_approval_reference);

  RAISE LOG 'cocinacore.first_platform_admin.provisioned database=% operator=% user_id=% email=% approval_reference=%',
    pg_catalog.current_database(), session_user, created_user_id, canonical_email, canonical_approval_reference;

  RETURN QUERY SELECT created_user_id, canonical_email;
EXCEPTION
  WHEN unique_violation THEN
    RAISE EXCEPTION USING ERRCODE = '23505', MESSAGE = 'FIRST_PLATFORM_ADMIN_ACCOUNT_CONFLICT';
END
$function$;

ALTER FUNCTION public.provision_first_platform_administrator(text, text, text, text)
  OWNER TO cocinacore_first_admin_function_owner;
REVOKE CREATE ON SCHEMA public FROM cocinacore_first_admin_function_owner;
SET ROLE cocinacore_first_admin_function_owner;
REVOKE ALL ON FUNCTION public.provision_first_platform_administrator(text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.provision_first_platform_administrator(text, text, text, text)
  TO cocinacore_first_admin_provisioner;
SET ROLE cocinacore_schema_owner;
