import { Pool, PoolClient, QueryResult, QueryResultRow, types } from 'pg';
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

export async function queryWithStatementTimeout<T extends QueryResultRow = QueryResultRow>(
  sql: string,
  params: unknown[] | undefined,
  timeoutMs: number
): Promise<QueryResult<T>> {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    throw new Error('Statement timeout must be a positive safe integer.');
  }

  return transaction(async (client) => {
    await client.query("select set_config('statement_timeout', $1, true)", [`${timeoutMs}ms`]);
    return client.query<T>(sql, params);
  });
}

export async function query<T extends QueryResultRow = QueryResultRow>(
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
  callback: (client: PoolClient) => T | Promise<T>
): Promise<T> {
  const client = await getPool().connect();
  let began = false;
  let releaseError: Error | undefined;
  try {
    await client.query('begin');
    began = true;
    const result = await callback(client);
    await client.query('commit');
    return result;
  } catch (error) {
    if (began) {
      try {
        await client.query('rollback');
      } catch (rollbackError) {
        // Preserve the original callback or commit error and discard this client.
        releaseError = rollbackError instanceof Error
          ? rollbackError
          : new Error('Transaction rollback failed.');
      }
    }
    throw error;
  } finally {
    if (releaseError) client.release(releaseError);
    else client.release();
  }
}

export function mapSingleRow<T extends QueryResultRow>(result: QueryResult<T>): T | null {
  return result.rows[0] ?? null;
}
