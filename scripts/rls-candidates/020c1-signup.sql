-- Candidate SQL only; invoke in a runner-managed transaction after provisioning.
CREATE POLICY signup_bootstrap_tenants_read ON public.tenants FOR SELECT TO cocinacore_signup_bootstrap USING (true);
CREATE POLICY signup_bootstrap_tenants_insert ON public.tenants FOR INSERT TO cocinacore_signup_bootstrap WITH CHECK (true);
CREATE POLICY signup_bootstrap_users_read ON public.users FOR SELECT TO cocinacore_signup_bootstrap USING (true);
CREATE POLICY signup_bootstrap_users_insert ON public.users FOR INSERT TO cocinacore_signup_bootstrap WITH CHECK (role='owner');
CREATE POLICY signup_bootstrap_memberships_insert ON public.tenant_memberships FOR INSERT TO cocinacore_signup_bootstrap WITH CHECK (role='owner');
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
REVOKE ALL ON FUNCTION public.signup_new_account(text,text,text,timestamptz,text) FROM PUBLIC, cocinacore_runtime_rls;
GRANT EXECUTE ON FUNCTION public.signup_new_account(text,text,text,timestamptz,text) TO cocinacore_auth;
REVOKE INSERT (name,tenant_type,trial_started_at,trial_ends_at) ON public.tenants FROM cocinacore_auth;
REVOKE INSERT (email,password_hash,full_name,tenant_id,role,terms_accepted_at,terms_version,email_confirmed) ON public.users FROM cocinacore_auth;
REVOKE INSERT (tenant_id,user_id,role) ON public.tenant_memberships FROM cocinacore_auth;
