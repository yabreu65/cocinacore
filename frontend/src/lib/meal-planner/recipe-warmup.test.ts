import { afterEach, describe, expect, it, vi } from 'vitest';
import { hydrateMealPlanWarmup, type WarmupPlannerDay } from './recipe-warmup';

describe('recipe-warmup', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('counts malformed recipe payloads as failures and sanitizes valid ingredient fields', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('null'))
      .mockResolvedValueOnce(new Response(JSON.stringify({ recipe: 123 })))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            recipe: '  Valid recipe  ',
            structuredIngredients: [
              { name: 'Tomato', normalized_name: 'tomato', structured: 'false' },
            ],
          })
        )
      );
    vi.stubGlobal('fetch', fetchMock);
    const meal = {
      name: 'Meal',
      time: '15 min',
      difficulty: 'Fácil' as const,
      badge: '',
      fusionTag: '',
      missing: 0,
      aiScore: 1,
    };
    const result = await hydrateMealPlanWarmup({
      origin: 'http://localhost:3000',
      calendar: [{ day: 'Lunes', meals: { Desayuno: meal, Almuerzo: meal, Cena: meal } }],
      targetDays: ['Lunes'],
      inventory: [],
      baseCuisine: '',
      fusionCuisines: [],
      peopleCount: 2,
      culinaryProfile: {},
    });

    expect(result.failed).toBe(2);
    expect(result.warmedSlots).toBe(1);
    expect(result.calendar[0].meals.Desayuno.recipe_content).toBeUndefined();
    expect(result.calendar[0].meals.Cena.recipe_content).toBe('Valid recipe');
    expect(result.calendar[0].meals.Cena.structured_ingredients?.[0].structured).toBe(false);
  });

  it('hydrates only target days and forwards rag context to recipe generation', async () => {
    const seenChunks: string[][] = [];
    const fetchMock = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as { chunks?: string[] };
      seenChunks.push(body.chunks ?? []);
      return new Response(
        JSON.stringify({
          recipe: 'Receta de prueba',
          structuredIngredients: [
            {
              name: 'Tomate',
              normalized_name: 'tomate',
              quantity: 2,
              unit: 'unidad',
              structured: true,
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    });

    vi.stubGlobal('fetch', fetchMock);
    vi.stubEnv('AUTH_SECRET', 'test-secret');

    const calendar: WarmupPlannerDay[] = [
      {
        day: 'Lunes',
        meals: {
          Desayuno: {
            name: 'Desayuno de Lunes',
            time: '15 min',
            difficulty: 'Fácil',
            badge: 'Perfil aplicado',
            fusionTag: 'Fusión',
            missing: 0,
            aiScore: 86,
            rag_context: ['contexto-pdf'],
          },
          Almuerzo: {
            name: 'Almuerzo de Lunes',
            time: '35 min',
            difficulty: 'Fácil',
            badge: 'Perfil aplicado',
            fusionTag: 'Fusión',
            missing: 0,
            aiScore: 86,
          },
          Cena: {
            name: 'Cena de Lunes',
            time: '25 min',
            difficulty: 'Fácil',
            badge: 'Perfil aplicado',
            fusionTag: 'Fusión',
            missing: 0,
            aiScore: 86,
          },
        },
      },
      {
        day: 'Martes',
        meals: {
          Desayuno: {
            name: 'Desayuno de Martes',
            time: '15 min',
            difficulty: 'Fácil',
            badge: 'Perfil aplicado',
            fusionTag: 'Fusión',
            missing: 0,
            aiScore: 86,
          },
          Almuerzo: {
            name: 'Almuerzo de Martes',
            time: '35 min',
            difficulty: 'Fácil',
            badge: 'Perfil aplicado',
            fusionTag: 'Fusión',
            missing: 0,
            aiScore: 86,
          },
          Cena: {
            name: 'Cena de Martes',
            time: '25 min',
            difficulty: 'Fácil',
            badge: 'Perfil aplicado',
            fusionTag: 'Fusión',
            missing: 0,
            aiScore: 86,
          },
        },
      },
    ];

    const result = await hydrateMealPlanWarmup({
      origin: 'http://localhost:3000',
      calendar,
      targetDays: ['Lunes'],
      inventory: ['tomate'],
      baseCuisine: 'Latinoamericana',
      fusionCuisines: ['Venezolana'],
      peopleCount: 4,
      culinaryProfile: {
        level: 'Intermedio',
        preferred: ['Familiar'],
        avoid: [],
        goals: ['Familia'],
      },
      actorUserId: 'user-1',
      actorTenantId: 'tenant-1',
    });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(result.warmedSlots).toBe(3);
    expect(result.failed).toBe(0);
    expect(seenChunks.some((chunks) => chunks.includes('contexto-pdf'))).toBe(true);
    expect(result.calendar[0].meals.Desayuno.recipe_content).toBe('Receta de prueba');
    expect(result.calendar[1].meals.Desayuno.recipe_content).toBeUndefined();
    const firstHeaders = fetchMock.mock.calls[0]?.[1]?.headers as Record<string, string>;
    expect(firstHeaders['X-CocinaCore-Warmup-Capability']).toEqual(expect.any(String));
    expect(firstHeaders['X-CocinaCore-Warmup-Job-Id']).toMatch(/^warmup:tenant-1:user-1:/);
  });

  it('caps provider fan-out even when all target days have empty meals', async () => {
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ recipe: 'Receta de prueba' }), { status: 200 })
    );
    vi.stubGlobal('fetch', fetchMock);
    const day = (dayName: string): WarmupPlannerDay => ({
      day: dayName,
      meals: {
        Desayuno: {
          name: 'Desayuno',
          time: '15 min',
          difficulty: 'Fácil',
          badge: '',
          fusionTag: '',
          missing: 0,
          aiScore: 1,
        },
        Almuerzo: {
          name: 'Almuerzo',
          time: '15 min',
          difficulty: 'Fácil',
          badge: '',
          fusionTag: '',
          missing: 0,
          aiScore: 1,
        },
        Cena: {
          name: 'Cena',
          time: '15 min',
          difficulty: 'Fácil',
          badge: '',
          fusionTag: '',
          missing: 0,
          aiScore: 1,
        },
      },
    });

    const result = await hydrateMealPlanWarmup({
      origin: 'http://localhost:3000',
      calendar: ['Lunes', 'Martes', 'Miércoles', 'Jueves'].map(day),
      targetDays: ['Lunes', 'Martes', 'Miércoles', 'Jueves'],
      inventory: [],
      baseCuisine: 'Latinoamericana',
      fusionCuisines: [],
      peopleCount: 2,
      culinaryProfile: {},
    });

    expect(fetchMock).toHaveBeenCalledTimes(9);
    expect(result.warmedSlots).toBe(9);
    expect(result.failed).toBe(3);
  });
});
