import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import Redis from 'ioredis';
import { serverLogger } from '@/lib/serverLogger';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type CheckStatus = 'ok' | 'fail' | 'timeout';

interface SingleCheck {
  status: CheckStatus;
  latency: number;
}

interface HealthResponse {
  status: 'ok' | 'degraded';
  timestamp: string;
  version: string;
  checks: {
    supabase: SingleCheck;
    redis: SingleCheck;
    gemini: SingleCheck;
    openrouter: SingleCheck;
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
// Supabase check: lightweight auth.getSession() validates the API + DB
// ---------------------------------------------------------------------------

async function checkSupabase(): Promise<SingleCheck> {
  const start = Date.now();
  let status: CheckStatus = 'fail';
  let latency = 0;

  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !serviceRoleKey) {
      serverLogger.warn('health.supabase.missing_config', {});
      return { status: 'fail', latency: 0 };
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const result = await withTimeout(
      supabase.auth.getSession(),
      HEALTH_CHECK_TIMEOUT_MS,
      'health_supabase'
    );

    latency = measureLatency(start);

    if (result.error) {
      serverLogger.warn('health.supabase.query_failed', {
        error: result.error.message,
      });
      status = 'fail';
    } else {
      status = 'ok';
    }
  } catch (err) {
    latency = measureLatency(start);
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('timeout')) {
      status = 'timeout';
      serverLogger.warn('health.supabase.timeout', { latency });
    } else {
      status = 'fail';
      serverLogger.warn('health.supabase.failed', { error: msg, latency });
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

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    serverLogger.info('health.gemini.not_configured', {});
    return { status: 'fail', latency: 0 };
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
// OpenRouter check: GET models list (no token consumption)
// ---------------------------------------------------------------------------

async function checkOpenRouter(): Promise<SingleCheck> {
  const start = Date.now();
  let status: CheckStatus = 'fail';
  let latency = 0;

  // OpenRouter can be called without an API key for the models endpoint
  try {
    const response = await withTimeout(
      fetch('https://openrouter.ai/api/v1/models', {
        method: 'GET',
      }),
      HEALTH_CHECK_TIMEOUT_MS,
      'health_openrouter'
    );

    latency = measureLatency(start);

    if (response.ok) {
      status = 'ok';
    } else {
      serverLogger.warn('health.openrouter.non_ok_response', {
        status: response.status,
      });
      status = 'fail';
    }
  } catch (err) {
    latency = measureLatency(start);
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('timeout')) {
      status = 'timeout';
      serverLogger.warn('health.openrouter.timeout', { latency });
    } else {
      status = 'fail';
      serverLogger.warn('health.openrouter.failed', { error: msg, latency });
    }
  }

  return { status, latency };
}

// ---------------------------------------------------------------------------
// GET /api/health
// ---------------------------------------------------------------------------

export async function GET() {
  const startedAt = Date.now();
  const requestId = crypto.randomUUID();

  serverLogger.info('health.check_started', { requestId });

  // Run all checks in parallel
  const [supabase, redis, gemini, openrouter] = await Promise.all([
    checkSupabase(),
    checkRedis(),
    checkGemini(),
    checkOpenRouter(),
  ]);

  const allOk =
    supabase.status === 'ok' &&
    redis.status === 'ok' &&
    gemini.status === 'ok' &&
    openrouter.status === 'ok';

  const body: HealthResponse = {
    status: allOk ? 'ok' : 'degraded',
    timestamp: new Date().toISOString(),
    version: APP_VERSION,
    checks: { supabase, redis, gemini, openrouter },
  };

  serverLogger.info('health.check_completed', {
    requestId,
    durationMs: Date.now() - startedAt,
    overall: body.status,
    supabase: supabase.status,
    redis: redis.status,
    gemini: gemini.status,
    openrouter: openrouter.status,
  });

  // Always return 200 so load balancers don't mark the instance as down
  // when a downstream dependency is degraded
  return NextResponse.json(body, { status: 200 });
}
