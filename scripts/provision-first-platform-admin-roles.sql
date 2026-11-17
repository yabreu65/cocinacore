-- Prepare the dedicated first-admin capability roles on one explicitly confirmed target.
-- Run interactively as a direct PostgreSQL superuser after verifying migrations 001-023.
-- \\password prompts without echo and sends only PostgreSQL's encrypted password.
\set ON_ERROR_STOP on
\set ECHO none

SELECT pg_catalog.current_database() AS target_database \gset
\echo 'Target database:' :target_database
\prompt 'Type the exact target database name to continue: ' target_confirmation
SELECT (:'target_confirmation' = :'target_database') AS target_confirmed \gset
\if :target_confirmed
\else
  \echo 'Target confirmation did not match; no roles were changed.'
  \quit 1
\endif

BEGIN;
DO $preflight$
DECLARE
  migration_count integer;
  last_migration text;
  direct_superuser boolean;
BEGIN
  SELECT session_user = current_user AND r.rolsuper
    INTO direct_superuser
    FROM pg_catalog.pg_roles r
   WHERE r.rolname = session_user;
  IF direct_superuser IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'FIRST_ADMIN_ROLE_SETUP_REQUIRES_DIRECT_SUPERUSER';
  END IF;

  SELECT count(*)::integer, max(filename)
    INTO migration_count, last_migration
    FROM public.schema_migrations;
  IF migration_count <> 23 OR last_migration <> '023_inventory_movement_retention.sql' THEN
    RAISE EXCEPTION 'FIRST_ADMIN_ROLE_SETUP_REQUIRES_VERIFIED_001_023';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles
     WHERE rolname = 'cocinacore_schema_owner'
       AND NOT rolcanlogin AND NOT rolsuper AND NOT rolbypassrls
       AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolreplication
  ) THEN
    RAISE EXCEPTION 'FIRST_ADMIN_SCHEMA_OWNER_REQUIRED';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles
     WHERE rolname IN ('cocinacore_first_admin_function_owner', 'cocinacore_first_admin_provisioner')
  ) THEN
    RAISE EXCEPTION 'FIRST_ADMIN_ROLES_ALREADY_EXIST_REFUSING_REUSE';
  END IF;
END
$preflight$;

CREATE ROLE cocinacore_first_admin_function_owner
  NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION;
COMMENT ON ROLE cocinacore_first_admin_function_owner IS 'CocinaCore first platform-admin function owner v1';
CREATE ROLE cocinacore_first_admin_provisioner
  LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION;
COMMENT ON ROLE cocinacore_first_admin_provisioner IS 'CocinaCore first platform-admin provisioner v1';
ALTER ROLE cocinacore_first_admin_provisioner SET search_path = pg_catalog, public;
ALTER ROLE cocinacore_first_admin_provisioner SET row_security = on;
GRANT USAGE ON SCHEMA public TO cocinacore_first_admin_function_owner, cocinacore_first_admin_provisioner;
SELECT pg_catalog.format('GRANT CONNECT ON DATABASE %I TO cocinacore_first_admin_provisioner', pg_catalog.current_database()) \gexec
GRANT cocinacore_first_admin_function_owner TO cocinacore_schema_owner WITH INHERIT FALSE, SET TRUE;

\password cocinacore_first_admin_provisioner

COMMIT;
\echo 'Prepared restricted first-platform-admin roles; no account or platform-owner row was created.'
