-- Add regional metadata for global books managed by platform owner

alter table public.global_books
  add column if not exists cuisine_region text not null default 'Global',
  add column if not exists cuisine_country text,
  add column if not exists cuisine_style text,
  add column if not exists tags text[] not null default '{}'::text[];
