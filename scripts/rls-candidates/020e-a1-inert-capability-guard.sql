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
