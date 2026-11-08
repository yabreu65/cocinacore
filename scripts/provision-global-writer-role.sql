-- Candidate for explicitly authorized disposable databases only; never run on a shared database.
\set ON_ERROR_STOP on
\set ECHO none
\if :{?global_writer_password}
\else
  \echo 'global_writer_password is required'
  \quit 1
\endif
select length(:'global_writer_password') > 0 as valid_password \gset
\if :valid_password
\else
  \echo 'global_writer_password must not be empty'
  \quit 1
\endif
begin;
select pg_advisory_xact_lock(hashtextextended('cocinacore:provision-global-writer', 0));
do $$
declare
  r record;
  role_name text;
  role_count integer;
  writer_object_count integer;
begin
  if not exists (select 1 from public.schema_migrations where filename = '019_real_consumption_reconciliation.sql') then
    raise exception 'Apply and verify migrations 001-019 first';
  end if;
  select count(*) into role_count from pg_roles
   where rolname in ('cocinacore_global_writer_view_owner','cocinacore_global_writer');
  select count(*) into writer_object_count from pg_class c join pg_namespace n on n.oid=c.relnamespace
   where n.nspname='public'
     and c.relname in ('owner_write_global_books','owner_write_global_pdfs','owner_write_global_chunks');
  if not ((role_count=0 and writer_object_count=0) or (role_count=2 and writer_object_count=3)) then
    raise exception 'Refusing partial global writer role or view installation';
  end if;
  foreach role_name in array array['cocinacore_global_writer_view_owner', 'cocinacore_global_writer'] loop
    select * into r from pg_roles where rolname = role_name;
    if found and (r.rolsuper or r.rolbypassrls or r.rolcreatedb or r.rolcreaterole or r.rolreplication or r.rolinherit
      or r.rolcanlogin is distinct from (role_name = 'cocinacore_global_writer')
      or shobj_description(r.oid, 'pg_authid') is distinct from 'CocinaCore isolated global writer v1'
      or (role_name='cocinacore_global_writer' and not coalesce(
        cardinality(r.rolconfig)=2 and r.rolconfig @> array['row_security=on','search_path=pg_catalog, public'],false))
      or (role_name='cocinacore_global_writer_view_owner' and r.rolconfig is not null)
      or exists (select 1 from pg_auth_members where member = r.oid or roleid = r.oid)
      or exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
                 where c.relowner = r.oid and (n.nspname <> 'public' or c.relname not in
                   ('owner_write_global_books', 'owner_write_global_pdfs', 'owner_write_global_chunks') or c.relkind <> 'v')))
    then raise exception 'Refusing existing privileged or untrusted global writer role'; end if;
  end loop;
  if role_count=2 and (
    not has_database_privilege('cocinacore_global_writer',current_database(),'CONNECT')
    or has_database_privilege('cocinacore_global_writer',current_database(),'CREATE')
    or has_database_privilege('cocinacore_global_writer',current_database(),'TEMP')
    or not has_schema_privilege('cocinacore_global_writer','public','USAGE')
    or has_schema_privilege('cocinacore_global_writer','public','CREATE')
    or not has_schema_privilege('cocinacore_global_writer_view_owner','public','USAGE')
    or has_schema_privilege('cocinacore_global_writer_view_owner','public','CREATE')
    or exists (select 1 from pg_namespace n
       where n.nspname not in ('pg_catalog','information_schema','public')
         and (has_schema_privilege('cocinacore_global_writer',n.oid,'USAGE')
           or has_schema_privilege('cocinacore_global_writer_view_owner',n.oid,'USAGE')))
  ) then
    raise exception 'Refusing global writer database or schema privilege drift';
  end if;
  if role_count=2 and (
    exists (select 1 from pg_proc where proowner in (
      select oid from pg_roles where rolname in ('cocinacore_global_writer','cocinacore_global_writer_view_owner')))
    or exists (select 1 from pg_class where relkind='S' and relowner in (
      select oid from pg_roles where rolname in ('cocinacore_global_writer','cocinacore_global_writer_view_owner')))
    or exists (select 1 from pg_namespace where nspowner in (
      select oid from pg_roles where rolname in ('cocinacore_global_writer','cocinacore_global_writer_view_owner')))
    or exists (select 1 from pg_database where datdba in (
      select oid from pg_roles where rolname in ('cocinacore_global_writer','cocinacore_global_writer_view_owner')))
    or exists (select 1 from pg_namespace n cross join lateral aclexplode(n.nspacl) a
      where n.oid='public'::regnamespace and a.grantee=0 and a.privilege_type='CREATE')
  ) then
    raise exception 'Refusing global writer object ownership or PUBLIC schema CREATE drift';
  end if;

  if writer_object_count=3 and exists (
    select 1
      from (values
        ('owner_write_global_books','158e764a6af66977e575135a28ea2b2c','NONE'),
        ('owner_write_global_pdfs','6faa61bf38a8fb2510439274c2df9e49','NONE'),
        ('owner_write_global_chunks','0bd8cd5e0a83eb114d2306b6dd0af4df','CASCADED')
      ) expected(view_name,definition_hash,check_option)
      full join (
        select c.relname::text view_name,md5(pg_get_viewdef(c.oid,true)) definition_hash,
               v.check_option::text check_option
          from pg_class c join pg_namespace n on n.oid=c.relnamespace
          join information_schema.views v on v.table_schema=n.nspname and v.table_name=c.relname
         where n.nspname='public' and c.relname in (
           'owner_write_global_books','owner_write_global_pdfs','owner_write_global_chunks')
           and c.relkind='v'
           and c.relowner=(select oid from pg_roles where rolname='cocinacore_global_writer_view_owner')
      ) actual using (view_name)
     where expected.view_name is null or actual.view_name is null
        or expected.definition_hash is distinct from actual.definition_hash
        or expected.check_option is distinct from actual.check_option
  ) then
    raise exception 'Refusing incompatible or altered global writer views';
  end if;

  if writer_object_count=3 and (
    exists (
      with expected(view_name,grantee_name,privilege_type,is_grantable) as (values
        ('owner_write_global_books','cocinacore_global_writer_view_owner','SELECT',false),
        ('owner_write_global_books','cocinacore_global_writer_view_owner','INSERT',false),
        ('owner_write_global_books','cocinacore_global_writer_view_owner','UPDATE',false),
        ('owner_write_global_books','cocinacore_global_writer_view_owner','DELETE',false),
        ('owner_write_global_books','cocinacore_global_writer_view_owner','TRUNCATE',false),
        ('owner_write_global_books','cocinacore_global_writer_view_owner','REFERENCES',false),
        ('owner_write_global_books','cocinacore_global_writer_view_owner','TRIGGER',false),
        ('owner_write_global_pdfs','cocinacore_global_writer_view_owner','SELECT',false),
        ('owner_write_global_pdfs','cocinacore_global_writer_view_owner','INSERT',false),
        ('owner_write_global_pdfs','cocinacore_global_writer_view_owner','UPDATE',false),
        ('owner_write_global_pdfs','cocinacore_global_writer_view_owner','DELETE',false),
        ('owner_write_global_pdfs','cocinacore_global_writer_view_owner','TRUNCATE',false),
        ('owner_write_global_pdfs','cocinacore_global_writer_view_owner','REFERENCES',false),
        ('owner_write_global_pdfs','cocinacore_global_writer_view_owner','TRIGGER',false),
        ('owner_write_global_chunks','cocinacore_global_writer_view_owner','SELECT',false),
        ('owner_write_global_chunks','cocinacore_global_writer_view_owner','INSERT',false),
        ('owner_write_global_chunks','cocinacore_global_writer_view_owner','UPDATE',false),
        ('owner_write_global_chunks','cocinacore_global_writer_view_owner','DELETE',false),
        ('owner_write_global_chunks','cocinacore_global_writer_view_owner','TRUNCATE',false),
        ('owner_write_global_chunks','cocinacore_global_writer_view_owner','REFERENCES',false),
        ('owner_write_global_chunks','cocinacore_global_writer_view_owner','TRIGGER',false),
        ('owner_write_global_books','cocinacore_global_writer','INSERT',false),
        ('owner_write_global_pdfs','cocinacore_global_writer','INSERT',false),
        ('owner_write_global_chunks','cocinacore_global_writer','INSERT',false)
      ), actual as (
        select c.relname::text,coalesce(role_acl.rolname,'PUBLIC')::text,a.privilege_type,a.is_grantable
          from pg_class c join pg_namespace n on n.oid=c.relnamespace
          cross join lateral aclexplode(c.relacl) a left join pg_roles role_acl on role_acl.oid=a.grantee
         where n.nspname='public' and c.relname in (
           'owner_write_global_books','owner_write_global_pdfs','owner_write_global_chunks')
      )
      select * from expected except select * from actual
      union all select * from actual except select * from expected
    ) or exists (
      with expected(view_name,column_name,grantee_name,privilege_type,is_grantable) as (values
        ('owner_write_global_books','id','cocinacore_global_writer','SELECT',false)
      ), actual as (
        select c.relname::text,a.attname::text,coalesce(role_acl.rolname,'PUBLIC')::text,acl.privilege_type,acl.is_grantable
          from pg_attribute a join pg_class c on c.oid=a.attrelid
          join pg_namespace n on n.oid=c.relnamespace
          cross join lateral aclexplode(a.attacl) acl left join pg_roles role_acl on role_acl.oid=acl.grantee
         where n.nspname='public' and c.relname in (
           'owner_write_global_books','owner_write_global_pdfs','owner_write_global_chunks')
           and a.attnum>0 and not a.attisdropped
      )
      select * from expected except select * from actual
      union all select * from actual except select * from expected
    )
  ) then
    raise exception 'Refusing unexpected global writer view ACLs';
  end if;

  if exists (
    select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
      cross join lateral aclexplode(c.relacl) a
     where n.nspname='public' and (
       (a.grantee=(select oid from pg_roles where rolname='cocinacore_global_writer_view_owner')
         and not ((c.relname='global_books' and a.privilege_type in ('SELECT','INSERT'))
           or (c.relname in ('global_pdf_library','book_chunks') and a.privilege_type='INSERT')
           or (c.relname in ('owner_write_global_books','owner_write_global_pdfs','owner_write_global_chunks')
             and c.relowner=a.grantee)))
       or (a.grantee=(select oid from pg_roles where rolname='cocinacore_global_writer')
         and not (c.relname in ('owner_write_global_books','owner_write_global_pdfs','owner_write_global_chunks')
           and a.privilege_type='INSERT'))
     )
  ) or exists (
    select 1 from pg_attribute a join pg_class c on c.oid=a.attrelid
      join pg_namespace n on n.oid=c.relnamespace cross join lateral aclexplode(a.attacl) acl
     where n.nspname='public' and (
       (acl.grantee=(select oid from pg_roles where rolname='cocinacore_global_writer')
         and not (c.relname='owner_write_global_books' and a.attname='id' and acl.privilege_type='SELECT'))
       or (acl.grantee=(select oid from pg_roles where rolname='cocinacore_global_writer_view_owner')
         and not (c.relname='book_chunks' and a.attname in ('tenant_id','tenant_book_id','global_book_id','source_type')
           and acl.privilege_type='SELECT'))
     )
  ) then
    raise exception 'Refusing unexpected global writer source grants';
  end if;

  if writer_object_count=3 and exists (
    with expected(table_name,grantee_name,privilege_type,is_grantable) as (values
      ('global_books','cocinacore_global_writer_view_owner','SELECT',false),
      ('global_books','cocinacore_global_writer_view_owner','INSERT',false),
      ('global_pdf_library','cocinacore_global_writer_view_owner','INSERT',false),
      ('book_chunks','cocinacore_global_writer_view_owner','INSERT',false)
    ), actual as (
      select c.relname::text,role_acl.rolname::text,a.privilege_type,a.is_grantable
        from pg_class c join pg_namespace n on n.oid=c.relnamespace
        cross join lateral aclexplode(c.relacl) a join pg_roles role_acl on role_acl.oid=a.grantee
       where n.nspname='public' and c.relname in ('global_books','global_pdf_library','book_chunks')
         and role_acl.rolname='cocinacore_global_writer_view_owner'
    )
    select * from expected except select * from actual
    union all select * from actual except select * from expected
  ) or (writer_object_count=3 and exists (
    with expected(table_name,column_name,grantee_name,privilege_type,is_grantable) as (values
      ('book_chunks','tenant_id','cocinacore_global_writer_view_owner','SELECT',false),
      ('book_chunks','tenant_book_id','cocinacore_global_writer_view_owner','SELECT',false),
      ('book_chunks','global_book_id','cocinacore_global_writer_view_owner','SELECT',false),
      ('book_chunks','source_type','cocinacore_global_writer_view_owner','SELECT',false)
    ), actual as (
      select c.relname::text,a.attname::text,role_acl.rolname::text,acl.privilege_type,acl.is_grantable
        from pg_attribute a join pg_class c on c.oid=a.attrelid
        join pg_namespace n on n.oid=c.relnamespace
        cross join lateral aclexplode(a.attacl) acl join pg_roles role_acl on role_acl.oid=acl.grantee
       where n.nspname='public' and c.relname in ('global_books','global_pdf_library','book_chunks')
         and role_acl.rolname='cocinacore_global_writer_view_owner'
    )
    select * from expected except select * from actual
    union all select * from actual except select * from expected
  )) then
    raise exception 'Refusing unexpected or grantable global writer source ACLs';
  end if;

  if exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    cross join lateral aclexplode(c.relacl) a where n.nspname = 'public' and a.grantee = 0)
    or exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
      cross join lateral aclexplode(c.relacl) a
      where n.nspname = 'public' and (
        (a.grantee = (select oid from pg_roles where rolname = 'cocinacore_global_writer')
          and not (c.relname in ('owner_write_global_books','owner_write_global_pdfs','owner_write_global_chunks') and a.privilege_type = 'INSERT'))
        or (a.grantee = (select oid from pg_roles where rolname = 'cocinacore_global_writer_view_owner')
          and not ((c.relname = 'global_books' and a.privilege_type in ('SELECT','INSERT'))
            or (c.relname in ('global_pdf_library','book_chunks') and a.privilege_type = 'INSERT')
            or (c.relname in ('owner_write_global_books','owner_write_global_pdfs','owner_write_global_chunks') and c.relowner = a.grantee)))
      ))
    or exists (select 1 from pg_attribute a join pg_class c on c.oid = a.attrelid
      join pg_namespace n on n.oid = c.relnamespace cross join lateral aclexplode(a.attacl) acl
      where n.nspname = 'public' and (acl.grantee = 0
        or (acl.grantee = (select oid from pg_roles where rolname = 'cocinacore_global_writer')
          and not (c.relname = 'owner_write_global_books' and a.attname = 'id' and acl.privilege_type = 'SELECT'))
        or (acl.grantee = (select oid from pg_roles where rolname = 'cocinacore_global_writer_view_owner')
          and not (c.relname = 'book_chunks' and a.attname in ('tenant_id','tenant_book_id','global_book_id','source_type') and acl.privilege_type = 'SELECT'))))
  then raise exception 'Unexpected PUBLIC or global writer column privileges'; end if;
  if exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname in ('owner_write_global_books','owner_write_global_pdfs','owner_write_global_chunks')
    and (c.relkind <> 'v' or c.relowner <> (select oid from pg_roles where rolname = 'cocinacore_global_writer_view_owner')))
  then raise exception 'Refusing untrusted existing writer object'; end if;
end $$;
select 'create role cocinacore_global_writer_view_owner nologin nosuperuser nobypassrls nocreatedb nocreaterole noinherit noreplication'
where not exists (select 1 from pg_roles where rolname = 'cocinacore_global_writer_view_owner') \gexec
select 'create role cocinacore_global_writer login nosuperuser nobypassrls nocreatedb nocreaterole noinherit noreplication'
where not exists (select 1 from pg_roles where rolname = 'cocinacore_global_writer') \gexec
comment on role cocinacore_global_writer_view_owner is 'CocinaCore isolated global writer v1';
comment on role cocinacore_global_writer is 'CocinaCore isolated global writer v1';
alter role cocinacore_global_writer_view_owner nologin nosuperuser nobypassrls nocreatedb nocreaterole noinherit noreplication;
alter role cocinacore_global_writer login nosuperuser nobypassrls nocreatedb nocreaterole noinherit noreplication;
select format('alter role cocinacore_global_writer password %L', :'global_writer_password') \gexec
\unset global_writer_password
alter role cocinacore_global_writer set search_path = pg_catalog, public;
alter role cocinacore_global_writer set row_security = on;
revoke all on all tables in schema public from cocinacore_global_writer;
revoke all on all sequences in schema public from cocinacore_global_writer, cocinacore_global_writer_view_owner;
revoke all on all functions in schema public from cocinacore_global_writer, cocinacore_global_writer_view_owner;
revoke all on schema public from cocinacore_global_writer, cocinacore_global_writer_view_owner;
select format('revoke all on database %I from cocinacore_global_writer', current_database()) \gexec
select format('grant connect on database %I to cocinacore_global_writer', current_database()) \gexec
grant usage on schema public to cocinacore_global_writer, cocinacore_global_writer_view_owner;
grant select, insert on public.global_books to cocinacore_global_writer_view_owner;
grant insert on public.global_pdf_library to cocinacore_global_writer_view_owner;
grant select (tenant_id, tenant_book_id, global_book_id, source_type), insert on public.book_chunks to cocinacore_global_writer_view_owner;
create or replace view public.owner_write_global_books as select id, title, author, description, cuisine_region, cuisine_country, cuisine_style, tags from public.global_books;
create or replace view public.owner_write_global_pdfs as select global_book_id, storage_path, file_size_bytes, page_count, checksum_sha256, uploaded_by from public.global_pdf_library;
create or replace view public.owner_write_global_chunks as select tenant_id, tenant_book_id, global_book_id, source_type, content, metadata, embedding from public.book_chunks
 where source_type = 'global_pdf' and tenant_id is null and tenant_book_id is null and global_book_id is not null
 with cascaded check option;
alter view public.owner_write_global_books owner to cocinacore_global_writer_view_owner;
alter view public.owner_write_global_pdfs owner to cocinacore_global_writer_view_owner;
alter view public.owner_write_global_chunks owner to cocinacore_global_writer_view_owner;
revoke all on public.owner_write_global_books, public.owner_write_global_pdfs, public.owner_write_global_chunks from public, cocinacore_runtime_rls, cocinacore_auth;
grant insert on public.owner_write_global_books, public.owner_write_global_pdfs, public.owner_write_global_chunks to cocinacore_global_writer;
grant select (id) on public.owner_write_global_books to cocinacore_global_writer;
commit;
\echo 'Provisioned isolated global writer candidate.'
