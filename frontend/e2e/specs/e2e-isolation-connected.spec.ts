import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import Redis from 'ioredis';
import { Pool } from 'pg';
import { validateE2ETargets } from '../database-target';
import { assertE2EDisposableIsolation } from '../fixtures/database';
import { buildE2ECachePattern, requireE2EExecutionId } from '../fixtures/isolation';

const targets = validateE2ETargets(process.env);
const database = new Pool({ connectionString: targets.databaseUrl });
const executionId = requireE2EExecutionId(process.env);

test.describe('E2E disposable isolation contract', () => {
  test('rejects a concurrent worker and cleans only its Redis namespace', async () => {
    await assertE2EDisposableIsolation(database);

    const firstWorker = await database.connect();
    const secondWorker = await database.connect();
    const lockName = `cocinacore:e2e:isolation-probe:${randomUUID()}`;
    const redis = new Redis(targets.redisUrl, { maxRetriesPerRequest: 1 });
    const workerA = `${executionId}-worker-a-${randomUUID().slice(0, 8)}`;
    const workerB = `${executionId}-worker-b-${randomUUID().slice(0, 8)}`;
    const external = `${executionId}-external-${randomUUID().slice(0, 8)}`;
    const keyA = `recipe:e2e:${workerA}:owned`;
    const keyB = `recipe:e2e:${workerB}:owned`;
    const keyExternal = `recipe:e2e:${external}:owned`;

    try {
      const firstLease = await firstWorker.query<{ acquired: boolean }>(
        'select pg_try_advisory_lock(hashtextextended($1, 0)) as acquired',
        [lockName]
      );
      const secondLease = await secondWorker.query<{ acquired: boolean }>(
        'select pg_try_advisory_lock(hashtextextended($1, 0)) as acquired',
        [lockName]
      );
      expect(firstLease.rows[0]?.acquired).toBe(true);
      expect(secondLease.rows[0]?.acquired).toBe(false);

      await redis.set(keyA, 'worker-a');
      await redis.set(keyB, 'worker-b');
      await redis.set(keyExternal, 'external');

      const pattern = buildE2ECachePattern({
        COCINACORE_E2E_EXECUTION_ID: workerA,
      });
      let cursor = '0';
      do {
        const [nextCursor, keys] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', '100');
        cursor = nextCursor;
        if (keys.length > 0) await redis.del(...keys);
      } while (cursor !== '0');

      expect(await redis.get(keyA)).toBeNull();
      expect(await redis.get(keyB)).toBe('worker-b');
      expect(await redis.get(keyExternal)).toBe('external');
    } finally {
      await firstWorker.query('select pg_advisory_unlock(hashtextextended($1, 0))', [lockName]);
      await secondWorker.query('select pg_advisory_unlock(hashtextextended($1, 0))', [lockName]);
      await redis.del(keyA, keyB, keyExternal);
      await redis.quit();
      firstWorker.release();
      secondWorker.release();
    }
  });

  test.afterAll(async () => {
    await database.end();
  });
});
