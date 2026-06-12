begin;

alter table public.users
  add column if not exists onboarding_completed boolean not null default false;

alter table public.tenant_pdf_library
  add column if not exists processing_status text not null default 'ready',
  add column if not exists processing_error text,
  add column if not exists processed_chunks_count integer not null default 0,
  add constraint tenant_pdf_library_processing_status_check
    check (processing_status in ('processing', 'ready', 'failed'));

commit;
