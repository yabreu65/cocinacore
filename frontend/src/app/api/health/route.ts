import { NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { serverLogger } from '@/lib/serverLogger';

const DEPENDENCY_TIMEOUT_MS = 2_000;

type DependencyState = 'ok' | 'degraded' | 'unavailable';

interface InternalDependencyStatus {
  status: DependencyState;
  latencyMs: number;
  error?: string;
}

interface PublicDependencyStatus {
  status: DependencyState;
  latencyMs: number;
}

interface HealthResponse {
  status: DependencyState;
  timestamp: string;
  uptime: number;
  dependencies: {
    database: PublicDependencyStatus;
    redis: PublicDependencyStatus;
  };
}

function checkDependency(name: string, fn: () => Promise<void>): Promise<InternalDependencyStatus> {
  const startedAt = Date.now();

  return new Promise<InternalDependencyStatus>((resolve) => {
    const timer = setTimeout(() => {
      resolve({
        status: 'unavailable',
        latencyMs: Date.now() - startedAt,
        error: `${name} health check timed out`,
      });
    }, DEPENDENCY_TIMEOUT_MS);

    fn()
      .then(() => {
        clearTimeout(timer);
        resolve({
          status: 'ok',
          latencyMs: Date.now() - startedAt,
        });
      })
      .catch((error) => {
        clearTimeout(timer);
        resolve({
          status: 'unavailable',
          latencyMs: Date.now() - startedAt,
          error: error instanceof Error ? error.message : String(error),
        });
      });
  });
}

async function checkDatabase(): Promise<InternalDependencyStatus> {
  return checkDependency('database', async () => {
    const pool = getPool();
    const client = await pool.connect();
    try {
      await client.query('SELECT 1');
    } finally {
      client.release();
    }
  });
}

async function checkRedis(): Promise<InternalDependencyStatus> {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    return {
      status: 'degraded',
      latencyMs: 0,
      error: 'REDIS_URL not configured',
    };
  }

  return checkDependency('redis', async () => {
    const { default: Redis } = await import('ioredis');
    const redis = new Redis(redisUrl, {
      maxRetriesPerRequest: 1,
      connectTimeout: DEPENDENCY_TIMEOUT_MS,
      lazyConnect: true,
      retryStrategy() {
        return null;
      },
    });

    try {
      await redis.connect();
      const result = await redis.ping();
      if (result !== 'PONG') {
        throw new Error('Unexpected Redis PING response');
      }
    } finally {
      redis.disconnect();
    }
  });
}

function aggregateStatus(deps: InternalDependencyStatus[]): DependencyState {
  if (deps.some((dependency) => dependency.status === 'unavailable')) return 'unavailable';
  if (deps.some((dependency) => dependency.status === 'degraded')) return 'degraded';
  return 'ok';
}

function toPublicDependency(status: InternalDependencyStatus): PublicDependencyStatus {
  return {
    status: status.status,
    latencyMs: status.latencyMs,
  };
}

let startTimestamp: number | null = null;

function getUptimeSeconds(): number {
  if (startTimestamp === null) {
    startTimestamp = Date.now();
  }
  return Math.floor((Date.now() - startTimestamp) / 1000);
}

export async function GET() {
  const [database, redis] = await Promise.all([checkDatabase(), checkRedis()]);
  const overallStatus = aggregateStatus([database, redis]);

  if (overallStatus !== 'ok') {
    serverLogger.warn('health_check.degraded', {
      status: overallStatus,
      database: database.status,
      databaseError: database.error,
      redis: redis.status,
      redisError: redis.error,
    });
  }

  const response: HealthResponse = {
    status: overallStatus,
    timestamp: new Date().toISOString(),
    uptime: getUptimeSeconds(),
    dependencies: {
      database: toPublicDependency(database),
      redis: toPublicDependency(redis),
    },
  };

  return NextResponse.json(response, {
    status: overallStatus === 'ok' ? 200 : 503,
  });
}
