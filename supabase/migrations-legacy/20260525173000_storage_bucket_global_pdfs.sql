begin;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('global-pdfs', 'global-pdfs', false, 52428800, array['application/pdf'])
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Platform owners read global pdf objects" on storage.objects;
create policy "Platform owners read global pdf objects"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'global-pdfs'
  and split_part(name, '/', 1) = 'global'
  and public.is_platform_owner()
);

drop policy if exists "Platform owners insert global pdf objects" on storage.objects;
create policy "Platform owners insert global pdf objects"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'global-pdfs'
  and split_part(name, '/', 1) = 'global'
  and public.is_platform_owner()
);

drop policy if exists "Platform owners update global pdf objects" on storage.objects;
create policy "Platform owners update global pdf objects"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'global-pdfs'
  and split_part(name, '/', 1) = 'global'
  and public.is_platform_owner()
)
with check (
  bucket_id = 'global-pdfs'
  and split_part(name, '/', 1) = 'global'
  and public.is_platform_owner()
);

drop policy if exists "Platform owners delete global pdf objects" on storage.objects;
create policy "Platform owners delete global pdf objects"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'global-pdfs'
  and split_part(name, '/', 1) = 'global'
  and public.is_platform_owner()
);

commit;
