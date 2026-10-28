import { describe, expect, it } from 'vitest';
import type { RecipeInventoryItemRow, UserRecipeDetailDto, UserMealPlanRow } from '@/lib/db/types';
import { buildCookingIntentPreview, type CookingIntentMealSlot } from './cooking-intent-preview';

const NOW = new Date('2026-10-28T16:00:00.000Z');

function inventory(overrides: Partial<RecipeInventoryItemRow> = {}): RecipeInventoryItemRow {
  return {
    id: 'inventory-1',
    tenant_id: 'tenant-1',
    user_id: 'user-1',
    ingredient_name: 'Tomato',
    quantity: '1 kg',
    unit: 'kg',
    category: null,
    expiration_date: '2026-11-02',
    estimated_unit_price: null,
    purchase_location: null,
    low_stock_threshold: null,
    normalized_name: 'tomato',
    notes: null,
    created_at: NOW.toISOString(),
    updated_at: NOW.toISOString(),
    ...overrides,
  };
}

function recipe(overrides: Partial<UserRecipeDetailDto> = {}): UserRecipeDetailDto {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    tenant_id: 'tenant-1',
    user_id: 'user-1',
    category: null,
    tags: [],
    archived_at: null,
    created_at: NOW.toISOString(),
    updated_at: NOW.toISOString(),
    current_version: {
      id: '00000000-0000-4000-8000-000000000002',
      recipe_id: '00000000-0000-4000-8000-000000000001',
      tenant_id: 'tenant-1',
      user_id: 'user-1',
      version_number: 1,
      title: 'Tomato rice',
      instructions: 'Cook the rice.\nAdd the tomato.',
      servings: 2,
      ingredients: [
        { name: 'Tomato', quantity: '600', unit: 'g' },
        { name: 'Rice', quantity: '1', unit: 'kg' },
      ],
      source_recipe_history_id: null,
      created_at: NOW.toISOString(),
    },
    ...overrides,
  };
}

function mealPlan(): UserMealPlanRow {
  return {
    id: '00000000-0000-4000-8000-000000000010',
    tenant_id: 'tenant-1',
    user_id: 'user-1',
    people_count: 2,
    period: 'week',
    mode: 'balanced_ai',
    base_cuisine: 'home',
    fusion_cuisines: [],
    fusion_intensity: 'sutil',
    goal: null,
    restrictions: [],
    inventory_snapshot: {},
    calendar_payload: {},
    consumption_payload: {},
    ai_content: null,
    created_at: NOW.toISOString(),
    updated_at: NOW.toISOString(),
  };
}

function preview(input: Partial<Parameters<typeof buildCookingIntentPreview>[0]> = {}) {
  return buildCookingIntentPreview({
    source: 'saved_recipe',
    recipe: recipe(),
    inventoryItems: [
      inventory(),
      inventory({
        id: 'inventory-2',
        ingredient_name: 'Rice',
        quantity: '500 g',
        unit: 'g',
        expiration_date: '2026-12-10',
      }),
    ],
    allergies: [],
    hardAvoid: [],
    profileConfigured: true,
    now: NOW,
    timeZone: 'America/Caracas',
    requestedPortions: null,
    ...input,
  });
}

describe('cooking intent preview', () => {
  it('builds a ready read-only preview from an owned saved recipe', () => {
    const result = preview();
    expect(result).toMatchObject({
      status: 'partial',
      source: 'saved_recipe',
      title: 'Tomato rice',
      portions: { original: 2, requested: 2, source: 'recipe' },
    });
    expect(result.ingredients).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'Tomato',
          availability: 'sufficient',
          requiredQuantity: 600,
          requiredUnit: 'g',
        }),
        expect.objectContaining({
          name: 'Rice',
          availability: 'partial',
          availableQuantity: 0.5,
          availableUnit: 'kg',
        }),
      ])
    );
    expect(result.steps).toHaveLength(2);
  });

  it('scales comparable quantities and consolidates repeated ingredients', () => {
    const result = preview({
      recipe: recipe({
        current_version: {
          ...recipe().current_version,
          servings: 2,
          ingredients: [
            { name: 'Tomato', quantity: '600', unit: 'g' },
            { name: 'Tomato', quantity: '0.6', unit: 'kg' },
          ],
        },
      }),
      inventoryItems: [inventory({ quantity: '2 kg', unit: 'kg' })],
      requestedPortions: 4,
    });
    expect(result.ingredients).toHaveLength(1);
    expect(result.ingredients[0]).toMatchObject({
      requiredQuantity: 2400,
      requiredUnit: 'g',
      availableQuantity: 2000,
      availability: 'partial',
    });
  });

  it('keeps missing units unknown instead of inferring a count', () => {
    const result = preview({
      recipe: recipe({
        current_version: {
          ...recipe().current_version,
          ingredients: [{ name: 'Tomato', quantity: '1 1/2', unit: null }],
        },
      }),
      inventoryItems: [inventory({ quantity: '2', unit: 'unidad' })],
    });
    expect(result.status).toBe('unknown');
    expect(result.ingredients[0]).toMatchObject({
      availability: 'unknown',
      requiredQuantity: null,
      requiredUnit: 'unknown',
    });
  });

  it('does not count expired lots as available', () => {
    const result = preview({ inventoryItems: [inventory({ expiration_date: '2026-10-27' })] });
    expect(result.ingredients.find((item) => item.name === 'Tomato')).toMatchObject({
      availability: 'missing',
      expiry: 'expired',
      availableQuantity: 0,
    });
  });

  it('keeps an unknown expiration fail-closed', () => {
    const result = preview({ inventoryItems: [inventory({ expiration_date: null })] });
    expect(result.ingredients.find((item) => item.name === 'Tomato')).toMatchObject({
      availability: 'unknown',
      expiry: 'unknown',
      evidence: 'unknown',
    });
  });

  it('blocks an allergy conflict explicitly', () => {
    const result = preview({ allergies: ['tomato'] });
    expect(result.status).toBe('blocked');
    expect(result.restrictions).toEqual({
      status: 'blocked',
      reasons: ['ingredient_restriction_conflict'],
    });
  });

  it('supports a confirmed plan slot without introducing a write', () => {
    const slot: CookingIntentMealSlot = {
      mealPlan: mealPlan(),
      dayIndex: 1,
      timeZone: 'America/Caracas',
      meal: {
        mealType: 'lunch',
        title: 'Tomato rice',
        prepMinutes: 30,
        description: 'A confirmed lunch',
        ingredients: [{ name: 'Tomato', quantity: 600, unit: 'g' }],
      },
    };
    const before = JSON.stringify(slot);
    const result = preview({ source: 'confirmed_meal_slot', recipe: undefined, mealSlot: slot });
    expect(result).toMatchObject({
      source: 'confirmed_meal_slot',
      status: 'ready',
      title: 'Tomato rice',
    });
    expect(JSON.stringify(slot)).toBe(before);
  });
});
