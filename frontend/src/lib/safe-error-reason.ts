const DATABASE_ERROR_REASONS: Record<string, string> = {
  '23505': 'db_unique_violation',
  '23503': 'db_foreign_key_violation',
  '23514': 'db_check_violation',
  '40001': 'db_serialization_failure',
  '40P01': 'db_deadlock',
  '57014': 'db_query_canceled',
  '08000': 'db_connection_failure',
  '08001': 'db_connection_failure',
  '08003': 'db_connection_failure',
  '08006': 'db_connection_failure',
};

const NETWORK_ERROR_CODES = new Set(['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EPIPE']);

/** Return only fixed, non-sensitive diagnostic classes for untrusted errors. */
export function getSafeErrorReason(error: unknown): string {
  if (typeof error !== 'object' || error === null) return 'unknown_error';

  const code = 'code' in error && typeof error.code === 'string' ? error.code : undefined;
  if (code && DATABASE_ERROR_REASONS[code]) return DATABASE_ERROR_REASONS[code];
  if (code && NETWORK_ERROR_CODES.has(code)) return 'network_failure';

  const name = 'name' in error && typeof error.name === 'string' ? error.name : undefined;
  if (name === 'AbortError' || name === 'DbOperationAbortedError') return 'request_canceled';

  return 'unknown_error';
}
