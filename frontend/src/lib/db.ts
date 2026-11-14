import { Pool, PoolClient, QueryResult, QueryResultRow, types } from 'pg';
import { serverLogger } from './serverLogger';
import { getSafeErrorReason } from './safe-error-reason';

// Parse PostgreSQL timestamps as ISO strings to match the existing contracts.
types.setTypeParser(types.builtins.TIMESTAMPTZ, (value: string) => value);
types.setTypeParser(types.builtins.TIMESTAMP, (value: string) => value);

let pool: Pool | null = null;
let authPool: Pool | null = null;
let authPoolUrl: string | null = null;
let globalWriterPool: Pool | null = null;
let globalWriterPoolUrl: string | null = null;

export interface DbOperationOptions {
  signal?: AbortSignal;
  deadlineAt?: number;
  isolationLevel?: 'read committed' | 'serializable';
}

class DbOperationAbortedError extends Error {
  constructor() {
    super('Database operation cancelled.');
    this.name = 'DbOperationAbortedError';
  }
}

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
      serverLogger.error('db.pool.error', {
        reason: getSafeErrorReason(error),
        operation: 'pool',
      });
    });
  }

  return pool;
}

/** Selectable only by server configuration, not by request parameters. */
function getAuthPool(): Pool {
  const enabled = process.env.COCINACORE_SEPARATE_AUTH_DB;
  if (enabled === undefined || enabled === 'false') return getPool();
  if (enabled !== 'true') throw new Error('Invalid authentication database configuration.');

  const url = process.env.AUTH_DATABASE_URL?.trim();
  if (!url)
    throw new Error('AUTH_DATABASE_URL is required when authentication separation is enabled.');
  if (url === process.env.DATABASE_URL?.trim()) {
    throw new Error('Authentication database connection must be configured separately.');
  }
  if (authPool && authPoolUrl !== url) {
    throw new Error('Authentication database configuration changed; restart the process.');
  }
  if (!authPool) {
    authPool = new Pool({
      connectionString: url,
      max: 20,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
    });
    authPoolUrl = url;
    authPool.on('error', (error) => {
      serverLogger.error('db.pool.error', {
        reason: getSafeErrorReason(error),
        operation: 'auth_pool',
      });
    });
  }
  return authPool;
}

function getGlobalWriterPool(): Pool {
  const url = process.env.OWNER_GLOBAL_WRITER_DATABASE_URL?.trim();
  if (!url) throw new Error('Global writer database is not configured.');
  if (
    [
      process.env.DATABASE_URL,
      process.env.AUTH_DATABASE_URL,
      process.env.OWNER_METRICS_DATABASE_URL,
    ].some((value) => value?.trim() === url)
  )
    throw new Error('Global writer database must use a separate connection.');
  if (globalWriterPool && globalWriterPoolUrl !== url)
    throw new Error('Global writer configuration changed; restart the process.');
  if (!globalWriterPool) {
    globalWriterPool = new Pool({
      connectionString: url,
      max: 2,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
    });
    globalWriterPoolUrl = url;
    globalWriterPool.on('error', (error) => {
      serverLogger.error('db.pool.error', {
        reason: getSafeErrorReason(error),
        operation: 'global_writer_pool',
      });
    });
  }
  return globalWriterPool;
}

export function isGlobalWriterEnabled(): boolean {
  const enabled = process.env.COCINACORE_OWNER_GLOBAL_WRITER_ENABLED;
  if (enabled === undefined || enabled === 'false') return false;
  if (enabled === 'true') return true;
  throw new Error('Invalid global writer configuration.');
}

function cancellationError(): DbOperationAbortedError {
  return new DbOperationAbortedError();
}

function isCancelled(options: DbOperationOptions): boolean {
  return Boolean(
    options.signal?.aborted ||
    (options.deadlineAt !== undefined && options.deadlineAt <= Date.now())
  );
}

async function acquireClient(
  options: DbOperationOptions,
  selectPool: () => Pool = getPool
): Promise<PoolClient> {
  if (isCancelled(options)) throw cancellationError();

  const connection = selectPool().connect();
  let settled = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let abortListener: (() => void) | undefined;

  const cancellation = new Promise<never>((_, reject) => {
    const rejectCancellation = () => {
      if (!settled) reject(cancellationError());
    };
    abortListener = rejectCancellation;
    options.signal?.addEventListener('abort', rejectCancellation, { once: true });
    if (options.deadlineAt !== undefined) {
      timer = setTimeout(rejectCancellation, Math.max(0, options.deadlineAt - Date.now()));
    }
  });

  try {
    const client = await new Promise<PoolClient>((resolve, reject) => {
      connection.then(
        (lateClient) => {
          if (settled) {
            lateClient.release(cancellationError());
            return;
          }
          settled = true;
          resolve(lateClient);
        },
        (error: unknown) => {
          if (!settled) {
            settled = true;
            reject(error);
          }
        }
      );
      cancellation.catch((error: unknown) => {
        if (!settled) {
          settled = true;
          reject(error);
        }
      });
    });
    return client;
  } finally {
    if (timer) clearTimeout(timer);
    if (abortListener) options.signal?.removeEventListener('abort', abortListener);
  }
}

function bindCancellation(client: PoolClient, options: DbOperationOptions) {
  let discarded = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const discard = () => {
    if (discarded) return;
    discarded = true;
    client.release(cancellationError());
  };

  if (options.signal) {
    if (options.signal.aborted) discard();
    else options.signal.addEventListener('abort', discard, { once: true });
  }
  if (options.deadlineAt !== undefined) {
    timer = setTimeout(discard, Math.max(0, options.deadlineAt - Date.now()));
  }

  return {
    get discarded() {
      return discarded;
    },
    dispose() {
      if (timer) clearTimeout(timer);
      options.signal?.removeEventListener('abort', discard);
    },
  };
}

export async function queryWithStatementTimeout<T extends QueryResultRow = QueryResultRow>(
  sql: string,
  params: unknown[] | undefined,
  timeoutMs: number,
  options: DbOperationOptions = {}
): Promise<QueryResult<T>> {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    throw new Error('Statement timeout must be a positive safe integer.');
  }

  return transaction(async (client) => {
    await client.query("select set_config('statement_timeout', $1, true)", [`${timeoutMs}ms`]);
    await client.query("select set_config('lock_timeout', $1, true)", [`${timeoutMs}ms`]);
    return client.query<T>(sql, params);
  }, options);
}

export async function query<T extends QueryResultRow = QueryResultRow>(
  sql: string,
  params?: unknown[],
  options: DbOperationOptions = {}
): Promise<QueryResult<T>> {
  return queryOnPool<T>(getPool, sql, params, options, 'query');
}

export async function authQuery<T extends QueryResultRow = QueryResultRow>(
  sql: string,
  params?: unknown[],
  options: DbOperationOptions = {}
): Promise<QueryResult<T>> {
  return queryOnPool<T>(getAuthPool, sql, params, options, 'auth_query');
}

async function queryOnPool<T extends QueryResultRow>(
  selectPool: () => Pool,
  sql: string,
  params: unknown[] | undefined,
  options: DbOperationOptions,
  operation: 'query' | 'auth_query'
): Promise<QueryResult<T>> {
  const client = await acquireClient(options, selectPool);
  const cancellation = bindCancellation(client, options);
  try {
    return await client.query<T>(sql, params);
  } catch (error) {
    serverLogger.error('db.query.error', {
      reason: getSafeErrorReason(error),
      operation,
    });
    throw error;
  } finally {
    cancellation.dispose();
    if (!cancellation.discarded) client.release();
  }
}

export async function transaction<T>(
  callback: (client: PoolClient) => T | Promise<T>,
  options: DbOperationOptions = {}
): Promise<T> {
  return transactionOnPool(getPool, callback, options);
}

export async function authTransaction<T>(
  callback: (client: PoolClient) => T | Promise<T>,
  options: DbOperationOptions = {}
): Promise<T> {
  return transactionOnPool(getAuthPool, callback, options);
}

export async function globalWriterTransaction<T>(
  callback: (client: PoolClient) => T | Promise<T>,
  options: DbOperationOptions = {}
): Promise<T> {
  return transactionOnPool(
    isGlobalWriterEnabled() ? getGlobalWriterPool : getPool,
    callback,
    options
  );
}

async function transactionOnPool<T>(
  selectPool: () => Pool,
  callback: (client: PoolClient) => T | Promise<T>,
  options: DbOperationOptions
): Promise<T> {
  const client = await acquireClient(options, selectPool);
  const cancellation = bindCancellation(client, options);
  let began = false;
  let releaseError: Error | undefined;
  try {
    const beginStatement =
      options.isolationLevel === 'serializable'
        ? 'begin isolation level serializable'
        : options.isolationLevel === 'read committed'
          ? 'begin isolation level read committed'
          : 'begin';
    await client.query(beginStatement);
    began = true;
    if (cancellation.discarded || isCancelled(options)) throw cancellationError();
    const result = await callback(client);
    if (cancellation.discarded || isCancelled(options)) throw cancellationError();
    await client.query('commit');
    return result;
  } catch (error) {
    if (began && !cancellation.discarded) {
      try {
        await client.query('rollback');
      } catch (rollbackError) {
        // Preserve the original callback or commit error and discard this client.
        releaseError =
          rollbackError instanceof Error
            ? rollbackError
            : new Error('Transaction rollback failed.');
      }
    }
    throw error;
  } finally {
    cancellation.dispose();
    if (!cancellation.discarded) {
      if (releaseError) client.release(releaseError);
      else client.release();
    }
  }
}

/** Caller must derive this scope from verified server-side authentication, never request data. */
export interface AuthenticatedDbScope {
  tenantId: string;
  userId: string;
}

/** Sets transaction-local RLS identity on the same connection as the operation. */
export async function scopedTransaction<T>(
  scope: AuthenticatedDbScope,
  callback: (client: PoolClient) => T | Promise<T>,
  options: DbOperationOptions = {}
): Promise<T> {
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (
    typeof scope?.tenantId !== 'string' ||
    scope.tenantId.length !== 36 ||
    !uuid.test(scope.tenantId) ||
    typeof scope?.userId !== 'string' ||
    scope.userId.length !== 36 ||
    !uuid.test(scope.userId)
  ) {
    throw new Error('Invalid database scope.');
  }
  return transaction(async (client) => {
    await client.query(
      "select set_config('app.tenant_id', $1, true), set_config('app.user_id', $2, true)",
      [scope.tenantId, scope.userId]
    );
    if (isCancelled(options)) throw cancellationError();
    return callback(client);
  }, options);
}

export function mapSingleRow<T extends QueryResultRow>(result: QueryResult<T>): T | null {
  return result.rows[0] ?? null;
}
