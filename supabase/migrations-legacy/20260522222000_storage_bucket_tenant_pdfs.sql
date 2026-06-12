begin;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('tenant-pdfs', 'tenant-pdfs', false, 52428800, array['application/pdf'])
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Tenant members read tenant pdf objects" on storage.objects;
create policy "Tenant members read tenant pdf objects"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'tenant-pdfs'
  and split_part(name, '/', 1) = 'tenant'
  and split_part(name, '/', 2) = public.get_auth_tenant_id()::text
);

drop policy if exists "Tenant members insert tenant pdf objects" on storage.objects;
create policy "Tenant members insert tenant pdf objects"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'tenant-pdfs'
  and split_part(name, '/', 1) = 'tenant'
  and split_part(name, '/', 2) = public.get_auth_tenant_id()::text
);

drop policy if exists "Tenant members update tenant pdf objects" on storage.objects;
create policy "Tenant members update tenant pdf objects"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'tenant-pdfs'
  and split_part(name, '/', 1) = 'tenant'
  and split_part(name, '/', 2) = public.get_auth_tenant_id()::text
)
with check (
  bucket_id = 'tenant-pdfs'
  and split_part(name, '/', 1) = 'tenant'
  and split_part(name, '/', 2) = public.get_auth_tenant_id()::text
);

drop policy if exists "Tenant members delete tenant pdf objects" on storage.objects;
create policy "Tenant members delete tenant pdf objects"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'tenant-pdfs'
  and split_part(name, '/', 1) = 'tenant'
  and split_part(name, '/', 2) = public.get_auth_tenant_id()::text
);

commit;
