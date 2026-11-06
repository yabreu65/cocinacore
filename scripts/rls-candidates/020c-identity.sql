-- Candidate only, disposable PostgreSQL. Not a canonical migration.
-- The NOLOGIN view owner breaks users/membership policy recursion and cannot be assumed by runtime.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='cocinacore_identity_probe' AND NOT rolcanlogin AND NOT rolsuper AND NOT rolbypassrls) THEN
    RAISE EXCEPTION 'Provision restricted identity probe first';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policy WHERE polrelid IN ('public.users'::regclass, 'public.tenants'::regclass, 'public.tenant_memberships'::regclass)) THEN
    RAISE EXCEPTION 'Existing identity policies require composition review';
  END IF;
  IF to_regclass('public.runtime_identity_probe') IS NOT NULL THEN RAISE EXCEPTION 'Identity probe view exists'; END IF;
END $$;
GRANT USAGE ON SCHEMA public TO cocinacore_identity_probe;
GRANT SELECT (id, tenant_id) ON public.users TO cocinacore_identity_probe;
GRANT SELECT (user_id, tenant_id) ON public.tenant_memberships TO cocinacore_identity_probe;
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.users FORCE ROW LEVEL SECURITY;
ALTER TABLE public.tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenants FORCE ROW LEVEL SECURITY;
ALTER TABLE public.tenant_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenant_memberships FORCE ROW LEVEL SECURITY;
-- Independent probe policies avoid users <-> memberships policy recursion.
CREATE POLICY identity_probe_users ON public.users FOR SELECT TO cocinacore_identity_probe
 USING (id = NULLIF(current_setting('app.user_id',true),'')::uuid AND tenant_id = NULLIF(current_setting('app.tenant_id',true),'')::uuid);
CREATE POLICY identity_probe_memberships ON public.tenant_memberships FOR SELECT TO cocinacore_identity_probe
 USING (user_id = NULLIF(current_setting('app.user_id',true),'')::uuid AND tenant_id = NULLIF(current_setting('app.tenant_id',true),'')::uuid);
CREATE VIEW public.runtime_identity_probe WITH (security_barrier=true) AS
 SELECT u.id, u.tenant_id FROM public.users u JOIN public.tenant_memberships m ON m.user_id=u.id AND m.tenant_id=u.tenant_id;
ALTER VIEW public.runtime_identity_probe OWNER TO cocinacore_identity_probe;
REVOKE ALL ON public.runtime_identity_probe FROM PUBLIC;
GRANT SELECT ON public.runtime_identity_probe TO cocinacore_runtime_rls;
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
