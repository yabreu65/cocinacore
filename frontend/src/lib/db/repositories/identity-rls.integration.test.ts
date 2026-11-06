import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Pool, type PoolClient } from 'pg';
import { randomUUID } from 'node:crypto';
import type { NextRequest } from 'next/server';
import { getPool, authQuery } from '@/lib/db';
import { resolveSessionToken } from '@/lib/auth/session';
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: vi
    .fn()
    .mockResolvedValue({ success: true, limit: 100, remaining: 99, resetAt: 1 }),
}));
const enabled = process.env.COCINACORE_IDENTITY_RLS_TEST === '1';
const signupBootstrapInstalled = process.env.COCINACORE_SIGNUP_BOOTSTRAP_TEST === '1';
const previousSignupBootstrapFlag = process.env.COCINACORE_SIGNUP_BOOTSTRAP_ENABLED;
const a = { tenantId: randomUUID(), userId: randomUUID() };
const a2 = { tenantId: a.tenantId, userId: randomUUID() };
const b = { tenantId: randomUUID(), userId: randomUUID() };
let admin: Pool;
let runtime: Pool;
async function scoped<T>(
  scope: { tenantId: string; userId: string },
  fn: (client: PoolClient) => Promise<T>
) {
  const c = await runtime.connect();
  try {
    await c.query('begin');
    await c.query("select set_config('app.tenant_id',$1,true),set_config('app.user_id',$2,true)", [
      scope.tenantId,
      scope.userId,
    ]);
    const out = await fn(c);
    await c.query('commit');
    return out;
  } catch (e) {
    await c.query('rollback');
    throw e;
  } finally {
    c.release();
  }
}
describe.skipIf(!enabled)('candidate identity RLS on disposable PostgreSQL', () => {
  beforeAll(async () => {
    const url = new URL(process.env.SIGNUP_TEST_ADMIN_URL ?? '');
    const data = new URL(process.env.DATABASE_URL ?? '');
    if (
      url.hostname !== '127.0.0.1' ||
      url.pathname !== '/signup_real_disposable' ||
      data.host !== url.host ||
      data.pathname !== url.pathname ||
      data.username !== 'cocinacore_runtime_rls'
    )
      throw new Error('Disposable database required');
    admin = new Pool({ connectionString: url.toString() });
    runtime = new Pool({ connectionString: data.toString(), max: 1 });
    const marker = await admin.query<{ marker: string }>(
      "select shobj_description(oid,'pg_database') marker from pg_database where datname=current_database()"
    );
    if (marker.rows[0].marker !== 'cocinacore-signup-real-disposable')
      throw new Error('Disposable marker missing');
    await admin.query("insert into tenants(id,name) values($1,'A'),($2,'B')", [
      a.tenantId,
      b.tenantId,
    ]);
    for (const u of [a, a2, b]) {
      await admin.query(
        "insert into users(id,tenant_id,email,password_hash) values($1,$2,$3,'fixture')",
        [u.userId, u.tenantId, `${u.userId}@example.test`]
      );
      await admin.query('insert into tenant_memberships(tenant_id,user_id) values($1,$2)', [
        u.tenantId,
        u.userId,
      ]);
    }
    process.env.AUTH_SECRET = 'disposable-identity-test-secret';
    if (signupBootstrapInstalled) process.env.COCINACORE_SIGNUP_BOOTSTRAP_ENABLED = 'true';
  });
  afterAll(async () => {
    if (previousSignupBootstrapFlag === undefined)
      delete process.env.COCINACORE_SIGNUP_BOOTSTRAP_ENABLED;
    else process.env.COCINACORE_SIGNUP_BOOTSTRAP_ENABLED = previousSignupBootstrapFlag;
    await Promise.all([admin?.end(), runtime?.end(), getPool().end()]);
  });
  it('denies cross-tenant, absent, invalid and contradictory contexts without recursion', async () => {
    for (const [scope, expected] of [
      [a, [a.userId, a2.userId]],
      [a2, [a.userId, a2.userId]],
      [b, [b.userId]],
    ] as const) {
      const res = await scoped(scope, async (c) => ({
        users: await c.query<{ id: string }>('select id from users'),
        tenants: await c.query<{ id: string }>('select id from tenants'),
        memberships: await c.query<{ user_id: string }>('select user_id from tenant_memberships'),
      }));
      expect(res.users.rows.map((x) => x.id).sort()).toEqual([...expected].sort());
      expect(res.tenants.rows.map((x) => x.id)).toEqual([scope.tenantId]);
      expect(res.memberships.rows.map((x) => x.user_id)).toEqual([scope.userId]);
    }
    for (const table of ['users', 'tenants', 'tenant_memberships'])
      expect(
        (
          await runtime.query(
            `select ${table === 'tenant_memberships' ? 'user_id' : 'id'} from ${table}`
          )
        ).rowCount
      ).toBe(0);
    expect(
      (
        await scoped({ tenantId: a.tenantId, userId: b.userId }, (c) =>
          c.query('select id from users')
        )
      ).rowCount
    ).toBe(0);
    await expect(
      scoped({ tenantId: 'invalid', userId: a.userId }, (c) => c.query('select id from tenants'))
    ).rejects.toMatchObject({ code: '22P02' });
    expect((await runtime.query('select id from users')).rowCount).toBe(0);
  });
  it('preserves active tenant for users with more than one membership', async () => {
    await admin.query('insert into tenant_memberships(tenant_id,user_id) values($1,$2)', [
      b.tenantId,
      a.userId,
    ]);
    expect(
      (
        await scoped({ tenantId: b.tenantId, userId: a.userId }, (c) =>
          c.query('select id from users')
        )
      ).rowCount
    ).toBe(0);
    expect((await scoped(a, (c) => c.query('select id from users'))).rowCount).toBe(2);
  });
  it('allows only own profile updates and denies sensitive identity mutations', async () => {
    expect(
      (
        await scoped(a, (c) =>
          c.query("update users set full_name='Allowed' where id=$1", [a.userId])
        )
      ).rowCount
    ).toBe(1);
    expect(
      (
        await scoped(a, (c) =>
          c.query("update users set full_name='Denied' where id=$1", [a2.userId])
        )
      ).rowCount
    ).toBe(0);
    for (const sql of [
      'select password_hash from users',
      "update users set password_hash='x'",
      "update users set role='owner'",
      'insert into tenant_memberships(tenant_id,user_id) values(gen_random_uuid(),gen_random_uuid())',
      'set role cocinacore_identity_probe',
    ])
      await expect(scoped(a, (c) => c.query(sql))).rejects.toMatchObject({ code: '42501' });
    await expect(authQuery('select * from recipe_inventory_items')).rejects.toMatchObject({
      code: '42501',
    });
  });
  it('uses auth SQL for atomic signup, login and session resolution before tenant scope', async () => {
    const { POST: signup } = await import('@/app/api/auth/signup/route');
    const { POST: login } = await import('@/app/api/auth/login/route');
    const email = `identity-${randomUUID()}@example.test`;
    const password = 'SecurePassword123!';
    const req = (path: string, body: unknown) =>
      new Request(`http://localhost${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }) as NextRequest;
    const response = await signup(
      req('/api/auth/signup', {
        email,
        password,
        confirmPassword: password,
        fullName: 'Identity Test',
        termsAccepted: true,
      })
    );
    expect(response.status).toBe(200);
    const signed = await login(req('/api/auth/login', { email, password }));
    expect(signed.status).toBe(200);
    const token = signed.headers.get('set-cookie')?.match(/cocinacore_session=([^;]+)/)?.[1];
    expect(token).toBeDefined();
    const session = await resolveSessionToken(decodeURIComponent(token!));
    expect(session?.user.email).toBe(email);
    const result = await admin.query<{ n: number }>(
      `select count(*)::int n from users u join tenants t on t.id=u.tenant_id join tenant_memberships m on m.user_id=u.id and m.tenant_id=t.id join sessions s on s.user_id=u.id where u.email=$1`,
      [email]
    );
    expect(result.rows[0].n).toBeGreaterThanOrEqual(1);
    const { createPasswordResetToken, consumePasswordResetToken } =
      await import('./passwordResetRepository');
    const userId = session?.user.id;
    if (!userId) throw new Error('Session user missing');
    const hash = randomUUID();
    await createPasswordResetToken({
      userId,
      tokenHash: hash,
      requestedIpHash: null,
      expiresAt: new Date(Date.now() + 60_000),
    });
    expect(
      await consumePasswordResetToken(hash, async (client, row) => {
        await client.query('update users set password_hash=$1,updated_at=now() where id=$2', [
          'replacement-hash',
          row.user_id,
        ]);
        await client.query('delete from sessions where user_id=$1', [row.user_id]);
        return true;
      })
    ).toBe(true);
    expect(await resolveSessionToken(decodeURIComponent(token!))).toBeNull();
    expect(await consumePasswordResetToken(hash, async () => true)).toBeNull();
  });
  it('rolls back signup when membership insertion fails', async () => {
    const { POST: signup } = await import('@/app/api/auth/signup/route');
    const email = `rollback-${randomUUID()}@example.test`;
    await admin.query(`create function identity_test_fail_membership() returns trigger language plpgsql as $$ begin raise exception 'injected failure'; end $$;
      create trigger identity_test_fail before insert on tenant_memberships for each row execute function identity_test_fail_membership()`);
    try {
      const response = await signup(
        new Request('http://localhost/api/auth/signup', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            email,
            password: 'SecurePassword123!',
            confirmPassword: 'SecurePassword123!',
            fullName: 'Rollback',
            termsAccepted: true,
          }),
        }) as NextRequest
      );
      expect(response.status).toBe(400);
      expect((await admin.query('select id from users where email=$1', [email])).rowCount).toBe(0);
      expect(
        (await admin.query('select id from tenants where name=$1', [`Tenant of ${email}`])).rowCount
      ).toBe(0);
      expect(response.headers.get('set-cookie')).toBeNull();
    } finally {
      await admin.query(
        'drop trigger identity_test_fail on tenant_memberships; drop function identity_test_fail_membership()'
      );
    }
  });
  it('preserves the nine previously protected tables and the probe role boundary', async () => {
    const names = [
      'user_recipes',
      'user_recipe_versions',
      'cooking_sessions',
      'cooking_session_events',
      'real_consumption_operations',
      'meal_consumption_claims',
      'real_consumption_items',
      'real_consumption_substitutions',
      'real_consumption_movement_links',
    ];
    const state = await admin.query<{ name: string; forced: boolean }>(
      'select relname name, relforcerowsecurity forced from pg_class where oid=any($1::regclass[]) and relrowsecurity',
      [names.map((name) => `public.${name}`)]
    );
    expect(state.rows).toHaveLength(9);
    expect(state.rows.every((row) => row.forced)).toBe(true);
    const probe = await admin.query<{
      rolcanlogin: boolean;
      rolsuper: boolean;
      rolbypassrls: boolean;
      memberships: number;
    }>(
      "select rolcanlogin, rolsuper, rolbypassrls, (select count(*)::int from pg_auth_members where member=r.oid or roleid=r.oid) memberships from pg_roles r where rolname='cocinacore_identity_probe'"
    );
    expect(probe.rows[0]).toEqual({
      rolcanlogin: false,
      rolsuper: false,
      rolbypassrls: false,
      memberships: 0,
    });
    const recipe = await scoped(a, (client) =>
      client.query<{ id: string }>(
        'insert into user_recipes (tenant_id,user_id) values ($1,$2) returning id',
        [a.tenantId, a.userId]
      )
    );
    expect(
      (
        await scoped(b, (client) =>
          client.query('select id from user_recipes where id=$1', [recipe.rows[0].id])
        )
      ).rowCount
    ).toBe(0);
    expect(
      (
        await scoped(a, (client) =>
          client.query('select id from user_recipes where id=$1', [recipe.rows[0].id])
        )
      ).rowCount
    ).toBe(1);
    for (const table of names) {
      const rows = await runtime.query(`select * from ${table}`);
      expect(rows.rowCount).toBe(0);
    }
  });
  it('preserves the auth membership boundary for the installed signup capability', async () => {
    const extra = randomUUID();
    await admin.query(
      "insert into users(id,tenant_id,email,password_hash) values($1,$2,$3,'fixture')",
      [extra, a.tenantId, `${extra}@example.test`]
    );
    if (signupBootstrapInstalled) {
      await expect(
        authQuery("insert into tenant_memberships(tenant_id,user_id,role) values($1,$2,'owner')", [
          a.tenantId,
          extra,
        ])
      ).rejects.toMatchObject({ code: '42501' });
      expect(
        (
          await admin.query(
            'select user_id from tenant_memberships where tenant_id=$1 and user_id=$2',
            [a.tenantId, extra]
          )
        ).rowCount
      ).toBe(0);
      return;
    }
    await authQuery(
      "insert into tenant_memberships(tenant_id,user_id,role) values($1,$2,'owner')",
      [a.tenantId, extra]
    );
    expect(
      (
        await admin.query(
          'select user_id from tenant_memberships where tenant_id=$1 and user_id=$2',
          [a.tenantId, extra]
        )
      ).rowCount
    ).toBe(1);
    await expect(
      authQuery("insert into tenant_memberships(tenant_id,user_id,role) values($1,$2,'owner')", [
        b.tenantId,
        extra,
      ])
    ).rejects.toMatchObject({ code: '42501' });
  });
});
