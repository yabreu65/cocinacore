import { afterAll, describe, expect, it } from 'vitest';
import { getPool, queryWithStatementTimeout, query } from '@/lib/db';

const runDatabaseTest =
  process.env.COCINACORE_RUN_STATEMENT_TIMEOUT_DB_TEST === '1' && Boolean(process.env.DATABASE_URL);
const pool = runDatabaseTest ? getPool() : null;

afterAll(async () => {
  if (pool) await pool.end();
});

describe('PostgreSQL statement timeout integration', () => {
  it.skipIf(!runDatabaseTest)(
    'cancels a timed-out statement and keeps the pool usable',
    async () => {
      let observedError: unknown;
      try {
        await queryWithStatementTimeout('select pg_sleep(2)', [], 100);
      } catch (error) {
        observedError = error;
      }

      expect(observedError).toMatchObject({ code: '57014' });
      await expect(query<{ value: number }>('select 1 as value')).resolves.toMatchObject({
        rows: [{ value: 1 }],
      });
    }
  );

  it.skipIf(!runDatabaseTest)('discards an aborted client and keeps the pool usable', async () => {
    const controller = new AbortController();
    const abortTimer = setTimeout(() => controller.abort(), 100);

    await expect(
      queryWithStatementTimeout('select pg_sleep(2)', [], 10_000, {
        signal: controller.signal,
      })
    ).rejects.toBeInstanceOf(Error);
    clearTimeout(abortTimer);

    await expect(query<{ value: number }>('select 1 as value')).resolves.toMatchObject({
      rows: [{ value: 1 }],
    });
  });
  it.skipIf(!runDatabaseTest)(
    'observes aborted concurrent backends and pool recovery',
    async () => {
      const controller = new AbortController();
      const started = Date.now();
      const pending = Promise.allSettled(
        [1, 2].map(() =>
          queryWithStatementTimeout('select pg_sleep(5) /* m6_abort_observed */', [], 800, {
            signal: controller.signal,
            deadlineAt: Date.now() + 400,
          })
        )
      );
      await new Promise((resolve) => setTimeout(resolve, 100));
      controller.abort();
      expect((await pending).every((result) => result.status === 'rejected')).toBe(true);
      let active = 0;
      do {
        const result = await query<{ active: string }>(
          "select count(*) as active from pg_stat_activity where pid <> pg_backend_pid() and state = 'active' and query like $1",
          ['%m6_abort_observed%']
        );
        active = Number(result.rows[0].active);
        if (active) await new Promise((resolve) => setTimeout(resolve, 50));
      } while (active && Date.now() - started < 2500);
      console.info('M6 backend observation', { elapsedMs: Date.now() - started, active });
      expect(active).toBe(0);
      expect(getPool().waitingCount).toBe(0);
      await expect(query('select 1')).resolves.toBeDefined();
    }
  );

  it.skipIf(!runDatabaseTest)('bounds saturated pool acquisition and recovers', async () => {
    const clients = await Promise.all(Array.from({ length: 20 }, () => getPool().connect()));
    const started = Date.now();
    try {
      await expect(query('select 1', [], { deadlineAt: Date.now() + 100 })).rejects.toThrow();
      expect(Date.now() - started).toBeLessThan(1500);
    } finally {
      clients.forEach((client) => client.release());
    }
    await expect(query('select 1')).resolves.toBeDefined();
    expect(getPool().waitingCount).toBe(0);
  });
});
