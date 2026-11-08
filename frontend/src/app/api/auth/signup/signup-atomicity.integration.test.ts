import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';
import { getPool, query } from '@/lib/db';
import { resolveSessionToken } from '@/lib/auth/session';
import * as userRepository from '@/lib/db/repositories/userRepository';

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: vi
    .fn()
    .mockResolvedValue({ success: true, limit: 100, remaining: 99, resetAt: 1 }),
}));

const enabled = process.env.COCINACORE_SIGNUP_DISPOSABLE_TEST === '1';
const { POST } = await import('./route');

function signup(email: string): Promise<Response> {
  return POST(
    new Request('http://localhost/api/auth/signup', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email,
        password: 'SecurePassword123!',
        confirmPassword: 'SecurePassword123!',
        fullName: 'Test Owner',
        termsAccepted: true,
      }),
    }) as unknown as NextRequest
  );
}

async function counts() {
  const result = await query<{
    tenants: string;
    users: string;
    memberships: string;
    sessions: string;
  }>(
    `select (select count(*) from tenants) tenants, (select count(*) from users) users,
     (select count(*) from tenant_memberships) memberships, (select count(*) from sessions) sessions`
  );
  return result.rows[0];
}

describe.skipIf(!enabled)('signup atomicity on disposable PostgreSQL', () => {
  beforeAll(async () => {
    // Only a freshly initialized private socket and specifically named test DB are accepted.
    const url = new URL(process.env.DATABASE_URL ?? '');
    if (
      url.hostname !== '' ||
      !url.searchParams.get('host')?.includes('/cocinacore-signup-disposable-') ||
      url.pathname !== '/signup_disposable'
    ) {
      throw new Error(
        'A private disposable PostgreSQL socket and signup_disposable database are required'
      );
    }
    process.env.AUTH_SECRET = 'disposable-signup-test-secret';
    await query(`
      create table tenants (id uuid primary key default gen_random_uuid(), tenant_type text not null default 'home', name text not null, trial_started_at timestamptz, trial_ends_at timestamptz, trial_soft_blocked_at timestamptz, created_at timestamptz default now(), updated_at timestamptz default now());
      create table users (id uuid primary key default gen_random_uuid(), email text not null constraint users_email_key unique, password_hash text not null, email_confirmed boolean not null default false, full_name text, tenant_id uuid references tenants(id), role text not null, terms_accepted_at timestamptz, terms_version text, onboarding_completed boolean not null default false, created_at timestamptz default now(), updated_at timestamptz default now());
      create table tenant_memberships (id uuid primary key default gen_random_uuid(), tenant_id uuid not null references tenants(id), user_id uuid not null references users(id), role text not null, created_at timestamptz default now(), updated_at timestamptz default now(), unique(tenant_id,user_id));
      create table sessions (id uuid primary key default gen_random_uuid(), user_id uuid not null references users(id), token_hash text not null unique, expires_at timestamptz not null, created_at timestamptz default now(), last_seen_at timestamptz default now());
      create function signup_test_failure() returns trigger language plpgsql as $$
      declare email_value text;
      begin
        if tg_table_name = 'tenants' then email_value := new.name;
        elsif tg_table_name = 'users' then email_value := new.email;
        else select email into email_value from users where id = new.user_id; end if;
        if email_value like 'race%@%' and tg_table_name = 'users' then perform pg_sleep(0.3); end if;
        if email_value like ('%fail-' || tg_table_name || '@%') then raise exception 'injected failure'; end if;
        return new;
      end $$;
      create trigger fail_tenant before insert on tenants for each row execute function signup_test_failure();
      create trigger fail_user before insert on users for each row execute function signup_test_failure();
      create trigger fail_membership before insert on tenant_memberships for each row execute function signup_test_failure();
      create trigger fail_session before insert on sessions for each row execute function signup_test_failure();
      create function signup_test_commit_failure() returns trigger language plpgsql as $$
      begin
        if exists (select 1 from users where id = new.user_id and email like 'fail-commit@%') then raise exception 'injected commit failure'; end if;
        return new;
      end $$;
      create constraint trigger fail_commit after insert on sessions deferrable initially deferred for each row execute function signup_test_commit_failure();
    `);
  });
  afterAll(async () => {
    await getPool().end();
  });

  it.each(['tenants', 'users', 'tenant_memberships', 'sessions', 'commit'])(
    'rolls back all records and returns no cookie on %s failure',
    async (stage) => {
      const before = await counts();
      const response = await signup(`fail-${stage}@example.test`);
      expect(response.status).toBe(400);
      expect(response.headers.get('set-cookie')).toBeNull();
      expect(await counts()).toEqual(before);
    }
  );

  it('rolls back when session signing configuration is invalid', async () => {
    const before = await counts();
    const original = process.env.AUTH_SECRET;
    try {
      process.env.AUTH_SECRET = 'CHANGE_ME';
      const response = await signup('fail-signing@example.test');
      expect(response.status).toBe(400);
      expect(response.headers.get('set-cookie')).toBeNull();
      expect(await counts()).toEqual(before);
    } finally {
      process.env.AUTH_SECRET = original;
    }
  });

  it('commits all records before returning a valid session cookie', async () => {
    const before = await counts();
    const response = await signup('success@example.test');
    expect(response.status).toBe(200);
    const cookie = response.headers.get('set-cookie');
    expect(cookie).toContain('cocinacore_session=');
    const token = cookie?.match(/cocinacore_session=([^;]+)/)?.[1];
    expect(token).toBeDefined();
    const resolved = await resolveSessionToken(decodeURIComponent(token!));
    expect(resolved?.user.email).toBe('success@example.test');
    const after = await counts();
    for (const key of ['tenants', 'users', 'memberships', 'sessions'] as const) {
      expect(Number(after?.[key])).toBe(Number(before?.[key]) + 1);
    }
  });

  it('allows retry after a rolled-back failure without leaving partial records', async () => {
    const before = await counts();
    const createUser = vi
      .spyOn(userRepository, 'createUser')
      .mockRejectedValueOnce(new Error('unavailable'));
    try {
      const failed = await signup('retry@example.test');
      expect(failed.status).toBe(400);
      expect(failed.headers.get('set-cookie')).toBeNull();
      expect(await counts()).toEqual(before);
      const success = await signup('retry@example.test');
      expect(success.status).toBe(200);
      const after = await counts();
      for (const key of ['tenants', 'users', 'memberships', 'sessions'] as const) {
        expect(Number(after?.[key])).toBe(Number(before?.[key]) + 1);
      }
    } finally {
      createUser.mockRestore();
    }
  });

  it('creates separate tenants and owner memberships for distinct signups', async () => {
    expect((await signup('isolation-a@example.test')).status).toBe(200);
    expect((await signup('isolation-b@example.test')).status).toBe(200);
    const result = await query<{ email: string; tenant_id: string; membership_tenant: string }>(
      `select u.email, u.tenant_id, m.tenant_id as membership_tenant
       from users u join tenant_memberships m on m.user_id = u.id
       where u.email = any($1) order by u.email`,
      [['isolation-a@example.test', 'isolation-b@example.test']]
    );
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0].tenant_id).not.toBe(result.rows[1].tenant_id);
    for (const row of result.rows) expect(row.tenant_id).toBe(row.membership_tenant);
  });

  it('rolls back the loser of simultaneous canonical-email signups', async () => {
    const before = await counts();
    const createUser = vi.spyOn(userRepository, 'createUser');
    const responses = await Promise.all([signup('race@example.test'), signup('RACE@example.test')]);
    expect(createUser).toHaveBeenCalledTimes(2);
    const results = await Promise.allSettled(
      createUser.mock.results.map((result) => result.value as Promise<unknown>)
    );
    expect(
      results.some((result) => {
        if (result.status !== 'rejected') return false;
        const reason: unknown = result.reason;
        return (
          typeof reason === 'object' &&
          reason !== null &&
          'code' in reason &&
          reason.code === '23505' &&
          'constraint' in reason &&
          reason.constraint === 'users_email_key'
        );
      })
    ).toBe(true);
    createUser.mockRestore();
    expect(responses.map((response) => response.status).sort()).toEqual([200, 400]);
    const failed = responses.find((response) => response.status === 400)!;
    expect(failed.headers.get('set-cookie')).toBeNull();
    expect(await failed.json()).toEqual({
      error: 'No pudimos completar la operación. Intentá nuevamente.',
    });
    const after = await counts();
    for (const key of ['tenants', 'users', 'memberships', 'sessions'] as const) {
      expect(Number(after?.[key])).toBe(Number(before?.[key]) + 1);
    }
  });
});
