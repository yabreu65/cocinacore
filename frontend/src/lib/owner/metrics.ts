import { Pool } from 'pg';
import { query } from '@/lib/db';
import { serverLogger } from '@/lib/serverLogger';
import { getSafeErrorReason } from '@/lib/safe-error-reason';

export interface OwnerMetrics {
  tenants: number;
  users: number;
  books: number;
  pdfs: number;
  chunks: number;
  reports: number;
  owners: number;
}

type MetricName = keyof OwnerMetrics;
type MetricRow = Record<MetricName, string | null>;
type CountRow = { count: string };
type LegacyMetricsState = { can_use_legacy_counts: boolean };
const metricNames: MetricName[] = [
  'tenants',
  'users',
  'books',
  'pdfs',
  'chunks',
  'reports',
  'owners',
];
let metricsPool: Pool | null = null;
let metricsPoolUrl: string | null = null;

function getMetricsPool(): Pool {
  const url = process.env.OWNER_METRICS_DATABASE_URL?.trim();
  if (!url) throw new Error('Owner metrics database is not configured.');
  if (url === process.env.DATABASE_URL?.trim() || url === process.env.AUTH_DATABASE_URL?.trim()) {
    throw new Error('Owner metrics database must use a separate connection.');
  }
  if (metricsPool && metricsPoolUrl !== url)
    throw new Error('Owner metrics configuration changed; restart the process.');
  if (!metricsPool) {
    metricsPool = new Pool({
      connectionString: url,
      max: 2,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
    });
    metricsPoolUrl = url;
    metricsPool.on('error', (error) => {
      serverLogger.error('owner.metrics.pool_error', { reason: getSafeErrorReason(error) });
    });
  }
  return metricsPool;
}

function parseMetrics(row: MetricRow | undefined): OwnerMetrics {
  if (!row || metricNames.some((name) => row[name] === null || !/^\d+$/.test(row[name]))) {
    throw new Error('Owner metrics are unavailable; review RLS configuration.');
  }
  const values = metricNames.map((name) => Number(row[name]));
  if (values.some((value) => !Number.isSafeInteger(value)))
    throw new Error('Owner metrics are unavailable.');
  return {
    tenants: values[0],
    users: values[1],
    books: values[2],
    pdfs: values[3],
    chunks: values[4],
    reports: values[5],
    owners: values[6],
  };
}

/** Call only after verifying the server-side session and platform-owner authorization. */
export async function getOwnerMetrics(): Promise<OwnerMetrics> {
  const enabled = process.env.COCINACORE_OWNER_METRICS_DB_ENABLED;
  if (enabled === undefined || enabled === 'false') {
    const state = await query<LegacyMetricsState>(`
      select count(*) = 7 and bool_and(not relrowsecurity and not relforcerowsecurity)
        as can_use_legacy_counts
      from pg_catalog.pg_class c
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relname in (
          'tenants', 'users', 'global_books', 'global_pdf_library', 'book_chunks',
          'premium_review_reports', 'platform_owners'
        )
    `);
    if (state.rows[0]?.can_use_legacy_counts !== true) {
      throw new Error('Owner metrics are unavailable; review RLS configuration.');
    }
    const results = await Promise.all([
      query<CountRow>('select count(*)::text as count from public.tenants'),
      query<CountRow>('select count(*)::text as count from public.users'),
      query<CountRow>('select count(*)::text as count from public.global_books'),
      query<CountRow>('select count(*)::text as count from public.global_pdf_library'),
      query<CountRow>(
        'select count(*)::text as count from public.book_chunks where global_book_id is not null'
      ),
      query<CountRow>('select count(*)::text as count from public.premium_review_reports'),
      query<CountRow>('select count(*)::text as count from public.platform_owners'),
    ]);
    return {
      tenants: Number(results[0].rows[0]?.count ?? '0'),
      users: Number(results[1].rows[0]?.count ?? '0'),
      books: Number(results[2].rows[0]?.count ?? '0'),
      pdfs: Number(results[3].rows[0]?.count ?? '0'),
      chunks: Number(results[4].rows[0]?.count ?? '0'),
      reports: Number(results[5].rows[0]?.count ?? '0'),
      owners: Number(results[6].rows[0]?.count ?? '0'),
    };
  }
  if (enabled !== 'true') throw new Error('Invalid owner metrics configuration.');
  let client;
  try {
    client = await getMetricsPool().connect();
    const result = await client.query<MetricRow>(
      'select tenants, users, books, pdfs, chunks, reports, owners from public.owner_global_metrics'
    );
    return parseMetrics(result.rows[0]);
  } catch (error) {
    serverLogger.error('owner.metrics.query_failed', { reason: getSafeErrorReason(error) });
    throw new Error('Owner metrics are unavailable.');
  } finally {
    client?.release();
  }
}
