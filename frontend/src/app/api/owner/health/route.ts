import { type NextRequest, NextResponse } from 'next/server';
import Redis from 'ioredis';
import { requireUser } from '@/lib/auth/server';
import { query } from '@/lib/db';
import { isPlatformOwner } from '@/lib/db/repositories/platformOwnerRepository';
import { serverLogger } from '@/lib/serverLogger';
import { getGeminiApiKey } from '@/lib/ai/gemini-config';

export const runtime = 'nodejs';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type CheckStatus = 'ok' | 'fail' | 'timeout' | 'not_configured';

interface SingleCheck {
  status: CheckStatus;
  latency: number;
}

interface HealthResponse {
  status: 'ok' | 'degraded';
  timestamp: string;
  version: string;
  checks: {
    postgresql: SingleCheck;
    redis: SingleCheck;
    gemini: SingleCheck;
  };
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const HEALTH_CHECK_TIMEOUT_MS = 3000;
const APP_VERSION = process.env.APP_VERSION ?? '0.1.0';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`${label}_timeout`)), ms)),
  ]);
}

function measureLatency(start: number): number {
  return Math.max(0, Math.round(Date.now() - start));
}

// ---------------------------------------------------------------------------
// PostgreSQL check: lightweight select 1 validates the DB connection
// ---------------------------------------------------------------------------

async function checkPostgreSQL(): Promise<SingleCheck> {
  const start = Date.now();
  let status: CheckStatus = 'fail';
  let latency = 0;

  try {
    if (!process.env.DATABASE_URL?.trim()) {
      serverLogger.warn('health.postgresql.missing_config', {});
      return { status: 'fail', latency: 0 };
    }

    await withTimeout(query('select 1'), HEALTH_CHECK_TIMEOUT_MS, 'health_postgresql');

    latency = measureLatency(start);
    status = 'ok';
  } catch (err) {
    latency = measureLatency(start);
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('timeout')) {
      status = 'timeout';
      serverLogger.warn('health.postgresql.timeout', { latency });
    } else {
      status = 'fail';
      serverLogger.warn('health.postgresql.failed', { error: msg, latency });
    }
  }

  return { status, latency };
}

// ---------------------------------------------------------------------------
// Redis check: PING
// ---------------------------------------------------------------------------

async function checkRedis(): Promise<SingleCheck> {
  const start = Date.now();
  let status: CheckStatus = 'fail';
  let latency = 0;

  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    serverLogger.info('health.redis.not_configured', {});
    return { status: 'fail', latency: 0 };
  }

  let redis: Redis | null = null;
  try {
    redis = new Redis(redisUrl, {
      maxRetriesPerRequest: 1,
      retryStrategy() {
        return null; // stop retrying immediately
      },
      lazyConnect: true,
      enableOfflineQueue: false,
    });

    await withTimeout(
      redis.connect().then(() => redis!.ping()),
      HEALTH_CHECK_TIMEOUT_MS,
      'health_redis'
    );

    latency = measureLatency(start);
    status = 'ok';
  } catch (err) {
    latency = measureLatency(start);
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('timeout')) {
      status = 'timeout';
      serverLogger.warn('health.redis.timeout', { latency });
    } else {
      status = 'fail';
      serverLogger.warn('health.redis.failed', { error: msg, latency });
    }
  } finally {
    if (redis) {
      try {
        redis.disconnect();
      } catch {
        // best-effort cleanup
      }
    }
  }

  return { status, latency };
}

// ---------------------------------------------------------------------------
// Gemini check: GET models list (no token consumption)
// ---------------------------------------------------------------------------

async function checkGemini(): Promise<SingleCheck> {
  const start = Date.now();
  let status: CheckStatus = 'fail';
  let latency = 0;

  const apiKey = getGeminiApiKey();
  if (!apiKey) {
    serverLogger.info('health.gemini.not_configured', {});
    return { status: 'not_configured', latency: 0 };
  }

  try {
    const response = await withTimeout(
      fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`, {
        method: 'GET',
      }),
      HEALTH_CHECK_TIMEOUT_MS,
      'health_gemini'
    );

    latency = measureLatency(start);

    if (response.ok) {
      status = 'ok';
    } else {
      serverLogger.warn('health.gemini.non_ok_response', {
        status: response.status,
      });
      status = 'fail';
    }
  } catch (err) {
    latency = measureLatency(start);
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('timeout')) {
      status = 'timeout';
      serverLogger.warn('health.gemini.timeout', { latency });
    } else {
      status = 'fail';
      serverLogger.warn('health.gemini.failed', { error: msg, latency });
    }
  }

  return { status, latency };
}

// ---------------------------------------------------------------------------
// GET /api/health
// ---------------------------------------------------------------------------

export async function GET(request: NextRequest) {
  try {
    const user = await requireUser(request, 'Unauthorized');
    const owner = await isPlatformOwner(user.id);
    if (!owner) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const startedAt = Date.now();
  const requestId = crypto.randomUUID();

  serverLogger.info('health.check_started', { requestId });

  // Run all checks in parallel
  const [postgresql, redis, gemini] = await Promise.all([
    checkPostgreSQL(),
    checkRedis(),
    checkGemini(),
  ]);

  const allOk =
    postgresql.status === 'ok' &&
    redis.status === 'ok' &&
    (gemini.status === 'ok' || gemini.status === 'not_configured');

  const body: HealthResponse = {
    status: allOk ? 'ok' : 'degraded',
    timestamp: new Date().toISOString(),
    version: APP_VERSION,
    checks: { postgresql, redis, gemini },
  };

  serverLogger.info('health.check_completed', {
    requestId,
    durationMs: Date.now() - startedAt,
    overall: body.status,
    postgresql: postgresql.status,
    redis: redis.status,
    gemini: gemini.status,
  });

  // Always return 200 so load balancers don't mark the instance as down
  // when a downstream dependency is degraded
  return NextResponse.json(body, { status: 200 });
}
