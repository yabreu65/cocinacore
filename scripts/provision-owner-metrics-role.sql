-- Candidate for explicitly authorized isolated databases only; not for shared production databases.
\set ON_ERROR_STOP on
\set ECHO none
\if :{?owner_metrics_password}
\else
  \echo 'owner_metrics_password is required'
  \quit 1
\endif
select length(:'owner_metrics_password') > 0 as valid_password \gset
\if :valid_password
\else
  \echo 'owner_metrics_password must not be empty'
  \quit 1
\endif
begin;
select pg_advisory_xact_lock(hashtextextended('cocinacore:provision-owner-metrics', 0));
do $$
declare r record; role_name text;
begin
  if not exists (select 1 from public.schema_migrations where filename = '019_real_consumption_reconciliation.sql') then
    raise exception 'Apply and verify migrations 001-019 first';
  end if;
  foreach role_name in array array['cocinacore_metrics_view_owner', 'cocinacore_owner_metrics'] loop
    select * into r from pg_roles where rolname = role_name;
    if found then
      if r.rolsuper or r.rolbypassrls or r.rolcreatedb or r.rolcreaterole or r.rolreplication
        or shobj_description(r.oid, 'pg_authid') is distinct from 'CocinaCore isolated metrics role v1'
        or exists (select 1 from pg_auth_members where member = r.oid or roleid = r.oid)
        or exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
                   where c.relowner = r.oid and (c.relname not in ('owner_global_metrics','owner_metrics_rls_guard') or n.nspname <> 'public')) then
        raise exception 'Refusing existing privileged or untrusted metrics role';
      end if;
    end if;
  end loop;
  -- Column ACLs survive table-level REVOKE; refuse unexpected inherited or direct grants.
  if exists (
    select 1 from pg_attribute a join pg_class c on c.oid = a.attrelid
    join pg_namespace n on n.oid = c.relnamespace
    cross join lateral aclexplode(a.attacl) acl
    where n.nspname = 'public' and (
      acl.grantee = 0 or
      (acl.grantee = (select oid from pg_roles where rolname = 'cocinacore_owner_metrics')) or
      (acl.grantee = (select oid from pg_roles where rolname = 'cocinacore_metrics_view_owner')
        and not (acl.privilege_type = 'SELECT' and (
          (c.relname in ('tenants', 'users', 'global_books', 'global_pdf_library', 'premium_review_reports') and a.attname = 'id')
          or (c.relname = 'platform_owners' and a.attname = 'user_id')
          or (c.relname = 'book_chunks' and a.attname in ('id', 'global_book_id'))
        )))
    )
  ) or exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    cross join lateral aclexplode(c.relacl) acl
    where n.nspname = 'public' and acl.grantee = 0
  ) then raise exception 'Unexpected PUBLIC or metrics column privileges'; end if;
  if to_regclass('public.owner_global_metrics') is not null and not exists (
    select 1 from pg_class c join pg_roles view_owner on view_owner.oid = c.relowner
    where c.oid = to_regclass('public.owner_global_metrics') and c.relkind = 'v'
      and view_owner.rolname = 'cocinacore_metrics_view_owner'
      and md5(pg_get_viewdef(c.oid,true)) in (
        'd9661b9fd079e6954af9d23c68b7ea94',
        '59035b254a488a1015d641a81cc928ff'
      )
  ) then raise exception 'Refusing untrusted existing metrics object'; end if;
  if to_regclass('public.owner_metrics_rls_guard') is not null and not exists (
    select 1 from pg_class c join pg_roles view_owner on view_owner.oid = c.relowner
    where c.oid = to_regclass('public.owner_metrics_rls_guard') and c.relkind = 'v'
      and view_owner.rolname = 'cocinacore_metrics_view_owner'
      and md5(pg_get_viewdef(c.oid,true)) = '8da147bc319c202a2ee4c8401c3d93ae'
  ) then raise exception 'Refusing untrusted owner metrics RLS guard'; end if;
  if to_regclass('public.owner_metrics_rls_guard') is not null and exists (
    select 1 from pg_class c cross join lateral aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) acl
    where c.oid=to_regclass('public.owner_metrics_rls_guard')
      and (acl.grantee<>(select oid from pg_roles where rolname='cocinacore_metrics_view_owner') or acl.is_grantable)
  ) then raise exception 'Unexpected owner metrics guard ACL'; end if;
  if (to_regclass('public.owner_global_metrics') is null and to_regclass('public.owner_metrics_rls_guard') is not null)
     or (to_regclass('public.owner_global_metrics') is not null
       and md5(pg_get_viewdef(to_regclass('public.owner_global_metrics'),true)) = 'd9661b9fd079e6954af9d23c68b7ea94'
       and to_regclass('public.owner_metrics_rls_guard') is not null)
     or (to_regclass('public.owner_global_metrics') is not null
       and md5(pg_get_viewdef(to_regclass('public.owner_global_metrics'),true)) = '59035b254a488a1015d641a81cc928ff'
       and to_regclass('public.owner_metrics_rls_guard') is null) then
    raise exception 'Refusing partial owner metrics RLS installation';
  end if;
end;
$$;
select 'create role cocinacore_metrics_view_owner nologin nosuperuser nobypassrls nocreatedb nocreaterole noinherit noreplication'
where not exists (select 1 from pg_roles where rolname = 'cocinacore_metrics_view_owner') \gexec
select 'create role cocinacore_owner_metrics login nosuperuser nobypassrls nocreatedb nocreaterole noinherit noreplication'
where not exists (select 1 from pg_roles where rolname = 'cocinacore_owner_metrics') \gexec
comment on role cocinacore_metrics_view_owner is 'CocinaCore isolated metrics role v1';
comment on role cocinacore_owner_metrics is 'CocinaCore isolated metrics role v1';
alter role cocinacore_metrics_view_owner reset all;
alter role cocinacore_owner_metrics reset all;
alter role cocinacore_metrics_view_owner nologin nosuperuser nobypassrls nocreatedb nocreaterole noinherit noreplication;
alter role cocinacore_owner_metrics login nosuperuser nobypassrls nocreatedb nocreaterole noinherit noreplication;
select format('alter role cocinacore_owner_metrics password %L', :'owner_metrics_password') \gexec
\unset owner_metrics_password
alter role cocinacore_owner_metrics set search_path = pg_catalog, public;
alter role cocinacore_owner_metrics set row_security = on;
revoke all privileges on schema public from cocinacore_metrics_view_owner, cocinacore_owner_metrics;
revoke all privileges on all tables in schema public from cocinacore_metrics_view_owner, cocinacore_owner_metrics;
revoke all privileges on all sequences in schema public from cocinacore_metrics_view_owner, cocinacore_owner_metrics;
revoke all privileges on all functions in schema public from cocinacore_metrics_view_owner, cocinacore_owner_metrics;
select format('revoke all privileges on database %I from cocinacore_owner_metrics', current_database()) \gexec
select format('grant connect on database %I to cocinacore_owner_metrics', current_database()) \gexec
grant usage on schema public to cocinacore_metrics_view_owner, cocinacore_owner_metrics;
grant select (id) on public.tenants, public.users, public.global_books, public.global_pdf_library, public.premium_review_reports to cocinacore_metrics_view_owner;
grant select (user_id) on public.platform_owners to cocinacore_metrics_view_owner;
grant select (id, global_book_id) on public.book_chunks to cocinacore_metrics_view_owner;
select 'grant select on public.owner_metrics_rls_guard to cocinacore_metrics_view_owner'
where to_regclass('public.owner_metrics_rls_guard') is not null \gexec
-- FORCE/ENABLE RLS requires a future reviewed metrics policy; never return partial counts.
do $$
begin
  if to_regclass('public.owner_global_metrics') is null then
    execute $view$create view public.owner_global_metrics as
with guard as (
  select coalesce(bool_or(c.relrowsecurity), true) as rls_enabled
  from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relname in ('tenants', 'users', 'global_books', 'global_pdf_library', 'book_chunks', 'premium_review_reports', 'platform_owners')
)
select
  case when guard.rls_enabled then null else (select count(id) from public.tenants) end as tenants,
  case when guard.rls_enabled then null else (select count(id) from public.users) end as users,
  case when guard.rls_enabled then null else (select count(id) from public.global_books) end as books,
  case when guard.rls_enabled then null else (select count(id) from public.global_pdf_library) end as pdfs,
  case when guard.rls_enabled then null else (select count(id) from public.book_chunks where global_book_id is not null) end as chunks,
  case when guard.rls_enabled then null else (select count(id) from public.premium_review_reports) end as reports,
  case when guard.rls_enabled then null else (select count(user_id) from public.platform_owners) end as owners
from guard;
    $view$;
  end if;
end
$$;
alter view public.owner_global_metrics owner to cocinacore_metrics_view_owner;
revoke all privileges on public.owner_global_metrics from public, cocinacore_runtime_rls, cocinacore_auth;
grant select on public.owner_global_metrics to cocinacore_owner_metrics;
commit;
\echo 'Provisioned isolated owner metrics candidate.'
