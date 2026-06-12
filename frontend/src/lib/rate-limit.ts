import Redis from 'ioredis';

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
}

// ---------------------------------------------------------------------------
// Per-route configuration
// ---------------------------------------------------------------------------

const ROUTE_CONFIGS: Record<string, RateLimitConfig> = {
  'recipe-generate': { limit: 10, windowSeconds: 60 },
  'meal-plan': { limit: 5, windowSeconds: 60 },
  'meal-plan/warmup': { limit: 3, windowSeconds: 60 },
  'inventory-suggestion': { limit: 8, windowSeconds: 60 },
  embeddings: { limit: 25, windowSeconds: 60 },
  'auth/password-reset': { limit: 3, windowSeconds: 900 },
  'auth/password-update': { limit: 5, windowSeconds: 900 },
  'auth/login': { limit: 8, windowSeconds: 900 },
  'auth/signup': { limit: 5, windowSeconds: 900 },
  'auth/invite-accept': { limit: 8, windowSeconds: 900 },
};

// ---------------------------------------------------------------------------
// Redis client (lazy singleton)
// ---------------------------------------------------------------------------

let redis: Redis | null = null;
let redisUnavailable = false;

function getRedisClient(): Redis | null {
  if (redisUnavailable) return null;
  if (redis) return redis;

  const redisUrl = process.env.REDIS_URL;

  if (!redisUrl) {
    redisUnavailable = true;
    return null;
  }

  try {
    redis = new Redis(redisUrl, {
      maxRetriesPerRequest: 1,
      retryStrategy() {
        redisUnavailable = true;
        return null; // stop retrying
      },
      lazyConnect: true,
    });
    // Fire-and-forget connect; if it fails we fall back to in-memory
    redis.connect().catch(() => {
      redisUnavailable = true;
      redis = null;
    });
  } catch {
    redisUnavailable = true;
    return null;
  }

  return redis;
}

// ---------------------------------------------------------------------------
// In-memory fallback (LRU-like, max 10K entries)
// ---------------------------------------------------------------------------

const MAX_IN_MEMORY_ENTRIES = 10_000;

interface WindowRecord {
  count: number;
  windowStart: number; // ms timestamp
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

function buildKey(route: string, ip: string, userId?: string): string {
  if (userId) {
    return `rl:${route}:${ip}:${userId}`;
  }
  return `rl:${route}:${ip}`;
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

if count >= limit then
  return 0
end

-- Add current millisecond timestamp with uniqueness
redis.call('ZADD', key, now, now .. ':' .. redis.call('ZCARD', key))
-- Set expiry on the key slightly longer than the window
redis.call('PEXPIRE', key, window * 1000 + 1000)

return 1
`;

let loadedScript: string | null = null;

async function redisCheck(key: string, config: RateLimitConfig): Promise<RateLimitResult> {
  const client = getRedisClient();
  if (!client) {
    return memoryCheck(key, config);
  }

  const nowMs = Date.now();

  try {
    if (!loadedScript) {
      loadedScript = (await client.script('LOAD', SLIDING_WINDOW_LUA)) as string;
    }

    const result = (await client.evalsha(
      loadedScript,
      1,
      key,
      nowMs,
      config.windowSeconds,
      config.limit
    )) as number;

    // Get the count of entries in the window for remaining calculation
    const count = await client.zcount(key, nowMs - config.windowSeconds * 1000, '+inf');

    const remaining = Math.max(0, config.limit - count);
    const resetAt = Math.floor((nowMs + config.windowSeconds * 1000) / 1000);

    return {
      success: result === 1,
      limit: config.limit,
      remaining,
      resetAt,
    };
  } catch {
    // Redis script might not be loaded yet; load and retry
    try {
      loadedScript = null; // reset so we reload next time
    } catch {
      // ignore
    }
    return memoryCheck(key, config);
  }
}

// ---------------------------------------------------------------------------
// In-memory sliding-window implementation
// ---------------------------------------------------------------------------

function memoryCheck(key: string, config: RateLimitConfig): RateLimitResult {
  evictIfNeeded();

  const now = Date.now();
  const windowStart = now - config.windowSeconds * 1000;

  const record = memoryMap.get(key);

  // No record or window expired → reset
  if (!record || record.windowStart <= windowStart) {
    memoryMap.set(key, { count: 1, windowStart: now });
    return {
      success: true,
      limit: config.limit,
      remaining: config.limit - 1,
      resetAt: Math.floor((now + config.windowSeconds * 1000) / 1000),
    };
  }

  // Window still active
  if (record.count >= config.limit) {
    const resetAt = Math.floor((record.windowStart + config.windowSeconds * 1000) / 1000);
    return {
      success: false,
      limit: config.limit,
      remaining: 0,
      resetAt,
    };
  }

  record.count += 1;
  memoryMap.set(key, record);

  return {
    success: true,
    limit: config.limit,
    remaining: config.limit - record.count,
    resetAt: Math.floor((record.windowStart + config.windowSeconds * 1000) / 1000),
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Checks whether the request is within the rate limit for the given route.
 *
 * @param route - one of the configured route keys (e.g. "recipe-generate")
 * @param ip - client IP address
 * @param userId - optional user ID; when present, the key is scoped per user
 */
export async function checkRateLimit(
  route: string,
  ip: string,
  userId?: string
): Promise<RateLimitResult> {
  const config = ROUTE_CONFIGS[route];
  if (!config) {
    // Unknown route — default to a generous limit as safety net
    return redisCheck(buildKey(route, ip, userId), { limit: 100, windowSeconds: 60 });
  }

  return redisCheck(buildKey(route, ip, userId), config);
}
