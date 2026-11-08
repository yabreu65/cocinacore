import Redis from 'ioredis';
import { randomUUID } from 'node:crypto';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RateLimitConfig {
  /** Maximum number of requests allowed in the window. */
  limit: number;
  /** Window size in seconds (sliding). */
  windowSeconds: number;
}

export interface RateLimitResult {
  success: boolean;
  limit: number;
  remaining: number;
  resetAt: number; // unix timestamp in seconds
  storage: 'redis' | 'memory' | 'unavailable';
}

export interface RateLimitOptions {
  /** Requires the shared atomic store; never fall back to process-local state. */
  requireSharedStore?: boolean;
  signal?: AbortSignal;
  deadlineAt?: number;
  /** Stable per-request id for an explicit retry; never reuse across requests. */
  requestId?: string;
}

// ---------------------------------------------------------------------------
// Per-route configuration
// ---------------------------------------------------------------------------

const ROUTE_CONFIGS: Record<string, RateLimitConfig> = {
  today: { limit: 5, windowSeconds: 60 },
  'recipe-generate': { limit: 10, windowSeconds: 60 },
  'meal-plan': { limit: 5, windowSeconds: 60 },
  'meal-plan/warmup': { limit: 3, windowSeconds: 60 },
  'inventory-suggestion': { limit: 8, windowSeconds: 60 },
  'cooking-teacher-user': { limit: 20, windowSeconds: 60 },
  'cooking-teacher-tenant': { limit: 120, windowSeconds: 60 },
  embeddings: { limit: 25, windowSeconds: 60 },
  'auth/password-reset': { limit: 3, windowSeconds: 900 },
  'auth/password-update': { limit: 5, windowSeconds: 900 },
  'auth/login': { limit: 8, windowSeconds: 900 },
  'auth/signup': { limit: 5, windowSeconds: 900 },
  'auth/invite-accept': { limit: 8, windowSeconds: 900 },
  'auth/login:anonymous-global': { limit: 100, windowSeconds: 900 },
  'auth/login:trusted-client': { limit: 40, windowSeconds: 900 },
  'auth/password-reset:anonymous-global': { limit: 50, windowSeconds: 900 },
  'auth/password-reset:trusted-client': { limit: 20, windowSeconds: 900 },
  'auth/signup:anonymous-global': { limit: 100, windowSeconds: 900 },
  'auth/signup:trusted-client': { limit: 40, windowSeconds: 900 },
  'auth/password-update:anonymous-global': { limit: 50, windowSeconds: 900 },
  'auth/password-update:trusted-client': { limit: 20, windowSeconds: 900 },
};

// ---------------------------------------------------------------------------
// Redis client (lazy singleton)
// ---------------------------------------------------------------------------

let redis: Redis | null = null;
let redisUnavailableUntil = 0;

function resetRedisClient(client?: Redis): void {
  if (!client || redis === client) {
    try {
      redis?.disconnect();
    } catch {
      // The stale client is discarded below.
    }
    redis = null;
  }
  redisUnavailableUntil = Date.now() + 1_000;
}

function getRedisClient(): Redis | null {
  if (redisUnavailableUntil > Date.now()) return null;
  redisUnavailableUntil = 0;
  if (redis) return redis;

  const redisUrl = process.env.REDIS_URL;

  if (!redisUrl) {
    redisUnavailableUntil = Date.now() + 1_000;
    return null;
  }

  try {
    redis = new Redis(redisUrl, {
      maxRetriesPerRequest: 0,
      connectTimeout: 1_000,
      commandTimeout: 2_000,
      retryStrategy() {
        redis = null;
        redisUnavailableUntil = Date.now() + 1_000;
        return null; // stop retrying
      },
      lazyConnect: true,
    });
    redis.on('error', () => undefined);
    const client = redis;
    // Fire-and-forget connect; if it fails we fall back to in-memory
    redis.connect().catch(() => {
      resetRedisClient(client);
    });
  } catch {
    resetRedisClient();
    return null;
  }

  return redis;
}

// ---------------------------------------------------------------------------
// In-memory fallback (LRU-like, max 10K entries)
// ---------------------------------------------------------------------------

const MAX_IN_MEMORY_ENTRIES = 10_000;

interface WindowRecord {
  timestamps: number[]; // request timestamps in milliseconds, oldest first
}

const memoryMap = new Map<string, WindowRecord>();

function evictIfNeeded(): void {
  if (memoryMap.size <= MAX_IN_MEMORY_ENTRIES) return;

  // Remove the oldest (first inserted) entry — rough LRU
  const oldestKey = memoryMap.keys().next().value;
  if (oldestKey !== undefined) {
    memoryMap.delete(oldestKey);
  }
}

// ---------------------------------------------------------------------------
// Key builder
// ---------------------------------------------------------------------------

function buildKey(route: string, identity: string, userId?: string): string {
  if (userId) {
    return `rl:${route}:${identity}:${userId}`;
  }
  return `rl:${route}:${identity}`;
}

// ---------------------------------------------------------------------------
// Redis sliding-window implementation
// ---------------------------------------------------------------------------

/** Lua script for sliding-window rate limit check */
const SLIDING_WINDOW_LUA = `
local key = KEYS[1]
local now = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local limit = tonumber(ARGV[3])

-- Remove entries older than the window
redis.call('ZREMRANGEBYSCORE', key, '-inf', now - window * 1000)

-- Count current entries within window
local count = redis.call('ZCARD', key)
local success = 0
local requestId = ARGV[4]

-- A caller retry with the same request id is idempotent and must not consume
-- the window twice after a response timeout.
if redis.call('ZSCORE', key, requestId) then
  success = 1
else
  if count < limit then
    redis.call('ZADD', key, now, requestId)
    redis.call('PEXPIRE', key, window * 1000 + 1000)
    count = redis.call('ZCARD', key)
    success = 1
  end
end

local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
local oldestScore = now
if #oldest >= 2 then
  oldestScore = tonumber(oldest[2])
end

return { success, count, oldestScore }
`;

function unavailableResult(config: RateLimitConfig): RateLimitResult {
  const resetAt = Math.ceil((Date.now() + config.windowSeconds * 1000) / 1000);
  return { success: false, limit: config.limit, remaining: 0, resetAt, storage: 'unavailable' };
}

async function redisCheck(
  key: string,
  config: RateLimitConfig,
  options: RateLimitOptions = {}
): Promise<RateLimitResult> {
  if (
    options.signal?.aborted ||
    (options.deadlineAt !== undefined && options.deadlineAt <= Date.now())
  ) {
    return unavailableResult(config);
  }
  const client = getRedisClient();
  if (!client) {
    return options.requireSharedStore ? unavailableResult(config) : memoryCheck(key, config);
  }

  const nowMs = Date.now();

  try {
    const commandTimeoutMs = 2_000;
    const remainingMs =
      options.deadlineAt === undefined ? commandTimeoutMs : options.deadlineAt - Date.now();
    if (remainingMs < commandTimeoutMs) return unavailableResult(config);

    // ioredis applies commandTimeout and maxRetriesPerRequest to this single
    // atomic EVAL. We do not race it with a logical timer: a race would return
    // fail-closed while the Redis mutation kept running in the background.
    // If Redis accepted the command before a transport timeout, the result is
    // intentionally treated as unknown and the caller must not retry it with
    // a new request id during the same operation.
    const result: unknown = await client.eval(
      SLIDING_WINDOW_LUA,
      1,
      key,
      nowMs,
      config.windowSeconds,
      config.limit,
      options.requestId ?? randomUUID()
    );

    if (
      !Array.isArray(result) ||
      result.length !== 3 ||
      (result[0] !== 0 && result[0] !== 1) ||
      typeof result[1] !== 'number' ||
      !Number.isInteger(result[1]) ||
      result[1] < 0 ||
      (typeof result[2] !== 'number' && typeof result[2] !== 'string')
    ) {
      throw new Error('Invalid Redis rate-limit response');
    }

    if (typeof result[2] === 'string' && result[2].trim() === '') {
      throw new Error('Invalid Redis rate-limit reset score');
    }

    const oldestLiveScoreMs = Number(result[2]);
    if (!Number.isSafeInteger(oldestLiveScoreMs) || oldestLiveScoreMs < 0) {
      throw new Error('Invalid Redis rate-limit reset score');
    }

    const remaining = Math.max(0, config.limit - result[1]);
    const resetAt = Math.ceil((oldestLiveScoreMs + config.windowSeconds * 1000) / 1000);

    return {
      success: result[0] === 1,
      limit: config.limit,
      remaining,
      resetAt,
      storage: 'redis',
    };
  } catch {
    resetRedisClient(client);
    return options.requireSharedStore ? unavailableResult(config) : memoryCheck(key, config);
  }
}

// ---------------------------------------------------------------------------
// In-memory sliding-window implementation
// ---------------------------------------------------------------------------

function memoryCheck(key: string, config: RateLimitConfig): RateLimitResult {
  evictIfNeeded();

  const now = Date.now();
  const windowMs = config.windowSeconds * 1000;
  const cutoff = now - windowMs;
  const record = memoryMap.get(key) ?? { timestamps: [] };
  record.timestamps = record.timestamps.filter((timestamp) => timestamp > cutoff);

  if (record.timestamps.length >= config.limit) {
    const oldestTimestamp = record.timestamps[0] ?? now;
    memoryMap.set(key, record);
    return {
      success: false,
      limit: config.limit,
      remaining: 0,
      resetAt: Math.ceil((oldestTimestamp + windowMs) / 1000),
      storage: 'memory',
    };
  }

  record.timestamps.push(now);
  memoryMap.set(key, record);

  return {
    success: true,
    limit: config.limit,
    remaining: config.limit - record.timestamps.length,
    resetAt: Math.ceil(((record.timestamps[0] ?? now) + windowMs) / 1000),
    storage: 'memory',
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Checks whether the request is within the rate limit for the given route.
 *
 * @param route - one of the configured route keys (e.g. "recipe-generate")
 * @param identity - client IP or authenticated identity, depending on the route
 * @param userId - optional user ID; when present, the key is scoped per user
 */
export async function checkRateLimit(
  route: string,
  identity: string,
  userId?: string,
  options: RateLimitOptions = {}
): Promise<RateLimitResult> {
  const config = ROUTE_CONFIGS[route];
  if (!config) {
    // Unknown route — default to a generous limit as safety net
    return redisCheck(
      buildKey(route, identity, userId),
      { limit: 100, windowSeconds: 60 },
      options
    );
  }

  return redisCheck(buildKey(route, identity, userId), config, options);
}
