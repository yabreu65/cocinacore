create table if not exists public.password_reset_tokens (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references public.users(id) on delete cascade,
    token_hash text not null unique,
    requested_ip_hash text null,
    expires_at timestamptz not null,
    used_at timestamptz null,
    created_at timestamptz not null default now()
);

create index if not exists idx_password_reset_tokens_user_id
    on public.password_reset_tokens(user_id);

create index if not exists idx_password_reset_tokens_active
    on public.password_reset_tokens(token_hash, expires_at)
    where used_at is null;

revoke all on public.password_reset_tokens from public;
