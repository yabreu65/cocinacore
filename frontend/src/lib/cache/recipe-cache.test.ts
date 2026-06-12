import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildRecipeCacheKey,
  getCachedRecipe,
  setCachedRecipe,
  type RecipeCacheKeyInput,
} from './recipe-cache';

// ---------------------------------------------------------------------------
// Memory fallback tests (REDIS_URL unset → uses in-memory Map)
// ---------------------------------------------------------------------------

describe('recipe-cache (memory fallback)', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it('builds a stable cache key regardless of ingredient ordering', () => {
    const input: RecipeCacheKeyInput = {
      mode: 'rag',
      requestedRecipeName: 'Arepas',
      requestedMealType: 'Desayuno',
      requestedDay: 'Lunes',
      ingredients: ['tomate', 'pollo', 'arroz'],
      peopleCount: 4,
      identity: ['Latinoamericana', 'Venezolana'],
      preferred: ['Familiar', 'Rápido'],
      avoid: ['Mariscos', 'Keto'],
      level: 'Intermedio',
      chunks: ['chunk-a', 'chunk-b'],
    };

    const reordered = {
      ...input,
      ingredients: ['arroz', 'tomate', 'pollo'],
      identity: ['Venezolana', 'Latinoamericana'],
      preferred: ['Rápido', 'Familiar'],
      avoid: ['Keto', 'Mariscos'],
    };

    expect(buildRecipeCacheKey(input)).toBe(buildRecipeCacheKey(reordered));
  });

  it('returns cached recipe while TTL is valid and expires after TTL', async () => {
    // Stub REDIS_URL empty so memory fallback is used
    vi.stubEnv('REDIS_URL', '');

    vi.useFakeTimers();
    const key = buildRecipeCacheKey({
      mode: 'free',
      requestedRecipeName: 'Pasta',
      requestedMealType: 'Almuerzo',
      requestedDay: 'Martes',
      ingredients: ['pasta'],
      peopleCount: 2,
      identity: ['Italiana'],
      preferred: [],
      avoid: [],
      level: 'Intermedio',
      chunks: [],
    });

    await setCachedRecipe(key, {
      recipe: 'Pasta al pomodoro',
      title: 'Pasta al pomodoro',
      provider: 'gemini',
      mode: 'free',
      structuredIngredients: [],
      createdAt: Date.now(),
    });

    expect((await getCachedRecipe(key))?.recipe).toBe('Pasta al pomodoro');

    vi.advanceTimersByTime(1000 * 60 * 60 * 6 + 1);
    expect(await getCachedRecipe(key)).toBeNull();
  });

  it('returns null on cache miss', async () => {
    vi.stubEnv('REDIS_URL', '');
    const key = buildRecipeCacheKey({
      mode: 'rag',
      requestedRecipeName: 'Unknown',
      requestedMealType: 'Cena',
      requestedDay: 'Domingo',
      ingredients: ['nada'],
      peopleCount: 1,
      identity: [],
      preferred: [],
      avoid: [],
      level: 'Principiante',
      chunks: [],
    });

    expect(await getCachedRecipe(key)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Redis integration tests (mocked ioredis)
// ---------------------------------------------------------------------------

describe('recipe-cache (Redis integration)', () => {
  const mockGet = vi.fn();
  const mockSet = vi.fn();
  const mockDel = vi.fn();

  beforeEach(() => {
    vi.stubEnv('REDIS_URL', 'redis://localhost:6379');
    vi.doMock('ioredis', () => ({
      // Arrow-function factories can't be used as constructors with `new`.
      // We define MockRedis as a plain constructor-function so `new Redis(url, opts)` succeeds.
      default: function MockRedis() {
        this.get = mockGet;
        this.set = mockSet;
        this.del = mockDel;
        this.connect = vi.fn().mockResolvedValue(undefined);
      },
    }));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
    mockGet.mockReset();
    mockSet.mockReset();
    mockDel.mockReset();
  });

  it('returns data on Redis cache hit', async () => {
    vi.resetModules();
    const { getCachedRecipe, buildRecipeCacheKey } = await import('./recipe-cache');

    const key = buildRecipeCacheKey({
      mode: 'free',
      requestedRecipeName: 'Pizza',
      requestedMealType: 'Cena',
      requestedDay: 'Viernes',
      ingredients: ['harina', 'tomate'],
      peopleCount: 4,
      identity: ['Italiana'],
      preferred: [],
      avoid: [],
      level: 'Intermedio',
      chunks: [],
    });

    const cachedData = {
      recipe: 'Pizza Margherita',
      title: 'Pizza Margherita',
      provider: 'gemini' as const,
      mode: 'free' as const,
      structuredIngredients: [],
      createdAt: Date.now() - 1000, // 1 second ago — still valid
    };

    mockGet.mockResolvedValue(JSON.stringify(cachedData));

    const result = await getCachedRecipe(key);
    expect(result?.recipe).toBe('Pizza Margherita');
  });

  it('returns null on Redis cache miss', async () => {
    vi.resetModules();
    const { getCachedRecipe, buildRecipeCacheKey } = await import('./recipe-cache');

    const key = buildRecipeCacheKey({
      mode: 'rag',
      requestedRecipeName: 'Missing',
      requestedMealType: 'Desayuno',
      requestedDay: 'Lunes',
      ingredients: ['nada'],
      peopleCount: 1,
      identity: [],
      preferred: [],
      avoid: [],
      level: 'Principiante',
      chunks: [],
    });

    mockGet.mockResolvedValue(null);

    const result = await getCachedRecipe(key);
    expect(result).toBeNull();
  });

  it('stores data in Redis with TTL on set', async () => {
    vi.resetModules();
    const { setCachedRecipe, buildRecipeCacheKey } = await import('./recipe-cache');

    const key = buildRecipeCacheKey({
      mode: 'free',
      requestedRecipeName: 'Risotto',
      requestedMealType: 'Almuerzo',
      requestedDay: 'Miércoles',
      ingredients: ['arroz', 'champiñones'],
      peopleCount: 2,
      identity: ['Italiana'],
      preferred: [],
      avoid: [],
      level: 'Avanzado',
      chunks: [],
    });

    mockSet.mockResolvedValue('OK');

    await setCachedRecipe(key, {
      recipe: 'Risotto ai funghi',
      title: 'Risotto ai funghi',
      provider: 'gemini',
      mode: 'free',
      structuredIngredients: [],
      createdAt: Date.now(),
    });

    expect(mockSet).toHaveBeenCalledTimes(1);
    // Verify it was called with EX flag for TTL
    const setArgs = mockSet.mock.calls[0];
    expect(setArgs[2]).toBe('EX');
    expect(setArgs[3]).toBe(21600); // 6 hours in seconds
  });

  it('falls back to memory Map when Redis get fails', async () => {
    vi.resetModules();
    const { getCachedRecipe, buildRecipeCacheKey, setCachedRecipe } =
      await import('./recipe-cache');

    const key = buildRecipeCacheKey({
      mode: 'rag',
      requestedRecipeName: 'Fallback',
      requestedMealType: 'Almuerzo',
      requestedDay: 'Jueves',
      ingredients: ['test'],
      peopleCount: 2,
      identity: [],
      preferred: [],
      avoid: [],
      level: 'Intermedio',
      chunks: [],
    });

    // Redis throws on get
    mockGet.mockRejectedValue(new Error('Connection refused'));

    // First set should also fail (Redis is down), falling back to memory
    mockSet.mockRejectedValue(new Error('Connection refused'));

    const data = {
      recipe: 'Memory fallback recipe',
      title: 'Fallback',
      provider: 'openrouter' as const,
      mode: 'rag' as const,
      structuredIngredients: [],
      createdAt: Date.now(),
    };

    // Set falls back to memory
    await setCachedRecipe(key, data);

    // Get from memory (Redis throws, fallback to memory where we just stored)
    const result = await getCachedRecipe(key);
    expect(result?.title).toBe('Fallback');
  });
});
