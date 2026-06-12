import { Pool, PoolClient, QueryResult, types } from 'pg';
import { serverLogger } from './serverLogger';

// Parse PostgreSQL timestamps as ISO strings to match the existing contracts.
types.setTypeParser(types.builtins.TIMESTAMPTZ, (value: string) => value);
types.setTypeParser(types.builtins.TIMESTAMP, (value: string) => value);

let pool: Pool | null = null;

function getDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url || url.trim() === '') {
    throw new Error('DATABASE_URL environment variable is required.');
  }
  return url;
}

export function getPool(): Pool {
  if (!pool) {
    pool = new Pool({
      connectionString: getDatabaseUrl(),
      // Reasonable defaults for Next.js serverless/long-running hybrid.
      max: 20,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
    });

    pool.on('error', (error) => {
      serverLogger.error('db.pool.error', { error: error.message });
    });
  }

  return pool;
}

export async function query<T = unknown>(
  sql: string,
  params?: unknown[]
): Promise<QueryResult<T>> {
  const client = await getPool().connect();
  try {
    return await client.query<T>(sql, params);
  } catch (error) {
    serverLogger.error('db.query.error', {
      error: error instanceof Error ? error.message : String(error),
      sql: sql.slice(0, 200),
    });
    throw error;
  } finally {
    client.release();
  }
}

export async function transaction<T>(
  callback: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await getPool().connect();
  await client.query('begin');
  try {
    const result = await callback(client);
    await client.query('commit');
    return result;
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

export function mapSingleRow<T>(result: QueryResult<T>): T | null {
  return result.rows[0] ?? null;
}
