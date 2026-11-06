import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
const sessionUser = vi.hoisted(() => vi.fn());
vi.mock('@/lib/auth/server', () => ({ getCurrentUser: sessionUser }));
vi.mock('next/navigation', () => ({
  redirect: (path: string) => {
    throw new Error(`redirect ${path}`);
  },
}));
import { Pool } from 'pg';
import { getOwnerMetrics } from './metrics';
import OwnerPage from '@/app/owner/page';

const enabled = process.env.COCINACORE_SIGNUP_REAL_SCHEMA_TEST === '1';
let admin: Pool;
let metrics: Pool;
let runtime: Pool;
let auth: Pool;
let globalWriter: Pool;
let publicProbe: Pool;

describe.skipIf(!enabled)('owner metrics on disposable PostgreSQL', () => {
  beforeAll(async () => {
    const urls = [
      'SIGNUP_TEST_ADMIN_URL',
      'OWNER_METRICS_DATABASE_URL',
      'DATABASE_URL',
      'AUTH_DATABASE_URL',
      'OWNER_GLOBAL_WRITER_DATABASE_URL',
    ].map((key) => new URL(process.env[key] ?? ''));
    const publicProbeUrl = process.env.OWNER_METRICS_PUBLIC_PROBE_DATABASE_URL;
    if (
      urls.some(
        (url) =>
          url.hostname !== '127.0.0.1' ||
          url.pathname !== '/signup_real_disposable' ||
          url.host !== urls[0].host
      ) ||
      urls[1].username !== 'cocinacore_owner_metrics' ||
      urls[2].username !== 'cocinacore_runtime_rls' ||
      urls[3].username !== 'cocinacore_auth' ||
      urls[4].username !== 'cocinacore_global_writer' ||
      (process.env.COCINACORE_OWNER_METRICS_RLS_TEST === '1' && !publicProbeUrl)
    )
      throw new Error('Disposable metrics database required');
    admin = new Pool({ connectionString: urls[0].toString() });
    metrics = new Pool({ connectionString: urls[1].toString() });
    runtime = new Pool({ connectionString: urls[2].toString() });
    auth = new Pool({ connectionString: urls[3].toString() });
    globalWriter = new Pool({ connectionString: urls[4].toString() });
    if (publicProbeUrl) {
      const url = new URL(publicProbeUrl);
      if (
        url.hostname !== urls[0].hostname ||
        url.port !== urls[0].port ||
        url.pathname !== urls[0].pathname ||
        url.username !== 'cocinacore_metrics_public_probe'
      )
        throw new Error('Disposable PUBLIC probe database required');
      publicProbe = new Pool({ connectionString: url.toString() });
    }
    const marker = await admin.query<{ marker: string }>(
      "select shobj_description(oid, 'pg_database') marker from pg_database where datname = current_database()"
    );
    expect(marker.rows[0].marker).toBe('cocinacore-signup-real-disposable');
  });
  afterAll(async () => {
    await Promise.all([
      admin?.end(),
      metrics?.end(),
      runtime?.end(),
      auth?.end(),
      globalWriter?.end(),
      publicProbe?.end(),
    ]);
  });

  it('returns exactly seven global counts through an isolated read-only role', async () => {
    expect((await metrics.query('select current_user')).rows[0]).toEqual({
      current_user: 'cocinacore_owner_metrics',
    });
    const roles =
      await admin.query(`select r.rolname, r.rolcanlogin, r.rolsuper, r.rolbypassrls, r.rolcreaterole, r.rolcreatedb, r.rolinherit,
      (select count(*)::int from pg_auth_members where member = r.oid or roleid = r.oid) as memberships,
      (select count(*)::int from pg_class c where c.relkind in ('r', 'p') and c.relowner = r.oid) as owned_tables
      from pg_roles r where r.rolname in ('cocinacore_owner_metrics', 'cocinacore_metrics_view_owner') order by r.rolname`);
    expect(roles.rows).toEqual([
      {
        rolname: 'cocinacore_metrics_view_owner',
        rolcanlogin: false,
        rolsuper: false,
        rolbypassrls: false,
        rolcreaterole: false,
        rolcreatedb: false,
        rolinherit: false,
        memberships: 0,
        owned_tables: 0,
      },
      {
        rolname: 'cocinacore_owner_metrics',
        rolcanlogin: true,
        rolsuper: false,
        rolbypassrls: false,
        rolcreaterole: false,
        rolcreatedb: false,
        rolinherit: false,
        memberships: 0,
        owned_tables: 0,
      },
    ]);
    expect(
      (
        await admin.query<{ available: boolean }>(
          'select available from public.owner_metrics_rls_guard'
        )
      ).rows
    ).toEqual([{ available: true }]);
    const actual = await getOwnerMetrics();
    const expected = await admin.query<{
      tenants: string;
      users: string;
      books: string;
      pdfs: string;
      chunks: string;
      reports: string;
      owners: string;
    }>(`select
      (select count(id) from public.tenants) tenants,
      (select count(id) from public.users) users,
      (select count(id) from public.global_books) books,
      (select count(id) from public.global_pdf_library) pdfs,
      (select count(id) from public.book_chunks where global_book_id is not null) chunks,
      (select count(id) from public.premium_review_reports) reports,
      (select count(user_id) from public.platform_owners) owners`);
    expect(Object.keys(actual).sort()).toEqual(
      ['tenants', 'users', 'books', 'pdfs', 'chunks', 'reports', 'owners'].sort()
    );
    for (const key of Object.keys(actual) as Array<keyof typeof actual>)
      expect(actual[key]).toBe(Number(expected.rows[0][key]));
    for (const table of [
      'users',
      'tenants',
      'global_books',
      'global_pdf_library',
      'premium_review_reports',
      'platform_owners',
      'sessions',
      'password_reset_tokens',
      'recipe_inventory_items',
      'user_meal_plans',
      'book_chunks',
    ]) {
      await expect(metrics.query(`select * from public.${table}`)).rejects.toMatchObject({
        code: '42501',
      });
      await expect(
        metrics.query(`insert into public.${table} default values`)
      ).rejects.toMatchObject({
        code: '42501',
      });
    }
    await expect(
      metrics.query('select * from public.owner_metrics_rls_guard')
    ).rejects.toMatchObject({
      code: '42501',
    });
    await expect(
      metrics.query('update public.users set full_name = full_name')
    ).rejects.toMatchObject({ code: '42501' });
    await expect(metrics.query('set role cocinacore_metrics_view_owner')).rejects.toMatchObject({
      code: '42501',
    });
    await expect(metrics.query('create temporary table forbidden (id int)')).rejects.toMatchObject({
      code: '42501',
    });
    await expect(runtime.query('select * from public.owner_global_metrics')).rejects.toMatchObject({
      code: '42501',
    });
    await expect(auth.query('select * from public.owner_global_metrics')).rejects.toMatchObject({
      code: '42501',
    });
    if (publicProbe) {
      await expect(
        publicProbe.query('select * from public.owner_global_metrics')
      ).rejects.toMatchObject({ code: '42501' });
    }
  });

  it('authorizes the owner page through the real owner lookup before loading real metrics', async () => {
    const tenant = (
      await admin.query<{ id: string }>(
        "insert into public.tenants (name) values ('Metrics test') returning id"
      )
    ).rows[0];
    const users = (
      await admin.query<{ id: string; email: string }>(
        "insert into public.users (email, password_hash, tenant_id) values ('metrics-owner@example.test', 'fixture', $1), ('metrics-nonowner@example.test', 'fixture', $1) returning id, email",
        [tenant.id]
      )
    ).rows;
    const owner = users.find((user) => user.email === 'metrics-owner@example.test');
    const nonowner = users.find((user) => user.email === 'metrics-nonowner@example.test');
    if (!owner || !nonowner) throw new Error('Owner fixture missing');
    await admin.query(
      "insert into public.tenant_memberships (tenant_id, user_id, role) values ($1, $2, 'owner'), ($1, $3, 'owner')",
      [tenant.id, owner.id, nonowner.id]
    );
    await admin.query(
      'insert into public.platform_owners (user_id, requires_manual_review) values ($1, false)',
      [owner.id]
    );
    const authenticatedOwner = {
      id: owner.id,
      email: owner.email,
      fullName: 'Metrics owner',
      tenant: {
        tenantId: tenant.id,
        role: 'owner' as const,
        tenantType: 'home' as const,
        onboardingCompleted: true,
      },
      termsAcceptedAt: null,
      termsVersion: null,
      onboardingCompleted: true,
    };
    sessionUser.mockResolvedValueOnce(authenticatedOwner);
    expect(await OwnerPage()).toBeDefined();
    sessionUser.mockResolvedValueOnce({
      ...authenticatedOwner,
      id: nonowner.id,
      email: nonowner.email,
    });
    await expect(OwnerPage()).rejects.toThrow('redirect /app');
  });

  it('keeps the global writer restricted to its views while application activation stays off', async () => {
    expect(process.env.COCINACORE_OWNER_GLOBAL_WRITER_ENABLED).toBe('false');
    const currentUser = await globalWriter.query<{ current_user: string }>('select current_user');
    expect(currentUser.rows[0]?.current_user).toBe('cocinacore_global_writer');
    const before = await admin.query<{ books: string; pdfs: string; chunks: string }>(`select
      (select count(*)::text from public.global_books) books,
      (select count(*)::text from public.global_pdf_library) pdfs,
      (select count(*)::text from public.book_chunks where global_book_id is not null) chunks`);
    const vector = JSON.stringify([1, ...Array<number>(1535).fill(0)]);
    for (const attempt of [
      () => globalWriter.query("insert into public.global_books (title) values ('denied direct')"),
      () =>
        globalWriter.query(
          `insert into public.global_pdf_library
             (global_book_id, storage_path, uploaded_by)
           values (gen_random_uuid(), 'denied.pdf', gen_random_uuid())`
        ),
      () =>
        globalWriter.query(
          `insert into public.book_chunks
             (tenant_id, tenant_book_id, global_book_id, source_type, content, metadata, embedding)
           values (null, null, gen_random_uuid(), 'global_pdf', 'denied chunk', '{}'::jsonb, $1::vector(1536))`,
          [vector]
        ),
    ]) {
      await expect(attempt()).rejects.toMatchObject({ code: '42501' });
    }
    const after = await admin.query<{ books: string; pdfs: string; chunks: string }>(`select
      (select count(*)::text from public.global_books) books,
      (select count(*)::text from public.global_pdf_library) pdfs,
      (select count(*)::text from public.book_chunks where global_book_id is not null) chunks`);
    expect(after.rows).toEqual(before.rows);
  });

  it('fails closed rather than returning partial counts when FORCE RLS is enabled', async () => {
    if (process.env.COCINACORE_OWNER_METRICS_RLS_TEST === '1') {
      try {
        await admin.query('drop policy owner_metrics_users_select on public.users');
        const guarded = await metrics.query('select * from public.owner_global_metrics');
        expect(guarded.rows[0]).toEqual({
          tenants: null,
          users: null,
          books: null,
          pdfs: null,
          chunks: null,
          reports: null,
          owners: null,
        });
        await expect(getOwnerMetrics()).rejects.toThrow('Owner metrics are unavailable');
      } finally {
        await admin.query(
          'create policy owner_metrics_users_select on public.users for select to cocinacore_metrics_view_owner using (true)'
        );
      }
      try {
        await admin.query(
          'alter policy owner_metrics_global_books_select on public.global_books using (false)'
        );
        expect((await metrics.query('select * from public.owner_global_metrics')).rows[0]).toEqual({
          tenants: null,
          users: null,
          books: null,
          pdfs: null,
          chunks: null,
          reports: null,
          owners: null,
        });
        await expect(getOwnerMetrics()).rejects.toThrow('Owner metrics are unavailable');
      } finally {
        await admin.query(
          'alter policy owner_metrics_global_books_select on public.global_books using (true)'
        );
      }
      try {
        await admin.query('alter table public.platform_owners no force row level security');
        expect((await metrics.query('select * from public.owner_global_metrics')).rows[0]).toEqual({
          tenants: null,
          users: null,
          books: null,
          pdfs: null,
          chunks: null,
          reports: null,
          owners: null,
        });
        await expect(getOwnerMetrics()).rejects.toThrow('Owner metrics are unavailable');
      } finally {
        await admin.query('alter table public.platform_owners force row level security');
      }
      return;
    }

    const prior = await admin.query<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>(
      "select relrowsecurity, relforcerowsecurity from pg_class where oid = 'public.users'::regclass"
    );
    expect(prior.rows[0]).toEqual({ relrowsecurity: false, relforcerowsecurity: false });
    try {
      await admin.query(
        'alter table public.users enable row level security; alter table public.users force row level security'
      );
      const guarded = await metrics.query('select * from public.owner_global_metrics');
      expect(guarded.rows[0]).toEqual({
        tenants: null,
        users: null,
        books: null,
        pdfs: null,
        chunks: null,
        reports: null,
        owners: null,
      });
      await expect(getOwnerMetrics()).rejects.toThrow('Owner metrics are unavailable');
    } finally {
      await admin.query(
        'alter table public.users no force row level security; alter table public.users disable row level security'
      );
    }
  });
});
