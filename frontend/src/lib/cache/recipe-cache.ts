import { createHash } from 'node:crypto';
import type { StructuredRecipeIngredient } from '@/lib/recipes/structured-ingredients';
import { serverLogger } from '@/lib/serverLogger';
import Redis from 'ioredis';
import { z } from 'zod';

export type CachedRecipe = {
  recipe: string;
  title: string;
  provider: 'gemini';
  model?: string;
  mode: 'free' | 'rag';
  structuredIngredients: StructuredRecipeIngredient[];
  createdAt: number;
};

export type RecipeCacheScope = {
  userId: string;
  tenantId: string | null;
};

export type RecipeCacheKeyInput = {
  mode: 'free' | 'rag';
  scope?: RecipeCacheScope | null;
  requestedRecipeName: string;
  requestedMealType: string;
  requestedDay: string;
  ingredients: string[];
  peopleCount: number;
  goals?: string[];
  inventoryContextHash?: string;
  profileContextHash?: string;
  contextVersion?: string;
  model?: string;
  /** @deprecated Private profile fields are represented by profileContextHash. */
  identity?: string[];
  /** @deprecated Private profile fields are represented by profileContextHash. */
  preferred?: string[];
  /** @deprecated Private profile fields are represented by profileContextHash. */
  avoid?: string[];
  /** @deprecated Private profile fields are represented by profileContextHash. */
  level?: string;
  chunks: string[];
};

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const RECIPE_CACHE_TTL_SECONDS = 21600; // 6 hours
const RECIPE_CACHE_TTL_MS = RECIPE_CACHE_TTL_SECONDS * 1000;
// Version the cache key locally so changes to cache identity do not require
// modifying the recipe-generation route.
const RECIPE_CACHE_KEY_VERSION = 2;
const MEMORY_MAX_ENTRIES = 128;
const MEMORY_MAX_ENTRY_BYTES = 256 * 1024;
const CACHE_NAMESPACE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/;

function getRedisKeyPrefix(): string {
  const namespace = process.env.COCINACORE_E2E_CACHE_NAMESPACE;
  if (!namespace) return 'recipe:';
  if (!CACHE_NAMESPACE_PATTERN.test(namespace)) {
    throw new Error('COCINACORE_E2E_CACHE_NAMESPACE is invalid.');
  }
  return `recipe:e2e:${namespace}:`;
}

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

const cachedRecipeSchema = z.object({
  recipe: z.string().min(1),
  title: z.string(),
  provider: z.literal('gemini'),
  model: z.string().optional(),
  mode: z.enum(['free', 'rag']),
  structuredIngredients: z.array(z.object({
    name: z.string(),
    normalized_name: z.string(),
    quantity: z.number().nullable(),
    unit: z.string().nullable(),
    optional_quantity_text: z.string().nullable(),
    category: z.string().nullable(),
    estimated_cost_optional: z.number().nullable(),
    structured: z.boolean(),
  })),
  createdAt: z.number().finite(),
});

function isFresh(createdAt: number, now: number): boolean {
  return Number.isFinite(createdAt) && createdAt <= now && now - createdAt < RECIPE_CACHE_TTL_MS;
}

function decodeCachedRecipe(raw: string): CachedRecipe | null {
  try {
    const parsed = cachedRecipeSchema.safeParse(JSON.parse(raw) as unknown);
    return parsed.success && isFresh(parsed.data.createdAt, Date.now()) ? parsed.data : null;
  } catch {
    return null;
  }
}

// Store bounded serialized entries, keyed by the same namespace as Redis.
// No timers, new services or background cleanup jobs are needed.
const memoryFallback = new Map<string, { raw: string; createdAt: number }>();

function memoryGet(key: string): CachedRecipe | null {
  const entry = memoryFallback.get(key);
  if (!entry) return null;
  const cached = decodeCachedRecipe(entry.raw);
  if (!cached) memoryFallback.delete(key);
  return cached;
}

function memorySet(key: string, value: CachedRecipe, raw: string): void {
  const now = Date.now();
  for (const [entryKey, entry] of memoryFallback) {
    if (!isFresh(entry.createdAt, now)) memoryFallback.delete(entryKey);
  }
  // A replacement must not leave a previous value behind if it cannot be cached.
  memoryFallback.delete(key);
  if (!isFresh(value.createdAt, now) ||
      Buffer.byteLength(key) + Buffer.byteLength(raw) > MEMORY_MAX_ENTRY_BYTES) return;
  if (memoryFallback.size >= MEMORY_MAX_ENTRIES) {
    const oldestKey = memoryFallback.keys().next().value;
    if (oldestKey !== undefined) memoryFallback.delete(oldestKey);
  }
  memoryFallback.set(key, { raw, createdAt: value.createdAt });
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function hashRecipeContext(context: unknown): string {
  return createHash('sha256').update(JSON.stringify(context)).digest('hex');
}

export function buildRecipeCacheKey(input: RecipeCacheKeyInput): string {
  return JSON.stringify({
    cacheKeyVersion: RECIPE_CACHE_KEY_VERSION,
    mode: input.mode,
    scope: input.scope ?? null,
    requestedRecipeName: input.requestedRecipeName,
    requestedMealType: input.requestedMealType,
    requestedDay: input.requestedDay,
    // The request order is meaningful: the first ingredient can define the main dish.
    ingredients: [...input.ingredients],
    peopleCount: input.peopleCount,
    goalsHash: hashRecipeContext([...(input.goals ?? [])].sort()),
    inventoryContextHash: input.inventoryContextHash ?? null,
    profileContextHash: input.profileContextHash ?? null,
    contextVersion: input.contextVersion ?? null,
    model: input.model ?? null,
    chunks: [...input.chunks],
  });
}

export async function getCachedRecipe(key: string): Promise<CachedRecipe | null> {
  const cacheKey = getRedisKeyPrefix() + key;
  const client = getRedisClient();

  if (client) {
    try {
      const raw = await client.get(cacheKey);
      const cached = raw ? decodeCachedRecipe(raw) : null;
      if (cached) {
        // A local write may have succeeded during a Redis outage. Do not replace
        // a newer local value with an older Redis entry.
        const local = memoryGet(cacheKey);
        if (local && local.createdAt > cached.createdAt) return local;
        memoryFallback.delete(cacheKey);
        return cached;
      }
      // Redis miss or invalid/expired data: check the bounded local fallback.
      // Redis manages expiration; do not delete a key another worker may update.
    } catch (err) {
      serverLogger.warn('recipe_cache.redis_get_failed', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return memoryGet(cacheKey);
}

export async function setCachedRecipe(key: string, value: CachedRecipe): Promise<void> {
  const cacheKey = getRedisKeyPrefix() + key;
  if (!isFresh(value.createdAt, Date.now())) return;
  const raw = JSON.stringify(value);
  const client = getRedisClient();

  if (client) {
    try {
      await client.set(cacheKey, raw, 'EX', RECIPE_CACHE_TTL_SECONDS);
      const local = memoryFallback.get(cacheKey);
      if (local && local.createdAt <= value.createdAt) memoryFallback.delete(cacheKey);
      return;
    } catch (err) {
      serverLogger.warn('recipe_cache.redis_set_failed', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const local = memoryFallback.get(cacheKey);
  if (!local || local.createdAt <= value.createdAt) memorySet(cacheKey, value, raw);
}
