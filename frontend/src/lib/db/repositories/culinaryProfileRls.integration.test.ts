import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Pool, type PoolClient } from 'pg';
import { getPool, scopedTransaction } from '@/lib/db';
import {
  ProfileTenantMismatchError,
  saveCulinaryProfile,
  saveCulinaryProfileInTransaction,
  setCulinaryProfileTerms,
  upsertCulinaryProfile,
} from './culinaryProfileRepository';
import { updateUserInTransaction } from './userRepository';

const enabled = process.env.COCINACORE_CULINARY_PROFILE_RLS_TEST === '1';
type Scope = { tenantId: string; userId: string };
type SqlContext = { tenantId: string; userId: string } | null;

const tenantA = randomUUID();
const tenantB = randomUUID();
const userA1 = randomUUID();
const userA2 = randomUUID();
const userB1 = randomUUID();
const userA3WithoutProfile = randomUUID();
const userA4ForInsert = randomUUID();
const userA5ForRollback = randomUUID();
const a1: Scope = { tenantId: tenantA, userId: userA1 };
const a2: Scope = { tenantId: tenantA, userId: userA2 };
const b1: Scope = { tenantId: tenantB, userId: userB1 };
const a3: Scope = { tenantId: tenantA, userId: userA3WithoutProfile };
const a4: Scope = { tenantId: tenantA, userId: userA4ForInsert };
const a5: Scope = { tenantId: tenantA, userId: userA5ForRollback };

const terms = {
  a1: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  a2: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaab',
  b1: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaac',
  orphan: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaad',
  a1New: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaae',
};

let admin: Pool;
let runtime: Pool;
let dietaryTermIds: string[] = [];

async function inContext<T>(
  scope: SqlContext,
  operation: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await runtime.connect();
  try {
    await client.query('begin');
    if (scope) {
      await client.query(
        "select set_config('app.tenant_id', $1, true), set_config('app.user_id', $2, true)",
        [scope.tenantId, scope.userId]
      );
    }
    const result = await operation(client);
    await client.query('commit');
    return result;
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

async function insertDietaryTerms(client: PoolClient, userId: string, ids: string[]) {
  const parameters: unknown[] = [userId];
  const values = ids
    .map((termId, index) => {
      parameters.push(termId);
      return `($1, $${index + 2}, 'prefer')`;
    })
    .join(', ');
  return client.query(
    `insert into public.user_culinary_profile_terms (user_id, term_id, preference_type)
     values ${values}`,
    parameters
  );
}

describe.skipIf(!enabled)('020D2 culinary profile FORCE RLS on disposable PostgreSQL', () => {
  beforeAll(async () => {
    const adminUrl = new URL(process.env.SIGNUP_TEST_ADMIN_URL ?? '');
    const runtimeUrl = new URL(process.env.DATABASE_URL ?? '');
    if (
      adminUrl.hostname !== '127.0.0.1' ||
      adminUrl.pathname !== '/signup_real_disposable' ||
      runtimeUrl.hostname !== adminUrl.hostname ||
      runtimeUrl.host !== adminUrl.host ||
      runtimeUrl.pathname !== adminUrl.pathname ||
      runtimeUrl.username !== 'cocinacore_runtime_rls' ||
      ['5435', '6381'].includes(runtimeUrl.port)
    ) {
      throw new Error('Private disposable PostgreSQL with restricted runtime required');
    }
    admin = new Pool({ connectionString: adminUrl.toString(), max: 2 });
    runtime = new Pool({ connectionString: runtimeUrl.toString(), max: 1 });

    const marker = await admin.query<{ marker: string }>(
      "select shobj_description(oid,'pg_database') marker from pg_database where datname=current_database()"
    );
    expect(marker.rows[0].marker).toBe('cocinacore-signup-real-disposable');
    const protectedTables = await runtime.query<{
      table_name: string;
      enabled: boolean;
      forced: boolean;
    }>(
      `select c.relname as table_name, c.relrowsecurity as enabled, c.relforcerowsecurity as forced
         from pg_class c where c.oid = any(array[
           'public.user_culinary_profiles'::regclass,
           'public.user_culinary_profile_terms'::regclass
         ]) order by c.relname`
    );
    expect(protectedTables.rows).toEqual([
      { table_name: 'user_culinary_profile_terms', enabled: true, forced: true },
      { table_name: 'user_culinary_profiles', enabled: true, forced: true },
    ]);
    const identity = await runtime.query<{
      current_user: string;
      rolbypassrls: boolean;
      rolsuper: boolean;
    }>('select current_user, rolbypassrls, rolsuper from pg_roles where rolname=current_user');
    expect(identity.rows[0]).toEqual({
      current_user: 'cocinacore_runtime_rls',
      rolbypassrls: false,
      rolsuper: false,
    });

    await admin.query('insert into public.tenants(id, name) values ($1, $2), ($3, $4)', [
      tenantA,
      '020D2 Tenant A',
      tenantB,
      '020D2 Tenant B',
    ]);
    for (const [scope, label] of [
      [a1, 'a1'],
      [a2, 'a2'],
      [b1, 'b1'],
      [a3, 'a3-orphan'],
      [a4, 'a4-insert'],
      [a5, 'a5-rollback'],
    ] as const) {
      await admin.query(
        'insert into public.users(id, email, password_hash, tenant_id, role) values ($1, $2, $3, $4, $5)',
        [
          scope.userId,
          `020d2-${label}-${randomUUID()}@example.test`,
          'fixture-hash',
          scope.tenantId,
          'owner',
        ]
      );
      await admin.query(
        'insert into public.tenant_memberships(tenant_id, user_id, role) values ($1, $2, $3)',
        [scope.tenantId, scope.userId, 'owner']
      );
    }
    await admin.query(
      `insert into public.user_culinary_profiles (user_id, tenant_id, level, available_time_minutes)
       values ($1, $2, 'A1 profile', 25), ($3, $2, 'A2 profile', 35), ($4, $5, 'B1 profile', 45)`,
      [userA1, tenantA, userA2, userB1, tenantB]
    );
    await admin.query(
      `insert into public.user_culinary_profile_terms (user_id, term_id, preference_type)
       values ($1, $2, 'identity'), ($3, $4, 'avoid'), ($5, $6, 'prefer'), ($7, $8, 'goal')`,
      [userA1, terms.a1, userA2, terms.a2, userB1, terms.b1, userA3WithoutProfile, terms.orphan]
    );

    const extraDietaryTerms = Array.from({ length: 8 }, () => randomUUID());
    dietaryTermIds = [
      'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
      'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbc',
      'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbd',
      'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbe',
      'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbf',
      ...extraDietaryTerms,
    ];
    for (const [index, termId] of extraDietaryTerms.entries()) {
      await admin.query(
        'insert into public.culinary_terms(id, dimension_id, label, is_active) values ($1, $2, $3, true)',
        [termId, '22222222-2222-2222-2222-222222222222', `020D2 dietary fixture ${index}`]
      );
    }
    const orphanRows = await admin.query(
      'select user_id from public.user_culinary_profile_terms where user_id = $1',
      [userA3WithoutProfile]
    );
    expect(orphanRows.rowCount).toBe(1);
    expect(
      (
        await admin.query('select 1 from public.user_culinary_profiles where user_id=$1', [
          userA3WithoutProfile,
        ])
      ).rowCount
    ).toBe(0);
  });

  afterAll(async () => {
    await Promise.all([admin?.end(), runtime?.end(), getPool().end()]);
  });

  it('returns only the active user profile and profile-parented terms for unfiltered SQL', async () => {
    const result = await inContext(a1, async (client) => ({
      profiles: await client.query<{ user_id: string; tenant_id: string }>(
        'select user_id, tenant_id from public.user_culinary_profiles order by user_id'
      ),
      terms: await client.query<{ user_id: string; term_id: string }>(
        'select user_id, term_id from public.user_culinary_profile_terms order by user_id'
      ),
    }));
    expect(result.profiles.rows).toEqual([{ user_id: userA1, tenant_id: tenantA }]);
    expect(result.terms.rows).toEqual([{ user_id: userA1, term_id: terms.a1 }]);

    const crossUserRows = await inContext(a1, (client) =>
      client.query('select user_id from public.user_culinary_profiles where user_id in ($1, $2)', [
        userA2,
        userB1,
      ])
    );
    expect(crossUserRows.rowCount).toBe(0);
    const orphanRows = await inContext(a3, (client) =>
      client.query('select user_id from public.user_culinary_profile_terms')
    );
    expect(orphanRows.rowCount).toBe(0);
  });

  it('allows own profile inserts and business updates while rejecting identity changes and deletes', async () => {
    const inserted = await inContext(a4, (client) =>
      client.query<{ user_id: string; tenant_id: string }>(
        `insert into public.user_culinary_profiles (user_id, tenant_id, level)
         values ($1, $2, 'New profile') returning user_id, tenant_id`,
        [userA4ForInsert, tenantA]
      )
    );
    expect(inserted.rows).toEqual([{ user_id: userA4ForInsert, tenant_id: tenantA }]);

    for (const [userId, tenantId] of [
      [userA2, tenantA],
      [userA1, tenantB],
      [userB1, tenantB],
    ]) {
      await expect(
        inContext(a1, (client) =>
          client.query(
            `insert into public.user_culinary_profiles (user_id, tenant_id, level)
             values ($1, $2, 'unauthorized')`,
            [userId, tenantId]
          )
        )
      ).rejects.toMatchObject({ code: '42501' });
    }

    const update = await inContext(a1, (client) =>
      client.query(
        `update public.user_culinary_profiles set level = 'Updated A1', available_time_minutes = 40
         where user_id = $1`,
        [userA1]
      )
    );
    expect(update.rowCount).toBe(1);
    expect(
      (
        await inContext(a1, (client) =>
          client.query('update public.user_culinary_profiles set level = $1 where user_id = $2', [
            'stolen',
            userA2,
          ])
        )
      ).rowCount
    ).toBe(0);
    for (const identityColumn of ['tenant_id', 'user_id']) {
      await expect(
        inContext(a1, (client) =>
          client.query(
            `update public.user_culinary_profiles set ${identityColumn} = $1 where user_id = $2`,
            [identityColumn === 'tenant_id' ? tenantB : userA2, userA1]
          )
        )
      ).rejects.toMatchObject({ code: '42501' });
    }
    await expect(
      inContext(a1, (client) =>
        client.query('delete from public.user_culinary_profiles where user_id = $1', [userA1])
      )
    ).rejects.toMatchObject({ code: '42501' });
  });

  it('preserves repository UPSERT behavior and the tenant mismatch contract', async () => {
    const upserted = await upsertCulinaryProfile({
      userId: userA1,
      tenantId: tenantA,
      level: 'Repository UPSERT',
    });
    expect(upserted.tenant_id).toBe(tenantA);
    expect(upserted.level).toBe('Repository UPSERT');

    const saved = await saveCulinaryProfile({
      userId: userA1,
      tenantId: tenantA,
      availableTimeMinutes: 55,
    });
    expect(saved.user_id).toBe(userA1);
    expect(saved.tenant_id).toBe(tenantA);
    expect(saved.available_time_minutes).toBe(55);

    await expect(
      saveCulinaryProfile({ userId: userA1, tenantId: tenantB, level: 'Wrong tenant' })
    ).rejects.toBeInstanceOf(ProfileTenantMismatchError);

    await setCulinaryProfileTerms(userA1, tenantA, [
      { termId: terms.a1New, preferenceType: 'goal', weight: 2 },
    ]);
    const replaced = await inContext(a1, (client) =>
      client.query<{ term_id: string; preference_type: string; weight: string }>(
        'select term_id, preference_type, weight::text from public.user_culinary_profile_terms'
      )
    );
    expect(replaced.rows).toEqual([
      { term_id: terms.a1New, preference_type: 'goal', weight: '2.00' },
    ]);
  });

  it('preserves the existing profile field bounds under FORCE RLS', async () => {
    const invalidMutations: Array<{ sql: string; values: unknown[] }> = [
      {
        sql: 'update public.user_culinary_profiles set available_time_minutes = 241 where user_id = $1',
        values: [userA1],
      },
      {
        sql: 'update public.user_culinary_profiles set disliked_ingredients = $2::text[] where user_id = $1',
        values: [userA1, Array.from({ length: 21 }, (_, index) => `ingredient-${index}`)],
      },
      {
        sql: 'update public.user_culinary_profiles set allergies = $2::text[] where user_id = $1',
        values: [userA1, Array.from({ length: 21 }, (_, index) => `allergy-${index}`)],
      },
      {
        sql: 'update public.user_culinary_profiles set household_members = $2::jsonb where user_id = $1',
        values: [
          userA1,
          JSON.stringify(Array.from({ length: 13 }, () => ({ name: 'Member', ageGroup: 'adult' }))),
        ],
      },
    ];
    for (const mutation of invalidMutations) {
      await expect(
        inContext(a1, (client) => client.query(mutation.sql, mutation.values))
      ).rejects.toMatchObject({ code: '23514' });
    }
  });

  it('requires an owned profile for preference reads, inserts and deletes', async () => {
    const ownInsert = await inContext(a1, (client) =>
      client.query(
        `insert into public.user_culinary_profile_terms (user_id, term_id, preference_type)
         values ($1, $2, 'avoid') returning user_id`,
        [userA1, terms.a1New]
      )
    );
    expect(ownInsert.rowCount).toBe(1);

    for (const userId of [userA2, userB1, userA3WithoutProfile]) {
      const tenantId = userId === userB1 ? tenantB : tenantA;
      await expect(
        inContext(a1, (client) =>
          client.query(
            `insert into public.user_culinary_profile_terms (user_id, term_id, preference_type)
             values ($1, $2, 'goal')`,
            [userId, terms.orphan]
          )
        )
      ).rejects.toMatchObject({ code: '42501' });
      expect(
        (
          await inContext({ tenantId, userId }, (client) =>
            client.query('select user_id from public.user_culinary_profile_terms')
          )
        ).rowCount
      ).toBe(userId === userA3WithoutProfile ? 0 : 1);
    }
    await expect(
      inContext(a1, (client) =>
        client.query('update public.user_culinary_profile_terms set weight = 2')
      )
    ).rejects.toMatchObject({ code: '42501' });

    const ownDelete = await inContext(a1, (client) =>
      client.query(
        `delete from public.user_culinary_profile_terms
          where user_id = $1 and term_id = $2 and preference_type = 'avoid'`,
        [userA1, terms.a1New]
      )
    );
    expect(ownDelete.rowCount).toBe(1);
    const foreignDelete = await inContext(a1, (client) =>
      client.query('delete from public.user_culinary_profile_terms where user_id = $1', [userA2])
    );
    expect(foreignDelete.rowCount).toBe(0);
    const orphanDelete = await inContext(a3, (client) =>
      client.query('delete from public.user_culinary_profile_terms where user_id = $1', [
        userA3WithoutProfile,
      ])
    );
    expect(orphanDelete.rowCount).toBe(0);
  });

  it('fails closed without valid context and clears transaction-local GUCs on pooled connections', async () => {
    const noContext = await inContext(null, (client) =>
      client.query('select user_id from public.user_culinary_profiles')
    );
    expect(noContext.rowCount).toBe(0);
    await expect(
      inContext(null, (client) =>
        client.query(
          `insert into public.user_culinary_profiles (user_id, tenant_id) values ($1, $2)`,
          [userA4ForInsert, tenantA]
        )
      )
    ).rejects.toMatchObject({ code: '42501' });
    await expect(
      inContext({ tenantId: 'malformed', userId: userA1 }, (client) =>
        client.query('select user_id from public.user_culinary_profiles')
      )
    ).rejects.toMatchObject({ code: '22P02' });
    await expect(
      inContext({ tenantId: tenantA, userId: 'malformed' }, (client) =>
        client.query('select user_id from public.user_culinary_profile_terms')
      )
    ).rejects.toMatchObject({ code: '22P02' });

    const contradictory = await inContext({ tenantId: tenantA, userId: userB1 }, (client) =>
      client.query('select user_id from public.user_culinary_profiles')
    );
    expect(contradictory.rowCount).toBe(0);
    await expect(
      inContext({ tenantId: tenantA, userId: userB1 }, (client) =>
        client.query(
          `insert into public.user_culinary_profiles (user_id, tenant_id) values ($1, $2)`,
          [userB1, tenantA]
        )
      )
    ).rejects.toMatchObject({ code: '42501' });

    const cleared = await runtime.query<{ tenant_id: string | null; user_id: string | null }>(
      "select current_setting('app.tenant_id', true) as tenant_id, current_setting('app.user_id', true) as user_id"
    );
    expect(cleared.rows[0].tenant_id).not.toBe(tenantA);
    expect(cleared.rows[0].user_id).not.toBe(userA1);
    expect(
      (await runtime.query('select user_id from public.user_culinary_profiles')).rowCount
    ).toBe(0);
  });

  it('rolls back profile creation when preference insertion fails in the same repository transaction', async () => {
    const invalidTermId = randomUUID();
    await expect(
      saveCulinaryProfile({
        userId: userA5ForRollback,
        tenantId: tenantA,
        level: 'Should roll back',
        terms: [{ termId: invalidTermId, preferenceType: 'avoid' }],
      })
    ).rejects.toMatchObject({ code: '23503' });
    expect(
      (
        await admin.query('select user_id from public.user_culinary_profiles where user_id=$1', [
          userA5ForRollback,
        ])
      ).rowCount
    ).toBe(0);
    expect(
      (
        await admin.query(
          'select user_id from public.user_culinary_profile_terms where user_id=$1',
          [userA5ForRollback]
        )
      ).rowCount
    ).toBe(0);
  });

  it('rolls back user and profile changes together on the same scoped client', async () => {
    await expect(
      scopedTransaction(a5, async (client) => {
        await updateUserInTransaction(client, userA5ForRollback, { fullName: 'Must roll back' });
        await saveCulinaryProfileInTransaction(client, {
          userId: userA5ForRollback,
          tenantId: tenantA,
          level: 'Must roll back',
          terms: [{ termId: randomUUID(), preferenceType: 'avoid' }],
        });
      })
    ).rejects.toMatchObject({ code: '23503' });

    const state = await admin.query<{
      full_name: string | null;
      profile_count: string;
      term_count: string;
    }>(
      `select u.full_name,
              (select count(*)::text from public.user_culinary_profiles p where p.user_id = u.id) as profile_count,
              (select count(*)::text from public.user_culinary_profile_terms t where t.user_id = u.id) as term_count
         from public.users u where u.id = $1`,
      [userA5ForRollback]
    );
    expect(state.rows).toEqual([{ full_name: null, profile_count: '0', term_count: '0' }]);
  });

  it('serializes concurrent preference inserts and preserves category limits', async () => {
    await inContext(a4, (client) =>
      client.query('select user_id from public.user_culinary_profiles')
    );
    const runtimeConcurrent = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
    const insertBatch = async (ids: string[]) => {
      const client = await runtimeConcurrent.connect();
      try {
        await client.query('begin');
        await client.query(
          "select set_config('app.tenant_id', $1, true), set_config('app.user_id', $2, true)",
          [tenantA, userA4ForInsert]
        );
        await insertDietaryTerms(client, userA4ForInsert, ids);
        await client.query('commit');
      } catch (error) {
        await client.query('rollback');
        throw error;
      } finally {
        client.release();
      }
    };

    try {
      await Promise.all([
        insertBatch(dietaryTermIds.slice(0, 6)),
        insertBatch(dietaryTermIds.slice(6, 12)),
      ]);
      const count = await admin.query<{ count: string }>(
        `select count(*)::text as count
           from public.user_culinary_profile_terms pt
           join public.culinary_terms t on t.id = pt.term_id
           join public.culinary_dimensions d on d.id = t.dimension_id
          where pt.user_id = $1 and d.key = 'dietary'`,
        [userA4ForInsert]
      );
      expect(count.rows[0].count).toBe('12');
      await expect(
        inContext(a4, (client) => insertDietaryTerms(client, userA4ForInsert, [dietaryTermIds[12]]))
      ).rejects.toMatchObject({ code: 'P0001' });
      const afterRejected = await admin.query<{ count: string }>(
        `select count(*)::text as count
           from public.user_culinary_profile_terms pt
           join public.culinary_terms t on t.id = pt.term_id
           join public.culinary_dimensions d on d.id = t.dimension_id
          where pt.user_id = $1 and d.key = 'dietary'`,
        [userA4ForInsert]
      );
      expect(afterRejected.rows[0].count).toBe('12');
    } finally {
      await runtimeConcurrent.end();
    }
  });
});
