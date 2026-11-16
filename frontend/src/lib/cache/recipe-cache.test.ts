import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildRecipeCacheKey,
  getCachedRecipe,
  setCachedRecipe,
  type RecipeCacheKeyInput,
  type CachedRecipe,
} from './recipe-cache';

// ---------------------------------------------------------------------------
// Memory fallback tests (REDIS_URL unset → uses in-memory Map)
// ---------------------------------------------------------------------------

describe('recipe-cache (memory fallback)', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it('preserves ingredient order while ignoring deprecated profile fields', () => {
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

    expect(buildRecipeCacheKey(input)).not.toBe(buildRecipeCacheKey(reordered));
    expect(buildRecipeCacheKey(input)).toBe(buildRecipeCacheKey({
      ...reordered,
      ingredients: input.ingredients,
    }));
    const unnamed = { ...input, requestedRecipeName: '' };
    expect(buildRecipeCacheKey(unnamed)).not.toBe(buildRecipeCacheKey({
      ...unnamed,
      ingredients: reordered.ingredients,
    }));
    expect(input.ingredients).toEqual(['tomate', 'pollo', 'arroz']);
    expect(buildRecipeCacheKey(input)).toContain('"cacheKeyVersion":2');

  });

  it('separates scope and hashed persisted context without serializing private values', () => {
    const input: RecipeCacheKeyInput = {
      mode: 'free',
      scope: { userId: 'user-1', tenantId: 'tenant-1' },
      requestedRecipeName: 'Sopa',
      requestedMealType: 'Cena',
      requestedDay: 'Lunes',
      ingredients: ['tomate'],
      peopleCount: 2,
      goals: ['Comidas rápidas'],
      identity: ['private profile identity'],
      inventoryContextHash: 'inventory-hash-a',
      profileContextHash: 'profile-hash-a',
      contextVersion: 'recipe-persisted-context-v1',
      model: 'gemini-2.0',
      chunks: [],
    };

    const key = buildRecipeCacheKey(input);

    expect(buildRecipeCacheKey({ ...input, scope: { userId: 'user-2', tenantId: 'tenant-1' } })).not.toBe(
      key
    );
    expect(buildRecipeCacheKey({ ...input, scope: { userId: 'user-1', tenantId: 'tenant-2' } })).not.toBe(
      key
    );
    expect(buildRecipeCacheKey({ ...input, inventoryContextHash: 'inventory-hash-b' })).not.toBe(key);
    expect(buildRecipeCacheKey({ ...input, profileContextHash: 'profile-hash-b' })).not.toBe(key);
    expect(buildRecipeCacheKey({ ...input, contextVersion: 'recipe-persisted-context-v3' })).not.toBe(key);
    expect(buildRecipeCacheKey({ ...input, goals: ['Otro objetivo'] })).not.toBe(key);
    expect(key).not.toContain('Comidas rápidas');
    expect(key).not.toContain('private profile identity');
    expect(key).not.toContain('private pantry item');
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
  it('bounds the local fallback to 128 entries, evicting the oldest insertion', async () => {
    vi.stubEnv('REDIS_URL', '');
    vi.useFakeTimers();
    const data: CachedRecipe = {
      recipe: 'Arroz', title: 'Arroz', provider: 'gemini', mode: 'free',
      structuredIngredients: [], createdAt: Date.now(),
    };
    for (let index = 0; index < 129; index++) {
      await setCachedRecipe('bounded-' + index, data);
    }
    expect(await getCachedRecipe('bounded-0')).toBeNull();
    expect(await getCachedRecipe('bounded-1')).toEqual(data);
    expect(await getCachedRecipe('bounded-128')).toEqual(data);
    vi.advanceTimersByTime(21600 * 1000);
    expect(await getCachedRecipe('bounded-128')).toBeNull();
    const fresh = { ...data, createdAt: Date.now() };
    await setCachedRecipe('bounded-fresh', fresh);
    expect(await getCachedRecipe('bounded-1')).toBeNull();
    expect(await getCachedRecipe('bounded-fresh')).toEqual(fresh);
  });

  it('does not retain oversized or already expired local entries', async () => {
    vi.stubEnv('REDIS_URL', '');
    vi.useFakeTimers();
    const data: CachedRecipe = {
      recipe: 'Arroz', title: 'Arroz', provider: 'gemini', mode: 'free',
      structuredIngredients: [], createdAt: Date.now(),
    };
    await setCachedRecipe('oversized', data);
    await setCachedRecipe('oversized', { ...data, recipe: 'x'.repeat(256 * 1024) });
    expect(await getCachedRecipe('oversized')).toBeNull();
    await setCachedRecipe('expired', { ...data, createdAt: Date.now() - 21600 * 1000 });
    expect(await getCachedRecipe('expired')).toBeNull();
  });

  it('isolates local fallback keys by the existing E2E namespace', async () => {
    vi.stubEnv('REDIS_URL', '');
    const data: CachedRecipe = {
      recipe: 'Arroz', title: 'Arroz', provider: 'gemini', mode: 'free',
      structuredIngredients: [], createdAt: Date.now(),
    };
    vi.stubEnv('COCINACORE_E2E_CACHE_NAMESPACE', 'test-one');
    await setCachedRecipe('same-key', data);
    vi.stubEnv('COCINACORE_E2E_CACHE_NAMESPACE', 'test-two');
    expect(await getCachedRecipe('same-key')).toBeNull();
    vi.stubEnv('COCINACORE_E2E_CACHE_NAMESPACE', 'test-one');
    expect(await getCachedRecipe('same-key')).toEqual(data);
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
      default: class MockRedis {
        get = mockGet;
        set = mockSet;
        del = mockDel;
        connect = vi.fn().mockResolvedValue(undefined);
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
      provider: 'gemini' as const,
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
  it('recovers a local write after Redis reconnects but misses the key', async () => {
    vi.resetModules();
    const { getCachedRecipe, setCachedRecipe } = await import('./recipe-cache');
    const data: CachedRecipe = {
      recipe: 'Arroz', title: 'Arroz', provider: 'gemini', mode: 'free',
      structuredIngredients: [], createdAt: Date.now(),
    };
    mockSet.mockRejectedValueOnce(new Error('Connection opening'));
    await setCachedRecipe('reconnect-miss', data);
    mockGet.mockResolvedValue(null);
    expect(await getCachedRecipe('reconnect-miss')).toEqual(data);
    // A successful replacement supersedes the local fallback.
    mockSet.mockResolvedValue('OK');
    await setCachedRecipe('reconnect-miss', { ...data, title: 'Nueva receta' });
    expect(await getCachedRecipe('reconnect-miss')).toBeNull();
  });

  it('uses the local fallback when Redis contains invalid or expired data', async () => {
    vi.resetModules();
    const { getCachedRecipe, setCachedRecipe } = await import('./recipe-cache');
    const data: CachedRecipe = {
      recipe: 'Arroz', title: 'Arroz', provider: 'gemini', mode: 'free',
      structuredIngredients: [], createdAt: Date.now(),
    };
    mockSet.mockRejectedValueOnce(new Error('Connection refused'));
    await setCachedRecipe('invalid-redis', data);
    for (const invalid of [
      'not json',
      JSON.stringify({ ...data, structuredIngredients: [null] }),
      JSON.stringify({ ...data, createdAt: Date.now() - 21600 * 1000 }),
    ]) {
      mockGet.mockResolvedValueOnce(invalid);
      expect(await getCachedRecipe('invalid-redis')).toEqual(data);
    }
    expect(mockDel).not.toHaveBeenCalled();
    mockGet.mockResolvedValueOnce('not json');
    expect(await getCachedRecipe('no-local')).toBeNull();
  });

  it('prefers a newer valid local recipe over an older Redis hit', async () => {
    vi.resetModules();
    const { getCachedRecipe, setCachedRecipe } = await import('./recipe-cache');
    const data: CachedRecipe = {
      recipe: 'Arroz', title: 'Receta local', provider: 'gemini', mode: 'free',
      structuredIngredients: [], createdAt: Date.now(),
    };
    mockSet.mockRejectedValueOnce(new Error('Connection refused'));
    await setCachedRecipe('newer-local', data);
    mockGet.mockResolvedValueOnce(JSON.stringify({
      ...data, title: 'Receta anterior', createdAt: data.createdAt - 1000,
    }));
    expect(await getCachedRecipe('newer-local')).toEqual(data);
    const fresh = { ...data, title: 'Receta Redis' };
    mockGet.mockResolvedValueOnce(JSON.stringify(fresh));
    expect(await getCachedRecipe('newer-local')).toEqual(fresh);
  });

});
