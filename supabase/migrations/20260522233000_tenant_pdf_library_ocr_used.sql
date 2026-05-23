begin;

alter table public.tenant_pdf_library
  add column if not exists ocr_used boolean not null default false;

commit;
