-- Fixed PostgreSQL 16 positive attestation for the 020 + 021 catalog.
-- Frozen 020 checks retained; only the reviewed inventory-price policy, grants and schema are added.
-- Read-only: all expected identities, definitions, options, policies and ACLs are constants.
DO $activated_contract$
DECLARE
  valid boolean;
  role_state boolean;
  ownership_state boolean;
  runtime_acl_diff text;
  runtime_column_acl_diff text;
BEGIN
  WITH expected_roles(role_name,can_login,comment_text) AS (VALUES
    ('cocinacore_runtime_rls',true,'CocinaCore isolated database runtime v1'),
    ('cocinacore_auth',true,'CocinaCore isolated database auth v1'),
    ('cocinacore_owner_metrics',true,'CocinaCore isolated metrics role v1'),
    ('cocinacore_global_writer',true,'CocinaCore isolated global writer v1'),
    ('cocinacore_identity_probe',false,'CocinaCore isolated signup role v1'),
    ('cocinacore_signup_bootstrap',false,'CocinaCore isolated signup role v1'),
    ('cocinacore_metrics_view_owner',false,'CocinaCore isolated metrics role v1'),
    ('cocinacore_global_writer_view_owner',false,'CocinaCore isolated global writer v1')
  )
  SELECT count(*)=8 AND bool_and(
    r.oid IS NOT NULL AND r.rolcanlogin=e.can_login AND NOT r.rolsuper
    AND NOT r.rolbypassrls AND NOT r.rolcreatedb AND NOT r.rolcreaterole
    AND NOT r.rolreplication AND NOT r.rolinherit AND r.rolconnlimit=-1
    AND r.rolvaliduntil IS NULL AND shobj_description(r.oid,'pg_authid')=e.comment_text
    AND CASE WHEN e.can_login THEN
      cardinality(r.rolconfig)=2 AND r.rolconfig @> ARRAY['search_path=pg_catalog, public','row_security=on']::text[]
      ELSE r.rolconfig IS NULL END
  ) INTO role_state
  FROM expected_roles e LEFT JOIN pg_catalog.pg_roles r ON r.rolname=e.role_name;

  IF role_state IS DISTINCT FROM true OR EXISTS (
    SELECT 1 FROM pg_catalog.pg_auth_members m
    WHERE m.roleid IN (SELECT oid FROM pg_catalog.pg_roles WHERE rolname IN (
      'cocinacore_runtime_rls','cocinacore_auth','cocinacore_owner_metrics','cocinacore_global_writer',
      'cocinacore_identity_probe','cocinacore_signup_bootstrap','cocinacore_metrics_view_owner',
      'cocinacore_global_writer_view_owner'))
       OR m.member IN (SELECT oid FROM pg_catalog.pg_roles WHERE rolname IN (
      'cocinacore_runtime_rls','cocinacore_auth','cocinacore_owner_metrics','cocinacore_global_writer',
      'cocinacore_identity_probe','cocinacore_signup_bootstrap','cocinacore_metrics_view_owner',
      'cocinacore_global_writer_view_owner'))
  ) THEN
    RAISE EXCEPTION 'ACTIVATED_CAPABILITIES_ROLE_MISMATCH';
  END IF;

  WITH expected_owners(classid,objid,role_name) AS (VALUES
    ('pg_catalog.pg_class'::regclass,'public.runtime_identity_probe'::regclass,'cocinacore_identity_probe'),
    ('pg_catalog.pg_proc'::regclass,'public.signup_new_account(text,text,text,timestamptz,text)'::regprocedure::oid,'cocinacore_signup_bootstrap'),
    ('pg_catalog.pg_class'::regclass,'public.owner_metrics_rls_guard'::regclass,'cocinacore_metrics_view_owner'),
    ('pg_catalog.pg_class'::regclass,'public.owner_global_metrics'::regclass,'cocinacore_metrics_view_owner'),
    ('pg_catalog.pg_class'::regclass,'public.owner_write_global_books'::regclass,'cocinacore_global_writer_view_owner'),
    ('pg_catalog.pg_class'::regclass,'public.owner_write_global_pdfs'::regclass,'cocinacore_global_writer_view_owner'),
    ('pg_catalog.pg_class'::regclass,'public.owner_write_global_chunks'::regclass,'cocinacore_global_writer_view_owner')
  ), expected AS (
    SELECT e.classid,e.objid,r.oid AS owner_oid FROM expected_owners e
    JOIN pg_catalog.pg_roles r ON r.rolname=e.role_name
  ), actual AS (
    SELECT d.classid,d.objid,d.refobjid AS owner_oid
    FROM pg_catalog.pg_shdepend d
    WHERE d.refclassid='pg_catalog.pg_authid'::pg_catalog.regclass AND d.deptype='o'
      AND d.dbid=(SELECT oid FROM pg_catalog.pg_database WHERE datname=current_database())
      AND d.refobjid IN (SELECT oid FROM pg_catalog.pg_roles WHERE rolname IN (
        'cocinacore_identity_probe','cocinacore_signup_bootstrap','cocinacore_metrics_view_owner',
        'cocinacore_global_writer_view_owner'))
  ), difference AS (
    (SELECT * FROM expected EXCEPT SELECT * FROM actual)
    UNION ALL
    (SELECT * FROM actual EXCEPT SELECT * FROM expected)
  )
  SELECT NOT EXISTS (SELECT 1 FROM difference) INTO ownership_state;
  IF ownership_state IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'ACTIVATED_CAPABILITIES_OWNER_MISMATCH';
  END IF;

  IF (SELECT count(*) FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
       WHERE n.nspname='public' AND c.relkind='v' AND c.relname IN (
         'runtime_identity_probe','owner_metrics_rls_guard','owner_global_metrics',
         'owner_write_global_books','owner_write_global_pdfs','owner_write_global_chunks')) <> 6
     OR (SELECT count(*) FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
       WHERE n.nspname='public' AND p.oid=pg_catalog.to_regprocedure('public.signup_new_account(text,text,text,timestamptz,text)')) <> 1
     OR (SELECT count(*) FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
       WHERE n.nspname='public' AND c.relname IN (
         'runtime_identity_probe','owner_metrics_rls_guard','owner_global_metrics',
         'owner_write_global_books','owner_write_global_pdfs','owner_write_global_chunks')
         AND ((c.relname='runtime_identity_probe' AND c.relowner=(SELECT oid FROM pg_catalog.pg_roles WHERE rolname='cocinacore_identity_probe')
               AND pg_catalog.md5(pg_catalog.pg_get_viewdef(c.oid,true))='8488958e031f004f834e064a4d2f8019'
               AND c.reloptions=ARRAY['security_barrier=true']::text[])
           OR (c.relname IN ('owner_metrics_rls_guard','owner_global_metrics')
               AND c.relowner=(SELECT oid FROM pg_catalog.pg_roles WHERE rolname='cocinacore_metrics_view_owner')
               AND c.reloptions IS NULL
               AND ((c.relname='owner_metrics_rls_guard' AND pg_catalog.md5(pg_catalog.pg_get_viewdef(c.oid,true))='8da147bc319c202a2ee4c8401c3d93ae')
                 OR (c.relname='owner_global_metrics' AND pg_catalog.md5(pg_catalog.pg_get_viewdef(c.oid,true))='59035b254a488a1015d641a81cc928ff')))
           OR (c.relname='owner_write_global_books' AND c.relowner=(SELECT oid FROM pg_catalog.pg_roles WHERE rolname='cocinacore_global_writer_view_owner')
               AND c.reloptions IS NULL AND pg_catalog.md5(pg_catalog.pg_get_viewdef(c.oid,true))='158e764a6af66977e575135a28ea2b2c')
           OR (c.relname='owner_write_global_pdfs' AND c.relowner=(SELECT oid FROM pg_catalog.pg_roles WHERE rolname='cocinacore_global_writer_view_owner')
               AND c.reloptions IS NULL AND pg_catalog.md5(pg_catalog.pg_get_viewdef(c.oid,true))='6faa61bf38a8fb2510439274c2df9e49')
           OR (c.relname='owner_write_global_chunks' AND c.relowner=(SELECT oid FROM pg_catalog.pg_roles WHERE rolname='cocinacore_global_writer_view_owner')
               AND c.reloptions=ARRAY['check_option=cascaded']::text[]
               AND pg_catalog.md5(pg_catalog.pg_get_viewdef(c.oid,true))='0bd8cd5e0a83eb114d2306b6dd0af4df'))) <> 6
     OR (SELECT p.proowner<>(SELECT oid FROM pg_catalog.pg_roles WHERE rolname='cocinacore_signup_bootstrap')
          OR NOT p.prosecdef OR p.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog']::text[]
          OR pg_catalog.md5(p.prosrc)<>'5358b46b5b10a8878408f2ffa5a2f223'
          FROM pg_catalog.pg_proc p WHERE p.oid=pg_catalog.to_regprocedure('public.signup_new_account(text,text,text,timestamptz,text)')) IS DISTINCT FROM false
  THEN
    RAISE EXCEPTION 'ACTIVATED_CAPABILITIES_OBJECT_MISMATCH';
  END IF;

  WITH expected_tables(name) AS (VALUES
    ('book_chunks'),('cooking_session_events'),('cooking_sessions'),('global_books'),('global_pdf_library'),
    ('inventory_movements'),('meal_consumption_claims'),('platform_owners'),('premium_review_reports'),
    ('real_consumption_items'),('real_consumption_movement_links'),('real_consumption_operations'),
    ('real_consumption_substitutions'),('recipe_ai_history'),('recipe_inventory_items'),('shopping_list_items'),
    ('tenant_books'),('tenant_invitations'),('tenant_memberships'),('tenant_pdf_library'),('tenants'),
    ('user_culinary_profile_terms'),('user_culinary_profiles'),('user_meal_plans'),('user_recipe_versions'),
    ('user_recipes'),('users')
  ), actual_tables AS (
    SELECT c.relname FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relrowsecurity AND c.relforcerowsecurity
      AND c.relname <> 'first_platform_admin_bootstrap_claim'
  ), rls_diff AS (
    (SELECT name FROM expected_tables EXCEPT SELECT relname FROM actual_tables)
    UNION ALL
    (SELECT relname FROM actual_tables EXCEPT SELECT name FROM expected_tables)
  )
  SELECT NOT EXISTS (SELECT 1 FROM rls_diff)
    AND (SELECT count(*)=27 AND bool_and(c.relrowsecurity AND c.relforcerowsecurity)
         FROM expected_tables e JOIN pg_catalog.pg_class c ON c.oid=pg_catalog.to_regclass('public.'||e.name))
  INTO valid;
  IF valid IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'ACTIVATED_CAPABILITIES_RLS_MISMATCH';
  END IF;

  WITH expected(tbl,pol,cmd,role_name,permissive,qual_hash,check_hash) AS (VALUES
      ('book_chunks','documents_chunks_select','r','cocinacore_runtime_rls',true,'205860f497f39ba01e5846d4b386ee7d','-'),
      ('book_chunks','documents_private_chunks_insert','a','cocinacore_runtime_rls',true,'-','74e8083d1e9741029cb74c86f16af19f'),
      ('book_chunks','owner_global_writer_global_chunks_insert','a','cocinacore_global_writer_view_owner',true,'-','683297ded201a155b416052089484b8f'),
      ('book_chunks','owner_metrics_chunks_select','r','cocinacore_metrics_view_owner',true,'527d9306231a2e81421147e4681374df','-'),
      ('cooking_session_events','cooking_session_events_tenant_user_isolation','*','PUBLIC',true,'bf41ec2e206efb5da99b73a8ce7279d3','bf41ec2e206efb5da99b73a8ce7279d3'),
      ('cooking_sessions','cooking_sessions_tenant_user_isolation','*','PUBLIC',true,'bf41ec2e206efb5da99b73a8ce7279d3','bf41ec2e206efb5da99b73a8ce7279d3'),
      ('global_books','owner_global_writer_global_books_insert','a','cocinacore_global_writer_view_owner',true,'-','1e2ffac12def62b379e8001d7db06492'),
      ('global_books','owner_global_writer_global_books_select','r','cocinacore_global_writer_view_owner',true,'b326b5062b2f0e69046810717534cb09','-'),
      ('global_books','owner_metrics_global_books_select','r','cocinacore_metrics_view_owner',true,'b326b5062b2f0e69046810717534cb09','-'),
      ('global_books','runtime_global_books_select','r','cocinacore_runtime_rls',true,'b326b5062b2f0e69046810717534cb09','-'),
      ('global_pdf_library','owner_global_writer_global_pdfs_insert','a','cocinacore_global_writer_view_owner',true,'-','1faec916f592851d25e78b6af91c04e4'),
      ('global_pdf_library','owner_metrics_global_pdfs_select','r','cocinacore_metrics_view_owner',true,'b326b5062b2f0e69046810717534cb09','-'),
      ('global_pdf_library','runtime_global_pdfs_select','r','cocinacore_runtime_rls',true,'b326b5062b2f0e69046810717534cb09','-'),
      ('inventory_movements','movement_runtime_insert','a','cocinacore_runtime_rls',true,'-','63c84a0c0bb6d73f93f3d10c744dd228'),
      ('inventory_movements','movement_runtime_select','r','cocinacore_runtime_rls',true,'829d9f9e024fc71e3402c48f18fe5ec6','-'),
      ('meal_consumption_claims','meal_consumption_claims_tenant_user_isolation','*','PUBLIC',true,'bf41ec2e206efb5da99b73a8ce7279d3','bf41ec2e206efb5da99b73a8ce7279d3'),
      ('platform_owners','owner_metrics_platform_owners_select','r','cocinacore_metrics_view_owner',true,'b326b5062b2f0e69046810717534cb09','-'),
      ('platform_owners','runtime_platform_owners_self_select','r','cocinacore_runtime_rls',true,'9c2cfb07a30d07b070aa20a4c06f84b6','-'),
      ('premium_review_reports','owner_metrics_reports_select','r','cocinacore_metrics_view_owner',true,'b326b5062b2f0e69046810717534cb09','-'),
      ('premium_review_reports','runtime_owner_premium_reports_select','r','cocinacore_runtime_rls',true,'5d656339b8672845d2bd61b5d9dba285','-'),
      ('real_consumption_items','real_consumption_items_tenant_user_isolation','*','PUBLIC',true,'bf41ec2e206efb5da99b73a8ce7279d3','bf41ec2e206efb5da99b73a8ce7279d3'),
      ('real_consumption_movement_links','real_consumption_movement_links_tenant_user_isolation','*','PUBLIC',true,'bf41ec2e206efb5da99b73a8ce7279d3','bf41ec2e206efb5da99b73a8ce7279d3'),
      ('real_consumption_operations','real_consumption_operations_tenant_user_isolation','*','PUBLIC',true,'bf41ec2e206efb5da99b73a8ce7279d3','bf41ec2e206efb5da99b73a8ce7279d3'),
      ('real_consumption_substitutions','real_consumption_substitutions_tenant_user_isolation','*','PUBLIC',true,'bf41ec2e206efb5da99b73a8ce7279d3','bf41ec2e206efb5da99b73a8ce7279d3'),
      ('recipe_ai_history','recipe_history_owner_delete','d','cocinacore_runtime_rls',true,'f495ef31db17e1d330c154a7568001f4','-'),
      ('recipe_ai_history','recipe_history_owner_insert','a','cocinacore_runtime_rls',true,'-','f495ef31db17e1d330c154a7568001f4'),
      ('recipe_ai_history','recipe_history_owner_update','w','cocinacore_runtime_rls',true,'f495ef31db17e1d330c154a7568001f4','f495ef31db17e1d330c154a7568001f4'),
      ('recipe_ai_history','recipe_history_tenant_select','r','cocinacore_runtime_rls',true,'049b61188bb1ee07a817bc83960a81f7','-'),
      ('recipe_inventory_items','inventory_runtime_delete','d','cocinacore_runtime_rls',true,'139432e3cc4bcc218275a33771c21a79','-'),
      ('recipe_inventory_items','inventory_runtime_insert','a','cocinacore_runtime_rls',true,'-','57ee3d2f55ce7add5bb05106d460f7de'),
      ('recipe_inventory_items','inventory_runtime_select','r','cocinacore_runtime_rls',true,'139432e3cc4bcc218275a33771c21a79','-'),
      ('recipe_inventory_items','inventory_runtime_update','w','cocinacore_runtime_rls',true,'139432e3cc4bcc218275a33771c21a79','139432e3cc4bcc218275a33771c21a79'),
      ('shopping_list_items','shopping_list_owner_delete','d','cocinacore_runtime_rls',true,'f495ef31db17e1d330c154a7568001f4','-'),
      ('shopping_list_items','shopping_list_owner_insert','a','cocinacore_runtime_rls',true,'-','f495ef31db17e1d330c154a7568001f4'),
      ('shopping_list_items','shopping_list_owner_select','r','cocinacore_runtime_rls',true,'f495ef31db17e1d330c154a7568001f4','-'),
      ('shopping_list_items','shopping_list_owner_update','w','cocinacore_runtime_rls',true,'f495ef31db17e1d330c154a7568001f4','f495ef31db17e1d330c154a7568001f4'),
      ('tenant_books','documents_tenant_books_delete','d','cocinacore_runtime_rls',true,'049b61188bb1ee07a817bc83960a81f7','-'),
      ('tenant_books','documents_tenant_books_select','r','cocinacore_runtime_rls',true,'049b61188bb1ee07a817bc83960a81f7','-'),
      ('tenant_invitations','tenant_invitations_runtime_select','r','cocinacore_runtime_rls',true,'049b61188bb1ee07a817bc83960a81f7','-'),
      ('tenant_memberships','identity_auth_membership_insert','a','cocinacore_auth',true,'-','58562a0d6b68a2566468ae99509b86f4'),
      ('tenant_memberships','identity_memberships_read','r','cocinacore_runtime_rls',true,'2785c7d2a02276201066b47944f808a1','-'),
      ('tenant_memberships','identity_probe_memberships','r','cocinacore_identity_probe',true,'c37f28a891160223cf64cb92fee37152','-'),
      ('tenant_memberships','signup_bootstrap_memberships_insert','a','cocinacore_signup_bootstrap',true,'-','21603c513e869db33e8949609c606a1d'),
      ('tenant_pdf_library','documents_tenant_pdfs_delete','d','cocinacore_runtime_rls',true,'1deacc6991bf727baedd33eecb9377b6','-'),
      ('tenant_pdf_library','documents_tenant_pdfs_select','r','cocinacore_runtime_rls',true,'1deacc6991bf727baedd33eecb9377b6','-'),
      ('tenants','identity_auth_tenants_insert','a','cocinacore_auth',true,'-','b326b5062b2f0e69046810717534cb09'),
      ('tenants','identity_auth_tenants_read','r','cocinacore_auth',true,'b326b5062b2f0e69046810717534cb09','-'),
      ('tenants','identity_tenants_read','r','cocinacore_runtime_rls',true,'8663c2b7582c099ed48444ddc50aeca7','-'),
      ('tenants','identity_tenants_currency_update','w','cocinacore_runtime_rls',true,'fe3805101395393c82392febd2d8470e','fe3805101395393c82392febd2d8470e'),
      ('tenants','owner_metrics_tenants_select','r','cocinacore_metrics_view_owner',true,'b326b5062b2f0e69046810717534cb09','-'),
      ('tenants','signup_bootstrap_tenants_insert','a','cocinacore_signup_bootstrap',true,'-','b326b5062b2f0e69046810717534cb09'),
      ('tenants','signup_bootstrap_tenants_read','r','cocinacore_signup_bootstrap',true,'b326b5062b2f0e69046810717534cb09','-'),
      ('user_culinary_profile_terms','culinary_profile_terms_owner_delete','d','cocinacore_runtime_rls',true,'aba4f0fccfd39ad88a8cc59375686359','-'),
      ('user_culinary_profile_terms','culinary_profile_terms_owner_insert','a','cocinacore_runtime_rls',true,'-','aba4f0fccfd39ad88a8cc59375686359'),
      ('user_culinary_profile_terms','culinary_profile_terms_owner_select','r','cocinacore_runtime_rls',true,'aba4f0fccfd39ad88a8cc59375686359','-'),
      ('user_culinary_profiles','culinary_profile_owner_insert','a','cocinacore_runtime_rls',true,'-','928bd4d7aa316f5d9af3b070ae6625e4'),
      ('user_culinary_profiles','culinary_profile_owner_select','r','cocinacore_runtime_rls',true,'928bd4d7aa316f5d9af3b070ae6625e4','-'),
      ('user_culinary_profiles','culinary_profile_owner_update','w','cocinacore_runtime_rls',true,'928bd4d7aa316f5d9af3b070ae6625e4','928bd4d7aa316f5d9af3b070ae6625e4'),
      ('user_meal_plans','meal_plan_owner_insert','a','cocinacore_runtime_rls',true,'-','f495ef31db17e1d330c154a7568001f4'),
      ('user_meal_plans','meal_plan_owner_select','r','cocinacore_runtime_rls',true,'f495ef31db17e1d330c154a7568001f4','-'),
      ('user_meal_plans','meal_plan_owner_update','w','cocinacore_runtime_rls',true,'f495ef31db17e1d330c154a7568001f4','f495ef31db17e1d330c154a7568001f4'),
      ('user_recipe_versions','user_recipe_versions_tenant_user_isolation','*','PUBLIC',true,'bf41ec2e206efb5da99b73a8ce7279d3','bf41ec2e206efb5da99b73a8ce7279d3'),
      ('user_recipes','user_recipes_tenant_user_isolation','*','PUBLIC',true,'bf41ec2e206efb5da99b73a8ce7279d3','bf41ec2e206efb5da99b73a8ce7279d3'),
      ('users','identity_auth_users_insert','a','cocinacore_auth',true,'-','b326b5062b2f0e69046810717534cb09'),
      ('users','identity_auth_users_read','r','cocinacore_auth',true,'b326b5062b2f0e69046810717534cb09','-'),
      ('users','identity_auth_users_update','w','cocinacore_auth',true,'b326b5062b2f0e69046810717534cb09','b326b5062b2f0e69046810717534cb09'),
      ('users','identity_probe_users','r','cocinacore_identity_probe',true,'bbff2be2eae4e15a233c59e536f8461f','-'),
      ('users','identity_users_read','r','cocinacore_runtime_rls',true,'6b335f66fa8463708d4e1a9d5d5b12cc','-'),
      ('users','identity_users_update','w','cocinacore_runtime_rls',true,'3b59a39dcf3fed953adc7f0cc90a6308','3b59a39dcf3fed953adc7f0cc90a6308'),
      ('users','owner_metrics_users_select','r','cocinacore_metrics_view_owner',true,'b326b5062b2f0e69046810717534cb09','-'),
      ('users','signup_bootstrap_users_insert','a','cocinacore_signup_bootstrap',true,'-','21603c513e869db33e8949609c606a1d'),
      ('users','signup_bootstrap_users_read','r','cocinacore_signup_bootstrap',true,'b326b5062b2f0e69046810717534cb09','-')
  ), expected_oids AS (
    SELECT e.tbl,e.pol,e.cmd,CASE WHEN e.role_name='PUBLIC' THEN 0::oid ELSE r.oid END AS role_oid,
      e.permissive,e.qual_hash,e.check_hash
    FROM expected e LEFT JOIN pg_catalog.pg_roles r ON r.rolname=e.role_name AND e.role_name<>'PUBLIC'
  ), actual AS (
    SELECT c.relname::text,p.polname::text,p.polcmd::text,
      CASE WHEN cardinality(p.polroles)=1 THEN p.polroles[1] END AS role_oid,
      p.polpermissive,COALESCE(pg_catalog.md5(pg_catalog.pg_get_expr(p.polqual,p.polrelid)),'-'),
      COALESCE(pg_catalog.md5(pg_catalog.pg_get_expr(p.polwithcheck,p.polrelid)),'-')
    FROM pg_catalog.pg_policy p JOIN pg_catalog.pg_class c ON c.oid=p.polrelid
    JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public'
      AND NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_roles function_owner
         WHERE function_owner.rolname='cocinacore_first_admin_function_owner'
           AND cardinality(p.polroles)=1 AND p.polroles[1]=function_owner.oid
      )
      AND NOT (c.relname='schema_migrations' AND p.polname='schema_migrations_runtime_select')
  ), differences AS (
    (SELECT * FROM expected_oids EXCEPT SELECT * FROM actual)
    UNION ALL
    (SELECT * FROM actual EXCEPT SELECT * FROM expected_oids)
  )
  SELECT NOT EXISTS (SELECT 1 FROM differences) AND (SELECT count(*)=72 FROM actual)
  INTO valid;
  IF valid IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'ACTIVATED_CAPABILITIES_024_INVENTORY_POLICY_MISMATCH';
  END IF;

  -- Provisioning may add this control-plane policy after migration activation.
  -- It is optional here, but if present must be the exact SELECT-only runtime rule.
  IF EXISTS (
    SELECT 1
      FROM pg_catalog.pg_policy p
      JOIN pg_catalog.pg_class c ON c.oid=p.polrelid
      JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
     WHERE n.nspname='public' AND c.relname='schema_migrations'
       AND p.polname='schema_migrations_runtime_select'
       AND (p.polcmd<>'r' OR p.polpermissive IS NOT TRUE
         OR cardinality(p.polroles)<>1
         OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles r
                         WHERE r.rolname='cocinacore_user' AND p.polroles[1]=r.oid)
         OR pg_catalog.pg_get_expr(p.polqual,p.polrelid) IS DISTINCT FROM 'true'
         OR p.polwithcheck IS NOT NULL)
  ) THEN
    RAISE EXCEPTION 'ACTIVATED_CAPABILITIES_024_INVENTORY_LEDGER_POLICY_MISMATCH';
  END IF;

  IF (SELECT count(*) FROM pg_catalog.pg_attribute a WHERE a.attrelid='public.owner_global_metrics'::pg_catalog.regclass
      AND a.attnum>0 AND NOT a.attisdropped)<>7
     OR EXISTS (
       WITH expected(attname) AS (VALUES ('tenants'),('users'),('books'),('pdfs'),('chunks'),('reports'),('owners')),
       actual AS (SELECT a.attname::text FROM pg_catalog.pg_attribute a
         WHERE a.attrelid='public.owner_global_metrics'::pg_catalog.regclass AND a.attnum>0 AND NOT a.attisdropped)
       SELECT 1 FROM ((SELECT * FROM expected EXCEPT SELECT * FROM actual)
         UNION ALL (SELECT * FROM actual EXCEPT SELECT * FROM expected)) d
     ) OR EXISTS (SELECT 1 FROM pg_catalog.pg_attribute a
       WHERE a.attrelid='public.owner_global_metrics'::pg_catalog.regclass AND a.attnum>0 AND NOT a.attisdropped
       AND pg_catalog.format_type(a.atttypid,a.atttypmod)<>'bigint') THEN
    RAISE EXCEPTION 'ACTIVATED_CAPABILITIES_METRICS_SHAPE_MISMATCH';
  END IF;

  -- Signup's legacy direct INSERT path is permanently denied after the C1 policy set.
  IF pg_catalog.has_table_privilege('cocinacore_auth','public.tenants','INSERT')
     OR pg_catalog.has_any_column_privilege('cocinacore_auth','public.tenants','INSERT')
     OR pg_catalog.has_table_privilege('cocinacore_auth','public.users','INSERT')
     OR pg_catalog.has_any_column_privilege('cocinacore_auth','public.users','INSERT')
     OR pg_catalog.has_table_privilege('cocinacore_auth','public.tenant_memberships','INSERT')
     OR pg_catalog.has_any_column_privilege('cocinacore_auth','public.tenant_memberships','INSERT') THEN
    RAISE EXCEPTION 'ACTIVATED_CAPABILITIES_AUTH_DIRECT_INSERT';
  END IF;
  IF pg_catalog.has_column_privilege('cocinacore_runtime_rls','public.users','password_hash','SELECT')
     OR pg_catalog.has_table_privilege('cocinacore_runtime_rls','public.sessions','SELECT')
     OR pg_catalog.has_table_privilege('cocinacore_runtime_rls','public.password_reset_tokens','SELECT') THEN
    RAISE EXCEPTION 'ACTIVATED_CAPABILITIES_SENSITIVE_RUNTIME_ACCESS';
  END IF;

  -- Runtime's table and column grants must match the reviewed provisioner contract exactly.
  WITH expected(relname,privilege_type,is_grantable) AS (VALUES
    ('tenants','SELECT',false),('tenant_memberships','SELECT',false),('platform_owners','SELECT',false),
    ('global_books','SELECT',false),('global_pdf_library','SELECT',false),
    ('tenant_books','SELECT',false),('tenant_books','DELETE',false),
    ('tenant_pdf_library','SELECT',false),('tenant_pdf_library','DELETE',false),
    ('book_chunks','SELECT',false),('book_chunks','INSERT',false),
    ('recipe_inventory_items','SELECT',false),('recipe_inventory_items','INSERT',false),('recipe_inventory_items','DELETE',false),
    ('inventory_movements','SELECT',false),('inventory_movements','INSERT',false),
    ('recipe_ai_history','SELECT',false),('recipe_ai_history','INSERT',false),('recipe_ai_history','UPDATE',false),('recipe_ai_history','DELETE',false),
    ('user_meal_plans','SELECT',false),('user_meal_plans','INSERT',false),('user_meal_plans','UPDATE',false),
    ('shopping_list_items','SELECT',false),('shopping_list_items','INSERT',false),('shopping_list_items','UPDATE',false),('shopping_list_items','DELETE',false),
    ('culinary_dimensions','SELECT',false),('culinary_terms','SELECT',false),
    ('user_culinary_profiles','SELECT',false),('user_culinary_profiles','INSERT',false),
    ('user_culinary_profile_terms','SELECT',false),('user_culinary_profile_terms','INSERT',false),('user_culinary_profile_terms','DELETE',false),
    ('premium_review_reports','SELECT',false),
    ('user_recipes','SELECT',false),('user_recipes','INSERT',false),('user_recipes','UPDATE',false),
    ('user_recipe_versions','SELECT',false),('user_recipe_versions','INSERT',false),
    ('cooking_sessions','SELECT',false),('cooking_sessions','INSERT',false),('cooking_sessions','UPDATE',false),
    ('cooking_session_events','SELECT',false),('cooking_session_events','INSERT',false),
    ('real_consumption_operations','SELECT',false),('real_consumption_operations','INSERT',false),
    ('meal_consumption_claims','SELECT',false),('meal_consumption_claims','INSERT',false),
    ('real_consumption_items','SELECT',false),('real_consumption_items','INSERT',false),
    ('real_consumption_substitutions','SELECT',false),('real_consumption_substitutions','INSERT',false),
    ('real_consumption_movement_links','SELECT',false),('real_consumption_movement_links','INSERT',false)
  ), actual AS (
    SELECT c.relname::text,a.privilege_type::text,a.is_grantable
    FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
    CROSS JOIN LATERAL pg_catalog.aclexplode(c.relacl) a
    WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m','f')
      AND a.grantee=(SELECT oid FROM pg_catalog.pg_roles WHERE rolname='cocinacore_runtime_rls')
      AND NOT (c.relname='runtime_identity_probe' AND a.privilege_type='SELECT' AND NOT a.is_grantable)
  ), diff AS (
    (SELECT * FROM expected EXCEPT SELECT * FROM actual)
    UNION ALL
    (SELECT * FROM actual EXCEPT SELECT * FROM expected)
  )
  SELECT NOT EXISTS (SELECT 1 FROM diff) AND (SELECT count(*)=55 FROM expected),
    (SELECT string_agg(pg_catalog.row_to_json(d)::text, ',') FROM diff d)
    INTO valid,runtime_acl_diff;
  IF valid IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'ACTIVATED_CAPABILITIES_RUNTIME_ACL_MISMATCH: %', COALESCE(runtime_acl_diff,'fixed table grant count mismatch');
  END IF;

  WITH expected(relname,column_name,privilege_type,is_grantable) AS (VALUES
    ('users','id','SELECT',false),('users','email','SELECT',false),('users','email_confirmed','SELECT',false),
    ('users','full_name','SELECT',false),('users','tenant_id','SELECT',false),('users','role','SELECT',false),
    ('users','terms_accepted_at','SELECT',false),('users','terms_version','SELECT',false),
    ('users','onboarding_completed','SELECT',false),('users','created_at','SELECT',false),('users','updated_at','SELECT',false),
    ('users','full_name','UPDATE',false),('users','onboarding_completed','UPDATE',false),('users','updated_at','UPDATE',false),
    ('recipe_inventory_items','ingredient_name','UPDATE',false),('recipe_inventory_items','quantity','UPDATE',false),
    ('recipe_inventory_items','unit','UPDATE',false),('recipe_inventory_items','category','UPDATE',false),
    ('recipe_inventory_items','expiration_date','UPDATE',false),('recipe_inventory_items','estimated_unit_price','UPDATE',false),
    ('recipe_inventory_items','purchase_location','UPDATE',false),('recipe_inventory_items','low_stock_threshold','UPDATE',false),
    ('recipe_inventory_items','normalized_name','UPDATE',false),('recipe_inventory_items','notes','UPDATE',false),
    ('recipe_inventory_items','updated_at','UPDATE',false),
    ('tenants','currency_code','UPDATE',false),
    ('recipe_inventory_items','price_currency','UPDATE',false),
    ('recipe_inventory_items','price_reference_quantity','UPDATE',false),
    ('recipe_inventory_items','price_reference_unit','UPDATE',false),
    ('user_culinary_profiles','level','UPDATE',false),('user_culinary_profiles','available_time_minutes','UPDATE',false),
    ('user_culinary_profiles','disliked_ingredients','UPDATE',false),('user_culinary_profiles','allergies','UPDATE',false),
    ('user_culinary_profiles','household_members','UPDATE',false),('user_culinary_profiles','updated_at','UPDATE',false),
    ('tenant_invitations','id','SELECT',false),('tenant_invitations','tenant_id','SELECT',false),
    ('tenant_invitations','email','SELECT',false),('tenant_invitations','status','SELECT',false),
    ('tenant_invitations','expires_at','SELECT',false),('tenant_invitations','created_at','SELECT',false)
  ), actual AS (
    SELECT c.relname::text,col.attname::text,a.privilege_type::text,a.is_grantable
    FROM pg_catalog.pg_attribute col JOIN pg_catalog.pg_class c ON c.oid=col.attrelid
    JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
    CROSS JOIN LATERAL pg_catalog.aclexplode(col.attacl) a
    WHERE n.nspname='public' AND col.attnum>0 AND NOT col.attisdropped
      AND a.grantee=(SELECT oid FROM pg_catalog.pg_roles WHERE rolname='cocinacore_runtime_rls')
  ), diff AS (
    (SELECT * FROM expected EXCEPT SELECT * FROM actual)
    UNION ALL
    (SELECT * FROM actual EXCEPT SELECT * FROM expected)
  )
  SELECT NOT EXISTS (SELECT 1 FROM diff) AND (SELECT count(*)=41 FROM expected),
    (SELECT string_agg(pg_catalog.row_to_json(d)::text, ',') FROM diff d)
    INTO valid,runtime_column_acl_diff;
  IF valid IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'ACTIVATED_CAPABILITIES_RUNTIME_COLUMN_ACL_MISMATCH: %', COALESCE(runtime_column_acl_diff,'fixed column grant count mismatch');
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
    CROSS JOIN LATERAL pg_catalog.aclexplode(c.relacl) a
    WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m','f') AND a.grantee=0
  ) OR EXISTS (
    SELECT 1 FROM pg_catalog.pg_attribute col JOIN pg_catalog.pg_class c ON c.oid=col.attrelid
    JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
    CROSS JOIN LATERAL pg_catalog.aclexplode(col.attacl) a
    WHERE n.nspname='public' AND col.attnum>0 AND NOT col.attisdropped AND a.grantee=0
  ) OR EXISTS (
    SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
    CROSS JOIN LATERAL pg_catalog.aclexplode(c.relacl) a
    WHERE n.nspname='public' AND c.relkind='S'
      AND a.grantee=(SELECT oid FROM pg_catalog.pg_roles WHERE rolname='cocinacore_runtime_rls')
  ) OR NOT pg_catalog.has_database_privilege('cocinacore_runtime_rls',current_database(),'CONNECT')
    OR pg_catalog.has_database_privilege('cocinacore_runtime_rls',current_database(),'CREATE')
    OR pg_catalog.has_database_privilege('cocinacore_runtime_rls',current_database(),'TEMP')
    OR NOT pg_catalog.has_schema_privilege('cocinacore_runtime_rls','public','USAGE')
    OR pg_catalog.has_schema_privilege('cocinacore_runtime_rls','public','CREATE')
    OR EXISTS (SELECT 1 FROM pg_catalog.pg_namespace n WHERE n.nspname NOT IN ('pg_catalog','information_schema','public')
      AND pg_catalog.has_schema_privilege('cocinacore_runtime_rls',n.oid,'USAGE')) THEN
    RAISE EXCEPTION 'ACTIVATED_CAPABILITIES_RUNTIME_BOUNDARY_MISMATCH';
  END IF;

  -- No app LOGIN may read the guard directly or receive any unexpected capability ACL.
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles l WHERE l.rolcanlogin AND NOT l.rolsuper AND (
      (l.rolname<>'cocinacore_runtime_rls' AND (pg_catalog.has_table_privilege(l.oid,'public.runtime_identity_probe','SELECT') OR pg_catalog.has_any_column_privilege(l.oid,'public.runtime_identity_probe','SELECT')))
      OR (l.rolname<>'cocinacore_owner_metrics' AND (pg_catalog.has_table_privilege(l.oid,'public.owner_global_metrics','SELECT') OR pg_catalog.has_any_column_privilege(l.oid,'public.owner_global_metrics','SELECT')))
      OR pg_catalog.has_table_privilege(l.oid,'public.owner_metrics_rls_guard','SELECT')
      OR pg_catalog.has_any_column_privilege(l.oid,'public.owner_metrics_rls_guard','SELECT')
      OR (l.rolname<>'cocinacore_global_writer' AND EXISTS (
        SELECT 1 FROM pg_catalog.pg_class v WHERE v.oid IN (
          'public.owner_write_global_books'::pg_catalog.regclass,
          'public.owner_write_global_pdfs'::pg_catalog.regclass,
          'public.owner_write_global_chunks'::pg_catalog.regclass)
          AND (pg_catalog.has_table_privilege(l.oid,v.oid,'INSERT') OR pg_catalog.has_any_column_privilege(l.oid,v.oid,'INSERT'))))
    )
  ) THEN RAISE EXCEPTION 'ACTIVATED_CAPABILITIES_LOGIN_BOUNDARY_MISMATCH'; END IF;

  -- Direct source-table access belongs only to the fixed NOLOGIN view owners.
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles l WHERE l.rolname IN ('cocinacore_owner_metrics','cocinacore_global_writer')
      AND EXISTS (SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='public' AND c.relkind IN ('r','p','f')
          AND (pg_catalog.has_table_privilege(l.oid,c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
            OR pg_catalog.has_any_column_privilege(l.oid,c.oid,'SELECT,INSERT,UPDATE,REFERENCES')))
  ) THEN RAISE EXCEPTION 'ACTIVATED_CAPABILITIES_LOGIN_BASE_TABLE_ACCESS'; END IF;

  -- The RAG helper remains invoker-only and unavailable to the application roles/PUBLIC.
  IF pg_catalog.to_regprocedure('public.match_chunks(vector,double precision,integer,uuid)') IS NULL
     OR (SELECT p.prosecdef FROM pg_catalog.pg_proc p WHERE p.oid=pg_catalog.to_regprocedure('public.match_chunks(vector,double precision,integer,uuid)'))
     OR pg_catalog.has_function_privilege('public','public.match_chunks(vector,double precision,integer,uuid)','EXECUTE')
     OR pg_catalog.has_function_privilege('cocinacore_runtime_rls','public.match_chunks(vector,double precision,integer,uuid)','EXECUTE')
     OR pg_catalog.has_function_privilege('cocinacore_auth','public.match_chunks(vector,double precision,integer,uuid)','EXECUTE')
     OR pg_catalog.has_function_privilege('cocinacore_owner_metrics','public.match_chunks(vector,double precision,integer,uuid)','EXECUTE')
     OR pg_catalog.has_function_privilege('cocinacore_global_writer','public.match_chunks(vector,double precision,integer,uuid)','EXECUTE') THEN
    RAISE EXCEPTION 'ACTIVATED_CAPABILITIES_RAG_EXECUTE_MISMATCH';
  END IF;

  -- D5 keeps invitation access to exactly the six summary columns.
  IF pg_catalog.has_table_privilege('cocinacore_runtime_rls','public.tenant_invitations','SELECT')
     OR (SELECT count(*) FROM pg_catalog.pg_attribute a WHERE a.attrelid='public.tenant_invitations'::pg_catalog.regclass
        AND a.attnum>0 AND NOT a.attisdropped AND pg_catalog.has_column_privilege('cocinacore_runtime_rls',a.attrelid,a.attnum,'SELECT'))<>6
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_attribute a WHERE a.attrelid='public.tenant_invitations'::pg_catalog.regclass
        AND a.attnum>0 AND NOT a.attisdropped AND a.attname NOT IN ('id','tenant_id','email','status','expires_at','created_at')
        AND pg_catalog.has_column_privilege('cocinacore_runtime_rls',a.attrelid,a.attnum,'SELECT')) THEN
    RAISE EXCEPTION 'ACTIVATED_CAPABILITIES_INVITATION_PROJECTION_MISMATCH';
  END IF;

  -- All direct ACL entries on the seven independently-owned capability objects
  -- are owner grants or a subset of the fixed activation allowlist.
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
      CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(c.relacl,pg_catalog.acldefault('r',c.relowner))) a
      LEFT JOIN pg_catalog.pg_roles g ON g.oid=a.grantee
     WHERE n.nspname='public' AND c.relname IN ('runtime_identity_probe','owner_metrics_rls_guard','owner_global_metrics',
        'owner_write_global_books','owner_write_global_pdfs','owner_write_global_chunks')
       AND a.grantee<>c.relowner
       AND NOT (g.rolname='cocinacore_runtime_rls' AND c.relname='runtime_identity_probe' AND a.privilege_type='SELECT' AND NOT a.is_grantable AND a.grantor=c.relowner)
       AND NOT (g.rolname='cocinacore_owner_metrics' AND c.relname='owner_global_metrics' AND a.privilege_type='SELECT' AND NOT a.is_grantable AND a.grantor=c.relowner)
       AND NOT (g.rolname='cocinacore_global_writer' AND c.relname IN ('owner_write_global_books','owner_write_global_pdfs','owner_write_global_chunks') AND a.privilege_type='INSERT' AND NOT a.is_grantable AND a.grantor=c.relowner)
  ) OR EXISTS (
    SELECT 1 FROM pg_catalog.pg_attribute col JOIN pg_catalog.pg_class c ON c.oid=col.attrelid
      CROSS JOIN LATERAL pg_catalog.aclexplode(col.attacl) a LEFT JOIN pg_catalog.pg_roles g ON g.oid=a.grantee
     WHERE c.oid IN ('public.runtime_identity_probe'::pg_catalog.regclass,'public.owner_metrics_rls_guard'::pg_catalog.regclass,
        'public.owner_global_metrics'::pg_catalog.regclass,'public.owner_write_global_books'::pg_catalog.regclass,
        'public.owner_write_global_pdfs'::pg_catalog.regclass,'public.owner_write_global_chunks'::pg_catalog.regclass)
       AND a.grantee<>c.relowner
       AND NOT (g.rolname='cocinacore_global_writer' AND c.relname='owner_write_global_books' AND col.attname='id'
          AND a.privilege_type='SELECT' AND NOT a.is_grantable AND a.grantor=c.relowner)
  ) THEN RAISE EXCEPTION 'ACTIVATED_CAPABILITIES_VIEW_ACL_MISMATCH'; END IF;

  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc p CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(p.proacl,pg_catalog.acldefault('f',p.proowner))) a
      LEFT JOIN pg_catalog.pg_roles g ON g.oid=a.grantee
     WHERE p.oid='public.signup_new_account(text,text,text,timestamptz,text)'::pg_catalog.regprocedure
       AND a.grantee<>p.proowner
       AND NOT (g.rolname='cocinacore_auth' AND a.privilege_type='EXECUTE' AND NOT a.is_grantable AND a.grantor=p.proowner)
  ) OR pg_catalog.has_function_privilege('public','public.signup_new_account(text,text,text,timestamptz,text)','EXECUTE')
    OR EXISTS (SELECT 1 FROM pg_catalog.pg_roles l WHERE l.rolcanlogin AND NOT l.rolsuper
       AND l.rolname<>'cocinacore_auth' AND pg_catalog.has_function_privilege(l.oid,
         'public.signup_new_account(text,text,text,timestamptz,text)','EXECUTE'))
  THEN RAISE EXCEPTION 'ACTIVATED_CAPABILITIES_SIGNUP_ACL_MISMATCH'; END IF;
  -- 021's columns must stay nullable without defaults; the price tuple's two
  -- validated CHECK constraints must retain their reviewed expressions.
  WITH expected(tbl,col,typ) AS (VALUES
    ('tenants','currency_code','text'),
    ('recipe_inventory_items','price_currency','text'),
    ('recipe_inventory_items','price_reference_quantity','numeric(12,4)'),
    ('recipe_inventory_items','price_reference_unit','text')
  ), actual AS (
    SELECT c.relname::text,a.attname::text,pg_catalog.format_type(a.atttypid,a.atttypmod) AS typ
      FROM pg_catalog.pg_attribute a JOIN pg_catalog.pg_class c ON c.oid=a.attrelid
      JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
      JOIN expected e ON e.tbl=c.relname AND e.col=a.attname
      WHERE n.nspname='public' AND a.attnum>0 AND NOT a.attisdropped
        AND NOT a.attnotnull AND NOT a.atthasdef AND a.attgenerated='' AND a.attidentity=''
  ) SELECT count(*)=4 AND NOT EXISTS (SELECT * FROM expected EXCEPT SELECT * FROM actual)
      INTO valid FROM actual;
  IF valid IS DISTINCT FROM true THEN RAISE EXCEPTION 'INVENTORY_021_COLUMN_MISMATCH'; END IF;

  WITH expected(tbl,con,definition_hash) AS (VALUES
    ('tenants','tenants_currency_code_check','9dd6d36e49e5e1bf773f88c07bc02594'),
    ('recipe_inventory_items','recipe_inventory_price_reference_check','1197f2a48a88c264e72c96e9a9a628d8')
  ), actual AS (
    SELECT c.relname::text,k.conname::text,pg_catalog.md5(pg_catalog.pg_get_constraintdef(k.oid))
      FROM pg_catalog.pg_constraint k JOIN pg_catalog.pg_class c ON c.oid=k.conrelid
      JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
      JOIN expected e ON e.tbl=c.relname AND e.con=k.conname
      WHERE n.nspname='public' AND k.contype='c' AND k.convalidated AND NOT k.connoinherit
  ) SELECT count(*)=2 AND NOT EXISTS (SELECT * FROM expected EXCEPT SELECT * FROM actual)
      INTO valid FROM actual;
  IF valid IS DISTINCT FROM true THEN RAISE EXCEPTION 'INVENTORY_021_CONSTRAINT_MISMATCH'; END IF;

  IF pg_catalog.has_table_privilege('cocinacore_runtime_rls','public.tenants','UPDATE')
     OR pg_catalog.has_column_privilege('cocinacore_runtime_rls','public.tenants','name','UPDATE')
     OR pg_catalog.has_column_privilege('cocinacore_auth','public.tenants','currency_code','UPDATE')
  THEN RAISE EXCEPTION 'INVENTORY_021_UNEXPECTED_WRITE_ACCESS'; END IF;

END
$activated_contract$;

SELECT CASE WHEN
  pg_catalog.has_function_privilege('cocinacore_auth','public.signup_new_account(text,text,text,timestamptz,text)','EXECUTE')
  AND pg_catalog.has_table_privilege('cocinacore_runtime_rls','public.runtime_identity_probe','SELECT')
  AND pg_catalog.has_table_privilege('cocinacore_owner_metrics','public.owner_global_metrics','SELECT')
  AND pg_catalog.has_table_privilege('cocinacore_global_writer','public.owner_write_global_books','INSERT')
  AND pg_catalog.has_table_privilege('cocinacore_global_writer','public.owner_write_global_pdfs','INSERT')
  AND pg_catalog.has_table_privilege('cocinacore_global_writer','public.owner_write_global_chunks','INSERT')
  AND pg_catalog.has_column_privilege('cocinacore_global_writer','public.owner_write_global_books','id','SELECT')
THEN 'active' ELSE 'pending' END AS activation_state;
