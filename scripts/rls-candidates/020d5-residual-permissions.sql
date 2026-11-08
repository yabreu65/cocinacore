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
