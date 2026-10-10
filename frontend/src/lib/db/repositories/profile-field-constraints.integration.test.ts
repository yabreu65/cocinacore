import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import type { PoolClient } from 'pg';
import { getPool, query } from '@/lib/db';

const runDatabaseTest = process.env.COCINACORE_RUN_PROFILE_FIELD_CONSTRAINTS_DB_TEST === '1';
const pool = runDatabaseTest ? getPool() : null;
const groupLimits = [
  { key: 'cuisine', limit: 6, preferenceType: 'identity' },
  { key: 'dietary', limit: 12, preferenceType: 'avoid' },
  { key: 'technique', limit: 8, preferenceType: 'prefer' },
  { key: 'ingredient_type', limit: 8, preferenceType: 'prefer' },
  { key: 'goal', limit: 6, preferenceType: 'goal' },
] as const;

function createDeferred() {
  let resolve!: () => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<void>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function waitWithTimeout<T>(promise: Promise<T>, label: string, timeoutMs = 5_000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Timed out waiting for ${label}`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function expectRejectedMutation(
  operation: (client: PoolClient) => Promise<unknown>,
  expectedMessage?: RegExp
): Promise<void> {
  if (!pool) throw new Error('Database pool is unavailable');
  const client = await pool.connect();
  try {
    await client.query('begin');
    const rejection = expect(operation(client)).rejects;
    if (expectedMessage) {
      await rejection.toThrow(expectedMessage);
    } else {
      await rejection.toThrow();
    }
  } finally {
    await client.query('rollback');
    client.release();
  }
}

async function waitForAdvisoryLockWait(backendPid: number, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const activity = await query<{ wait_event_type: string | null; wait_event: string | null }>(
      `select wait_event_type, wait_event from pg_stat_activity where pid = $1`,
      [backendPid]
    );
    const state = activity.rows[0];
    if (state?.wait_event_type === 'Lock' && state.wait_event === 'advisory') return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Transaction B backend ${backendPid} never appeared in advisory lock wait`);
}

afterAll(async () => {
  if (pool) await pool.end();
});

describe('PostgreSQL culinary profile field constraints integration', () => {
  it.skipIf(!runDatabaseTest)('accepts field boundaries and rejects invalid field values and selection caps', async () => {
    const tenantId = randomUUID();
    const userId = randomUUID();
    const movedToUserId = randomUUID();
    const termIds = new Map<string, string[]>();

    try {
      await query(
        `insert into public.tenants (id, tenant_type, name)
         values ($1, 'home', 'Profile field constraints integration')`,
        [tenantId]
      );
      await query(
        `insert into public.users
           (id, email, password_hash, full_name, tenant_id, role, onboarding_completed)
         values ($1, $2, 'integration-only', $3, $4, 'owner', false)`,
        [userId, `profile-fields-${userId}@integration.invalid`, 'x'.repeat(120), tenantId]
      );
      await query(
        `insert into public.users
           (id, email, password_hash, full_name, tenant_id, role, onboarding_completed)
         values ($1, $2, 'integration-only', 'Move target', $3, 'owner', false)`,
        [movedToUserId, `profile-fields-moved-${movedToUserId}@integration.invalid`, tenantId]
      );
      await query(
        `insert into public.user_culinary_profiles
           (user_id, tenant_id, level, available_time_minutes, disliked_ingredients, allergies, household_members)
         values ($1, $2, 'Principiante', 5, $3, $4, $5::jsonb)`,
        [
          userId,
          tenantId,
          Array.from({ length: 20 }, () => 'd'.repeat(80)),
          Array.from({ length: 20 }, () => 'a'.repeat(80)),
          JSON.stringify(Array.from({ length: 12 }, (_, index) => ({ name: `Member ${index}`, ageGroup: 'adult' }))),
        ]
      );

      await expect(
        query('update public.users set full_name = $2 where id = $1', [userId, 'x'.repeat(121)])
      ).rejects.toThrow();
      await expect(
        query('update public.user_culinary_profiles set level = $2 where user_id = $1', [userId, 'Avanzado'])
      ).rejects.toThrow();
      await expect(
        query('update public.user_culinary_profiles set available_time_minutes = $2 where user_id = $1', [userId, 4])
      ).rejects.toThrow();
      await expect(
        query('update public.user_culinary_profiles set available_time_minutes = $2 where user_id = $1', [userId, 241])
      ).rejects.toThrow();
      for (const acceptedLevel of ['Principiante', 'Intermedio', 'Chef', null]) {
        await query('update public.user_culinary_profiles set level = $2 where user_id = $1', [userId, acceptedLevel]);
      }
      await query(
        `update public.user_culinary_profiles
         set available_time_minutes = 240,
             disliked_ingredients = array_fill('d'::text, array[20]),
             allergies = array_fill('a'::text, array[20]),
             household_members = $2::jsonb
         where user_id = $1`,
        [userId, JSON.stringify([{ name: 'N'.repeat(60), ageGroup: 'child' }])]
      );
      await expectRejectedMutation((client) => client.query(
        "update public.user_culinary_profiles set allergies = array['a', null]::text[] where user_id = $1",
        [userId]
      ));
      await expectRejectedMutation((client) => client.query(
        "update public.user_culinary_profiles set disliked_ingredients = array['d', null]::text[] where user_id = $1",
        [userId]
      ));
      await expect(
        query("update public.user_culinary_profiles set allergies = array_fill('a'::text, array[21]) where user_id = $1", [userId])
      ).rejects.toThrow();
      await expect(
        query("update public.user_culinary_profiles set disliked_ingredients = array_fill('d'::text, array[21]) where user_id = $1", [userId])
      ).rejects.toThrow();
      await expect(
        query("update public.user_culinary_profiles set allergies = array['%s'] where user_id = $1".replace('%s', 'a'.repeat(81)), [userId])
      ).rejects.toThrow();
      await expect(
        query("update public.user_culinary_profiles set disliked_ingredients = array['%s'] where user_id = $1".replace('%s', 'd'.repeat(81)), [userId])
      ).rejects.toThrow();
      await expect(
        query('update public.user_culinary_profiles set household_members = $2::jsonb where user_id = $1', [
          userId,
          JSON.stringify([{ name: 'x'.repeat(61), ageGroup: 'adult' }]),
        ])
      ).rejects.toThrow();
      await expect(
        query('update public.user_culinary_profiles set household_members = $2::jsonb where user_id = $1', [
          userId,
          JSON.stringify([{ name: '   ', ageGroup: 'adult' }]),
        ])
      ).rejects.toThrow();
      await expect(
        query('update public.user_culinary_profiles set household_members = $2::jsonb where user_id = $1', [
          userId,
          JSON.stringify([{ name: 'Member', ageGroup: 'unknown' }]),
        ])
      ).rejects.toThrow();
      await expect(
        query('update public.user_culinary_profiles set household_members = $2::jsonb where user_id = $1', [
          userId,
          JSON.stringify([{ name: 'Member', ageGroup: 'adult', extra: true }]),
        ])
      ).rejects.toThrow();
      await expect(
        query('update public.user_culinary_profiles set household_members = $2::jsonb where user_id = $1', [
          userId,
          JSON.stringify(Array.from({ length: 13 }, () => ({ name: 'Member', ageGroup: 'adult' }))),
        ])
      ).rejects.toThrow();

      for (const { key, limit, preferenceType } of groupLimits) {
        const dimension = await query<{ id: string }>(
          'select id from public.culinary_dimensions where key = $1',
          [key]
        );
        const dimensionId = dimension.rows[0]?.id;
        if (!dimensionId) throw new Error(`Seeded culinary dimension ${key} is unavailable`);
        const ids = Array.from({ length: limit + 1 }, () => randomUUID());
        termIds.set(key, ids);
        for (const [index, termId] of ids.entries()) {
          await query(
            'insert into public.culinary_terms (id, dimension_id, label, is_active) values ($1, $2, $3, true)',
            [termId, dimensionId, `${key} term ${index}`]
          );
        }
        for (const termId of ids.slice(0, limit)) {
          await query(
            `insert into public.user_culinary_profile_terms (user_id, term_id, preference_type)
             values ($1, $2, $3)`,
            [userId, termId, preferenceType]
          );
        }
        await expect(
          query(
            `insert into public.user_culinary_profile_terms (user_id, term_id, preference_type)
             values ($1, $2, $3)`,
            [userId, ids[limit], preferenceType]
          )
        ).rejects.toThrow();
        if (key === 'cuisine') {
          await query(
            `update public.user_culinary_profile_terms set preference_type = 'prefer'
             where user_id = $1 and term_id = $2`,
            [userId, ids[0]]
          );
          await query(
            `update public.user_culinary_profile_terms set user_id = $2
             where user_id = $1 and term_id = $3`,
            [userId, movedToUserId, ids[0]]
          );
        }
      }
    } finally {
      await query('delete from public.user_culinary_profile_terms where user_id = any($1::uuid[])', [[userId, movedToUserId]]);
      await query('delete from public.user_culinary_profile_terms where term_id = any($1::uuid[])', [
        [...termIds.values()].flat(),
      ]);
      await query('delete from public.user_culinary_profiles where user_id = $1 and tenant_id = $2', [userId, tenantId]);
      await query('delete from public.users where id = any($1::uuid[]) and tenant_id = $2', [[userId, movedToUserId], tenantId]);
      const createdTermIds = [...termIds.values()].flat();
      await query('delete from public.culinary_terms where id = any($1::uuid[])', [createdTermIds]);
      await query('delete from public.tenants where id = $1', [tenantId]);
      const remaining = await query<{ terms: string; profileTerms: string; profiles: string; users: string; tenants: string }>(
        `select
           (select count(*) from public.culinary_terms where id = any($3::uuid[]))::text as terms,
           (select count(*) from public.user_culinary_profile_terms where user_id = any($4::uuid[])
             or term_id = any($3::uuid[]))::text as "profileTerms",
           (select count(*) from public.user_culinary_profiles where user_id = $1 and tenant_id = $2)::text as profiles,
           (select count(*) from public.users where id = any($4::uuid[]) and tenant_id = $2)::text as users,
           (select count(*) from public.tenants where id = $2)::text as tenants`,
        [userId, tenantId, createdTermIds, [userId, movedToUserId]]
      );
      expect(remaining.rows[0]).toEqual({ terms: '0', profileTerms: '0', profiles: '0', users: '0', tenants: '0' });
      expect(termIds.size).toBe(groupLimits.length);
    }
  }, 30_000);

  it.skipIf(!runDatabaseTest)('rejects selected-term reclassification and selected-dimension key renames', async () => {
    const tenantId = randomUUID();
    const userId = randomUUID();
    const techniqueTermId = randomUUID();
    const cuisineTermId = randomUUID();

    try {
      await query(
        `insert into public.tenants (id, tenant_type, name)
         values ($1, 'home', 'Taxonomy immutability integration')`,
        [tenantId]
      );
      await query(
        `insert into public.users (id, email, password_hash, full_name, tenant_id, role, onboarding_completed)
         values ($1, $2, 'integration-only', 'Taxonomy owner', $3, 'owner', false)`,
        [userId, `taxonomy-${userId}@integration.invalid`, tenantId]
      );
      const dimensions = await query<{ id: string; key: string }>(
        "select id, key from public.culinary_dimensions where key in ('technique', 'cuisine')"
      );
      const dimensionByKey = new Map(dimensions.rows.map((dimension) => [dimension.key, dimension.id]));
      const techniqueDimensionId = dimensionByKey.get('technique');
      const cuisineDimensionId = dimensionByKey.get('cuisine');
      if (!techniqueDimensionId || !cuisineDimensionId) throw new Error('Required seeded culinary dimensions are unavailable');
      await query(
        `insert into public.culinary_terms (id, dimension_id, label, is_active)
         values ($1, $2, 'Selected technique fixture', true), ($3, $4, 'Selected cuisine fixture', true)`,
        [techniqueTermId, techniqueDimensionId, cuisineTermId, cuisineDimensionId]
      );
      await query(
        `insert into public.user_culinary_profile_terms (user_id, term_id, preference_type)
         values ($1, $2, 'prefer'), ($1, $3, 'identity')`,
        [userId, techniqueTermId, cuisineTermId]
      );

      await expectRejectedMutation((client) => client.query(
        'update public.culinary_terms set dimension_id = $2 where id = $1',
        [techniqueTermId, cuisineDimensionId]
      ), /Cannot reclassify culinary term/);
      await expectRejectedMutation((client) => client.query(
        "update public.culinary_dimensions set key = $2 where id = $1",
        [cuisineDimensionId, `renamed-${randomUUID()}`]
      ), /Cannot rename culinary dimension/);
      const unchanged = await query<{ term_dimension_id: string; dimension_key: string }>(
        `select terms.dimension_id as term_dimension_id, dimensions.key as dimension_key
         from public.culinary_terms as terms
         cross join public.culinary_dimensions as dimensions
         where terms.id = $1 and dimensions.id = $2`,
        [techniqueTermId, cuisineDimensionId]
      );
      expect(unchanged.rows[0]).toEqual({ term_dimension_id: techniqueDimensionId, dimension_key: 'cuisine' });
    } finally {
      await query('delete from public.user_culinary_profile_terms where user_id = $1', [userId]);
      await query('delete from public.user_culinary_profile_terms where term_id = any($1::uuid[])', [[techniqueTermId, cuisineTermId]]);
      await query('delete from public.culinary_terms where id = any($1::uuid[])', [[techniqueTermId, cuisineTermId]]);
      await query('delete from public.users where id = $1 and tenant_id = $2', [userId, tenantId]);
      await query('delete from public.tenants where id = $1', [tenantId]);
      const remaining = await query<{ terms: string; profileTerms: string; profiles: string; users: string; tenants: string }>(
        `select
           (select count(*) from public.culinary_terms where id = any($3::uuid[]))::text as terms,
           (select count(*) from public.user_culinary_profile_terms where user_id = $1
             or term_id = any($3::uuid[]))::text as "profileTerms",
           (select count(*) from public.user_culinary_profiles where user_id = $1 and tenant_id = $2)::text as profiles,
           (select count(*) from public.users where id = $1 and tenant_id = $2)::text as users,
           (select count(*) from public.tenants where id = $2)::text as tenants`,
        [userId, tenantId, [techniqueTermId, cuisineTermId]]
      );
      expect(remaining.rows[0]).toEqual({ terms: '0', profileTerms: '0', profiles: '0', users: '0', tenants: '0' });
    }
  }, 20_000);

  it.skipIf(!runDatabaseTest)('rejects taxonomy reclassification waiting behind a committed profile selection under READ COMMITTED', async () => {
    const tenantId = randomUUID();
    const userId = randomUUID();
    const selectedTermId = randomUUID();
    const transactionAReady = createDeferred();
    const releaseTransactionA = createDeferred();
    const transactionBAttemptingUpdate = createDeferred();
    let transactionA: Promise<void> | undefined;
    let transactionB: Promise<void> | undefined;
    let transactionBBackendPid: number | undefined;
    const clientA = await pool!.connect();
    const clientB = await pool!.connect();

    try {
      await query(
        `insert into public.tenants (id, tenant_type, name)
         values ($1, 'home', 'Reverse taxonomy race integration')`,
        [tenantId]
      );
      await query(
        `insert into public.users (id, email, password_hash, full_name, tenant_id, role, onboarding_completed)
         values ($1, $2, 'integration-only', 'Reverse taxonomy owner', $3, 'owner', false)`,
        [userId, `taxonomy-reverse-${userId}@integration.invalid`, tenantId]
      );
      const dimensions = await query<{ id: string; key: string }>(
        "select id, key from public.culinary_dimensions where key in ('cuisine', 'technique')"
      );
      const dimensionByKey = new Map(dimensions.rows.map((dimension) => [dimension.key, dimension.id]));
      const cuisineDimensionId = dimensionByKey.get('cuisine');
      const techniqueDimensionId = dimensionByKey.get('technique');
      if (!cuisineDimensionId || !techniqueDimensionId) throw new Error('Required seeded culinary dimensions are unavailable');
      await query(
        'insert into public.culinary_terms (id, dimension_id, label, is_active) values ($1, $2, $3, true)',
        [selectedTermId, cuisineDimensionId, 'Reverse race unselected cuisine']
      );

      transactionA = (async () => {
        await clientA.query('begin isolation level read committed');
        const isolation = await clientA.query<{ transaction_isolation: string }>('show transaction_isolation');
        expect(isolation.rows[0]?.transaction_isolation).toBe('read committed');
        await clientA.query(
          `insert into public.user_culinary_profile_terms (user_id, term_id, preference_type)
           values ($1, $2, 'identity')`,
          [userId, selectedTermId]
        );
        transactionAReady.resolve();
        await waitWithTimeout(releaseTransactionA.promise, 'profile selection commit barrier');
        await clientA.query('commit');
      })();
      void transactionA.catch((error: unknown) => transactionAReady.reject(error));
      await waitWithTimeout(transactionAReady.promise, 'profile selection and taxonomy locks');

      transactionB = (async () => {
        await clientB.query('begin isolation level read committed');
        const isolation = await clientB.query<{ transaction_isolation: string }>('show transaction_isolation');
        expect(isolation.rows[0]?.transaction_isolation).toBe('read committed');
        const backend = await clientB.query<{ pid: number }>('select pg_backend_pid() as pid');
        transactionBBackendPid = backend.rows[0]?.pid;
        if (transactionBBackendPid === undefined) throw new Error('Transaction B backend PID was unavailable');
        transactionBAttemptingUpdate.resolve();
        await clientB.query(
          'update public.culinary_terms set dimension_id = $2 where id = $1',
          [selectedTermId, techniqueDimensionId]
        );
        await clientB.query('commit');
      })();
      void transactionB.catch(() => undefined);
      await waitWithTimeout(transactionBAttemptingUpdate.promise, 'taxonomy reclassification attempt');
      const backendPid = transactionBBackendPid;
      if (backendPid === undefined) throw new Error('Transaction B backend PID was unavailable');
      await waitForAdvisoryLockWait(backendPid);
      releaseTransactionA.resolve();
      await waitWithTimeout(transactionA, 'profile selection transaction commit');

      let transactionBError: unknown;
      try {
        await waitWithTimeout(transactionB, 'taxonomy reclassification rejection after selection commit');
      } catch (error) {
        if (error instanceof Error && error.message.startsWith('Timed out waiting for')) throw error;
        transactionBError = error;
      }
      expect(transactionBError).toBeInstanceOf(Error);
      expect((transactionBError as Error).message).toBe(
        `Cannot reclassify culinary term ${selectedTermId} while selected by a profile`
      );
      const persistedSelection = await query<{ count: string }>(
        'select count(*)::text as count from public.user_culinary_profile_terms where user_id = $1 and term_id = $2',
        [userId, selectedTermId]
      );
      expect(persistedSelection.rows[0]?.count).toBe('1');
      const unchangedDimension = await query<{ dimension_id: string }>(
        'select dimension_id from public.culinary_terms where id = $1',
        [selectedTermId]
      );
      expect(unchangedDimension.rows[0]?.dimension_id).toBe(cuisineDimensionId);
    } finally {
      releaseTransactionA.resolve();
      await Promise.allSettled([clientA.query('rollback'), clientB.query('rollback')]);
      clientA.release();
      clientB.release();
      await query('delete from public.user_culinary_profile_terms where user_id = $1 or term_id = $2', [userId, selectedTermId]);
      await query('delete from public.culinary_terms where id = $1', [selectedTermId]);
      await query('delete from public.users where id = $1 and tenant_id = $2', [userId, tenantId]);
      await query('delete from public.tenants where id = $1', [tenantId]);
      const remaining = await query<{ terms: string; profileTerms: string; profiles: string; users: string; tenants: string }>(
        `select
           (select count(*) from public.culinary_terms where id = $3)::text as terms,
           (select count(*) from public.user_culinary_profile_terms where user_id = $1 or term_id = $3)::text as "profileTerms",
           (select count(*) from public.user_culinary_profiles where user_id = $1 and tenant_id = $2)::text as profiles,
           (select count(*) from public.users where id = $1 and tenant_id = $2)::text as users,
           (select count(*) from public.tenants where id = $2)::text as tenants`,
        [userId, tenantId, selectedTermId]
      );
      expect(remaining.rows[0]).toEqual({ terms: '0', profileTerms: '0', profiles: '0', users: '0', tenants: '0' });
    }
  }, 20_000);

  it.skipIf(!runDatabaseTest)('serializes taxonomy reclassification against a capped selection under READ COMMITTED', async () => {
    const tenantId = randomUUID();
    const userId = randomUUID();
    const cuisineTermIds = Array.from({ length: 6 }, () => randomUUID());
    const remappedTermId = randomUUID();
    const transactionAReady = createDeferred();
    const releaseTransactionA = createDeferred();
    const transactionBAttemptingInsert = createDeferred();
    let transactionA: Promise<void> | undefined;
    let transactionB: Promise<void> | undefined;
    let transactionBBackendPid: number | undefined;
    const clientA = await pool!.connect();
    const clientB = await pool!.connect();

    try {
      await query(
        `insert into public.tenants (id, tenant_type, name)
         values ($1, 'home', 'Taxonomy concurrency integration')`,
        [tenantId]
      );
      await query(
        `insert into public.users (id, email, password_hash, full_name, tenant_id, role, onboarding_completed)
         values ($1, $2, 'integration-only', 'Taxonomy concurrency owner', $3, 'owner', false)`,
        [userId, `taxonomy-lock-${userId}@integration.invalid`, tenantId]
      );
      const dimensions = await query<{ id: string; key: string }>(
        "select id, key from public.culinary_dimensions where key in ('technique', 'cuisine')"
      );
      const dimensionByKey = new Map(dimensions.rows.map((dimension) => [dimension.key, dimension.id]));
      const techniqueDimensionId = dimensionByKey.get('technique');
      const cuisineDimensionId = dimensionByKey.get('cuisine');
      if (!techniqueDimensionId || !cuisineDimensionId) throw new Error('Required seeded culinary dimensions are unavailable');
      for (const [index, termId] of cuisineTermIds.entries()) {
        await query(
          'insert into public.culinary_terms (id, dimension_id, label, is_active) values ($1, $2, $3, true)',
          [termId, cuisineDimensionId, `Taxonomy cuisine cap ${index}`]
        );
      }
      await query(
        'insert into public.culinary_terms (id, dimension_id, label, is_active) values ($1, $2, $3, true)',
        [remappedTermId, techniqueDimensionId, 'Taxonomy remap candidate']
      );
      for (const termId of cuisineTermIds) {
        await query(
          `insert into public.user_culinary_profile_terms (user_id, term_id, preference_type)
           values ($1, $2, 'identity')`,
          [userId, termId]
        );
      }

      transactionA = (async () => {
        await clientA.query('begin isolation level read committed');
        const isolation = await clientA.query<{ transaction_isolation: string }>('show transaction_isolation');
        expect(isolation.rows[0]?.transaction_isolation).toBe('read committed');
        await clientA.query(
          'update public.culinary_terms set dimension_id = $2 where id = $1',
          [remappedTermId, cuisineDimensionId]
        );
        transactionAReady.resolve();
        await waitWithTimeout(releaseTransactionA.promise, 'taxonomy remap commit barrier');
        await clientA.query('commit');
      })();
      void transactionA.catch((error: unknown) => transactionAReady.reject(error));
      await waitWithTimeout(transactionAReady.promise, 'taxonomy remap and advisory lock');

      transactionB = (async () => {
        await clientB.query('begin isolation level read committed');
        const isolation = await clientB.query<{ transaction_isolation: string }>('show transaction_isolation');
        expect(isolation.rows[0]?.transaction_isolation).toBe('read committed');
        const backend = await clientB.query<{ pid: number }>('select pg_backend_pid() as pid');
        transactionBBackendPid = backend.rows[0]?.pid;
        if (transactionBBackendPid === undefined) throw new Error('Transaction B backend PID was unavailable');
        transactionBAttemptingInsert.resolve();
        await clientB.query(
          `insert into public.user_culinary_profile_terms (user_id, term_id, preference_type)
           values ($1, $2, 'identity')`,
          [userId, remappedTermId]
        );
        await clientB.query('commit');
      })();
      void transactionB.catch(() => undefined);
      await waitWithTimeout(transactionBAttemptingInsert.promise, 'capped taxonomy selection attempt');
      const backendPid = transactionBBackendPid;
      if (backendPid === undefined) throw new Error('Transaction B backend PID was unavailable');
      await waitForAdvisoryLockWait(backendPid);
      releaseTransactionA.resolve();
      await waitWithTimeout(transactionA, 'taxonomy remap transaction commit');
      let transactionBRejected = false;
      try {
        await waitWithTimeout(transactionB, 'capped selection rejection after taxonomy remap');
      } catch (error) {
        if (error instanceof Error && error.message.startsWith('Timed out waiting for')) throw error;
        transactionBRejected = true;
      }
      expect(transactionBRejected).toBe(true);
      const selection = await query<{ count: string }>(
        'select count(*)::text as count from public.user_culinary_profile_terms where user_id = $1 and term_id = $2',
        [userId, remappedTermId]
      );
      expect(selection.rows[0]?.count).toBe('0');
    } finally {
      releaseTransactionA.resolve();
      await Promise.allSettled([clientA.query('rollback'), clientB.query('rollback')]);
      clientA.release();
      clientB.release();
      const allTermIds = [...cuisineTermIds, remappedTermId];
      await query('delete from public.user_culinary_profile_terms where term_id = any($1::uuid[])', [allTermIds]);
      await query('delete from public.user_culinary_profile_terms where user_id = $1', [userId]);
      await query('delete from public.users where id = $1 and tenant_id = $2', [userId, tenantId]);
      await query('delete from public.culinary_terms where id = any($1::uuid[])', [allTermIds]);
      await query('delete from public.tenants where id = $1', [tenantId]);
      const remaining = await query<{ terms: string; profileTerms: string; profiles: string; users: string; tenants: string }>(
        `select
           (select count(*) from public.culinary_terms where id = any($3::uuid[]))::text as terms,
           (select count(*) from public.user_culinary_profile_terms where user_id = $1
             or term_id = any($3::uuid[]))::text as "profileTerms",
           (select count(*) from public.user_culinary_profiles where user_id = $1 and tenant_id = $2)::text as profiles,
           (select count(*) from public.users where id = $1 and tenant_id = $2)::text as users,
           (select count(*) from public.tenants where id = $2)::text as tenants`,
        [userId, tenantId, allTermIds]
      );
      expect(remaining.rows[0]).toEqual({ terms: '0', profileTerms: '0', profiles: '0', users: '0', tenants: '0' });
    }
  }, 20_000);

  it.skipIf(!runDatabaseTest)('serializes concurrent selection inserts under READ COMMITTED using the shared user advisory key', async () => {
    const tenantId = randomUUID();
    const userId = randomUUID();
    const termIds = Array.from({ length: 7 }, () => randomUUID());
    const transactionAReady = createDeferred();
    const releaseTransactionA = createDeferred();
    const transactionBAttemptingInsert = createDeferred();
    let transactionA: Promise<void> | undefined;
    let transactionB: Promise<void> | undefined;
    let transactionBBackendPid: number | undefined;
    const clientA = await getPool().connect();
    const clientB = await getPool().connect();

    try {
      await query(
        `insert into public.tenants (id, tenant_type, name)
         values ($1, 'home', 'Profile constraint concurrency integration')`,
        [tenantId]
      );
      await query(
        `insert into public.users (id, email, password_hash, full_name, tenant_id, role, onboarding_completed)
         values ($1, $2, 'integration-only', 'Concurrency profile', $3, 'owner', false)`,
        [userId, `profile-limit-${userId}@integration.invalid`, tenantId]
      );
      await query(
        'insert into public.user_culinary_profiles (user_id, tenant_id) values ($1, $2)',
        [userId, tenantId]
      );
      const cuisineDimension = await query<{ id: string }>(
        "select id from public.culinary_dimensions where key = 'cuisine'"
      );
      const dimensionId = cuisineDimension.rows[0]?.id;
      if (!dimensionId) throw new Error('Seeded cuisine dimension is unavailable');
      for (const [index, termId] of termIds.entries()) {
        await query(
          'insert into public.culinary_terms (id, dimension_id, label, is_active) values ($1, $2, $3, true)',
          [termId, dimensionId, `Concurrent cuisine ${index}`]
        );
      }
      for (const termId of termIds.slice(0, 5)) {
        await query(
          `insert into public.user_culinary_profile_terms (user_id, term_id, preference_type)
           values ($1, $2, 'identity')`,
          [userId, termId]
        );
      }

      transactionA = (async () => {
        await clientA.query('begin isolation level read committed');
        const isolation = await clientA.query<{ transaction_isolation: string }>('show transaction_isolation');
        expect(isolation.rows[0]?.transaction_isolation).toBe('read committed');
        await clientA.query(
          'select pg_advisory_xact_lock(hashtextextended($1, 0))',
          [`culinary-profile:${userId}`]
        );
        await clientA.query(
          `insert into public.user_culinary_profile_terms (user_id, term_id, preference_type)
           values ($1, $2, 'identity')`,
          [userId, termIds[5]]
        );
        transactionAReady.resolve();
        await waitWithTimeout(releaseTransactionA.promise, 'first transaction commit barrier');
        await clientA.query('commit');
      })();
      void transactionA.catch(() => undefined);
      await waitWithTimeout(transactionAReady.promise, 'first selection insert');

      transactionB = (async () => {
        await clientB.query('begin isolation level read committed');
        const isolation = await clientB.query<{ transaction_isolation: string }>('show transaction_isolation');
        expect(isolation.rows[0]?.transaction_isolation).toBe('read committed');
        const backend = await clientB.query<{ pid: number }>('select pg_backend_pid() as pid');
        transactionBBackendPid = backend.rows[0]?.pid;
        if (transactionBBackendPid === undefined) throw new Error('Transaction B backend PID was unavailable');
        transactionBAttemptingInsert.resolve();
        await clientB.query(
          `insert into public.user_culinary_profile_terms (user_id, term_id, preference_type)
           values ($1, $2, 'identity')`,
          [userId, termIds[6]]
        );
        await clientB.query('commit');
      })();
      void transactionB.catch(() => undefined);
      await waitWithTimeout(transactionBAttemptingInsert.promise, 'second selection insert attempt');
      const backendPid = transactionBBackendPid;
      if (backendPid === undefined) throw new Error('Transaction B backend PID was unavailable');
      await waitForAdvisoryLockWait(backendPid);
      releaseTransactionA.resolve();
      await waitWithTimeout(transactionA, 'first selection transaction commit');
      let transactionBRejected = false;
      try {
        await waitWithTimeout(transactionB, 'second selection transaction rejection');
      } catch (error) {
        if (error instanceof Error && error.message.startsWith('Timed out waiting for')) throw error;
        transactionBRejected = true;
      }
      expect(transactionBRejected).toBe(true);
      const count = await query<{ count: string }>(
        `select count(*)::text as count from public.user_culinary_profile_terms
         where user_id = $1 and term_id in ($2, $3)`,
        [userId, termIds[5], termIds[6]]
      );
      expect(count.rows[0]?.count).toBe('1');
    } finally {
      releaseTransactionA.resolve();
      await Promise.allSettled([clientA.query('rollback'), clientB.query('rollback')]);
      clientA.release();
      clientB.release();
      await query('delete from public.user_culinary_profile_terms where term_id = any($1::uuid[])', [termIds]);
      await query('delete from public.user_culinary_profiles where user_id = $1 and tenant_id = $2', [userId, tenantId]);
      await query('delete from public.users where id = $1 and tenant_id = $2', [userId, tenantId]);
      await query('delete from public.culinary_terms where id = any($1::uuid[])', [termIds]);
      await query('delete from public.tenants where id = $1', [tenantId]);
      const remaining = await query<{ terms: string; profileTerms: string; profiles: string; users: string; tenants: string }>(
        `select
           (select count(*) from public.culinary_terms where id = any($3::uuid[]))::text as terms,
           (select count(*) from public.user_culinary_profile_terms where term_id = any($3::uuid[]))::text as "profileTerms",
           (select count(*) from public.user_culinary_profiles where user_id = $1 and tenant_id = $2)::text as profiles,
           (select count(*) from public.users where id = $1 and tenant_id = $2)::text as users,
           (select count(*) from public.tenants where id = $2)::text as tenants`,
        [userId, tenantId, termIds]
      );
      expect(remaining.rows[0]).toEqual({ terms: '0', profileTerms: '0', profiles: '0', users: '0', tenants: '0' });
    }
  }, 20_000);
});
