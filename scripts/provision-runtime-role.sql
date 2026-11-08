-- Run ONLY against an explicitly authorized, isolated database after migrations 001-019.
-- psql -X -v ON_ERROR_STOP=1 -v runtime_password="$PASSWORD" -d "$DB" -f this-file
-- The provisioner owns the schema/objects and can create roles. Never use this
-- script as DATABASE_URL's HTTP identity, or run it against a shared database.
-- Do not enable psql echo/query logging or shell tracing when supplying secrets.
\set ON_ERROR_STOP on
\set ECHO none
\if :{?runtime_password}
\else
  \echo 'runtime_password is required'
  \quit 1
\endif
select length(:'runtime_password') > 0 as runtime_password_present \gset
\if :runtime_password_present
\else
  \echo 'runtime_password must not be empty'
  \quit 1
\endif

begin;
-- Serialize repeated provisioning within this database.
select pg_advisory_xact_lock(hashtextextended('cocinacore:provision-runtime-role', 0));
do $$
declare
  runtime record;
begin
  if current_user = 'cocinacore_runtime_rls' then
    raise exception 'Use a separate provisioning identity';
  end if;
  if not exists (select 1 from public.schema_migrations
                  where filename = '019_real_consumption_reconciliation.sql') then
    raise exception 'Apply and verify migrations 001-019 before provisioning';
  end if;
  select * into runtime from pg_roles where rolname = 'cocinacore_runtime_rls';
  if found then
    if runtime.rolsuper or runtime.rolbypassrls or runtime.rolcreatedb
       or runtime.rolcreaterole or runtime.rolreplication
       or shobj_description(runtime.oid, 'pg_authid') is distinct from
          'CocinaCore isolated database runtime v1' then
      raise exception 'Refusing to repurpose an existing or privileged role';
    end if;
    if exists (select 1 from pg_auth_members
                where member = runtime.oid or roleid = runtime.oid)
       or exists (select 1 from pg_shdepend
                   where refclassid = 'pg_authid'::regclass
                     and refobjid = runtime.oid and deptype = 'o') then
      raise exception 'Runtime must have no memberships, members or owned objects';
    end if;
  end if;
  -- Table/column privileges inherited from PUBLIC cannot be denied to one role.
  -- Fail rather than silently widening the reviewed runtime matrix.
  if exists (
    select 1 from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    cross join lateral aclexplode(c.relacl) acl
    where n.nspname = 'public' and acl.grantee = 0
  ) or exists (
    select 1 from pg_attribute a
    join pg_class c on c.oid = a.attrelid
    join pg_namespace n on n.oid = c.relnamespace
    cross join lateral aclexplode(a.attacl) acl
    where n.nspname = 'public'
      and (
        acl.grantee = 0
        or (
          acl.grantee = (select oid from pg_roles where rolname = 'cocinacore_runtime_rls')
          and not (
            (c.relname = 'recipe_inventory_items' and acl.privilege_type = 'UPDATE' and a.attname in
              ('ingredient_name','quantity','unit','category','expiration_date','estimated_unit_price','purchase_location','low_stock_threshold','normalized_name','notes','updated_at'))
            or (c.relname = 'users' and (
              (acl.privilege_type = 'SELECT' and a.attname in
                ('id', 'email', 'email_confirmed', 'full_name', 'tenant_id', 'role',
                 'terms_accepted_at', 'terms_version', 'onboarding_completed', 'created_at', 'updated_at'))
              or (acl.privilege_type = 'UPDATE' and a.attname in
                ('full_name', 'onboarding_completed', 'updated_at'))
            ))
            or (c.relname = 'user_culinary_profiles' and acl.privilege_type = 'UPDATE' and a.attname in
              ('level', 'available_time_minutes', 'disliked_ingredients', 'allergies', 'household_members', 'updated_at'))
            or (c.relname = 'tenant_invitations' and acl.privilege_type = 'SELECT' and a.attname in
              ('id', 'tenant_id', 'email', 'status', 'expires_at', 'created_at'))
          )
        )
      )
  ) then
    raise exception 'Unexpected PUBLIC relation or runtime column privileges; review before provisioning';
  end if;
end;
$$;

select 'create role cocinacore_runtime_rls login nosuperuser nobypassrls '
       || 'nocreatedb nocreaterole noinherit noreplication'
where not exists (select 1 from pg_roles where rolname = 'cocinacore_runtime_rls')
\gexec
comment on role cocinacore_runtime_rls is 'CocinaCore isolated database runtime v1';
select format('alter role cocinacore_runtime_rls password %L', :'runtime_password')
\gexec
\unset runtime_password
alter role cocinacore_runtime_rls login nosuperuser nobypassrls
  nocreatedb nocreaterole noinherit noreplication;
alter role cocinacore_runtime_rls set search_path = pg_catalog, public;
alter role cocinacore_runtime_rls set row_security = on;

-- Database-local PUBLIC hardening is deliberate: PostgreSQL otherwise grants
-- TEMP to every login, and older installations grant CREATE on public as well.
-- This changes defaults for other logins in THIS isolated database, never roles
-- or privileges in other databases. Do not run on a shared service database.
select format('revoke create, temporary on database %I from public', current_database())
\gexec
revoke create on schema public from public;
select format('revoke all privileges on database %I from cocinacore_runtime_rls', current_database())
\gexec
revoke all privileges on schema public from cocinacore_runtime_rls;
revoke all privileges on all tables in schema public from cocinacore_runtime_rls;
revoke all privileges on all sequences in schema public from cocinacore_runtime_rls;
revoke all privileges on all functions in schema public from cocinacore_runtime_rls;
select format('grant connect on database %I to cocinacore_runtime_rls', current_database())
\gexec
grant usage on schema public to cocinacore_runtime_rls;

-- Candidate data runtime: authentication and session credentials use a separate role.
grant select on public.tenants to cocinacore_runtime_rls;
grant select (id, email, email_confirmed, full_name, tenant_id, role, terms_accepted_at,
  terms_version, onboarding_completed, created_at, updated_at) on public.users to cocinacore_runtime_rls;
grant update (full_name, onboarding_completed, updated_at) on public.users to cocinacore_runtime_rls;
grant select on public.tenant_memberships to cocinacore_runtime_rls;
grant select on public.platform_owners to cocinacore_runtime_rls;
-- Invitation tokens and acceptance metadata are not needed by read-only pages.
revoke select on public.tenant_invitations from cocinacore_runtime_rls;
revoke select (id, tenant_id, email, invited_by, role, invitation_token, status,
  expires_at, accepted_at, accepted_by, created_at) on public.tenant_invitations from cocinacore_runtime_rls;
grant select (id, tenant_id, email, status, expires_at, created_at)
  on public.tenant_invitations to cocinacore_runtime_rls;

-- LEGACY RLS GATE: these grants preserve current data-runtime compatibility but
-- are NOT a database tenant-isolation boundary. Do not treat this provisioner
-- as closing the legacy RLS finding until an additive migration proves policies
-- and auth/bootstrap compatibility with populated tenant A/B fixtures.
-- Owner-only PDF upload checks requireUser + approved platform owner first.
grant select on public.global_books to cocinacore_runtime_rls;
grant select on public.global_pdf_library to cocinacore_runtime_rls;
grant select, delete on public.tenant_books to cocinacore_runtime_rls;
grant select, delete on public.tenant_pdf_library to cocinacore_runtime_rls;
grant select, insert on public.book_chunks to cocinacore_runtime_rls;
grant select, insert, delete on public.recipe_inventory_items to cocinacore_runtime_rls;
grant update (ingredient_name, quantity, unit, category, expiration_date, estimated_unit_price, purchase_location, low_stock_threshold, normalized_name, notes, updated_at) on public.recipe_inventory_items to cocinacore_runtime_rls;
grant select, insert on public.inventory_movements to cocinacore_runtime_rls;
grant select, insert, update, delete on public.recipe_ai_history to cocinacore_runtime_rls;
grant select, insert, update on public.user_meal_plans to cocinacore_runtime_rls;
grant select, insert, update, delete on public.shopping_list_items to cocinacore_runtime_rls;
grant select on public.culinary_dimensions to cocinacore_runtime_rls;
grant select on public.culinary_terms to cocinacore_runtime_rls;
grant select, insert on public.user_culinary_profiles to cocinacore_runtime_rls;
grant update (level, available_time_minutes, disliked_ingredients, allergies,
  household_members, updated_at) on public.user_culinary_profiles to cocinacore_runtime_rls;
grant select, insert, delete on public.user_culinary_profile_terms to cocinacore_runtime_rls;
grant select on public.premium_review_reports to cocinacore_runtime_rls;

-- RLS tables: context must be transaction-local app.tenant_id + app.user_id.
-- Mutable aggregates are updated/archived, not deleted. Audit children and
-- recipe versions need SELECT/INSERT only. No TRUNCATE/REFERENCES/TRIGGER grants.
grant select, insert, update on public.user_recipes to cocinacore_runtime_rls;
grant select, insert on public.user_recipe_versions to cocinacore_runtime_rls;
grant select, insert, update on public.cooking_sessions to cocinacore_runtime_rls;
grant select, insert on public.cooking_session_events to cocinacore_runtime_rls;
grant select, insert on public.real_consumption_operations to cocinacore_runtime_rls;
grant select, insert on public.meal_consumption_claims to cocinacore_runtime_rls;
grant select, insert on public.real_consumption_items to cocinacore_runtime_rls;
grant select, insert on public.real_consumption_substitutions to cocinacore_runtime_rls;
grant select, insert on public.real_consumption_movement_links to cocinacore_runtime_rls;
-- No SQL HTTP consumer for recipe_ai_ratings, premium_recipes,
-- saved_premium_recipes, premium_recipe_reviews, meal-plan suggestions/snapshots.
-- No access to schema_migrations. All IDs use UUIDs; no sequence grants needed.

-- App functions default to PUBLIC EXECUTE in PostgreSQL. Revoke explicitly,
-- leaving extension functions (pgcrypto/vector) and pg_catalog untouched.
-- These are SECURITY INVOKER; no SECURITY DEFINER escape hatch is introduced.
revoke execute on function public.match_chunks(vector, double precision, integer, uuid) from public, cocinacore_runtime_rls;
revoke execute on function public.is_platform_owner(uuid) from public;
revoke execute on function public.remove_tenant_member(uuid, uuid) from public;
revoke execute on function public.update_tenant_member_role(uuid, uuid, text) from public;
revoke execute on function public.accept_tenant_invitation(uuid, text) from public;
revoke execute on function public.get_owner_overview_metrics() from public;
revoke execute on function public.approve_platform_owner(uuid) from public;
revoke execute on function public.is_valid_culinary_profile_text_list(text[], integer) from public;
revoke execute on function public.is_valid_culinary_household_members(jsonb) from public;
revoke execute on function public.enforce_culinary_profile_term_group_limit() from public;
revoke execute on function public.prevent_culinary_profile_taxonomy_reclassification() from public;
revoke execute on function public.enforce_user_recipe_version_invariants() from public;
revoke execute on function public.validate_real_consumption_substitution() from public;
revoke execute on function public.validate_real_consumption_movement_link() from public;
revoke execute on function public.reject_real_consumption_mutation() from public;
-- Triggers installed by migrations do not need runtime EXECUTE privilege.
grant execute on function public.is_valid_culinary_profile_text_list(text[], integer) to cocinacore_runtime_rls;
grant execute on function public.is_valid_culinary_household_members(jsonb) to cocinacore_runtime_rls;

commit;
\echo 'Provisioned cocinacore_runtime_rls in the connected database; no migration/runtime membership granted.'
