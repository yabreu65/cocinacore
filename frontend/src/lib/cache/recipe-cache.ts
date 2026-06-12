import type { StructuredRecipeIngredient } from '@/lib/recipes/structured-ingredients';
import { serverLogger } from '@/lib/serverLogger';
import Redis from 'ioredis';

export type CachedRecipe = {
  recipe: string;
  title: string;
  provider: 'gemini' | 'openrouter';
  model?: string;
  mode: 'free' | 'rag';
  structuredIngredients: StructuredRecipeIngredient[];
  createdAt: number;
};

export type RecipeCacheKeyInput = {
  mode: 'free' | 'rag';
  requestedRecipeName: string;
  requestedMealType: string;
  requestedDay: string;
  ingredients: string[];
  peopleCount: number;
  identity: string[];
  preferred: string[];
  avoid: string[];
  level: string;
  chunks: string[];
};

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const RECIPE_CACHE_TTL_SECONDS = 21600; // 6 hours
const RECIPE_CACHE_TTL_MS = RECIPE_CACHE_TTL_SECONDS * 1000;
const REDIS_KEY_PREFIX = 'recipe:';

// ---------------------------------------------------------------------------
// Redis client (lazy singleton, same pattern as rate-limit.ts)
// ---------------------------------------------------------------------------

let redis: Redis | null = null;
let redisUnavailable = false;

function getRedisClient(): Redis | null {
  if (redisUnavailable) return null;
  if (redis) return redis;

  const redisUrl = process.env.REDIS_URL;

  if (!redisUrl) {
    redisUnavailable = true;
    serverLogger.info('recipe_cache.redis_not_configured', {});
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
      enableOfflineQueue: false, // fail fast — we fall back to memory
    });
    // Fire-and-forget connect; if it fails we fall back to in-memory
    redis.connect().catch((err: Error) => {
      serverLogger.warn('recipe_cache.redis_connect_failed', {
        error: err.message,
      });
      redisUnavailable = true;
      redis = null;
    });
  } catch (err) {
    serverLogger.warn('recipe_cache.redis_init_error', {
      error: err instanceof Error ? err.message : String(err),
    });
    redisUnavailable = true;
    return null;
  }

  return redis;
}

// ---------------------------------------------------------------------------
// In-memory fallback (Map)
// ---------------------------------------------------------------------------

const memoryFallback = new Map<string, CachedRecipe>();

function memoryGet(key: string): CachedRecipe | null {
  const cached = memoryFallback.get(key);
  if (!cached) return null;
  if (Date.now() - cached.createdAt >= RECIPE_CACHE_TTL_MS) {
    memoryFallback.delete(key);
    return null;
  }
  return cached;
}

function memorySet(key: string, value: CachedRecipe): void {
  memoryFallback.set(key, value);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function buildRecipeCacheKey(input: RecipeCacheKeyInput): string {
  return JSON.stringify({
    ...input,
    ingredients: [...input.ingredients].sort(),
    identity: [...input.identity].sort(),
    preferred: [...input.preferred].sort(),
    avoid: [...input.avoid].sort(),
    chunks: [...input.chunks],
  });
}

export async function getCachedRecipe(key: string): Promise<CachedRecipe | null> {
  const client = getRedisClient();

  if (client) {
    const redisKey = REDIS_KEY_PREFIX + key;
    try {
      const raw = await client.get(redisKey);
      if (!raw) return null;

      const cached = JSON.parse(raw) as CachedRecipe;

      // Double-check TTL (Redis EXPIRE should handle this, but guard against clock drift / stale data)
      if (Date.now() - cached.createdAt >= RECIPE_CACHE_TTL_MS) {
        await client.del(redisKey);
        return null;
      }

      return cached;
    } catch (err) {
      serverLogger.warn('recipe_cache.redis_get_failed', {
        error: err instanceof Error ? err.message : String(err),
      });
      // Fall through to memory fallback
    }
  }

  return memoryGet(key);
}

export async function setCachedRecipe(key: string, value: CachedRecipe): Promise<void> {
  const client = getRedisClient();

  if (client) {
    const redisKey = REDIS_KEY_PREFIX + key;
    try {
      await client.set(redisKey, JSON.stringify(value), 'EX', RECIPE_CACHE_TTL_SECONDS);
      return;
    } catch (err) {
      serverLogger.warn('recipe_cache.redis_set_failed', {
        error: err instanceof Error ? err.message : String(err),
      });
      // Fall through to memory fallback
    }
  }

  memorySet(key, value);
}
