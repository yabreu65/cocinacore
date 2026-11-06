import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { Pool, type PoolClient } from 'pg';
import { readFileSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { searchChunks } from '@/lib/db/repositories/bookChunkRepository';
import type { NextRequest } from 'next/server';
import { authQuery, getPool, query, scopedTransaction, transaction } from '@/lib/db';
import { resolveSessionToken } from '@/lib/auth/session';
import {
  deleteSessionByTokenHash,
  hashSessionToken,
} from '@/lib/db/repositories/sessionRepository';
import { loadCookingTeacherContext } from '@/lib/cooking-teacher-context';
import { createPersistentRecipe } from '@/lib/db/repositories/recipeRepository';
import { createInventoryItem } from '@/lib/db/repositories/inventoryRepository';
import { reconcileRealConsumption } from '@/lib/db/repositories/realConsumptionRepository';
import { parseStructuredMealPlanValue } from '@/lib/meal-planner/structured-plan';
import {
  createCookingSession,
  transitionCookingSession,
  getCookingSession,
} from '@/lib/db/repositories/cookingSessionRepository';
import { listInventoryItemsByTenant } from '@/lib/db/repositories/inventoryRepository';
import {
  findCulinaryProfileByUserAndTenant,
  upsertCulinaryProfile,
} from '@/lib/db/repositories/culinaryProfileRepository';
import * as userRepository from '@/lib/db/repositories/userRepository';

const emailMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/email/resend', () => ({
  getAppPublicUrl: () => 'https://app.example.test',
  sendPasswordResetEmail: emailMock,
}));

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: vi
    .fn()
    .mockResolvedValue({ success: true, limit: 100, remaining: 99, resetAt: 1 }),
}));

const enabled = process.env.COCINACORE_SIGNUP_REAL_SCHEMA_TEST === '1';
let admin: Pool;
const { POST } = await import('./route');
const { POST: login } = await import('../login/route');
const { POST: resetRequest } = await import('../password-reset/request/route');
const { POST: resetUpdate } = await import('../password-reset/update/route');
const { updateUserInTransaction } = await import('@/lib/db/repositories/userRepository');
const { saveCulinaryProfileInTransaction } =
  await import('@/lib/db/repositories/culinaryProfileRepository');

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
  const result = await admin.query<{
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

const rlsTables = [
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

async function setContext(client: PoolClient, tenantId: string, userId: string) {
  await client.query(
    "select set_config('app.tenant_id', $1, true), set_config('app.user_id', $2, true)",
    [tenantId, userId]
  );
}

describe.skipIf(!enabled)('signup on real migrations 001–019 (restricted runtime)', () => {
  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL ?? '');
    const adminUrl = new URL(process.env.SIGNUP_TEST_ADMIN_URL ?? '');
    const authUrl = new URL(process.env.AUTH_DATABASE_URL ?? '');
    if (
      url.hostname !== '127.0.0.1' ||
      url.pathname !== '/signup_real_disposable' ||
      url.username !== 'cocinacore_runtime_rls' ||
      ['5435', '6381'].includes(url.port) ||
      url.host !== adminUrl.host ||
      url.pathname !== adminUrl.pathname ||
      authUrl.host !== url.host ||
      authUrl.pathname !== url.pathname ||
      authUrl.username !== 'cocinacore_auth' ||
      process.env.COCINACORE_SEPARATE_AUTH_DB !== 'true'
    )
      throw new Error('A dedicated loopback signup_real_disposable runtime/admin pair is required');
    admin = new Pool({ connectionString: adminUrl.toString() });
    const marker = await admin.query<{ marker: string | null }>(
      "select shobj_description(oid, 'pg_database') marker from pg_database where datname = current_database()"
    );
    expect(marker.rows[0].marker).toBe('cocinacore-signup-real-disposable');
    process.env.AUTH_SECRET = 'disposable-signup-test-secret';
    process.env.RESEND_API_KEY = 'disposable-test';
    process.env.EMAIL_FROM = 'test@example.test';
    process.env.APP_PUBLIC_URL = 'https://app.example.test';
    emailMock.mockResolvedValue(undefined);
    await admin.query(`
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
  afterEach(() => vi.restoreAllMocks());
  afterAll(async () => {
    await getPool().end();
    await admin?.query(`
      drop trigger if exists fail_tenant on public.tenants;
      drop trigger if exists fail_user on public.users;
      drop trigger if exists fail_membership on public.tenant_memberships;
      drop trigger if exists fail_session on public.sessions;
      drop function if exists public.signup_test_failure();
      drop trigger if exists fail_commit on public.sessions;
      drop function if exists public.signup_test_commit_failure();
    `);
    await admin?.end();
  });

  it('keeps legacy signup functional on the verified 019 boundary', async () => {
    const before = await counts();
    const response = await signup('recovery-019-before-a1p@example.test');
    expect(response.status).toBe(200);
    expect(response.headers.get('set-cookie')).toContain('cocinacore_session=');
    const after = await counts();
    for (const key of ['tenants', 'users', 'memberships', 'sessions'] as const) {
      expect(Number(after?.[key])).toBe(Number(before?.[key]) + 1);
    }
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
    const result = await admin.query<{
      email: string;
      tenant_id: string;
      membership_tenant: string;
    }>(
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
    const originalCreate = userRepository.createUser;
    const createUser = vi.spyOn(userRepository, 'createUser');
    let arrivals = 0;
    let open!: () => void;
    const barrier = new Promise<void>((resolve) => {
      open = resolve;
    });
    createUser.mockImplementation(async (...args) => {
      if (++arrivals === 2) open();
      await barrier;
      return originalCreate(...args);
    });
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

  it('uses a non-owner, non-superuser, non-bypass runtime without role memberships', async () => {
    const result = await query(`select current_user, rolsuper, rolbypassrls, rolcreaterole,
      rolcreatedb, rolcanlogin, rolreplication from pg_roles where rolname = current_user`);
    expect(result.rows[0]).toEqual({
      current_user: 'cocinacore_runtime_rls',
      rolsuper: false,
      rolbypassrls: false,
      rolcreaterole: false,
      rolcreatedb: false,
      rolcanlogin: true,
      rolreplication: false,
    });
    expect(
      (
        await query(`select 1 from pg_auth_members where member =
      (select oid from pg_roles where rolname = current_user)`)
      ).rows
    ).toHaveLength(0);
    expect(
      (
        await query(`select 1 from pg_class where relnamespace = 'public'::regnamespace
      and relowner = (select oid from pg_roles where rolname = current_user)`)
      ).rows
    ).toHaveLength(0);
  });

  it('matches the least-privilege RLS matrix and denies administrative capabilities', async () => {
    for (const table of rlsTables) {
      for (const privilege of [
        'SELECT',
        'INSERT',
        'UPDATE',
        'DELETE',
        'TRUNCATE',
        'REFERENCES',
        'TRIGGER',
      ]) {
        const allowed = (
          await query<{ allowed: boolean }>(
            'select has_table_privilege(current_user, $1, $2) allowed',
            [table, privilege]
          )
        ).rows[0].allowed;
        expect(allowed, `${table} ${privilege}`).toBe(
          privilege === 'SELECT' ||
            privilege === 'INSERT' ||
            (privilege === 'UPDATE' && ['user_recipes', 'cooking_sessions'].includes(table))
        );
      }
    }
    expect(
      (
        await query(`select
      has_database_privilege(current_user, current_database(), 'CONNECT') connect,
      has_database_privilege(current_user, current_database(), 'CREATE') as "create",
      has_database_privilege(current_user, current_database(), 'TEMP') temp,
      has_schema_privilege(current_user, 'public', 'USAGE') as "usage",
      has_schema_privilege(current_user, 'public', 'CREATE') schema_create,
      has_table_privilege(current_user, 'schema_migrations', 'SELECT') ledger,
      current_setting('row_security') row_security`)
      ).rows
    ).toEqual([
      {
        connect: true,
        create: false,
        temp: false,
        usage: true,
        schema_create: false,
        ledger: false,
        row_security: 'on',
      },
    ]);
    await expect(query('set role postgres')).rejects.toMatchObject({ code: '42501' });
    await expect(
      query('create temporary table forbidden_runtime_table (id int)')
    ).rejects.toMatchObject({ code: '42501' });
    await expect(
      query('create table public.forbidden_runtime_table (id int)')
    ).rejects.toMatchObject({ code: '42501' });
    const functions = (
      await query<{ proname: string; allowed: boolean; prosecdef: boolean }>(
        `
      select p.proname, has_function_privilege(current_user, p.oid, 'EXECUTE') allowed, p.prosecdef
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = any($1) order by p.proname`,
        [
          [
            'match_chunks',
            'is_valid_culinary_profile_text_list',
            'is_valid_culinary_household_members',
            'is_platform_owner',
            'remove_tenant_member',
            'update_tenant_member_role',
            'accept_tenant_invitation',
            'get_owner_overview_metrics',
            'approve_platform_owner',
          ],
        ]
      )
    ).rows;
    expect(functions).toHaveLength(9);
    for (const fn of functions) {
      expect(fn.prosecdef).toBe(false);
      expect(fn.allowed, fn.proname).toBe(
        ['is_valid_culinary_profile_text_list', 'is_valid_culinary_household_members'].includes(
          fn.proname
        )
      );
    }
    await expect(
      query('select public.match_chunks(null::vector, 0::double precision, 1, null::uuid)')
    ).rejects.toMatchObject({ code: '42501' });
  });

  it('records the pre-020 legacy inventory isolation blocker', async () => {
    const tenantA = randomUUID();
    const tenantB = randomUUID();
    const userA = randomUUID();
    const userB = randomUUID();
    await admin.query(
      "insert into tenants (id, name) values ($1, 'RLS gate A'), ($2, 'RLS gate B')",
      [tenantA, tenantB]
    );
    await admin.query(
      "insert into users (id, tenant_id, email, password_hash) values ($1, $2, $3, 'fixture'), ($4, $5, $6, 'fixture')",
      [userA, tenantA, `${userA}@example.test`, userB, tenantB, `${userB}@example.test`]
    );
    await admin.query(
      'insert into tenant_memberships (tenant_id, user_id) values ($1, $2), ($3, $4)',
      [tenantA, userA, tenantB, userB]
    );
    await admin.query(
      "insert into recipe_inventory_items (tenant_id, user_id, ingredient_name) values ($1, $2, 'RLS gate A'), ($3, $4, 'RLS gate B')",
      [tenantA, userA, tenantB, userB]
    );
    const rows = await scopedTransaction({ tenantId: tenantA, userId: userA }, (client) =>
      client.query<{ tenant_id: string }>(
        'select tenant_id from recipe_inventory_items where tenant_id = any($1::uuid[])',
        [[tenantA, tenantB]]
      )
    );
    // The historical pre-policy run records the leak; the candidate must deny it.
    if (process.env.COCINACORE_INVENTORY_RLS_TEST === '1') {
      expect(rows.rows.map((row) => row.tenant_id)).toEqual([tenantA]);
    } else {
      expect(rows.rows.map((row) => row.tenant_id).sort()).toEqual([tenantA, tenantB].sort());
    }
  });

  it('runs scoped RAG directly while match_chunks is denied', async () => {
    const tenantA = randomUUID();
    const tenantB = randomUUID();
    const userA = randomUUID();
    const userB = randomUUID();
    const globalBook = randomUUID();
    const bookA = randomUUID();
    const bookB = randomUUID();
    await admin.query("insert into tenants (id, name) values ($1, 'RAG A'), ($2, 'RAG B')", [
      tenantA,
      tenantB,
    ]);
    await admin.query(
      "insert into users (id, tenant_id, email, password_hash) values ($1, $2, $3, 'fixture'), ($4, $5, $6, 'fixture')",
      [userA, tenantA, `${userA}@example.test`, userB, tenantB, `${userB}@example.test`]
    );
    await admin.query("insert into global_books (id, title) values ($1, 'Global')", [globalBook]);
    await admin.query(
      "insert into tenant_books (id, tenant_id, title) values ($1, $2, 'A'), ($3, $4, 'B')",
      [bookA, tenantA, bookB, tenantB]
    );
    const embedding = [1, ...Array<number>(1535).fill(0)];
    await admin.query(
      `insert into book_chunks (tenant_id, global_book_id, tenant_book_id, source_type, content, embedding)
       values (null, $1, null, 'global_pdf', 'global', $6::vector),
              ($2, null, $3, 'tenant_pdf', 'private-a', $6::vector),
              ($4, null, $5, 'tenant_pdf', 'private-b', $6::vector),
              (null, null, null, 'ai_generated', 'ambiguous-ai', $6::vector)`,
      [globalBook, tenantA, bookA, tenantB, bookB, JSON.stringify(embedding)]
    );
    for (const [tenantId, userId, own, other] of [
      [tenantA, userA, 'private-a', 'private-b'],
      [tenantB, userB, 'private-b', 'private-a'],
    ]) {
      const results = await searchChunks({
        tenantId,
        userId,
        embedding,
        statementTimeoutMs: 5000,
        matchCount: 20,
      });
      const contents = results.map((row) => row.content);
      expect(contents).toContain('global');
      expect(contents).toContain(own);
      expect(contents).not.toContain(other);
      expect(contents).not.toContain('ambiguous-ai');
    }
  });

  it('has an exact ordered 001–019 ledger and source checksums matching the manifest', async () => {
    const directory = new URL('../../../../../../db/migrations/', import.meta.url);
    const manifest = JSON.parse(readFileSync(new URL('manifest.json', directory), 'utf8')) as {
      migrations: { id: string; filename: string; sha256: string; byteLength: number }[];
    };
    expect(manifest.migrations.map((entry) => entry.id)).toEqual(
      Array.from({ length: 19 }, (_, i) => String(i + 1).padStart(3, '0'))
    );
    const ledger = await admin.query<{ filename: string }>(
      'select filename from schema_migrations order by applied_at, filename'
    );
    expect(ledger.rows.map((row) => row.filename)).toEqual(
      manifest.migrations.map((entry) => entry.filename)
    );
    for (const entry of manifest.migrations) {
      const bytes = readFileSync(new URL(entry.filename, directory));
      expect(bytes.length).toBe(entry.byteLength);
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(entry.sha256);
    }
  });

  it('rejects an existing canonical email without a cookie or partial records', async () => {
    const before = await counts();
    const response = await signup('SUCCESS@example.test');
    expect(response.status).toBe(400);
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(await counts()).toEqual(before);
  });

  it('enforces actual UNIQUE, canonical email, membership and session foreign keys', async () => {
    const before = await counts();
    const user = (
      await authQuery<{ id: string; tenant_id: string }>(
        "select id, tenant_id from users where email = 'success@example.test'"
      )
    ).rows[0];
    await expect(
      authQuery(`insert into users (email, password_hash) values ('success@example.test', 'test')`)
    ).rejects.toMatchObject({ code: '23505', constraint: 'users_email_key' });
    await expect(
      authQuery(`insert into users (email, password_hash) values ('UPPER@example.test', 'test')`)
    ).rejects.toMatchObject({ code: '23514', constraint: 'users_email_canonical_check' });
    await expect(
      authQuery('insert into tenant_memberships (tenant_id, user_id) values ($1, $2)', [
        user.tenant_id,
        user.id,
      ])
    ).rejects.toMatchObject({ code: '23505' });
    await expect(
      authQuery('insert into tenant_memberships (tenant_id, user_id) values ($1, $2)', [
        user.tenant_id,
        randomUUID(),
      ])
    ).rejects.toMatchObject({ code: '23503' });
    await expect(
      authQuery(
        "insert into sessions (user_id, token_hash, expires_at) values ($1, 'invalid-fk', now())",
        [randomUUID()]
      )
    ).rejects.toMatchObject({ code: '23503' });
    const token = (
      await authQuery<{ token_hash: string }>(
        'select token_hash from sessions where user_id = $1',
        [user.id]
      )
    ).rows[0].token_hash;
    await expect(
      authQuery('insert into sessions (user_id, token_hash, expires_at) values ($1, $2, now())', [
        user.id,
        token,
      ])
    ).rejects.toMatchObject({ code: '23505', constraint: 'sessions_token_hash_key' });
    expect(await counts()).toEqual(before);
  });

  it('records the exact RLS boundary, including FORCE RLS on all nine policy tables', async () => {
    const rows = (
      await query<{ relname: string; relforcerowsecurity: boolean }>(`
      select relname, relforcerowsecurity from pg_class
      where relnamespace = 'public'::regnamespace and relrowsecurity order by relname
    `)
    ).rows;
    expect(rows.filter((row) => row.relname !== 'schema_migrations')).toEqual(
      [
        ...rlsTables,
        ...(process.env.COCINACORE_INVENTORY_RLS_TEST === '1'
          ? ['recipe_inventory_items', 'inventory_movements']
          : []),
      ]
        .slice()
        .sort()
        .map((relname) => ({ relname, relforcerowsecurity: true }))
    );
    const core = await query(
      `select relname from pg_class where relnamespace = 'public'::regnamespace
      and relname = any($1) and relrowsecurity`,
      [['tenants', 'users', 'tenant_memberships', 'sessions']]
    );
    expect(core.rows).toHaveLength(0);
    for (const table of rlsTables) {
      expect((await query(`select * from public.${table}`)).rows).toHaveLength(0);
    }
  });

  it('isolates all nine populated RLS tables, including real reconciliation children', async () => {
    const users = (
      await query<{ id: string; tenant_id: string }>(
        "select id, tenant_id from users where email like 'isolation-%' order by email"
      )
    ).rows;
    expect(users).toHaveLength(2);
    const populated = rlsTables;
    for (const user of users) {
      await transaction(async (client) => {
        await setContext(client, user.tenant_id, user.id);
        const recipe = (
          await client.query<{ id: string }>(
            `insert into user_recipes (tenant_id, user_id) values ($1, $2) returning id`,
            [user.tenant_id, user.id]
          )
        ).rows[0].id as string;
        const version = (
          await client.query<{ id: string }>(
            `insert into user_recipe_versions
        (recipe_id, tenant_id, user_id, version_number, title, instructions)
        values ($1, $2, $3, 1, 'Test recipe', 'Test step') returning id`,
            [recipe, user.tenant_id, user.id]
          )
        ).rows[0].id as string;
        const plan = (
          await client.query<{ id: string }>(
            `insert into user_meal_plans
        (tenant_id, user_id, period, mode) values ($1, $2, 'week', 'balanced_ai') returning id`,
            [user.tenant_id, user.id]
          )
        ).rows[0].id as string;
        const session = (
          await client.query<{ id: string }>(
            `insert into cooking_sessions
        (tenant_id, user_id, meal_plan_id, recipe_id, recipe_version_id, day_index, meal_type,
          total_steps, instruction_snapshot, source_updated_at, source_calendar_payload_hash)
        values ($1, $2, $3, $4, $5, 1, 'lunch', 1, '{"steps":[{"index":1,"title":"Prepare","instruction":"Test step"}]}', now(), repeat('a', 64)) returning id`,
            [user.tenant_id, user.id, plan, recipe, version]
          )
        ).rows[0].id as string;
        await client.query<{ id: string }>(
          `insert into cooking_session_events
        (session_id, tenant_id, user_id, operation_type, previous_step, next_step,
          previous_status, next_status, idempotency_key, payload_hash)
        values ($1, $2, $3, 'start', 1, 1, 'active', 'active', 'test', repeat('a', 64))`,
          [session, user.tenant_id, user.id]
        );
        const operation = (
          await client.query<{ id: string }>(
            `insert into real_consumption_operations
        (tenant_id, user_id, cooking_session_id, meal_plan_id, day_index, meal_type,
          recipe_id, recipe_version_id, idempotency_key, request_hash, source_snapshot_hash, status, confirmed_at)
        values ($1, $2, $3, $4, 1, 'lunch', $5, $6, 'test', repeat('a', 64), repeat('a', 64), 'confirmed', now()) returning id`,
            [user.tenant_id, user.id, session, plan, recipe, version]
          )
        ).rows[0].id;
        const inventory = (
          await client.query<{ id: string }>(
            `insert into recipe_inventory_items (tenant_id, user_id, ingredient_name, quantity, unit)
         values ($1, $2, 'Rice', '10', 'g') returning id`,
            [user.tenant_id, user.id]
          )
        ).rows[0].id;
        await client.query(
          `insert into meal_consumption_claims
         (tenant_id, user_id, meal_plan_id, day_index, meal_type, mode, operation_id, operation_status)
         values ($1, $2, $3, 1, 'lunch', 'real_reconciliation', $4, 'confirmed')`,
          [user.tenant_id, user.id, plan, operation]
        );
        const item = (
          await client.query<{ id: string }>(
            `insert into real_consumption_items
         (operation_id, tenant_id, user_id, original_ingredient, normalized_original_ingredient,
          outcome, effective_ingredient, normalized_effective_ingredient, quantity, unit,
          quantity_status, inventory_item_id)
         values ($1, $2, $3, 'Pasta', 'pasta', 'substituted', 'Rice', 'rice', 1, 'g', 'known', $4)
         returning id`,
            [operation, user.tenant_id, user.id, inventory]
          )
        ).rows[0].id;
        await client.query(
          `insert into real_consumption_substitutions
         (operation_id, item_id, tenant_id, user_id, original_ingredient, substitute_ingredient,
          substitute_inventory_item_id)
         values ($1, $2, $3, $4, 'Pasta', 'Rice', $5)`,
          [operation, item, user.tenant_id, user.id, inventory]
        );
        const movement = (
          await client.query<{ id: string }>(
            `insert into inventory_movements
         (tenant_id, user_id, inventory_item_id, movement_type, quantity, unit, normalized_name, source)
         values ($1, $2, $3, 'recipe_consumption', 1, 'g', 'rice', $4) returning id`,
            [user.tenant_id, user.id, inventory, `real-consumption:${operation}`]
          )
        ).rows[0].id;
        await client.query(
          `insert into real_consumption_movement_links
         (operation_id, item_id, movement_id, tenant_id, user_id) values ($1, $2, $3, $4, $5)`,
          [operation, item, movement, user.tenant_id, user.id]
        );
      });
    }
    for (const [index, user] of users.entries()) {
      const other = users[1 - index];
      await transaction(async (client) => {
        await setContext(client, user.tenant_id, user.id);
        for (const table of populated) {
          const own = (await client.query(`select tenant_id, user_id from ${table}`)).rows;
          expect(own).toEqual([{ tenant_id: user.tenant_id, user_id: user.id }]);
          for (const verb of ['update', 'delete'] as const) {
            const granted = (
              await client.query<{ allowed: boolean }>(
                'select has_table_privilege(current_user, $1, $2) allowed',
                [table, verb]
              )
            ).rows[0].allowed;
            const sql =
              verb === 'update'
                ? `update ${table} set tenant_id = tenant_id where tenant_id = $1 returning tenant_id`
                : `delete from ${table} where tenant_id = $1 returning tenant_id`;
            if (granted) {
              expect((await client.query(sql, [other.tenant_id])).rowCount).toBe(0);
            } else {
              await client.query('savepoint denied_acl');
              await expect(client.query(sql, [other.tenant_id])).rejects.toMatchObject({
                code: '42501',
              });
              await client.query('rollback to savepoint denied_acl');
            }
          }
        }
        for (const [tenant, identity] of [
          [user.tenant_id, other.id],
          [other.tenant_id, user.id],
          [user.tenant_id, ''],
          ['', user.id],
        ]) {
          await setContext(client, tenant, identity);
          for (const table of populated)
            expect((await client.query(`select * from ${table}`)).rows).toHaveLength(0);
        }
      });
      await expect(
        transaction(async (client) => {
          await setContext(client, user.tenant_id, user.id);
          await client.query('insert into user_recipes (tenant_id, user_id) values ($1, $2)', [
            other.tenant_id,
            other.id,
          ]);
        })
      ).rejects.toMatchObject({ code: '42501' });
      await transaction(async (client) => {
        await setContext(client, user.tenant_id, user.id);
        await client.query('savepoint forbidden_update');
        await expect(
          client.query('update user_recipes set tenant_id = $1, user_id = $2', [
            other.tenant_id,
            other.id,
          ])
        ).rejects.toMatchObject({ code: '42501' });
        await client.query('rollback to savepoint forbidden_update');
        const ownInsert = await client.query<{ id: string }>(
          'insert into user_recipes (tenant_id, user_id) values ($1, $2) returning id',
          [user.tenant_id, user.id]
        );
        expect(ownInsert.rowCount).toBe(1);
        await client.query('savepoint denied_delete');
        await expect(
          client.query('delete from user_recipes where id = $1', [ownInsert.rows[0].id])
        ).rejects.toMatchObject({ code: '42501' });
        await client.query('rollback to savepoint denied_delete');
        // Roll back the successful write too; persistent fixtures remain one row per owner.
        await client.query('rollback to savepoint forbidden_update');
      });
    }
    // Transaction-local identity must not leak into reused pooled connections.
    for (const table of populated) {
      expect((await query(`select * from ${table}`)).rows).toHaveLength(0);
      expect((await admin.query(`select * from ${table}`)).rows).toHaveLength(2);
    }
  });

  it('rejects cross-owner and missing-context inserts into every populated RLS table', async () => {
    const owners = (
      await query<{ id: string; tenant_id: string }>(
        "select id, tenant_id from users where email like 'isolation-%' order by email"
      )
    ).rows;
    for (const [index, owner] of owners.entries()) {
      const other = owners[1 - index];
      for (const table of rlsTables) {
        // Read an actual valid foreign record as fixture input, never as isolation evidence.
        const record = (
          await admin.query<{ payload: Record<string, unknown> }>(
            `select to_jsonb(t) payload from ${table} t where tenant_id = $1`,
            [other.tenant_id]
          )
        ).rows[0].payload;
        const before = (await admin.query(`select * from ${table} order by tenant_id`)).rows;
        for (const context of ['owner', 'none'] as const) {
          await expect(
            transaction(async (client) => {
              if (context === 'owner') await setContext(client, owner.tenant_id, owner.id);
              await client.query(
                `insert into ${table} select * from jsonb_populate_record(null::${table}, $1::jsonb)`,
                [JSON.stringify(record)]
              );
            })
          ).rejects.toMatchObject(
            // These BEFORE INSERT consistency triggers fail closed before WITH CHECK
            // because their protected parent lookup is invisible. Do not call that RLS-only proof.
            table === 'real_consumption_substitutions'
              ? { code: 'P0001', message: 'REAL_CONSUMPTION_SUBSTITUTION_MISMATCH' }
              : table === 'real_consumption_movement_links'
                ? { code: 'P0001', message: 'REAL_CONSUMPTION_MOVEMENT_LINK_MISMATCH' }
                : { code: '42501' }
          );
          expect((await admin.query(`select * from ${table} order by tenant_id`)).rows).toEqual(
            before
          );
        }
      }
    }
  });

  it('clears both identities after COMMIT and ROLLBACK on the exact same pooled backend', async () => {
    const owners = (
      await query<{ id: string; tenant_id: string }>(
        "select id, tenant_id from users where email like 'isolation-%' order by email"
      )
    ).rows;
    const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
    const pids = new Set<number>();
    try {
      for (const owner of owners) {
        for (const finish of ['commit', 'rollback'] as const) {
          const client = await pool.connect();
          try {
            pids.add(
              (await client.query<{ pid: number }>('select pg_backend_pid() pid')).rows[0].pid
            );
            await client.query('begin');
            await setContext(client, owner.tenant_id, owner.id);
            for (const table of rlsTables) {
              expect((await client.query(`select tenant_id, user_id from ${table}`)).rows).toEqual([
                { tenant_id: owner.tenant_id, user_id: owner.id },
              ]);
            }
            await client.query(finish);
          } finally {
            client.release();
          }
          const reused = await pool.connect();
          try {
            pids.add(
              (await reused.query<{ pid: number }>('select pg_backend_pid() pid')).rows[0].pid
            );
            expect(
              (
                await reused.query(`select
              nullif(current_setting('app.tenant_id', true), '') tenant,
              nullif(current_setting('app.user_id', true), '') as "user"`)
              ).rows
            ).toEqual([{ tenant: null, user: null }]);
            for (const table of rlsTables) {
              expect((await reused.query(`select * from ${table}`)).rows).toHaveLength(0);
              const allowed = (
                await reused.query<{ allowed: boolean }>(
                  "select has_table_privilege(current_user, $1, 'UPDATE') allowed",
                  [table]
                )
              ).rows[0].allowed;
              if (allowed)
                expect(
                  (await reused.query(`update ${table} set tenant_id = tenant_id`)).rowCount
                ).toBe(0);
              else
                await expect(
                  reused.query(`update ${table} set tenant_id = tenant_id`)
                ).rejects.toMatchObject({ code: '42501' });
              await expect(reused.query(`delete from ${table}`)).rejects.toMatchObject({
                code: '42501',
              });
            }
          } finally {
            reused.release();
          }
        }
      }
      expect(pids.size).toBe(1);
    } finally {
      await pool.end();
    }
  });

  it('loads M5 sessions and M6 teacher context with real recipe, inventory and culinary profile repositories', async () => {
    const owners = (
      await query<{ id: string; tenant_id: string }>(
        "select id, tenant_id from users where email like 'isolation-%' order by email"
      )
    ).rows;
    for (const [index, owner] of owners.entries()) {
      const other = owners[1 - index];
      const session = (
        await admin.query<{ id: string }>('select id from cooking_sessions where tenant_id = $1', [
          owner.tenant_id,
        ])
      ).rows[0];
      await upsertCulinaryProfile({
        userId: owner.id,
        tenantId: owner.tenant_id,
        level: 'beginner',
      });
      expect(await findCulinaryProfileByUserAndTenant(owner.id, other.tenant_id)).toBeNull();
      expect((await findCulinaryProfileByUserAndTenant(owner.id, owner.tenant_id))?.level).toBe(
        'beginner'
      );
      expect(
        await listInventoryItemsByTenant(
          owner.tenant_id,
          undefined,
          undefined,
          {},
          { tenantId: owner.tenant_id, userId: owner.id }
        )
      ).toHaveLength(1);
      expect(await getCookingSession(session.id, other.tenant_id, other.id)).toBeNull();
      expect((await getCookingSession(session.id, owner.tenant_id, owner.id))?.id).toBe(session.id);
      const context = await loadCookingTeacherContext(session.id, owner.tenant_id, owner.id);
      expect(context?.authorization).toEqual({
        verified: true,
        tenantScoped: true,
        writes: 'none',
      });
      expect(context?.session.id).toBe(session.id);
      expect(context?.recipe.title).toBe('Test recipe');
      expect(await loadCookingTeacherContext(session.id, other.tenant_id, other.id)).toBeNull();
    }
  });

  it('runs M5 creation/completion and concurrent idempotent reconciliation with the official restricted role', async () => {
    const owner = (
      await admin.query<{ id: string; tenant_id: string }>(
        `select id, tenant_id from users
         where email in ('isolation-a@example.test', '020d1-preflight@example.test')
         order by (email = '020d1-preflight@example.test') limit 1`
      )
    ).rows[0];
    const scope = { tenantId: owner.tenant_id, userId: owner.id };
    const recipe = await createPersistentRecipe(scope, {
      title: 'Lifecycle pasta',
      instructions: 'Cook pasta.',
      servings: 4,
      ingredients: [{ name: 'Pasta', quantity: '1', unit: 'g' }],
    });
    const inventory = await createInventoryItem({
      ...scope,
      ingredientName: 'Rice',
      quantity: '10',
      unit: 'g',
    });
    const calendar = {
      period: 'week',
      dayCount: 7,
      days: Array.from({ length: 7 }, (_, index) => ({
        dayIndex: index + 1,
        meals: ['breakfast', 'lunch', 'dinner'].map((mealType) => ({
          mealType,
          title: 'Lifecycle pasta',
          description: null,
          prepMinutes: 10,
          ingredients: [{ name: 'Pasta', quantity: 1, unit: 'g' }],
          recipeRef: { recipeId: recipe.id, versionId: recipe.current_version.id },
        })),
      })),
      schedule: {
        startDate: '2026-11-01',
        timeZone: 'UTC',
        confirmedAt: '2026-11-01T00:00:00.000Z',
        portionConfirmation: { peopleCount: 4, confirmedAt: '2026-11-01T00:00:00.000Z' },
      },
    };
    expect(parseStructuredMealPlanValue(calendar, 'week').success).toBe(true);
    const plan = (
      await scopedTransaction(scope, (client) =>
        client.query<{ id: string; updated_at: string }>(
          `insert into user_meal_plans (tenant_id, user_id, period, mode, calendar_payload)
           values ($1, $2, 'week', 'balanced_ai', $3::jsonb) returning id, updated_at`,
          [owner.tenant_id, owner.id, JSON.stringify(calendar)]
        )
      )
    ).rows[0];
    const startInput = {
      ...scope,
      mealPlanId: plan.id,
      dayIndex: 1,
      mealType: 'lunch' as const,
      recipeId: recipe.id,
      versionId: recipe.current_version.id,
      expectedUpdatedAt: plan.updated_at,
      expectedCalendarPayload: calendar,
      idempotencyKey: 'lifecycle-start',
    };
    const started = await createCookingSession(startInput);
    expect(started.status).toBe('applied');
    if (started.status !== 'applied') throw new Error('M5 session was not created');
    expect((await createCookingSession(startInput)).status).toBe('already_applied');
    const completed = await transitionCookingSession({
      ...scope,
      sessionId: started.session.id,
      action: 'complete',
      expectedVersion: started.session.version,
      idempotencyKey: 'lifecycle-complete',
    });
    expect(completed.status).toBe('applied');
    if (completed.status !== 'applied') throw new Error('M5 session was not completed');
    const input = {
      ...scope,
      sessionId: completed.session.id,
      expectedVersion: completed.session.version,
      idempotencyKey: 'lifecycle-reconcile',
      confirmed: true as const,
      items: [
        {
          originalIngredient: 'Pasta',
          outcome: 'substituted' as const,
          effectiveIngredient: 'Rice',
          quantity: 1,
          unit: 'g',
          inventoryItemId: inventory.id,
          substituteIngredient: 'Rice',
          substituteInventoryItemId: inventory.id,
        },
      ],
    };
    const results = await Promise.all([
      reconcileRealConsumption(input),
      reconcileRealConsumption(input),
    ]);
    // A raced request may return conflict; a subsequent retry must recover the durable operation.
    expect(results.filter((result) => result.status === 'applied')).toHaveLength(1);
    for (const result of results)
      expect(['applied', 'already_applied', 'conflict']).toContain(result.status);
    const retry = await reconcileRealConsumption(input);
    expect(retry.status).toBe('already_applied');
    expect(
      await reconcileRealConsumption({ ...input, items: [{ ...input.items[0], quantity: 2 }] })
    ).toEqual({ status: 'conflict' });
    expect(
      await reconcileRealConsumption({ ...input, idempotencyKey: 'second-slot-attempt' })
    ).toEqual({ status: 'conflict' });
    const inventoryAfter = (
      await scopedTransaction(scope, (client) =>
        client.query<{ quantity: string }>(
          'select quantity from recipe_inventory_items where id = $1',
          [inventory.id]
        )
      )
    ).rows[0];
    expect(Number(inventoryAfter.quantity)).toBe(9);
    await transaction(async (client) => {
      await setContext(client, owner.tenant_id, owner.id);
      const operation = (
        await client.query<{ id: string }>(
          'select id from real_consumption_operations where cooking_session_id = $1',
          [started.session.id]
        )
      ).rows;
      expect(operation).toHaveLength(1);
      for (const table of [
        'meal_consumption_claims',
        'real_consumption_items',
        'real_consumption_substitutions',
        'real_consumption_movement_links',
      ]) {
        expect(
          (await client.query(`select * from ${table} where operation_id = $1`, [operation[0].id]))
            .rows
        ).toHaveLength(1);
      }
      expect(
        (
          await client.query('select * from inventory_movements where inventory_item_id = $1', [
            inventory.id,
          ])
        ).rows
      ).toHaveLength(1);
    });
    const context = await loadCookingTeacherContext(started.session.id, owner.tenant_id, owner.id);
    expect(context?.session.status).toBe('completed');
    expect(context?.recipe.title).toBe('Lifecycle pasta');
  });

  it('proves separate identities and effective credential and business-table denials', async () => {
    expect(
      (await query<{ current_user: string }>('select current_user')).rows[0].current_user
    ).toBe('cocinacore_runtime_rls');
    expect(
      (await authQuery<{ current_user: string }>('select current_user')).rows[0].current_user
    ).toBe('cocinacore_auth');
    for (const execute of [query, authQuery]) {
      const state = await execute<{
        rolsuper: boolean;
        rolbypassrls: boolean;
        rolcreatedb: boolean;
        rolcreaterole: boolean;
        rolinherit: boolean;
        rolreplication: boolean;
        rolcanlogin: boolean;
        memberships: number;
        owned: number;
      }>(
        `select r.rolsuper, r.rolbypassrls, r.rolcreatedb, r.rolcreaterole, r.rolinherit, r.rolreplication, r.rolcanlogin,
          (select count(*)::int from pg_auth_members where member = r.oid or roleid = r.oid) memberships,
          (select count(*)::int from pg_class c where c.relnamespace = 'public'::regnamespace and c.relowner = r.oid) owned
         from pg_roles r where r.rolname = current_user`
      );
      expect(state.rows[0]).toEqual({
        rolsuper: false,
        rolbypassrls: false,
        rolcreatedb: false,
        rolcreaterole: false,
        rolinherit: false,
        rolreplication: false,
        rolcanlogin: true,
        memberships: 0,
        owned: 0,
      });
      await expect(execute('set role postgres')).rejects.toMatchObject({ code: '42501' });
      await expect(execute('create temporary table no_privileges (id int)')).rejects.toMatchObject({
        code: '42501',
      });
    }
    for (const sql of [
      'select password_hash from public.users',
      'select * from public.sessions',
      'delete from public.sessions',
      'select * from public.password_reset_tokens',
      'update public.password_reset_tokens set used_at = now()',
      "insert into public.tenant_memberships (tenant_id, user_id, role) values (gen_random_uuid(), gen_random_uuid(), 'owner')",
    ])
      await expect(query(sql)).rejects.toMatchObject({ code: '42501' });
    for (const table of [
      'recipe_inventory_items',
      'inventory_movements',
      'user_meal_plans',
      'user_recipes',
      'book_chunks',
      'shopping_list_items',
    ]) {
      await expect(authQuery(`select * from public.${table}`)).rejects.toMatchObject({
        code: '42501',
      });
    }
    const acl = await query<{
      password_read: boolean;
      fullname_read: boolean;
      fullname_update: boolean;
      role_update: boolean;
      session_read: boolean;
      reset_read: boolean;
    }>(`
      select has_column_privilege(current_user, 'public.users', 'password_hash', 'SELECT') password_read,
        has_column_privilege(current_user, 'public.users', 'full_name', 'SELECT') fullname_read,
        has_column_privilege(current_user, 'public.users', 'full_name', 'UPDATE') fullname_update,
        has_column_privilege(current_user, 'public.users', 'role', 'UPDATE') role_update,
        has_table_privilege(current_user, 'public.sessions', 'SELECT') session_read,
        has_table_privilege(current_user, 'public.password_reset_tokens', 'SELECT') reset_read`);
    expect(acl.rows[0]).toEqual({
      password_read: false,
      fullname_read: true,
      fullname_update: true,
      role_update: false,
      session_read: false,
      reset_read: false,
    });
    const expectedAuthTables: Record<string, string[]> = {
      tenants: ['SELECT'],
      users: ['SELECT'],
      sessions: ['SELECT', 'DELETE'],
      password_reset_tokens: ['SELECT'],
    };
    const tables = (
      await admin.query<{ name: string }>(
        "select c.relname as name from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind in ('r','p','v','m','f') order by c.relname"
      )
    ).rows;
    for (const { name } of tables) {
      for (const privilege of [
        'SELECT',
        'INSERT',
        'UPDATE',
        'DELETE',
        'TRUNCATE',
        'REFERENCES',
        'TRIGGER',
      ]) {
        const allowed = (
          await authQuery<{ allowed: boolean }>(
            'select has_table_privilege(current_user, $1, $2) allowed',
            [`public.${name}`, privilege]
          )
        ).rows[0].allowed;
        expect(allowed, `auth table ${name} ${privilege}`).toBe(
          (expectedAuthTables[name] ?? []).includes(privilege)
        );
      }
    }
    const columnGrants: Record<string, Record<string, string[]>> = {
      tenants: { INSERT: ['name', 'tenant_type', 'trial_started_at', 'trial_ends_at'] },
      users: {
        INSERT: [
          'email',
          'password_hash',
          'full_name',
          'tenant_id',
          'role',
          'terms_accepted_at',
          'terms_version',
          'email_confirmed',
        ],
        UPDATE: ['password_hash', 'updated_at'],
      },
      tenant_memberships: { INSERT: ['tenant_id', 'user_id', 'role'] },
      sessions: { INSERT: ['user_id', 'token_hash', 'expires_at'], UPDATE: ['last_seen_at'] },
      password_reset_tokens: {
        INSERT: ['user_id', 'token_hash', 'requested_ip_hash', 'expires_at'],
        UPDATE: ['used_at'],
      },
    };
    for (const { name } of tables) {
      const columns = (
        await admin.query<{ name: string }>(
          'select attname as name from pg_attribute where attrelid = $1::regclass and attnum > 0 and not attisdropped',
          [`public.${name}`]
        )
      ).rows;
      for (const column of columns)
        for (const privilege of ['INSERT', 'UPDATE', 'REFERENCES']) {
          const allowed = (
            await authQuery<{ allowed: boolean }>(
              'select has_column_privilege(current_user, $1, $2, $3) allowed',
              [`public.${name}`, column.name, privilege]
            )
          ).rows[0].allowed;
          expect(allowed, `auth column ${name}.${column.name} ${privilege}`).toBe(
            (columnGrants[name]?.[privilege] ?? []).includes(column.name)
          );
        }
    }
    // This is a known administrative boundary failure, not an assertion of tenant isolation.
    expect(
      Number(
        (await query<{ count: string }>('select count(*)::text as count from public.users')).rows[0]
          .count
      )
    ).toBeGreaterThan(1);
  });

  it('reads members and billing and atomically updates user and culinary profile on runtime', async () => {
    const owner = (
      await admin.query<{ id: string; tenant_id: string }>(
        "select id, tenant_id from users where email = 'isolation-a@example.test'"
      )
    ).rows[0];
    const members = await query(
      'select id, full_name, email, role, created_at from public.users where tenant_id = $1 order by created_at asc',
      [owner.tenant_id]
    );
    expect(members.rows.length).toBeGreaterThan(0);
    expect(
      (
        await query('select trial_ends_at, tenant_type from public.tenants where id = $1', [
          owner.tenant_id,
        ])
      ).rows
    ).toHaveLength(1);
    expect(
      Number(
        (
          await query<{ count: string }>(
            'select count(*)::text as count from public.users where tenant_id = $1',
            [owner.tenant_id]
          )
        ).rows[0].count
      )
    ).toBeGreaterThan(0);
    const before = (
      await query<{ full_name: string | null }>(
        'select full_name from public.users where id = $1',
        [owner.id]
      )
    ).rows[0].full_name;
    await expect(
      transaction(async (client) => {
        await updateUserInTransaction(client, owner.id, { fullName: 'Rollback test' });
        await saveCulinaryProfileInTransaction(client, {
          userId: owner.id,
          tenantId: owner.tenant_id,
          level: 'beginner',
        });
        throw new Error('injected profile failure');
      })
    ).rejects.toThrow('injected profile failure');
    expect(
      (
        await query<{ full_name: string | null }>(
          'select full_name from public.users where id = $1',
          [owner.id]
        )
      ).rows[0].full_name
    ).toBe(before);
    await transaction(async (client) => {
      await updateUserInTransaction(client, owner.id, {
        fullName: 'Updated owner',
        onboardingCompleted: true,
      });
      await saveCulinaryProfileInTransaction(client, {
        userId: owner.id,
        tenantId: owner.tenant_id,
        level: 'beginner',
      });
    });
    expect(
      (
        await query('select full_name, onboarding_completed from public.users where id = $1', [
          owner.id,
        ])
      ).rows[0]
    ).toEqual({ full_name: 'Updated owner', onboarding_completed: true });
  });

  it('runs login, sessions, recovery, concurrent consumption and rollback using auth identity', async () => {
    const email = 'auth-flow@example.test';
    expect((await signup(email)).status).toBe(200);
    const request = (path: string, body: unknown) =>
      new Request(`http://localhost/api/auth/${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }) as unknown as NextRequest;
    expect((await login(request('login', { email, password: 'bad-password' }))).status).toBe(401);
    const loggedIn = await login(request('login', { email, password: 'SecurePassword123!' }));
    expect(loggedIn.status).toBe(200);
    const sessionToken = decodeURIComponent(
      loggedIn.headers.get('set-cookie')?.match(/cocinacore_session=([^;]+)/)?.[1] ?? ''
    );
    expect((await resolveSessionToken(sessionToken))?.user.email).toBe(email);
    await deleteSessionByTokenHash(await hashSessionToken(sessionToken));
    expect(await resolveSessionToken(sessionToken)).toBeNull();
    const expiringLogin = await login(request('login', { email, password: 'SecurePassword123!' }));
    const expiringToken = decodeURIComponent(
      expiringLogin.headers.get('set-cookie')?.match(/cocinacore_session=([^;]+)/)?.[1] ?? ''
    );
    await admin.query(
      "update public.sessions set expires_at = now() - interval '1 second' where token_hash = $1",
      [await hashSessionToken(expiringToken)]
    );
    expect(await resolveSessionToken(expiringToken)).toBeNull();
    const activeLogin = await login(request('login', { email, password: 'SecurePassword123!' }));
    const activeSessionToken = decodeURIComponent(
      activeLogin.headers.get('set-cookie')?.match(/cocinacore_session=([^;]+)/)?.[1] ?? ''
    );
    expect((await resolveSessionToken(activeSessionToken))?.user.email).toBe(email);
    const unknown = await resetRequest(
      request('password-reset/request', { email: 'unknown@example.test' })
    );
    const existing = await resetRequest(request('password-reset/request', { email }));
    expect(await unknown.json()).toEqual(await existing.json());
    const resetToken = () => {
      const args = emailMock.mock.calls.at(-1)?.[0] as { resetUrl: string };
      return new URL(args.resetUrl).searchParams.get('token') ?? '';
    };
    const oldToken = resetToken();
    expect((await resetRequest(request('password-reset/request', { email }))).status).toBe(200);
    const activeToken = resetToken();
    const body = (token: string) => ({
      token,
      password: 'NewPassword123!',
      confirmPassword: 'NewPassword123!',
    });
    expect((await resetUpdate(request('password-reset/update', body(oldToken)))).status).toBe(401);
    await admin.query(`create function fail_reset_for_test() returns trigger language plpgsql as $$
      begin if exists (select 1 from public.users where id = old.user_id and email = 'auth-flow@example.test') then raise exception 'injected reset failure'; end if; return old; end $$;
      create trigger fail_reset_for_test before delete on public.sessions for each row execute function fail_reset_for_test();`);
    expect((await resetUpdate(request('password-reset/update', body(activeToken)))).status).toBe(
      500
    );
    expect((await resolveSessionToken(activeSessionToken))?.user.email).toBe(email);
    expect((await login(request('login', { email, password: 'SecurePassword123!' }))).status).toBe(
      200
    );
    await admin.query(
      'drop trigger fail_reset_for_test on public.sessions; drop function fail_reset_for_test()'
    );
    const results = await Promise.all([
      resetUpdate(request('password-reset/update', body(activeToken))),
      resetUpdate(request('password-reset/update', body(activeToken))),
    ]);
    expect(results.map((result) => result.status).sort()).toEqual([200, 401]);
    expect(await resolveSessionToken(activeSessionToken)).toBeNull();
    expect((await login(request('login', { email, password: 'SecurePassword123!' }))).status).toBe(
      401
    );
    expect((await login(request('login', { email, password: 'NewPassword123!' }))).status).toBe(
      200
    );
  });
});
