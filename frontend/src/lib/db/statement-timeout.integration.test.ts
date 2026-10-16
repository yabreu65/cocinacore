import { afterAll, describe, expect, it } from 'vitest';
import { getPool, queryWithStatementTimeout, query } from '@/lib/db';

const runDatabaseTest =
  process.env.COCINACORE_RUN_STATEMENT_TIMEOUT_DB_TEST === '1' && Boolean(process.env.DATABASE_URL);
const pool = runDatabaseTest ? getPool() : null;

afterAll(async () => {
  if (pool) await pool.end();
});

describe('PostgreSQL statement timeout integration', () => {
  it.skipIf(!runDatabaseTest)('cancels a timed-out statement and keeps the pool usable', async () => {
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
  });
});
