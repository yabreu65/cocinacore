import { describe, expect, it } from 'vitest';
import {
  RecipeGenerateSchema,
  MealPlanSchema,
  EmbeddingsSchema,
  InventorySuggestionSchema,
  MealPlanWarmupSchema,
  validateRequest,
} from './validation';

// ---------------------------------------------------------------------------
// RecipeGenerateSchema
// ---------------------------------------------------------------------------

describe('RecipeGenerateSchema', () => {
  it('accepts a minimal valid payload with defaults filled', () => {
    const result = RecipeGenerateSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.ingredients).toEqual([]);
      expect(result.data.mode).toBe('free');
      expect(result.data.provider).toBe('auto');
      expect(result.data.peopleCount).toBe(4);
    }
  });

  it('accepts a fully-specified payload', () => {
    const result = RecipeGenerateSchema.safeParse({
      ingredients: ['tomate', 'pollo', 'arroz'],
      chunks: ['contexto breve del pdf'],
      mode: 'rag',
      provider: 'gemini',
      recipeName: 'Arepas',
      mealType: 'Desayuno',
      day: 'Lunes',
      peopleCount: 2,
      culinaryProfile: {
        level: 'Intermedio',
        preferred: ['Familiar'],
        avoid: ['Mariscos'],
        goals: ['Saludable'],
        identity: ['Venezolana'],
      },
    });
    expect(result.success).toBe(true);
  });

  it('rejects mode that is not free/rag', () => {
    const result = RecipeGenerateSchema.safeParse({ mode: 'invalid' });
    expect(result.success).toBe(false);
  });

  it('rejects more than 30 ingredients', () => {
    const result = RecipeGenerateSchema.safeParse({
      ingredients: Array.from({ length: 31 }, (_, i) => `ingredient-${i}`),
    });
    expect(result.success).toBe(false);
  });

  it('rejects chunks over 2000 characters', () => {
    const result = RecipeGenerateSchema.safeParse({
      chunks: ['a'.repeat(2001)],
    });
    expect(result.success).toBe(false);
  });

  it('rejects peopleCount out of range', () => {
    expect(RecipeGenerateSchema.safeParse({ peopleCount: 0 }).success).toBe(false);
    expect(RecipeGenerateSchema.safeParse({ peopleCount: 101 }).success).toBe(false);
    expect(RecipeGenerateSchema.safeParse({ peopleCount: -1 }).success).toBe(false);
  });

  it('rejects empty string ingredient', () => {
    const result = RecipeGenerateSchema.safeParse({ ingredients: [''] });
    expect(result.success).toBe(false);
  });

  it('defaults mode to free and provider to auto when omitted', () => {
    const result = RecipeGenerateSchema.safeParse({ ingredients: ['pollo'] });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.mode).toBe('free');
      expect(result.data.provider).toBe('auto');
    }
  });

  it('rejects too many preferred/avoid/goals in culinaryProfile', () => {
    const eleven = Array.from({ length: 11 }, (_, i) => `item-${i}`);
    const result = RecipeGenerateSchema.safeParse({
      culinaryProfile: { preferred: eleven },
    });
    expect(result.success).toBe(false);
  });

  it('accepts null level in culinaryProfile', () => {
    const result = RecipeGenerateSchema.safeParse({
      culinaryProfile: { level: null },
    });
    expect(result.success).toBe(true);
  });

  it('rejects non-numeric peopleCount', () => {
    const result = RecipeGenerateSchema.safeParse({ peopleCount: 'abc' });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// MealPlanSchema
// ---------------------------------------------------------------------------

describe('MealPlanSchema', () => {
  it('accepts minimal payload with defaults', () => {
    const result = MealPlanSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.mode).toBe('inventory_to_menu');
      expect(result.data.period).toBe('week');
      expect(result.data.peopleCount).toBe(4);
    }
  });

  it('accepts menu_to_shopping mode', () => {
    const result = MealPlanSchema.safeParse({ mode: 'menu_to_shopping' });
    expect(result.success).toBe(true);
  });

  it('rejects invalid mode', () => {
    const result = MealPlanSchema.safeParse({ mode: 'free' });
    expect(result.success).toBe(false);
  });

  it('rejects more than 120 inventory items', () => {
    const result = MealPlanSchema.safeParse({
      inventory: Array.from({ length: 121 }, (_, i) => `item-${i}`),
    });
    expect(result.success).toBe(false);
  });

  it('rejects fusionIntensity outside enum', () => {
    const result = MealPlanSchema.safeParse({ fusionIntensity: 'extrema' });
    expect(result.success).toBe(false);
  });

  it('accepts valid fusionIntensity values', () => {
    expect(MealPlanSchema.safeParse({ fusionIntensity: 'sutil' }).success).toBe(true);
    expect(MealPlanSchema.safeParse({ fusionIntensity: 'media' }).success).toBe(true);
    expect(MealPlanSchema.safeParse({ fusionIntensity: 'alta' }).success).toBe(true);
  });

  it('rejects chunks over 2000 characters', () => {
    const result = MealPlanSchema.safeParse({ chunks: ['a'.repeat(2001)] });
    expect(result.success).toBe(false);
  });

  it('rejects more than 10 chunks', () => {
    const result = MealPlanSchema.safeParse({
      chunks: Array.from({ length: 11 }, (_, i) => `chunk-${i}`),
    });
    expect(result.success).toBe(false);
  });

  it('accepts full culinaryProfile', () => {
    const result = MealPlanSchema.safeParse({
      culinaryProfile: {
        preferred: ['Familiar'],
        avoid: ['Mariscos'],
        goals: ['Saludable'],
        level: 'Avanzado',
      },
    });
    expect(result.success).toBe(true);
  });

  it('rejects culinaryProfile preferred over 12 items', () => {
    const result = MealPlanSchema.safeParse({
      culinaryProfile: {
        preferred: Array.from({ length: 13 }, (_, i) => `pref-${i}`),
      },
    });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// EmbeddingsSchema
// ---------------------------------------------------------------------------

describe('EmbeddingsSchema', () => {
  it('accepts a valid texts array', () => {
    const result = EmbeddingsSchema.safeParse({
      texts: ['texto uno', 'texto dos'],
    });
    expect(result.success).toBe(true);
  });

  it('rejects empty texts array', () => {
    const result = EmbeddingsSchema.safeParse({ texts: [] });
    expect(result.success).toBe(false);
  });

  it('rejects missing texts field', () => {
    const result = EmbeddingsSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it('rejects more than 120 texts', () => {
    const result = EmbeddingsSchema.safeParse({
      texts: Array.from({ length: 121 }, (_, i) => `text-${i}`),
    });
    expect(result.success).toBe(false);
  });

  it('rejects text over 5000 characters', () => {
    const result = EmbeddingsSchema.safeParse({
      texts: ['a'.repeat(5001)],
    });
    expect(result.success).toBe(false);
  });

  it('rejects empty string text', () => {
    const result = EmbeddingsSchema.safeParse({ texts: [''] });
    expect(result.success).toBe(false);
  });

  it('accepts exactly 120 texts', () => {
    const result = EmbeddingsSchema.safeParse({
      texts: Array.from({ length: 120 }, (_, i) => `text-${i}`),
    });
    expect(result.success).toBe(true);
  });

  it('accepts text at max 5000 chars', () => {
    const result = EmbeddingsSchema.safeParse({ texts: ['a'.repeat(5000)] });
    expect(result.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// InventorySuggestionSchema
// ---------------------------------------------------------------------------

describe('InventorySuggestionSchema', () => {
  it('accepts a valid payload with menuContent', () => {
    const result = InventorySuggestionSchema.safeParse({
      menuContent: 'Lunes: Desayuno...',
    });
    expect(result.success).toBe(true);
  });

  it('rejects missing menuContent', () => {
    const result = InventorySuggestionSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it('rejects empty menuContent', () => {
    const result = InventorySuggestionSchema.safeParse({ menuContent: '' });
    expect(result.success).toBe(false);
  });

  it('rejects menuContent over 10000 characters', () => {
    const result = InventorySuggestionSchema.safeParse({
      menuContent: 'a'.repeat(10001),
    });
    expect(result.success).toBe(false);
  });

  it('accepts optional peopleCount', () => {
    const result = InventorySuggestionSchema.safeParse({
      menuContent: 'Menú semanal...',
      peopleCount: 6,
    });
    expect(result.success).toBe(true);
  });

  it('rejects peopleCount out of range', () => {
    expect(
      InventorySuggestionSchema.safeParse({
        menuContent: 'ok',
        peopleCount: 0,
      }).success
    ).toBe(false);
    expect(
      InventorySuggestionSchema.safeParse({
        menuContent: 'ok',
        peopleCount: 101,
      }).success
    ).toBe(false);
  });

  it('rejects non-integer peopleCount', () => {
    const result = InventorySuggestionSchema.safeParse({
      menuContent: 'ok',
      peopleCount: 2.5,
    });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// MealPlanWarmupSchema
// ---------------------------------------------------------------------------

describe('MealPlanWarmupSchema', () => {
  it('accepts valid calendar and targetDays arrays', () => {
    const result = MealPlanWarmupSchema.safeParse({
      calendar: [{ day: 'Lunes', meals: [] }],
      targetDays: ['Lunes', 'Martes'],
    });
    expect(result.success).toBe(true);
  });

  it('rejects missing calendar', () => {
    const result = MealPlanWarmupSchema.safeParse({
      targetDays: ['Lunes'],
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing targetDays', () => {
    const result = MealPlanWarmupSchema.safeParse({
      calendar: [{ day: 'Lunes' }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects empty calendar array', () => {
    const result = MealPlanWarmupSchema.safeParse({
      calendar: [],
      targetDays: ['Lunes'],
    });
    expect(result.success).toBe(false);
  });

  it('rejects empty targetDays array', () => {
    const result = MealPlanWarmupSchema.safeParse({
      calendar: [{ day: 'Lunes' }],
      targetDays: [],
    });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// validateRequest helper
// ---------------------------------------------------------------------------

describe('validateRequest', () => {
  const sampleSchema = MealPlanSchema;

  function fakeRequest(body: unknown): Request {
    return new Request('https://localhost/api/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  it('returns success with parsed data for valid body', async () => {
    const result = await validateRequest(
      fakeRequest({ mode: 'menu_to_shopping', peopleCount: 3 }),
      sampleSchema
    );
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.mode).toBe('menu_to_shopping');
      expect(result.data.peopleCount).toBe(3);
    }
  });

  it('returns error with 400 for invalid body', async () => {
    const result = await validateRequest(
      fakeRequest({ mode: 'invalid', peopleCount: 'abc' }),
      sampleSchema
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.status).toBe(400);
      expect(result.error.body.error).toBe('Validation failed');
      expect(Array.isArray(result.error.body.details)).toBe(true);
      expect(result.error.body.details.length).toBeGreaterThan(0);
    }
  });

  it('returns error for non-JSON body', async () => {
    const req = new Request('https://localhost/api/test', {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: 'not json',
    });
    const result = await validateRequest(req, sampleSchema);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.status).toBe(400);
      expect(result.error.body.error).toBe('Validation failed');
      expect(result.error.body.details[0]?.message).toContain('JSON');
    }
  });

  it('provides meaningful detail paths in error', async () => {
    const result = await validateRequest(fakeRequest({ peopleCount: -5 }), sampleSchema);
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.body.details.map((d) => d.path);
      expect(paths.some((p) => p.includes('peopleCount'))).toBe(true);
    }
  });
});
