import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { getPool, query, transaction } from '@/lib/db';
import {
  findCulinaryProfileByUserIdInTransaction,
  findCulinaryProfileTermsByUserId,
  lockCulinaryProfileUpdateInTransaction,
  saveCulinaryProfileInTransaction,
  setCulinaryProfileTerms,
} from './culinaryProfileRepository';
import { updateUserInTransaction } from './userRepository';

const runDatabaseTest = process.env.COCINACORE_RUN_PROFILE_ATOMICITY_DB_TEST === '1';

const pool = runDatabaseTest ? getPool() : null;

function createDeferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

async function waitWithTimeout<T>(
  promise: Promise<T>,
  label: string,
  timeoutMs = 5_000
): Promise<T> {
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

async function waitForAdvisoryLockWait(
  backendPid: number,
  hasAcquiredLock: () => boolean,
  timeoutMs = 5_000
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (hasAcquiredLock())
      throw new Error('Transaction B acquired the advisory lock before A released it');
    const activity = await query<{ wait_event_type: string | null; wait_event: string | null }>(
      `select wait_event_type, wait_event
       from pg_stat_activity
       where pid = $1`,
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

describe('PostgreSQL profile update atomicity integration', () => {
  it.skipIf(!runDatabaseTest)(
    'validates tenant ownership before replacing terms and serializes concurrent replacements',
    async () => {
      const tenantA = randomUUID();
      const tenantB = randomUUID();
      const userA = randomUUID();
      const userB = randomUUID();
      const emailA = `profile-terms-a-${userA}@integration.invalid`;
      const emailB = `profile-terms-b-${userB}@integration.invalid`;

      try {
        await query(
          `insert into public.tenants (id, tenant_type, name)
           values ($1, 'home', 'Profile terms A'), ($2, 'home', 'Profile terms B')`,
          [tenantA, tenantB]
        );
        await query(
          `insert into public.users
             (id, email, password_hash, full_name, tenant_id, role, onboarding_completed)
           values
             ($1, $3, 'integration-only', 'Terms A', $5, 'owner', false),
             ($2, $4, 'integration-only', 'Terms B', $6, 'owner', false)`,
          [userA, userB, emailA, emailB, tenantA, tenantB]
        );
        await query(
          `insert into public.user_culinary_profiles (user_id, tenant_id, level)
           values ($1, $2, 'Intermedio'), ($3, $4, 'Principiante')`,
          [userA, tenantA, userB, tenantB]
        );

        const termIds = await query<{ id: string }>(
          'select id from public.culinary_terms order by id limit 2'
        );
        const firstTerm = termIds.rows[0]?.id;
        const secondTerm = termIds.rows[1]?.id;
        if (!firstTerm || !secondTerm)
          throw new Error('Disposable database has fewer than two terms');

        await setCulinaryProfileTerms(userA, tenantA, [
          { termId: firstTerm, preferenceType: 'avoid' },
        ]);
        await expect(findCulinaryProfileTermsByUserId(userA, tenantA)).resolves.toHaveLength(1);
        await expect(findCulinaryProfileTermsByUserId(userA, tenantB)).resolves.toEqual([]);
        const validCount = await query<{ count: string }>(
          'select count(*)::text as count from public.user_culinary_profile_terms where user_id = $1',
          [userA]
        );
        expect(validCount.rows[0]?.count).toBe('1');

        await expect(
          setCulinaryProfileTerms(userB, tenantA, [{ termId: secondTerm, preferenceType: 'avoid' }])
        ).rejects.toThrow('Culinary profile belongs to a different tenant');
        await expect(
          setCulinaryProfileTerms(randomUUID(), tenantA, [
            { termId: secondTerm, preferenceType: 'avoid' },
          ])
        ).rejects.toThrow('Culinary profile belongs to a different tenant');

        const afterRejectedWrites = await query<{ count: string }>(
          'select count(*)::text as count from public.user_culinary_profile_terms where user_id = $1',
          [userA]
        );
        expect(afterRejectedWrites.rows[0]?.count).toBe('1');

        await Promise.all([
          setCulinaryProfileTerms(userA, tenantA, [
            { termId: firstTerm, preferenceType: 'prefer' },
          ]),
          setCulinaryProfileTerms(userA, tenantA, [
            { termId: secondTerm, preferenceType: 'avoid' },
          ]),
        ]);

        const concurrentResult = await query<{ term_id: string; preference_type: string }>(
          `select term_id, preference_type
           from public.user_culinary_profile_terms
           where user_id = $1`,
          [userA]
        );
        expect(concurrentResult.rows).toHaveLength(1);
        expect([firstTerm, secondTerm]).toContain(concurrentResult.rows[0]?.term_id);
      } finally {
        await query('delete from public.user_culinary_profile_terms where user_id in ($1, $2)', [
          userA,
          userB,
        ]);
        await query('delete from public.user_culinary_profiles where user_id in ($1, $2)', [
          userA,
          userB,
        ]);
        await query('delete from public.users where id in ($1, $2)', [userA, userB]);
        await query('delete from public.tenants where id in ($1, $2)', [tenantA, tenantB]);
      }
    }
  );

  it.skipIf(!runDatabaseTest)(
    'rolls back user and culinary profile changes when term insertion fails',
    async () => {
      const tenantId = randomUUID();
      const userId = randomUUID();
      const email = `profile-atomicity-${userId}@integration.invalid`;
      const originalName = 'Atomicity baseline';
      const originalLevel = 'Principiante';

      try {
        await query(
          `insert into public.tenants (id, tenant_type, name)
         values ($1, 'home', 'Profile atomicity integration')`,
          [tenantId]
        );
        await query(
          `insert into public.users
           (id, email, password_hash, full_name, tenant_id, role, onboarding_completed)
         values ($1, $2, 'integration-only', $3, $4, 'owner', false)`,
          [userId, email, originalName, tenantId]
        );
        await query(
          `insert into public.user_culinary_profiles (user_id, tenant_id, level)
         values ($1, $2, $3)`,
          [userId, tenantId, originalLevel]
        );

        await expect(
          transaction(async (client) => {
            await updateUserInTransaction(client, userId, {
              fullName: 'Atomicity changed',
              onboardingCompleted: true,
            });
            await saveCulinaryProfileInTransaction(client, {
              userId,
              tenantId,
              level: 'Intermedio',
              terms: [{ termId: 'not-a-valid-uuid', preferenceType: 'avoid' }],
            });
          })
        ).rejects.toThrow();

        const state = await query<{
          full_name: string | null;
          onboarding_completed: boolean;
          level: string | null;
        }>(
          `select users.full_name, users.onboarding_completed, profiles.level
         from public.users as users
         join public.user_culinary_profiles as profiles on profiles.user_id = users.id
         where users.id = $1 and users.tenant_id = $2 and profiles.tenant_id = $2`,
          [userId, tenantId]
        );

        expect(state.rows).toEqual([
          { full_name: originalName, onboarding_completed: false, level: originalLevel },
        ]);
      } finally {
        await query('delete from public.users where id = $1 and tenant_id = $2', [
          userId,
          tenantId,
        ]);
        await query('delete from public.tenants where id = $1', [tenantId]);
      }
    }
  );

  it.skipIf(!runDatabaseTest)(
    'serializes distinct partial updates when the profile row is initially missing',
    async () => {
      const tenantId = randomUUID();
      const userId = randomUUID();
      const email = `profile-concurrency-${userId}@integration.invalid`;
      const transactionAReady = createDeferred();
      const releaseTransactionA = createDeferred();
      const transactionBAttemptingLock = createDeferred();
      let transactionA: Promise<void> | undefined;
      let transactionB: Promise<void> | undefined;
      let transactionBBackendPid: number | undefined;
      let hasTransactionBAcquiredLock = false;

      try {
        await query(
          `insert into public.tenants (id, tenant_type, name)
           values ($1, 'home', 'Profile concurrency integration')`,
          [tenantId]
        );
        await query(
          `insert into public.users
             (id, email, password_hash, full_name, tenant_id, role, onboarding_completed)
           values ($1, $2, 'integration-only', 'Concurrency baseline', $3, 'owner', false)`,
          [userId, email, tenantId]
        );

        transactionA = transaction(async (client) => {
          await lockCulinaryProfileUpdateInTransaction(client, userId, tenantId);
          const existingProfile = await findCulinaryProfileByUserIdInTransaction(
            client,
            userId,
            tenantId
          );
          expect(existingProfile).toBeNull();
          await saveCulinaryProfileInTransaction(client, {
            userId,
            tenantId,
            availableTimeMinutes: 35,
          });
          transactionAReady.resolve();
          await waitWithTimeout(releaseTransactionA.promise, 'transaction A release barrier');
        });
        void transactionA.catch(() => undefined);
        await waitWithTimeout(transactionAReady.promise, 'transaction A lock and profile creation');

        transactionB = transaction(async (client) => {
          const backend = await client.query<{ pid: number }>('select pg_backend_pid() as pid');
          transactionBBackendPid = backend.rows[0]?.pid;
          if (transactionBBackendPid === undefined)
            throw new Error('Transaction B backend PID was unavailable');
          transactionBAttemptingLock.resolve();
          await lockCulinaryProfileUpdateInTransaction(client, userId, tenantId);
          hasTransactionBAcquiredLock = true;
          const profileAfterACommit = await findCulinaryProfileByUserIdInTransaction(
            client,
            userId,
            tenantId
          );
          expect(profileAfterACommit?.available_time_minutes).toBe(35);
          await saveCulinaryProfileInTransaction(client, {
            userId,
            tenantId,
            level: 'Intermedio',
          });
        });
        void transactionB.catch(() => undefined);
        await waitWithTimeout(transactionBAttemptingLock.promise, 'transaction B lock attempt');

        const backendPidForWait = transactionBBackendPid;
        if (backendPidForWait === undefined)
          throw new Error('Transaction B backend PID was unavailable');
        await waitForAdvisoryLockWait(backendPidForWait, () => hasTransactionBAcquiredLock);
        expect(hasTransactionBAcquiredLock).toBe(false);

        releaseTransactionA.resolve();
        await waitWithTimeout(
          Promise.all([transactionA, transactionB]),
          'both profile transactions'
        );

        const finalProfile = await query<{
          available_time_minutes: number | null;
          level: string | null;
        }>(
          `select available_time_minutes, level
           from public.user_culinary_profiles
           where user_id = $1 and tenant_id = $2`,
          [userId, tenantId]
        );
        expect(finalProfile.rows).toEqual([{ available_time_minutes: 35, level: 'Intermedio' }]);
      } finally {
        releaseTransactionA.resolve();
        const pendingTransactions = [transactionA, transactionB].filter(
          (pending): pending is Promise<void> => pending !== undefined
        );
        let transactionWaitError: unknown;
        if (pendingTransactions.length > 0) {
          try {
            await waitWithTimeout(
              Promise.allSettled(pendingTransactions),
              'transaction cleanup',
              10_000
            );
          } catch (error) {
            transactionWaitError = error;
          }
        }

        const cleanupErrors: unknown[] = [];
        for (const [sql, params] of [
          ['delete from public.user_culinary_profile_terms where user_id = $1', [userId]],
          [
            'delete from public.user_culinary_profiles where user_id = $1 and tenant_id = $2',
            [userId, tenantId],
          ],
          ['delete from public.users where id = $1 and tenant_id = $2', [userId, tenantId]],
          ['delete from public.tenants where id = $1', [tenantId]],
        ] as const) {
          try {
            await query(sql, [...params]);
          } catch (error) {
            cleanupErrors.push(error);
          }
        }
        const remaining = await query<{
          profile_terms: string;
          profiles: string;
          users: string;
          tenants: string;
        }>(
          `select
             (select count(*) from public.user_culinary_profile_terms where user_id = $1)::text as profile_terms,
             (select count(*) from public.user_culinary_profiles where user_id = $1 and tenant_id = $2)::text as profiles,
             (select count(*) from public.users where id = $1 and tenant_id = $2)::text as users,
             (select count(*) from public.tenants where id = $2)::text as tenants`,
          [userId, tenantId]
        );
        expect(remaining.rows[0]).toEqual({
          profile_terms: '0',
          profiles: '0',
          users: '0',
          tenants: '0',
        });
        if (cleanupErrors.length > 0)
          throw new Error(`Targeted cleanup failed for ${cleanupErrors.length} resource(s)`);
        if (transactionWaitError) throw transactionWaitError;
      }
    },
    20_000
  );
});
