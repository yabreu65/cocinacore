import { describe, expect, it } from 'vitest';
import type { RecipeInventoryItemRow } from '@/lib/db/types';
import type { MealConsumptionPayload } from './consumption';
import type { PersistedMealPlanProfileContext } from './profile-context';
import type { StructuredMealPlan } from './structured-plan';
import {
  buildAdaptiveMealPlanProposal,
  validateAdaptivePlanReplacement,
} from './adaptive-planning';

const profile: PersistedMealPlanProfileContext = {
  identity: [],
  preferred: [],
  avoid: [],
  goals: [],
  availableTimeMinutes: 30,
  allergies: [],
  dislikedIngredients: [],
};

const inventory = (overrides: Partial<RecipeInventoryItemRow> = {}): RecipeInventoryItemRow => ({
  id: 'item-1',
  tenant_id: 'tenant-1',
  user_id: 'user-1',
  ingredient_name: 'Tomate',
  quantity: '1',
  unit: 'kg',
  category: 'Verduras',
  expiration_date: '2026-10-28',
  estimated_unit_price: null,
  purchase_location: null,
  low_stock_threshold: null,
  normalized_name: 'tomate',
  notes: null,
  created_at: '2026-10-27T00:00:00.000Z',
  updated_at: '2026-10-27T00:00:00.000Z',
  ...overrides,
});

function meal(title: string, ingredientName: string, prepMinutes: number | null = 20) {
  return {
    mealType: 'dinner' as const,
    title,
    prepMinutes,
    description: null,
    ingredients: [{ name: ingredientName, quantity: 1, unit: 'kg' }],
  };
}

function plan(): StructuredMealPlan {
  return {
    period: 'week',
    dayCount: 2,
    availableTimeMinutesSnapshot: 30,
    days: [
      {
        dayIndex: 1,
        label: 'Día 1',
        meals: [
          { ...meal('Desayuno 1', 'Avena'), mealType: 'breakfast' },
          { ...meal('Almuerzo 1', 'Arroz'), mealType: 'lunch' },
          meal('Arroz posterior', 'Arroz'),
        ],
      },
      {
        dayIndex: 2,
        label: 'Día 2',
        meals: [
          { ...meal('Desayuno 2', 'Avena'), mealType: 'breakfast' },
          { ...meal('Almuerzo 2', 'Arroz'), mealType: 'lunch' },
          meal('Tomate urgente', 'Tomate'),
        ],
      },
    ],
  };
}

describe('buildAdaptiveMealPlanProposal', () => {
  it('prioritizes a real near-expiry ingredient without mutating the source plan', () => {
    const source = plan();
    const proposal = buildAdaptiveMealPlanProposal({
      plan: source,
      inventoryItems: [inventory()],
      profile,
      consumptionPayload: {},
      now: new Date('2026-10-27T12:00:00.000Z'),
    });

    expect(proposal.plan.days[0].meals.find((entry) => entry.mealType === 'dinner')?.title).toBe(
      'Tomate urgente'
    );
    expect(proposal.changes).toHaveLength(2);
    expect(source.days[0].meals[2].title).toBe('Arroz posterior');
  });

  it('does not move a consumed slot and reports unknown evidence conservatively', () => {
    const source = plan();
    const consumptionPayload: MealConsumptionPayload = {
      '1:dinner': {
        consumedAt: '2026-10-27T10:00:00.000Z',
        dayIndex: 1,
        mealType: 'dinner',
        mealTitle: 'Arroz posterior',
        decrements: [],
        skipped: [],
      },
    };
    const proposal = buildAdaptiveMealPlanProposal({
      plan: source,
      inventoryItems: [inventory({ expiration_date: null, quantity: null, unit: null })],
      profile: null,
      consumptionPayload,
      now: new Date('2026-10-27T12:00:00.000Z'),
    });

    expect(proposal.plan.days[0].meals.find((entry) => entry.mealType === 'dinner')?.title).toBe(
      'Arroz posterior'
    );
    expect(proposal.confidence).toBe('unknown');
    expect(proposal.evidence.some((entry) => entry.status === 'unknown')).toBe(true);
  });

  it('does not claim budget or time gains without comparable evidence', () => {
    const proposal = buildAdaptiveMealPlanProposal({
      plan: plan(),
      inventoryItems: [inventory({ estimated_unit_price: null })],
      profile: { ...profile, availableTimeMinutes: undefined },
      consumptionPayload: {},
      now: new Date('2026-10-27T12:00:00.000Z'),
    });

    expect(proposal.metrics.cost.status).toBe('unknown');
    expect(proposal.metrics.time.status).toBe('unknown');
  });

  it('keeps fractional compatible units and incompatible evidence conservative', () => {
    const source = plan();
    const proposal = buildAdaptiveMealPlanProposal({
      plan: source,
      inventoryItems: [
        inventory({ quantity: '1 1/2', unit: 'kg', expiration_date: '2026-10-28' }),
        inventory({
          id: 'item-2',
          ingredient_name: 'Tomate',
          quantity: '2',
          unit: 'unidad',
          expiration_date: null,
        }),
      ],
      profile,
      consumptionPayload: {},
      now: new Date('2026-10-27T12:00:00.000Z'),
    });

    expect(proposal.evidence.find((entry) => entry.label === 'Vencimientos')?.status).toBe(
      'unknown'
    );
    expect(proposal.plan.days.flatMap((day) => day.meals).map((meal) => meal.ingredients)).toEqual(
      source.days.flatMap((day) => day.meals).map((meal) => meal.ingredients)
    );
  });

  it('rejects confirmation payloads that alter the time snapshot or a consumed slot', () => {
    const source = plan();
    const changedSnapshot = { ...source, availableTimeMinutesSnapshot: 45 };
    expect(validateAdaptivePlanReplacement(source, changedSnapshot, {})).toEqual({
      valid: false,
      reason: 'time_snapshot_changed',
    });

    const consumed = {
      '1:dinner': {
        consumedAt: '2026-10-27T10:00:00.000Z',
        dayIndex: 1,
        mealType: 'dinner' as const,
        mealTitle: 'Arroz posterior',
        decrements: [],
        skipped: [],
      },
    };
    const swapped = buildAdaptiveMealPlanProposal({
      plan: source,
      inventoryItems: [inventory()],
      profile,
      consumptionPayload: consumed,
      now: new Date('2026-10-27T12:00:00.000Z'),
    }).plan;
    const unsafe = {
      ...swapped,
      days: swapped.days.map((day) => ({ ...day, meals: day.meals.map((meal) => ({ ...meal })) })),
    };
    unsafe.days[0].meals[2] = { ...unsafe.days[0].meals[2], title: 'Alterada' };
    expect(validateAdaptivePlanReplacement(source, unsafe, consumed)).toEqual({
      valid: false,
      reason: 'meal_content_changed',
    });
  });

  it('does not move a meal into a scheduled day that is already in the past', () => {
    const source: StructuredMealPlan = {
      ...plan(),
      dayCount: 3,
      days: [
        ...plan().days,
        {
          dayIndex: 3,
          label: 'Día 3',
          meals: [
            { ...meal('Desayuno 3', 'Avena'), mealType: 'breakfast' },
            { ...meal('Almuerzo 3', 'Arroz'), mealType: 'lunch' },
            meal('Tomate urgente', 'Tomate'),
          ],
        },
      ],
      schedule: {
        startDate: '2026-10-25',
        timeZone: 'America/Caracas',
        confirmedAt: '2026-10-24T12:00:00.000Z',
      },
    };
    const proposal = buildAdaptiveMealPlanProposal({
      plan: source,
      inventoryItems: [inventory()],
      profile,
      consumptionPayload: {},
      now: new Date('2026-10-27T15:00:00.000Z'),
    });

    expect(proposal.plan.days[0].meals.find((entry) => entry.mealType === 'dinner')?.title).toBe(
      'Arroz posterior'
    );
    expect(proposal.plan.days[2].meals.find((entry) => entry.mealType === 'dinner')?.title).toBe(
      'Tomate urgente'
    );
  });

  it('reports changes when meals share a title but differ in content', () => {
    const source: StructuredMealPlan = {
      ...plan(),
      days: [
        {
          dayIndex: 1,
          label: 'Día 1',
          meals: [
            { ...meal('Mismo título', 'Arroz'), mealType: 'breakfast' },
            { ...meal('Almuerzo 1', 'Arroz'), mealType: 'lunch' },
            meal('Mismo título', 'Arroz'),
          ],
        },
        {
          dayIndex: 2,
          label: 'Día 2',
          meals: [
            { ...meal('Desayuno 2', 'Avena'), mealType: 'breakfast' },
            { ...meal('Almuerzo 2', 'Arroz'), mealType: 'lunch' },
            meal('Mismo título', 'Tomate'),
          ],
        },
      ],
    };
    const proposal = buildAdaptiveMealPlanProposal({
      plan: source,
      inventoryItems: [inventory()],
      profile,
      consumptionPayload: {},
      now: new Date('2026-10-27T12:00:00.000Z'),
    });

    expect(proposal.changes).toHaveLength(2);
    expect(proposal.changes[0]?.previousMeal).toBe('Mismo título');
    expect(proposal.changes[0]?.proposedMeal).toBe('Mismo título');
  });

  it('does not let an expired lot hide a usable near-expiry lot', () => {
    const proposal = buildAdaptiveMealPlanProposal({
      plan: plan(),
      inventoryItems: [
        inventory({ expiration_date: '2026-10-20' }),
        inventory({ id: 'item-2', expiration_date: '2026-10-28' }),
      ],
      profile,
      consumptionPayload: {},
      now: new Date('2026-10-27T12:00:00.000Z'),
    });

    expect(proposal.plan.days[0].meals.find((entry) => entry.mealType === 'dinner')?.title).toBe(
      'Tomate urgente'
    );
    expect(proposal.evidence.find((entry) => entry.label === 'Vencimientos')?.status).toBe('known');
  });

  it('keeps a meal before its ingredient deadline when urgency scores conflict', () => {
    const source: StructuredMealPlan = {
      ...plan(),
      schedule: {
        startDate: '2026-10-27',
        timeZone: 'America/Caracas',
        confirmedAt: '2026-10-26T12:00:00.000Z',
      },
      days: [
        {
          dayIndex: 1,
          label: 'Día 1',
          meals: [
            { ...meal('Desayuno 1', 'Avena'), mealType: 'breakfast' },
            { ...meal('Almuerzo 1', 'Arroz'), mealType: 'lunch' },
            meal('Tomate vence hoy', 'Tomate'),
          ],
        },
        {
          dayIndex: 2,
          label: 'Día 2',
          meals: [
            { ...meal('Desayuno 2', 'Avena'), mealType: 'breakfast' },
            { ...meal('Almuerzo 2', 'Arroz'), mealType: 'lunch' },
            {
              ...meal('Cebolla urgente por volumen', 'Cebolla'),
              ingredients: [
                { name: 'Cebolla', quantity: 1, unit: 'kg' },
                { name: 'Cebolla', quantity: 1, unit: 'kg' },
                { name: 'Cebolla', quantity: 1, unit: 'kg' },
              ],
            },
          ],
        },
      ],
    };
    const proposal = buildAdaptiveMealPlanProposal({
      plan: source,
      inventoryItems: [
        inventory({ expiration_date: '2026-10-27' }),
        inventory({
          id: 'item-2',
          ingredient_name: 'Cebolla',
          normalized_name: 'cebolla',
          expiration_date: '2026-10-29',
        }),
      ],
      profile,
      consumptionPayload: {},
      now: new Date('2026-10-28T01:00:00.000Z'),
    });

    expect(proposal.plan.days[0].meals.find((entry) => entry.mealType === 'dinner')?.title).toBe(
      'Tomate vence hoy'
    );
    expect(proposal.plan.days[1].meals.find((entry) => entry.mealType === 'dinner')?.title).toBe(
      'Cebolla urgente por volumen'
    );
  });

  it('preserves known deadlines when another lot has unknown quantity', () => {
    const source: StructuredMealPlan = {
      ...plan(),
      schedule: {
        startDate: '2026-10-27',
        timeZone: 'America/Caracas',
        confirmedAt: '2026-10-26T12:00:00.000Z',
      },
    };
    const proposal = buildAdaptiveMealPlanProposal({
      plan: source,
      inventoryItems: [
        inventory({ expiration_date: '2026-10-27' }),
        inventory({ id: 'item-2', quantity: null, unit: null, expiration_date: '2026-10-27' }),
      ],
      profile,
      consumptionPayload: {},
      now: new Date('2026-10-27T12:00:00.000Z'),
    });

    expect(proposal.plan.days[0].meals.find((entry) => entry.mealType === 'dinner')?.title).toBe(
      'Arroz posterior'
    );
    expect(proposal.evidence.find((entry) => entry.label === 'Vencimientos')?.status).toBe(
      'unknown'
    );
  });
});
