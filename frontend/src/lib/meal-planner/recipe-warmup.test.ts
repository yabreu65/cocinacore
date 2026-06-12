import { afterEach, describe, expect, it, vi } from 'vitest';
import { hydrateMealPlanWarmup, type WarmupPlannerDay } from './recipe-warmup';

describe('recipe-warmup', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
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
    });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(result.warmedSlots).toBe(3);
    expect(result.failed).toBe(0);
    expect(seenChunks.some((chunks) => chunks.includes('contexto-pdf'))).toBe(true);
    expect(result.calendar[0].meals.Desayuno.recipe_content).toBe('Receta de prueba');
    expect(result.calendar[1].meals.Desayuno.recipe_content).toBeUndefined();
  });
});
