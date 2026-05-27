-- Owner console overview metrics (read-only aggregate for platform owners)

create or replace function public.get_owner_overview_metrics()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenants_total integer := 0;
  v_users_total integer := 0;
  v_global_books_total integer := 0;
  v_global_pdfs_total integer := 0;
  v_global_chunks_total integer := 0;
  v_premium_reports_pending integer := 0;
  v_trials_active integer := 0;
  v_trials_expired integer := 0;
begin
  if not public.is_platform_owner() then
    raise exception 'Access denied: platform owner required'
      using errcode = '42501';
  end if;

  select count(*) into v_tenants_total from public.tenants;
  select count(*) into v_users_total from public.users;
  select count(*) into v_global_books_total from public.global_books;
  select count(*) into v_global_pdfs_total from public.global_pdf_library;
  select count(*) into v_global_chunks_total
  from public.book_chunks bc
  where bc.tenant_id is null
    and bc.global_book_id is not null;

  select count(*) into v_premium_reports_pending
  from public.premium_review_reports prr
  where prr.status in ('open', 'reviewing');

  select count(*) into v_trials_active
  from public.tenants t
  where t.trial_ends_at >= timezone('utc'::text, now());

  select count(*) into v_trials_expired
  from public.tenants t
  where t.trial_ends_at < timezone('utc'::text, now());

  return jsonb_build_object(
    'tenants_total', v_tenants_total,
    'users_total', v_users_total,
    'global_books_total', v_global_books_total,
    'global_pdfs_total', v_global_pdfs_total,
    'global_chunks_total', v_global_chunks_total,
    'premium_reports_pending', v_premium_reports_pending,
    'trials_active', v_trials_active,
    'trials_expired', v_trials_expired
  );
end;
$$;

revoke all on function public.get_owner_overview_metrics() from public;
grant execute on function public.get_owner_overview_metrics() to authenticated;
