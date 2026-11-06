import type { QueryResultRow } from 'pg';

export interface DbTransactionClient {
  query<R extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: unknown[]
  ): Promise<{ rows: R[] }>;
}
